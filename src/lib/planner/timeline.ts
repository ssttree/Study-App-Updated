// Lays a planned day out like a calendar: each study window becomes a band at
// its real time, and the items inside it follow one after another from the
// window's start. Kept free of the screen so it can be tested.

import type { Availability, PlanItem, StudyWindow } from '../types';
import { clockMinutes, weekday } from './dates';

/** Minutes after midnight. */
export interface Span {
  start: number;
  end: number;
}

export interface TimedItem extends Span {
  item: PlanItem;
  windowId: string;
}

export interface TimedWindow extends Span {
  window: StudyWindow;
}

export interface DayLayout {
  windows: TimedWindow[];
  items: TimedItem[];
  /** Items with no time: extra time ("I've got 20 more minutes") and skipped items. */
  loose: PlanItem[];
}

export function layoutDay(windows: StudyWindow[], items: PlanItem[]): DayLayout {
  const timedWindows = windows
    .map((w) => ({ window: w, start: clockMinutes(w.start), end: clockMinutes(w.start) + w.minutes }))
    .sort((a, b) => a.start - b.start);
  const byId = new Map(timedWindows.map((w) => [w.window.id, w]));
  const cursor = new Map(timedWindows.map((w) => [w.window.id, w.start]));
  const timed: TimedItem[] = [];
  const loose: PlanItem[] = [];
  for (const item of items) {
    const w = byId.get(item.windowId);
    if (!w || item.status === 'skipped') {
      loose.push(item);
      continue;
    }
    const start = cursor.get(w.window.id)!;
    const end = start + Math.max(1, item.minutes);
    cursor.set(w.window.id, end);
    timed.push({ item, windowId: w.window.id, start, end });
  }
  return { windows: timedWindows, items: timed, loose };
}

/** The hours the calendar shows: whole hours around everything on it, at least `minSpan` long. */
export function visibleRange(spans: Span[], fallback: Span = { start: 15 * 60, end: 21 * 60 }, minSpan = 4 * 60): Span {
  if (!spans.length) return fallback;
  let start = Math.min(...spans.map((s) => s.start));
  let end = Math.max(...spans.map((s) => s.end));
  start = Math.max(0, Math.floor(start / 60) * 60);
  end = Math.min(24 * 60, Math.ceil(end / 60) * 60);
  if (end - start < minSpan) end = Math.min(24 * 60, start + minSpan);
  if (end - start < minSpan) start = Math.max(0, end - minSpan);
  return { start, end };
}

// The weekly planning session: a set time (Sunday afternoon by default) to do
// the weekly review and look over the coming week.

export interface PlanningTime {
  /** 0 Sunday to 6 Saturday. */
  day: number;
  /** HH:MM. */
  start: string;
  minutes: number;
}

export const DEFAULT_PLANNING: PlanningTime = { day: 0, start: '16:00', minutes: 20 };

/** The planning time, or null when it is turned off. Missing means the default. */
export function planningTime(a: Availability): PlanningTime | null {
  if (a.planning === null) return null;
  return a.planning ?? DEFAULT_PLANNING;
}

/**
 * When the planning session falls on a date, or null if not that day. If a
 * work shift covers the set time, it moves to straight after the shift.
 */
export function planningSlot(a: Availability, date: string, busy: Span[] = []): Span | null {
  const p = planningTime(a);
  if (!p || weekday(date) !== p.day) return null;
  let start = clockMinutes(p.start);
  const sorted = [...busy].sort((x, y) => x.start - y.start);
  for (const b of sorted) {
    if (start < b.end && start + p.minutes > b.start) start = b.end;
  }
  return { start, end: start + p.minutes };
}
