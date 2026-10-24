// Planner days are local date keys like "2026-10-27", so a due date never
// shifts with time zones or daylight saving.

import { studyDayStart } from '../queue';

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export function dateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local midnight of a date key. */
export function keyToTime(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d + n).getTime());
}

/** Whole days from a to b (b later is positive). */
export function daysBetween(a: string, b: string): number {
  return Math.round((keyToTime(b) - keyToTime(a)) / 86_400_000);
}

/** 0 Sunday to 6 Saturday. */
export function weekday(key: string): number {
  return new Date(keyToTime(key)).getDay();
}

/** Today's key, where a new day starts at the study day hour (4am by default). */
export function todayKey(now: number, dayStartHour: number): string {
  return dateKey(studyDayStart(now, dayStartHour));
}

/** "Today", "Tomorrow", "Wed 29 Oct". */
export function dayLabel(key: string, today: string): string {
  const diff = daysBetween(today, key);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return new Date(keyToTime(key)).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "due today", "due tomorrow", "due Fri", "due 12 Nov", "2 days late". */
export function dueLabel(due: string, today: string): string {
  const diff = daysBetween(today, due);
  if (diff < 0) return `${-diff} day${diff === -1 ? '' : 's'} late`;
  if (diff === 0) return 'due today';
  if (diff === 1) return 'due tomorrow';
  const d = new Date(keyToTime(due));
  if (diff < 7) return 'due ' + d.toLocaleDateString('en-AU', { weekday: 'short' });
  return 'due ' + d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

/** "17:20" to minutes after midnight. */
export function clockMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 1050 to "17:30". */
export function clockText(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "45 min", "1 h 30". */
export function minutesText(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') : ''}`;
}
