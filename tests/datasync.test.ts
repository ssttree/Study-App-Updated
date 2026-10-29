import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error plain JS server code
import { createApi } from '../server/api.js';
// @ts-expect-error plain JS server code
import { createStore } from '../server/store.js';
// @ts-expect-error plain JS server code
import { createSyncStore, validChange } from '../server/sync.js';
import {
  deleteDeck,
  getCard,
  getImage,
  getSettings,
  listCards,
  listDecks,
  listReviewLogs,
  recordReview,
  resetDbConnection,
  saveCard,
  saveDeck,
  saveImage,
  saveSettings,
  saveSyncConfig,
} from '../src/lib/db';
import { clearForJoin, fingerprint, getDataSyncState, localRecordCount, remoteWins, syncData } from '../src/lib/datasync';
import { blankCard } from '../src/lib/cards';
import { makeScheduler, rate } from '../src/lib/scheduler';
import { DEFAULT_SETTINGS, DEFAULT_SYNC } from '../src/lib/types';

// Each "device" is its own browser storage, like a Zen space or the phone.
const devices: Record<string, IDBFactory> = {};
async function use(name: string) {
  await resetDbConnection();
  devices[name] ??= new IDBFactory();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = devices[name];
}

let server: Server;
let syncStore: { close(): Promise<void> };
let dir = '';
const realFetch = globalThis.fetch;

