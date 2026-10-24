// Google Calendar for the Study App. The server holds the Google sign-in (a
// refresh token) so the laptop never stores it. It only WRITES to the two
// calendars it makes itself, and only READS the calendars you pick.

import { createHash } from 'node:crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';

// app.created: make and edit only calendars this app created.
// calendarlist.readonly + events.readonly: see your other calendars, never change them.
export const SCOPES =
  process.env.GOOGLE_SCOPES ||
  [
    'https://www.googleapis.com/auth/calendar.app.created',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.events.readonly',
  ].join(' ');

export const CALENDARS = {
  due: { summary: 'Study App: Due dates', description: 'Homework, tests, exams and assignment milestones. Made by the Study App; edit them in the app.' },
  blocks: { summary: 'Study App: Study blocks', description: 'Your planned study windows. Made by the Study App; hide this calendar any time.' },
};

export const TIME_ZONE = process.env.TIME_ZONE || 'Australia/Sydney';

export class GoogleError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function googleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function authUrl(redirectUri, state) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${q}`;
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      ...params,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new GoogleError(res.status === 400 ? 401 : 502, body.error_description || body.error || 'Google sign-in failed');
  return body;
}

export async function exchangeCode(code, redirectUri) {
  const body = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  if (!body.refresh_token) throw new GoogleError(502, 'Google did not give the app a long-term sign-in. Try connecting again.');
  return body.refresh_token;
}

/** Calendar API calls with an access token that is refreshed as needed. */
export function createClient(store) {
  let access = null;

  async function token() {
    if (access && access.expires > Date.now() + 60_000) return access.token;
    const { google } = await store.read();
    if (!google?.refreshToken) throw new GoogleError(409, 'Google Calendar is not connected.');
    try {
      const body = await tokenRequest({ refresh_token: google.refreshToken, grant_type: 'refresh_token' });
      access = { token: body.access_token, expires: Date.now() + body.expires_in * 1000 };
      return access.token;
    } catch (e) {
      // The sign-in was taken back (or expired): forget it so the app asks to connect again.
      if (e.status === 401) await store.update((d) => void (d.google = null));
      throw e;
    }
  }

  async function call(method, path, body) {
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${await token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new GoogleError(res.status, data.error?.message || `Google Calendar said ${res.status}`);
    return data;
  }

  return { call, forget: () => (access = null) };
}

/** Google lets an app choose an event's id (letters a to v and digits), so the same item always maps to the same event. */
export function eventId(key) {
  return 'sa' + createHash('sha1').update(key).digest('hex');
}

/** The app's two calendars, made the first time they are needed (and again if you delete one). */
export async function ensureCalendar(client, store, which) {
  const { google } = await store.read();
  const known = google?.calendars?.[which];
  if (known) {
    try {
      await client.call('GET', `/calendars/${encodeURIComponent(known)}`);
      return known;
    } catch (e) {
      if (e.status !== 404 && e.status !== 403) throw e;
    }
  }
  const made = await client.call('POST', '/calendars', { ...CALENDARS[which], timeZone: TIME_ZONE });
  await store.update((d) => {
    if (d.google) d.google.calendars = { ...(d.google.calendars ?? {}), [which]: made.id };
  });
  return made.id;
}

/** Turns the app's event shape into Google's. All-day events have a date; others a start and end time. */
export function toGoogle(ev) {
  const base = {
    id: eventId(ev.key),
    summary: String(ev.title).slice(0, 300),
    description: ev.description ? String(ev.description).slice(0, 4000) : undefined,
    status: 'confirmed',
    transparency: ev.date ? 'transparent' : 'opaque',
    reminders: { useDefault: false, overrides: [] },
  };
  if (ev.date) {
    const end = new Date(ev.date + 'T00:00:00Z');
    end.setUTCDate(end.getUTCDate() + 1);
    return { ...base, start: { date: ev.date }, end: { date: end.toISOString().slice(0, 10) } };
  }
  return { ...base, start: { dateTime: ev.start, timeZone: TIME_ZONE }, end: { dateTime: ev.end, timeZone: TIME_ZONE } };
}

function same(a, b) {
  const when = (x) => x?.date ?? (x?.dateTime ? new Date(x.dateTime).getTime() : null);
  return (
    a.summary === b.summary &&
    (a.description ?? '') === (b.description ?? '') &&
    when(a.start) === when(b.start) &&
    when(a.end) === when(b.end)
  );
}

async function listAll(client, calendarId, from, to, extra = {}) {
  const items = [];
  let pageToken;
  do {
    const q = new URLSearchParams({ timeMin: from, timeMax: to, singleEvents: 'true', maxResults: '2500', ...extra });
    if (pageToken) q.set('pageToken', pageToken);
    const page = await client.call('GET', `/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return items;
}

/**
 * Makes one of the app's calendars match the list it was sent, between two
 * times: new events are added, changed ones updated, and ones the app no
 * longer has are removed. Returns what changed.
 */
export async function reconcile(client, calendarId, wanted, from, to) {
  const existing = await listAll(client, calendarId, from, to);
  const byId = new Map(existing.map((e) => [e.id, e]));
  const desired = wanted.map(toGoogle);
  const keep = new Set(desired.map((e) => e.id));
  const counts = { added: 0, updated: 0, removed: 0 };
  const path = (id) => `/calendars/${encodeURIComponent(calendarId)}/events/${id}`;
  for (const ev of desired) {
    const old = byId.get(ev.id);
    if (old && same(old, ev)) continue;
    try {
      await client.call('PUT', path(ev.id), ev);
      counts[old ? 'updated' : 'added']++;
    } catch (e) {
      if (e.status !== 404) throw e;
      await client.call('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, ev);
      counts.added++;
    }
  }
  for (const old of existing) {
    if (keep.has(old.id)) continue;
    try {
      await client.call('DELETE', path(old.id));
      counts.removed++;
    } catch (e) {
      if (e.status !== 404 && e.status !== 410) throw e;
    }
  }
  return counts;
}

/** Events from one of your own calendars, cut down to what the planner needs. */
export async function readEvents(client, calendarId, from, to) {
  const items = await listAll(client, calendarId, from, to, { orderBy: 'startTime' });
  return items
    .filter((e) => e.status !== 'cancelled')
    .map((e) => ({
      title: e.summary ?? '',
      start: e.start?.dateTime ?? e.start?.date,
      end: e.end?.dateTime ?? e.end?.date,
      allDay: !e.start?.dateTime,
    }));
}
