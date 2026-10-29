// Talks to the Railway server whenever this device is online: syncs all
// your data with your other devices (see datasync.ts), collects homework
// added on the quick add page, refreshes the copy of your work and timetable
// calendars, and pushes due dates and study blocks to Google. Everything
// else in the app keeps working offline; this just catches up later.

import {
  getCalendarCache,
  getSettings,
  getSyncConfig,
  listTasks,
  saveCalendarCache,
  saveSyncConfig,
  saveTasks,
} from './db';
import { noteSyncError, syncData } from './datasync';
import { addDays, keyToTime, todayKey } from './planner/dates';
import { blockEvents, dueEvents, toCalEvent, type CalendarCache } from './planner/calendar';
import { itemText } from './planner/labels';
import { loadPlanner } from './planner/load';
import type { SyncConfig, Task } from './types';

/** How often your data syncs with your other devices while the app is open. */
export const DATA_SYNC_EVERY = 60_000;
/** How often the phone inbox and Google Calendar are checked. "Sync now" ignores this. */
export const SYNC_EVERY = 10 * 60_000;
/** Sent on window when another device's changes arrived, so the screen can reload. */
export const DATA_SYNCED = 'study-data-synced';
/** Days of your calendars kept for offline planning. */
const READ_BACK = 1;
const READ_AHEAD = 21;

export class SyncError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(key: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      headers: { 'x-study-key': key, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new SyncError(0, "Can't reach the server. You might be offline.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new SyncError(res.status, (data as { error?: string }).error ?? `The server said ${res.status}.`);
  return data as T;
}

export interface ServerStatus {
  ok: boolean;
  google: boolean;
  connected: boolean;
  inbox: number;
  redirect: string;
}

interface InboxItem {
  id: string;
  title: string;
  subject: string;
  type: Task['type'];
  due: string;
  minutes: number;
  required: boolean;
  study?: Task['study'];
  notes: string;
  added: number;
}

/** A task from the phone. It keeps the inbox id, so collecting the same one twice changes nothing. */
export function taskFromInbox(item: InboxItem): Task {
  return {
    id: item.id,
    title: item.title,
    subject: item.subject,
    type: item.type,
    due: item.due,
    minutes: item.minutes,
    spent: 0,
    required: item.required,
    study: item.study === 'flashcards' ? 'flashcards' : 'desk',
    status: 'open',
    notes: item.notes,
    carryOvers: 0,
    created: item.added,
  };
}

export interface SyncResult {
  /** Records sent to and collected from your other devices. */
  sent: number;
  got: number;
  collected: number;
  pushed: boolean;
  calendarsRead: boolean;
  error?: string;
}

let running: Promise<SyncResult> | null = null;

/** Syncs if it's been a while (or always, when forced). Never throws: problems are saved and shown in Settings. */
export function sync(force = false): Promise<SyncResult> {
  running ??= run(force).finally(() => (running = null));
  return running;
}

async function run(force: boolean): Promise<SyncResult> {
  const result: SyncResult = { sent: 0, got: 0, collected: 0, pushed: false, calendarsRead: false };
  let config = await getSyncConfig();
  if (!config.key) return result;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return result;

  // Your data, every time.
  try {
    const data = await syncData(config.key);
    result.sent = data.sent;
    result.got = data.got;
    if (data.got && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(DATA_SYNCED, { detail: data.got }));
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    await noteSyncError(result.error);
    if (e instanceof SyncError && (e.status === 0 || e.status === 401)) return result;
  }

  if (!force && config.lastSync && Date.now() - config.lastSync < SYNC_EVERY) return result;
  try {
    const status = await api<ServerStatus>(config.key, '/api/status');
    config = { ...config, connected: status.connected };

    // 1. Homework added on the phone.
    if (status.inbox > 0) {
      const { items } = await api<{ items: InboxItem[] }>(config.key, '/api/inbox');
      const known = new Set((await listTasks()).map((t) => t.id));
      const fresh = items.filter((i) => !known.has(i.id)).map(taskFromInbox);
      if (fresh.length) await saveTasks(fresh);
      await api(config.key, '/api/inbox/ack', { method: 'POST', body: { ids: items.map((i) => i.id) } });
      result.collected = fresh.length;
    }

    // Only one device talks to Google; the others get the calendar copy through sync.
    if (status.connected && config.google !== false) {
      // 2. A fresh copy of your work and timetable calendars.
      result.calendarsRead = await readCalendars(config);
      // 3. Due dates and study blocks out to Google.
      if (config.pushDue || config.pushBlocks) {
        const data = await loadPlanner();
        const tasks = new Map(data.tasks.map((t) => [t.id, t]));
        const assessments = new Map(data.assessments.map((a) => [a.id, a]));
        const blocks = blockEvents(data.days, (it) => itemText(it, tasks, assessments, data.today).title);
        await api(config.key, '/api/google/push', {
          method: 'POST',
          body: {
            due: config.pushDue ? dueEvents(data.tasks, data.assessments, data.today) : undefined,
            // Turned off: the calendar is emptied for the coming week rather than left out of date.
            blocks: config.pushBlocks ? blocks : { ...blocks, events: [] },
          },
        });
        result.pushed = true;
      }
    }
    await saveSyncConfig({ ...config, lastSync: Date.now(), lastError: undefined });
  } catch (e) {
    result.error ??= e instanceof Error ? e.message : String(e);
    const connected = e instanceof SyncError && e.status === 409 ? false : config.connected;
    await saveSyncConfig({ ...config, connected, lastSync: Date.now(), lastError: e instanceof Error ? e.message : String(e) });
  }
  return result;
}

/** Fetches the chosen calendars for the next three weeks and keeps a copy. */
export async function readCalendars(config: SyncConfig): Promise<boolean> {
  const ids = [config.workCalendarId, config.timetableCalendarId].filter(Boolean);
  if (!ids.length) {
    await saveCalendarCache(null);
    return false;
  }
  const settings = await getSettings();
  const today = todayKey(Date.now(), settings.dayStartHour);
  const from = addDays(today, -READ_BACK);
  const to = addDays(today, READ_AHEAD);
  const { events } = await api<{ events: Record<string, { title: string; start: string; end: string; allDay: boolean }[]> }>(
    config.key,
    '/api/google/events',
    { method: 'POST', body: { calendarIds: ids, from: new Date(keyToTime(from)).toISOString(), to: new Date(keyToTime(addDays(to, 1))).toISOString() } },
  );
  const cache: CalendarCache = {
    fetched: Date.now(),
    from,
    to,
    work: (events[config.workCalendarId] ?? []).map(toCalEvent),
    timetable: (events[config.timetableCalendarId] ?? []).map(toCalEvent),
  };
  await saveCalendarCache(cache);
  return true;
}

export { getCalendarCache };