async function startServer(where: string) {
  syncStore = createSyncStore(where);
  const api = createApi(createStore(where), syncStore);
  server = createServer(async (req, res) => {
    if (!(await api.handle(req, res, new URL(req.url ?? '/', 'http://localhost')))) res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://localhost:${typeof addr === 'object' && addr ? addr.port : 0}`;
  globalThis.fetch = ((input: string, init?: RequestInit) => realFetch(input.startsWith('/') ? base + input : input, init)) as typeof fetch;
}

async function stopServer() {
  await new Promise((r) => server.close(r));
  await syncStore.close();
}

beforeAll(async () => {
  process.env.APP_KEY = 'secret';
  dir = await mkdtemp(join(tmpdir(), 'study-sync-'));
  await startServer(dir);
});

afterAll(async () => {
  await stopServer();
  globalThis.fetch = realFetch;
  await rm(dir, { recursive: true, force: true });
  delete process.env.APP_KEY;
});

const deck = (id: string, name: string) => ({ id, name, subject: 'Chemistry', module: '', typingDefault: 'off' as const, created: 1, updated: 1 });

describe('the pieces', () => {
  it('fingerprints change with the record', () => {
    expect(fingerprint('cards', { a: 1 })).toBe(fingerprint('cards', { a: 1 }));
    expect(fingerprint('cards', { a: 1 })).not.toBe(fingerprint('cards', { a: 2 }));
    // Pictures and reviews never change once saved, so only their keys count.
    expect(fingerprint('images', { data: 'x' })).toBe(fingerprint('images', { data: 'y' }));
  });

  it('keeps the later edit when both devices changed a record', () => {
    expect(remoteWins({ updated: 5 }, { store: 'cards', key: 'c', value: { updated: 9 } })).toBe(true);
    expect(remoteWins({ updated: 9 }, { store: 'cards', key: 'c', value: { updated: 5 } })).toBe(false);
    expect(remoteWins({ updated: 9 }, { store: 'cards', key: 'c', deleted: true })).toBe(true);
    expect(remoteWins({ id: 'x' }, { store: 'tasks', key: 'x', value: { id: 'x' } })).toBe(true);
  });

  it('refuses stores and meta entries that never sync', () => {
    expect(validChange({ store: 'cards', key: 'a', value: { id: 'a' } })).toBe(true);
    expect(validChange({ store: 'cards', key: 'a', deleted: true })).toBe(true);
    expect(validChange({ store: 'meta', key: 'settings', value: {} })).toBe(true);
    expect(validChange({ store: 'meta', key: 'sync', value: { key: 'secret' } })).toBe(false);
    expect(validChange({ store: 'evil', key: 'a', value: {} })).toBe(false);
    expect(validChange({ store: 'cards', key: '', value: {} })).toBe(false);
    expect(validChange({ store: 'cards', key: 'a' })).toBe(false);
  });
});

describe('syncing two devices', () => {
  it('copies the laptop to a new device', async () => {
    await use('laptop');
    await saveSyncConfig({ ...DEFAULT_SYNC, key: 'secret' });
    await saveDeck(deck('d1', 'Equilibrium'));
    await saveDeck(deck('d2', 'Acids'));
    const card = { ...blankCard('d1', 100), id: 'c1', front: 'Le Chatelier?', back: 'Shifts to oppose the change' };
    await saveCard(card);
    await saveImage({ id: 'img1', data: 'data:image/png;base64,AAAA', width: 1, height: 1 });
    await saveSettings({ ...DEFAULT_SETTINGS, newPerDay: 12 });
    const first = await syncData('secret');
    expect(first.sent).toBe(5);

    await use('zen-space-2');
    expect(await localRecordCount()).toBe(0);
    const got = await syncData('secret');
    expect(got.got).toBe(5);
    expect((await listDecks()).map((d) => d.name)).toEqual(['Acids', 'Equilibrium']);
    expect((await getCard('c1'))?.back).toBe('Shifts to oppose the change');
    expect((await getImage('img1'))?.data).toBe('data:image/png;base64,AAAA');
    expect((await getSettings()).newPerDay).toBe(12);
    // Nothing new on either side.
    expect(await syncData('secret')).toEqual({ sent: 0, got: 0 });
  });

  it('carries reviews and deletions back', async () => {
    await use('zen-space-2');
    const card = (await getCard('c1'))!;
    const { card: after, log } = rate(makeScheduler(DEFAULT_SETTINGS), card, 'forward', 3);
    await recordReview(after, log);
    await deleteDeck('d2');
    expect((await syncData('secret')).sent).toBe(3);

    await use('laptop');
    const got = await syncData('secret');
    expect(got.got).toBe(3);
    expect((await listDecks()).map((d) => d.id)).toEqual(['d1']);
    expect(await listReviewLogs()).toHaveLength(1);
    expect((await getCard('c1'))?.fsrs.reps).toBe(1);
  });

  it('keeps the newer edit when both changed the same card offline', async () => {
    await use('laptop');
    const c = (await getCard('c1'))!;
    await saveCard({ ...c, back: 'laptop edit' });
    await new Promise((r) => setTimeout(r, 5));
    await use('zen-space-2');
    await saveCard({ ...(await getCard('c1'))!, back: 'later edit' });

    await use('laptop');
    await syncData('secret');
    await use('zen-space-2');
    await syncData('secret');
    expect((await getCard('c1'))?.back).toBe('later edit');
    await use('laptop');
    await syncData('secret');
    expect((await getCard('c1'))?.back).toBe('later edit');
  });

  it('never syncs the app key or this device’s own sync state', async () => {
    await use('zen-space-2');
    const state = await getDataSyncState();
    await use('laptop');
    expect((await getDataSyncState()).device).not.toBe(state.device);
  });

  it('replaces an old copy when joining with "use the synced copy"', async () => {
    await use('old-space');
    await saveDeck(deck('stale', 'Old stuff'));
    await clearForJoin();
    await syncData('secret');
    expect((await listDecks()).map((d) => d.id)).toEqual(['d1']);
    // The old deck never reached the server.
    await use('laptop');
    await syncData('secret');
    expect((await listDecks()).map((d) => d.id)).toEqual(['d1']);
  });

  it('collects big pictures in pieces', async () => {
    await use('laptop');
    const big = 'data:image/png;base64,' + 'A'.repeat(1_200_000);
    for (let i = 0; i < 5; i++) await saveImage({ id: `big${i}`, data: big + i, width: 1, height: 1 });
    expect((await syncData('secret')).sent).toBe(5);
    await use('phone');
    let pages = 0;
    await syncData('secret', () => pages++);
    expect(pages).toBeGreaterThan(1);
    expect((await getImage('big4'))?.data.endsWith('4')).toBe(true);
    expect(await listCards()).toHaveLength(1);
  });

  it('sends everything again when the server was wiped', async () => {
    await stopServer();
    const fresh = await mkdtemp(join(tmpdir(), 'study-sync-'));
    await startServer(fresh);
    await use('laptop');
    const result = await syncData('secret');
    expect(result.sent).toBeGreaterThan(5);
    await use('new-phone');
    await syncData('secret');
    expect((await getCard('c1'))?.back).toBe('later edit');
    await rm(fresh, { recursive: true, force: true });
  });

  it('turns away the wrong key', async () => {
    await expect(syncData('nope')).rejects.toThrow(/key/i);
  });
});
