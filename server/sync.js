// Keeps one copy of all your study data on the server so every device (the
// laptop, the phone, each Zen space) can catch up with the others. Each device
// still keeps its own full copy in the browser and works offline; it sends
// what changed and collects what the others changed whenever it's online.
//
// Data is a list of records, one per saved thing (a card, a review, a skill),
// each with a running number (seq). A device asks for everything after the
// last number it saw. Deleting leaves a small "deleted" marker so the other
// devices delete it too.
//
// It lives in SQLite in DATA_DIR (a Railway volume), not in store.json,
// because question pictures make it far too big to rewrite on every change.

import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/** The app's stores that sync. Anything else is refused. */
export const SYNC_STORES = new Set([
  'decks',
  'cards',
  'reviewLogs',
  'meta',
  'skills',
  'problems',
  'attempts',
  'testPlans',
  'images',
  'tasks',
  'plans',
  'marks',
  'weeklyReviews',
]);
/** The only meta entries that sync. The app key and sync state stay on each device. */
export const SYNC_META = new Set(['settings', 'availability', 'calendarCache']);

/** About how much one pull sends back, so a phone's first sync comes in pieces. */
const PAGE_BYTES = 3_000_000;
const PAGE_ROWS = 2000;

export function validChange(c) {
  if (!c || typeof c !== 'object') return false;
  if (typeof c.store !== 'string' || !SYNC_STORES.has(c.store)) return false;
  if (typeof c.key !== 'string' || !c.key || c.key.length > 200) return false;
  if (c.store === 'meta' && !SYNC_META.has(c.key)) return false;
  if (c.deleted) return true;
  return c.value !== undefined && c.value !== null && typeof c.value === 'object';
}

export function createSyncStore(dir = process.env.DATA_DIR || './data') {
  let opened = null;

  /** Opens the database the first time it's needed, so a server without SQLite still serves the app. */
  function open() {
    opened ??= (async () => {
      const { DatabaseSync } = await import('node:sqlite');
      await mkdir(dir, { recursive: true });
      const db = new DatabaseSync(join(dir, 'sync.db'));
      db.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS records (
          store TEXT NOT NULL,
          key TEXT NOT NULL,
          seq INTEGER NOT NULL,
          deleted INTEGER NOT NULL DEFAULT 0,
          data TEXT,
          device TEXT,
          at INTEGER NOT NULL,
          PRIMARY KEY (store, key)
        );
        CREATE INDEX IF NOT EXISTS records_seq ON records (seq);
        CREATE TABLE IF NOT EXISTS info (name TEXT PRIMARY KEY, value TEXT);
      `);
      // A new id whenever the database starts empty, so devices notice a wiped server and send everything again.
      let id = db.prepare('SELECT value FROM info WHERE name = ?').get('id')?.value;
      if (!id) {
        id = randomUUID();
        db.prepare('INSERT INTO info (name, value) VALUES (?, ?)').run('id', id);
      }
      return {
        db,
        id,
        maxSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM records'),
        upsert: db.prepare(`
          INSERT INTO records (store, key, seq, deleted, data, device, at) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (store, key) DO UPDATE SET seq = excluded.seq, deleted = excluded.deleted,
            data = excluded.data, device = excluded.device, at = excluded.at
        `),
        page: db.prepare('SELECT store, key, seq, deleted, data FROM records WHERE seq > ? AND (device IS NULL OR device != ?) ORDER BY seq LIMIT ?'),
        counts: db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM records WHERE deleted = 0'),
      };
    })();
    opened.catch(() => (opened = null));
    return opened;
  }

  async function status() {
    const s = await open();
    const { n, bytes } = s.counts.get();
    return { id: s.id, cursor: Number(s.maxSeq.get().n), records: Number(n), bytes: Number(bytes) };
  }

  /** Saves a device's changes. Later changes to the same record replace earlier ones. */
  async function push(device, changes, now = Date.now()) {
    const s = await open();
    s.db.exec('BEGIN IMMEDIATE');
    try {
      let seq = Number(s.maxSeq.get().n);
      for (const c of changes) {
        seq += 1;
        s.upsert.run(c.store, c.key, seq, c.deleted ? 1 : 0, c.deleted ? null : JSON.stringify(c.value), device, now);
      }
      s.db.exec('COMMIT');
      return { id: s.id, cursor: seq };
    } catch (e) {
      s.db.exec('ROLLBACK');
      throw e;
    }
  }

  /**
   * Everything changed after `since`, leaving out what this device sent itself.
   * Comes in pages: when `more` is true, ask again from the new cursor.
   */
  async function pull(device, since) {
    const s = await open();
    const rows = s.page.all(since, device, PAGE_ROWS);
    const changes = [];
    let bytes = 0;
    let cursor = since;
    for (const r of rows) {
      if (changes.length && bytes + (r.data?.length ?? 0) > PAGE_BYTES) break;
      bytes += r.data?.length ?? 0;
      cursor = Number(r.seq);
      changes.push(r.deleted ? { store: r.store, key: r.key, deleted: true } : { store: r.store, key: r.key, value: JSON.parse(r.data) });
    }
    const more = changes.length < rows.length || rows.length === PAGE_ROWS;
    // Nothing more for this device: jump past its own changes so it doesn't ask for them again.
    if (!more) cursor = Number(s.maxSeq.get().n);
    return { id: s.id, changes, cursor, more };
  }

  /** Only for tests. */
  async function close() {
    if (opened) (await opened).db.close();
    opened = null;
  }

  return { status, push, pull, close };
}
