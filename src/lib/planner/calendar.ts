// Google Calendar, the planner's side. Reading: work shifts take out study
// windows (with 30 minutes to get there and back), school holidays take out
// the bus, and the lesson on now guesses the subject for quick add. Writing:
// due dates and study blocks become events in the app's own two calendars.
// The last copy of your calendars is kept so all of this works offline.

import type { PlanItem, StudyWindow, Task, TestPlan } from '../types';
import { addDays, clockMinutes, dateKey, keyToTime, weekday } from './dates';
import { KIND_LABEL, kindOf } from './assessments';
import type { DayContext } from './availability';
import { shortSubject } from '../practice/load';

/** An event from one of your calendars, with times as milliseconds. */
export interface CalEvent {
  title: string;
  start: number;
  end: number;
  allDay: boolean;
}

export interface CalendarCache {
  fetched: number;
  /** Date keys the copy covers. */
  from: string;
  to: string;
  work: CalEvent[];
  timetable: CalEvent[];
}

export const SHIFT_BUFFER = 30;

/** Turns the server's event (ISO strings, or plain dates for all-day events) into a CalEvent. */
export function toCalEvent(e: { title: string; start: string; end: string; allDay: boolean }): CalEvent {
  const time = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? keyToTime(v) : Date.parse(v));
  return { title: e.title, start: time(e.start), end: time(e.end), allDay: e.allDay };
}

const NOT_SCHOOL = /holiday|vacation|pupil.?free|staff development|no school/i;

export function dayContext(cache: CalendarCache | null, key: string): DayContext | undefined {
  if (!cache || key < cache.from || key > cache.to) return undefined;
  const dayStart = keyToTime(key);
  const dayEnd = keyToTime(addDays(key, 1));
  const busy = cache.work
    .filter((e) => !e.allDay && e.start < dayEnd && e.end > dayStart)
    .map((e) => ({
      start: Math.max(0, Math.round((e.start - dayStart) / 60_000) - SHIFT_BUFFER),
      end: Math.min(24 * 60, Math.round((e.end - dayStart) / 60_000) + SHIFT_BUFFER),
    }));
  let schoolDay: boolean | undefined;
  const day = weekday(key);
  if (cache.timetable.length && day >= 1 && day <= 5) {
    const today = cache.timetable.filter((e) => e.start < dayEnd && e.end > dayStart);
    schoolDay = today.some((e) => !NOT_SCHOOL.test(e.title)) && !today.some((e) => e.allDay && NOT_SCHOOL.test(e.title));
  }
  return { busy, schoolDay };
}

/** The lesson on now (or that just finished), from the timetable. */
export function lessonAt(cache: CalendarCache | null, now: number): string | null {
  if (!cache) return null;
  const lesson = cache.timetable.filter((e) => !e.allDay && e.start <= now && e.end + 10 * 60_000 >= now).pop();
  return lesson?.title ?? null;
}

/** One event the app wants in one of its own calendars. */
export interface PushEvent {
  /** Stable name, so the same item keeps the same Google event. */
  key: string;
  title: string;
  description?: string;
  /** All-day events have a date; others have ISO start and end times. */
  date?: string;
  start?: string;
  end?: string;
}

export interface PushPart {
  events: PushEvent[];
  from: string;
  to: string;
}

/** Days back that due dates are kept in Google, so last week's still show. */
export const DUE_BACK_DAYS = 14;
export const DUE_AHEAD_DAYS = 400;

/** Homework still to do and every assessment, as all-day events. */
export function dueEvents(tasks: Task[], assessments: TestPlan[], today: string): PushPart {
  const from = addDays(today, -DUE_BACK_DAYS);
  const to = addDays(today, DUE_AHEAD_DAYS);
  const events: PushEvent[] = [];
  for (const t of tasks) {
    if (t.status !== 'open' || t.due < from || t.due >= to) continue;
    const subject = t.subject ? `${shortSubject(t.subject)}: ` : '';
    events.push({
      key: `task:${t.id}`,
      title: `${subject}${t.title}${t.required ? '' : ' (optional)'}`,
      description: `About ${t.minutes} min.${t.notes ? '\n\n' + t.notes : ''}`,
      date: t.due,
    });
  }
  for (const a of assessments) {
    const date = dateKey(a.date);
    if (date < from || date >= to) continue;
    events.push({
      key: `assessment:${a.id}`,
      title: `${KIND_LABEL[kindOf(a)]}: ${a.name}`,
      description: [shortSubject(a.subject), a.weighting ? `${a.weighting}%` : ''].filter(Boolean).join(' · '),
      date,
    });
  }
  return { events, from: new Date(keyToTime(from)).toISOString(), to: new Date(keyToTime(to)).toISOString() };
}

/** The planned study windows for the next week, each with a one-line summary of the plan. */
export function blockEvents(
  days: { date: string; windows: StudyWindow[]; plan: { items: PlanItem[] } }[],
  title: (item: PlanItem) => string,
): PushPart {
  const events: PushEvent[] = [];
  for (const day of days) {
    for (const w of day.windows) {
      const items = day.plan.items.filter((it) => it.windowId === w.id && it.status !== 'skipped');
      if (!items.length) continue;
      const [y, m, d] = day.date.split('-').map(Number);
      const start = new Date(y, m - 1, d, 0, clockMinutes(w.start));
      const end = new Date(start.getTime() + w.minutes * 60_000);
      events.push({
        key: `block:${day.date}:${w.id}`,
        title: `Study: ${items.map(title).join(', ')}`,
        description: items.map((it) => `${title(it)} (${it.minutes} min)`).join('\n'),
        start: start.toISOString(),
        end: end.toISOString(),
      });
    }
  }
  const first = days[0]?.date ?? dateKey(Date.now());
  const last = days[days.length - 1]?.date ?? first;
  return { events, from: new Date(keyToTime(first)).toISOString(), to: new Date(keyToTime(addDays(last, 1))).toISOString() };
}
