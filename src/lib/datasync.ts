// Keeps every device's copy of your data the same: the laptop, the phone and
// each Zen space (which all have their own separate browser storage). Each
// one keeps working offline; when online it sends what changed here and
// collects what changed elsewhere, through the Railway server.
//
// How it spots changes: it remembers a short fingerprint of every record as
// it was at the last sync. Anything with a new fingerprint changed here,
// anything gone was deleted here. That way no screen has to remember to say
// it saved something.
//
// When the same record changed on two devices between syncs, the one with
// the later `updated` time wins (a card reviewed on both). Otherwise the
// other device's copy wins, since this device has had its chance to send.

import { db } from './db';
import { api } from './sync';

/** Stores that sync, besides a few meta entries. */
export const SYNCED_STORES = [
  'decks',
  'cards',
  'reviewLogs',
  'skills',
  'problems',
  'attempts',
  'testPlans',
  'images',
  'tasks',
  'plans',
  'marks',
  'weeklyReviews',
] as const;
type SyncedStore = (typeof SYNCED_STORES)[number] | 'meta';

/** Settings and study windows sync; the app key and this file's own state stay on each device. */
export const SYNCED_META = ['settings', 'availability', 'calendarCache'] as const;

/** Never changed once saved (only added or deleted), so their keys are enough. Saves reading every picture each time. */
const KEY_ONLY = new Set<SyncedStore>(['reviewLogs', 'images']);

/** About how much one upload carries. */
const PUSH_BYTES = 2_500_000;

export interface DataSyncState {
  /** This browser's own id, so the server doesn't send its own changes back. */
  device: string;
  /** The server database this device last synced with. A new id means the server was wiped. */
  serverId: string;
  /** The last change from the server this device has. */
  cursor: number;
  /** Fingerprint of each record at the last sync, by "store/key". */
  base: Record<string, string>;
  lastSync?: number;
  lastError?: string;
  /** Records sent and collected by the last sync, for Settings. */
  lastSent?: number;
  lastGot?: number;
}

interface Change {
  store: SyncedStore;
  key: string;
  deleted?: boolean;
  value?: unknown;
}

interface Local {
  store: SyncedStore;
  key: string;
  hash: string;
  /** Left out for key-only stores until it's needed. */
  value?: unknown;
}

export interface ServerSyncStatus {
  id: string;
  cursor: number;
  records: number;
  bytes: number;
}

const recordId = (store: string, key: string) => `${store}/${key}`;

