import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error plain JS server code
import { cleanInboxTask, createApi, keyMatches } from '../server/api.js';
// @ts-expect-error plain JS server code
import { createStore } from '../server/store.js';
// @ts-expect-error plain JS server code
import { eventId, reconcile, toGoogle } from '../server/google.js';

describe('inbox tasks from the phone', () => {
  it('keeps only good fields', () => {
    const t = cleanInboxTask({ title: '  Finish Q5  ', due: '2026-10-30', minutes: '20', type: 'hack', required: false, extra: 1 }, 5);
    expect(t).toMatchObject({ title: 'Finish Q5', due: '2026-10-30', minutes: 20, type: 'classwork', required: false, added: 5 });
    expect(t).not.toHaveProperty('extra');
    expect(cleanInboxTask({ title: '', due: '2026-10-30' })).toBeNull();
    expect(cleanInboxTask({ title: 'x', due: 'friday' })).toBeNull();
    expect(cleanInboxTask({ title: 'x', due: '2026-10-30', minutes: 99999 }).minutes).toBe(600);
  });

  it('checks the key', () => {
    expect(keyMatches('abc', 'abc')).toBe(true);
    expect(keyMatches('abd', 'abc')).toBe(false);
    expect(keyMatches('abc', '')).toBe(false);
    expect(keyMatches(undefined, 'abc')).toBe(false);
  });
});

describe('the server API', () => {
  let server: Server;
  let base = '';
  let dir = '';
  const headers = { 'x-study-key': 'secret', 'Content-Type': 'application/json' };

  beforeAll(async () => {
    process.env.APP_KEY = 'secret';
    dir = await mkdtemp(join(tmpdir(), 'study-'));
    const api = createApi(createStore(dir));
    server = createServer(async (req, res) => {
      const handled = await api.handle(req, res, new URL(req.url ?? '/', 'http://localhost'));
      if (!handled) res.writeHead(200).end('app');
    });
    await new Promise<void>((r) => server.listen(0, r));
    const addr = server.address();
    base = `http://localhost:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterAll(async () => {
    server.close();
    await rm(dir, { recursive: true, force: true });
    delete process.env.APP_KEY;
  });

  it('turns away the wrong key', async () => {
    const res = await fetch(base + '/api/inbox', { headers: { 'x-study-key': 'nope' } });
    expect(res.status).toBe(401);
    const start = await fetch(base + '/auth/google/start?k=nope', { redirect: 'manual' });
    expect(start.status).toBe(401);
  });

  it('keeps homework from the phone until the laptop collects it', async () => {
    const add = await fetch(base + '/api/inbox', { method: 'POST', headers, body: JSON.stringify({ title: 'Read ch 3', due: '2026-10-27', minutes: 15 }) });
    expect(add.status).toBe(201);
    const { items } = await (await fetch(base + '/api/inbox', { headers })).json();
    expect(items).toHaveLength(1);
    const status = await (await fetch(base + '/api/status', { headers })).json();
    expect(status).toMatchObject({ ok: true, connected: false, inbox: 1 });
    await fetch(base + '/api/inbox/ack', { method: 'POST', headers, body: JSON.stringify({ ids: [items[0].id] }) });
    expect((await (await fetch(base + '/api/inbox', { headers })).json()).items).toEqual([]);
  });

  it('leaves the app alone and refuses a Google return it did not start', async () => {
    expect(await (await fetch(base + '/')).text()).toBe('app');
    const back = await fetch(base + '/auth/google/callback?state=made-up&code=x', { redirect: 'manual' });
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe('/#/planner/connect/expired');
  });

  it('says when Google is not connected', async () => {
    const res = await fetch(base + '/api/google/calendars', { headers });
    expect(res.status).toBe(409);
  });
});

describe('pushing to Google', () => {
  it('makes all-day and timed events with stable ids', () => {
    expect(eventId('task:1')).toMatch(/^sa[0-9a-f]{40}$/);
    expect(eventId('task:1')).toBe(eventId('task:1'));
    expect(toGoogle({ key: 'a', title: 'Essay', date: '2026-10-31' })).toMatchObject({ start: { date: '2026-10-31' }, end: { date: '2026-11-01' } });
    expect(toGoogle({ key: 'b', title: 'Study', start: '2026-10-26T06:20:00.000Z', end: '2026-10-26T07:05:00.000Z' }).start.dateTime).toBe(
      '2026-10-26T06:20:00.000Z',
    );
  });

  it('adds, updates and removes only what changed', async () => {
    const calls: string[] = [];
    const unchanged = toGoogle({ key: 'same', title: 'Same', date: '2026-10-30' });
    const changed = toGoogle({ key: 'moved', title: 'Moved', date: '2026-10-29' });
    const stale = { id: eventId('gone'), summary: 'Gone', start: { date: '2026-10-28' }, end: { date: '2026-10-29' } };
    const client = {
      async call(method: string, path: string) {
        calls.push(`${method} ${path.split('?')[0].split('/').pop()}`);
        if (method === 'GET') return { items: [unchanged, changed, stale] };
        if (method === 'PUT' && path.includes(eventId('new'))) {
          throw Object.assign(new Error('nope'), { status: 404 });
        }
        return {};
      },
    };
    const counts = await reconcile(
      client,
      'cal',
      [
        { key: 'same', title: 'Same', date: '2026-10-30' },
        { key: 'moved', title: 'Moved', date: '2026-10-31' },
        { key: 'new', title: 'New', date: '2026-11-01' },
      ],
      '2026-10-20T00:00:00Z',
      '2026-12-01T00:00:00Z',
    );
    expect(counts).toEqual({ added: 1, updated: 1, removed: 1 });
    expect(calls).toEqual([
      'GET events',
      `PUT ${eventId('moved')}`,
      `PUT ${eventId('new')}`,
      'POST events',
      `DELETE ${eventId('gone')}`,
    ]);
  });
});
