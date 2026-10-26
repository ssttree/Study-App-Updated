// The server's small API: the phone's homework inbox and Google Calendar.
// Everything except the Google sign-in return needs the app key (APP_KEY,
// set in Railway), so nobody else can add homework or read your calendars.

import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  authUrl,
  createClient,
  ensureCalendar,
  exchangeCode,
  GoogleError,
  googleConfigured,
  readEvents,
  reconcile,
} from './google.js';

const TYPES = new Set(['classwork', 'smartered', 'assignment', 'other']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_INBOX = 500;
/** Sign-in attempts waiting for Google to send you back. */
const pendingStates = new Map();

export function keyMatches(given, key = process.env.APP_KEY) {
  if (!key || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Checks a homework task sent from the phone and keeps only the fields the app uses. */
export function cleanInboxTask(body, now = Date.now()) {
  if (!body || typeof body !== 'object') return null;
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
  if (!title || typeof body.due !== 'string' || !DATE.test(body.due)) return null;
  const minutes = Math.round(Number(body.minutes));
  return {
    id: randomUUID(),
    title,
    subject: typeof body.subject === 'string' ? body.subject.slice(0, 60) : '',
    type: TYPES.has(body.type) ? body.type : 'classwork',
    due: body.due,
    minutes: Number.isFinite(minutes) ? Math.max(5, Math.min(600, minutes)) : 20,
    required: body.required !== false,
    study: body.study === 'flashcards' ? 'flashcards' : 'desk',
    notes: typeof body.notes === 'string' ? body.notes.slice(0, 2000) : '',
    added: now,
  };
}

async function readJson(req, limit = 1_000_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new GoogleError(413, 'Too much data');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new GoogleError(400, 'That was not JSON');
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
  return true;
}

function redirect(res, to) {
  res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' });
  res.end();
  return true;
}

/** Where Google sends you back to. Railway sits behind a proxy, so trust its forwarded headers. */
function callbackUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '') + '/auth/google/callback';
  const proto = req.headers['x-forwarded-proto']?.split(',')[0] || 'http';
  return `${proto}://${req.headers.host}/auth/google/callback`;
}

const isoDay = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

export function createApi(store) {
  const client = createClient(store);

  async function handle(req, res, url) {
    const path = url.pathname;

    // Google sends you back here after you say yes. The state proves the sign-in started from the app.
    if (path === '/auth/google/callback') {
      const state = url.searchParams.get('state') ?? '';
      const started = pendingStates.get(state);
      pendingStates.delete(state);
      if (!started || Date.now() - started > 15 * 60_000) return redirect(res, '/#/planner/connect/expired');
      if (url.searchParams.get('error')) return redirect(res, '/#/planner/connect/declined');
      try {
        const refreshToken = await exchangeCode(url.searchParams.get('code') ?? '', callbackUrl(req));
        await store.update((d) => void (d.google = { refreshToken, calendars: d.google?.calendars ?? {}, connected: Date.now() }));
        client.forget();
        return redirect(res, '/#/planner/connect/done');
      } catch {
        return redirect(res, '/#/planner/connect/failed');
      }
    }

    if (!path.startsWith('/api/') && path !== '/auth/google/start') return false;
    if (!process.env.APP_KEY) return send(res, 503, { error: 'The server has no APP_KEY yet. Add one in Railway.' });
    const given = path === '/auth/google/start' ? url.searchParams.get('k') : req.headers['x-study-key'];
    if (!keyMatches(given)) return send(res, 401, { error: 'Wrong app key.' });

    try {
      if (path === '/auth/google/start') {
        if (!googleConfigured()) return send(res, 503, { error: 'Google is not set up on the server yet.' });
        const state = randomBytes(24).toString('hex');
        pendingStates.set(state, Date.now());
        return redirect(res, authUrl(callbackUrl(req), state));
      }

      if (path === '/api/status' && req.method === 'GET') {
        const d = await store.read();
        return send(res, 200, { ok: true, google: googleConfigured(), connected: !!d.google?.refreshToken, inbox: d.inbox.length, redirect: callbackUrl(req) });
      }

      // The phone's inbox: the phone adds, the laptop collects and then says which it saved.
      if (path === '/api/inbox' && req.method === 'POST') {
        const task = cleanInboxTask(await readJson(req, 20_000));
        if (!task) return send(res, 400, { error: 'A task needs a title and a due date.' });
        const full = await store.update((d) => {
          if (d.inbox.length >= MAX_INBOX) return true;
          d.inbox.push(task);
          return false;
        });
        if (full) return send(res, 507, { error: 'The inbox is full. Open the app on your laptop to collect it.' });
        return send(res, 201, { task });
      }
      if (path === '/api/inbox' && req.method === 'GET') {
        return send(res, 200, { items: (await store.read()).inbox });
      }
      if (path === '/api/inbox/ack' && req.method === 'POST') {
        const { ids } = await readJson(req);
        const done = new Set(Array.isArray(ids) ? ids : []);
        await store.update((d) => void (d.inbox = d.inbox.filter((t) => !done.has(t.id))));
        return send(res, 200, { ok: true });
      }

      if (path === '/api/google/disconnect' && req.method === 'POST') {
        await store.update((d) => void (d.google = null));
        client.forget();
        return send(res, 200, { ok: true });
      }
      if (path === '/api/google/calendars' && req.method === 'GET') {
        const list = await client.call('GET', '/users/me/calendarList?maxResults=250');
        const own = new Set(Object.values((await store.read()).google?.calendars ?? {}));
        const calendars = (list.items ?? [])
          .filter((c) => !own.has(c.id))
          .map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, primary: !!c.primary }));
        return send(res, 200, { calendars });
      }
      // The laptop tells the server which calendar is the timetable, so the phone can guess the subject.
      if (path === '/api/google/settings' && req.method === 'POST') {
        const { timetableCalendarId } = await readJson(req);
        await store.update((d) => void (d.timetableCalendarId = typeof timetableCalendarId === 'string' ? timetableCalendarId : null));
        return send(res, 200, { ok: true });
      }
      if (path === '/api/google/events' && req.method === 'POST') {
        const { calendarIds, from, to } = await readJson(req);
        if (!Array.isArray(calendarIds) || !isoDay(from) || !isoDay(to)) return send(res, 400, { error: 'Bad request' });
        const out = {};
        for (const id of calendarIds.slice(0, 5)) {
          if (typeof id === 'string') out[id] = await readEvents(client, id, from, to);
        }
        return send(res, 200, { events: out });
      }
      // The lesson on right now, from the timetable calendar (for the phone's subject guess).
      if (path === '/api/lesson-now' && req.method === 'GET') {
        const { timetableCalendarId, google } = await store.read();
        if (!timetableCalendarId || !google?.refreshToken) return send(res, 200, { title: null });
        const now = Date.now();
        const events = await readEvents(client, timetableCalendarId, new Date(now - 60 * 60_000).toISOString(), new Date(now + 60 * 60_000).toISOString());
        // In a lesson, or within 10 minutes after one (packing up is when homework gets set).
        const lesson = events.filter((e) => !e.allDay && Date.parse(e.start) <= now && Date.parse(e.end) + 10 * 60_000 >= now).pop();
        return send(res, 200, { title: lesson?.title ?? null });
      }
      // The laptop sends the full list for each of the app's calendars; the server makes Google match it.
      if (path === '/api/google/push' && req.method === 'POST') {
        const body = await readJson(req, 4_000_000);
        const result = {};
        for (const which of ['due', 'blocks']) {
          const part = body[which];
          if (!part || !Array.isArray(part.events) || !isoDay(part.from) || !isoDay(part.to)) continue;
          const events = part.events.filter((e) => e && typeof e.key === 'string' && typeof e.title === 'string' && (DATE.test(e.date ?? '') || (isoDay(e.start) && isoDay(e.end))));
          const calendarId = await ensureCalendar(client, store, which);
          result[which] = await reconcile(client, calendarId, events, part.from, part.to);
        }
        return send(res, 200, { result });
      }
      return send(res, 404, { error: 'Not found' });
    } catch (e) {
      const status = e instanceof GoogleError ? e.status : 500;
      if (status === 500) console.error(e);
      return send(res, status >= 400 && status < 600 ? status : 502, { error: e instanceof Error ? e.message : 'Server error' });
    }
  }

  return { handle };
}