/** A short fingerprint of a record (cyrb53). Two different records almost never match. */
export function fingerprint(store: string, value: unknown): string {
  if (KEY_ONLY.has(store as SyncedStore)) return '1';
  const s = JSON.stringify(value) ?? '';
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Which copy to keep when a record changed both here and on another device. */
export function remoteWins(local: unknown, remote: Change): boolean {
  if (remote.deleted || !local) return true;
  const a = (local as { updated?: unknown }).updated;
  const b = (remote.value as { updated?: unknown }).updated;
  if (typeof a === 'number' && typeof b === 'number') return b >= a;
  return true;
}

// The state lives in the meta store, which never syncs it.

export async function getDataSyncState(): Promise<DataSyncState> {
  const stored = (await (await db()).get('meta', 'dataSync')) as DataSyncState | undefined;
  return stored ?? { device: crypto.randomUUID(), serverId: '', cursor: 0, base: {} };
}

async function saveState(state: DataSyncState): Promise<void> {
  await (await db()).put('meta', state, 'dataSync');
}

const ALL = [...SYNCED_STORES, 'meta'] as const;

/** Reads every synced record and its fingerprint. */
async function snapshot(): Promise<Map<string, Local>> {
  const out = new Map<string, Local>();
  const tx = (await db()).transaction(ALL, 'readonly');
  for (const store of SYNCED_STORES) {
    const os = tx.objectStore(store);
    const keys = (await os.getAllKeys()).map(String);
    if (KEY_ONLY.has(store)) {
      for (const key of keys) out.set(recordId(store, key), { store, key, hash: '1' });
      continue;
    }
    // getAll and getAllKeys come back in the same key order.
    const values = await os.getAll();
    keys.forEach((key, i) => out.set(recordId(store, key), { store, key, hash: fingerprint(store, values[i]), value: values[i] }));
  }
  for (const key of SYNCED_META) {
    const value = await tx.objectStore('meta').get(key);
    if (value !== undefined) out.set(recordId('meta', key), { store: 'meta', key, hash: fingerprint('meta', value), value });
  }
  await tx.done;
  return out;
}

/** Records that changed here since the last sync, by id. */
function localChanges(local: Map<string, Local>, base: Record<string, string>): Set<string> {
  const changed = new Set<string>();
  for (const [id, l] of local) if (base[id] !== l.hash) changed.add(id);
  for (const id of Object.keys(base)) if (!local.has(id)) changed.add(id);
  return changed;
}

/** Saves another device's changes here. Returns how many actually changed something. */
async function applyChanges(changes: Change[], local: Map<string, Local>, pending: Set<string>, state: DataSyncState): Promise<number> {
  const tx = (await db()).transaction(ALL, 'readwrite');
  let applied = 0;
  for (const c of changes) {
    const id = recordId(c.store, c.key);
    const hash = c.deleted ? undefined : fingerprint(c.store, c.value);
    const os = tx.objectStore(c.store);
    if (pending.has(id)) {
      if (!remoteWins(local.get(id)?.value, c)) continue;
      pending.delete(id);
    } else {
      if (state.base[id] === hash && local.get(id)?.hash === hash) continue;
      // Changed here since the snapshot (say, a review just now): keep it, it goes up next time.
      if (!KEY_ONLY.has(c.store)) {
        const now = await os.get(c.key);
        if ((now === undefined ? undefined : fingerprint(c.store, now)) !== local.get(id)?.hash) continue;
      }
    }
    if (c.deleted) await os.delete(c.key);
    else if (c.store === 'meta') await os.put(c.value as never, c.key);
    else await os.put(c.value as never);
    if (hash === undefined) {
      delete state.base[id];
      local.delete(id);
    } else {
      state.base[id] = hash;
      local.set(id, { store: c.store, key: c.key, hash, value: c.value });
    }
    applied++;
  }
  await tx.done;
  return applied;
}

/** Turns the waiting changes into uploads of a sensible size. */
async function* uploads(pending: Set<string>, local: Map<string, Local>): AsyncGenerator<{ changes: Change[]; ids: string[] }> {
  let batch: Change[] = [];
  let ids: string[] = [];
  let size = 0;
  const database = await db();
  for (const id of pending) {
    const slash = id.indexOf('/');
    const store = id.slice(0, slash) as SyncedStore;
    const key = id.slice(slash + 1);
    const l = local.get(id);
    let change: Change;
    if (!l) change = { store, key, deleted: true };
    else {
      const value = KEY_ONLY.has(store) ? await database.get(store as never, key) : l.value;
      // Deleted since the snapshot: it goes up as a deletion next time.
      if (value === undefined) continue;
      change = { store, key, value };
    }
    const bytes = change.value ? JSON.stringify(change.value).length : 50;
    if (batch.length && size + bytes > PUSH_BYTES) {
      yield { changes: batch, ids };
      batch = [];
      ids = [];
      size = 0;
    }
    batch.push(change);
    ids.push(id);
    size += bytes;
  }
  if (batch.length) yield { changes: batch, ids };
}

export interface DataSyncResult {
  sent: number;
  got: number;
}

/**
 * One full sync: collect what other devices changed, then send what changed
 * here. Throws if the server can't be reached; the caller records the error.
 */
export function syncData(key: string, onProgress?: (got: number) => void): Promise<DataSyncResult> {
  // One at a time: a second call waits for the first, then runs.
  const next = queue.then(() => runSync(key, onProgress));
  queue = next.catch(() => {});
  return next;
}

let queue: Promise<unknown> = Promise.resolve();

async function runSync(key: string, onProgress?: (got: number) => void): Promise<DataSyncResult> {
  const state = await getDataSyncState();
  const status = await api<ServerSyncStatus>(key, '/api/sync/status');
  if (status.id !== state.serverId) {
    // First sync, or the server was wiped: treat everything here as new and send it all.
    state.serverId = status.id;
    state.cursor = 0;
    state.base = {};
  }
  const local = await snapshot();
  const pending = localChanges(local, state.base);
  let got = 0;
  let sent = 0;

  // 1. Collect, page by page. Progress is saved so a dropped connection picks up where it stopped.
  for (let more = true; more; ) {
    const page = await api<{ id: string; changes: Change[]; cursor: number; more: boolean }>(
      key,
      `/api/sync/pull?device=${state.device}&since=${state.cursor}`,
    );
    if (page.id !== state.serverId) throw new Error('The server was reset during the sync. It will start again next time.');
    got += await applyChanges(page.changes, local, pending, state);
    onProgress?.(got);
    state.cursor = page.cursor;
    more = page.more;
    await saveState(state);
  }

  // 2. Send.
  for await (const { changes, ids } of uploads(pending, local)) {
    await api(key, '/api/sync/push', { method: 'POST', body: { device: state.device, changes } });
    for (const id of ids) {
      const l = local.get(id);
      if (l) state.base[id] = l.hash;
      else delete state.base[id];
    }
    sent += changes.length;
    await saveState(state);
  }

  state.lastSync = Date.now();
  state.lastError = undefined;
  state.lastSent = sent;
  state.lastGot = got;
  await saveState(state);
  return { sent, got };
}

export async function noteSyncError(message: string): Promise<void> {
  const state = await getDataSyncState();
  await saveState({ ...state, lastSync: Date.now(), lastError: message });
}

/** How many records this device holds, to decide whether joining needs a choice. */
export async function localRecordCount(): Promise<number> {
  const database = await db();
  let n = 0;
  for (const store of SYNCED_STORES) {
    // Planner days are rebuilt by themselves, so they don't count as "your data".
    if (store !== 'plans') n += await database.count(store);
  }
  return n;
}

/**
 * Empties this device's study data so the next sync fills it from the server.
 * Used when joining a device that already has old data (another Zen space,
 * an old copy) and you want the synced copy instead.
 */
export async function clearForJoin(): Promise<void> {
  const database = await db();
  const tx = database.transaction(ALL, 'readwrite');
  for (const store of SYNCED_STORES) await tx.objectStore(store).clear();
  for (const key of SYNCED_META) await tx.objectStore('meta').delete(key);
  const state = (await tx.objectStore('meta').get('dataSync')) as DataSyncState | undefined;
  if (state) await tx.objectStore('meta').put({ ...state, serverId: '', cursor: 0, base: {} }, 'dataSync');
  await tx.done;
}
