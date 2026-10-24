// The weekly study windows: the time you CAN study, each with a kind that
// says what fits there. Two templates (off season and soccer season) share
// the windows marked "all", and the planner switches on the dates.

import type { Availability, StudyWindow } from '../types';
import { clockMinutes, weekday } from './dates';

const WEEKDAYS = [1, 2, 3, 4, 5];

/** The starting template from the design. Everything here can be edited. */
export function defaultAvailability(): Availability {
  return {
    windows: [
      { id: 'bus-am', name: 'Bus to school', days: WEEKDAYS, start: '07:10', minutes: 50, kind: 'bus', season: 'all' },
      { id: 'bus-pm', name: 'Bus home', days: WEEKDAYS, start: '15:20', minutes: 50, kind: 'bus', season: 'all' },
      { id: 'desk-pm', name: 'Before dinner', days: WEEKDAYS, start: '17:20', minutes: 45, kind: 'desk', season: 'all' },
      { id: 'tue-night', name: 'Tuesday night', days: [2], start: '19:30', minutes: 30, kind: 'flexible', season: 'all' },
      { id: 'sat', name: 'Saturday', days: [6], start: '09:00', minutes: 90, kind: 'desk', season: 'off' },
      { id: 'sat-game', name: 'Saturday after the game', days: [6], start: '15:00', minutes: 90, kind: 'desk', season: 'soccer' },
      { id: 'sun', name: 'Sunday morning', days: [0], start: '08:00', minutes: 90, kind: 'desk', season: 'all' },
    ],
    soccerStart: '04-15',
    soccerEnd: '09-07',
    trainingDays: [2, 4],
    overrides: {},
  };
}

/** True when the date falls in soccer season (MM-DD range, inclusive). */
export function inSoccerSeason(key: string, a: Availability): boolean {
  const md = key.slice(5);
  return a.soccerStart <= a.soccerEnd
    ? md >= a.soccerStart && md <= a.soccerEnd
    : md >= a.soccerStart || md <= a.soccerEnd;
}

/** Training nights take out desk and flexible windows from 4pm. */
export const TRAINING_FROM = 16 * 60;

/** The template windows for a day, before any one-off changes. */
export function templateWindows(key: string, a: Availability): StudyWindow[] {
  const day = weekday(key);
  const soccer = inSoccerSeason(key, a);
  const training = soccer && a.trainingDays.includes(day);
  return a.windows
    .filter((w) => w.days.includes(day))
    .filter((w) => w.season === 'all' || w.season === (soccer ? 'soccer' : 'off'))
    .filter((w) => !(training && w.kind !== 'bus' && clockMinutes(w.start) >= TRAINING_FROM))
    .sort((x, y) => clockMinutes(x.start) - clockMinutes(y.start));
}

/** What your calendars say about one day (see calendar.ts). */
export interface DayContext {
  /** Work shifts, as minutes after midnight, already padded for travel. */
  busy: { start: number; end: number }[];
  /** False on a weekday with no lessons (a holiday); undefined when we can't tell. */
  schoolDay?: boolean;
}

/** Takes out windows that clash with a work shift, and bus windows on school holidays. */
export function applyContext(windows: StudyWindow[], ctx: DayContext | undefined): StudyWindow[] {
  if (!ctx) return windows;
  return windows.filter((w) => {
    if (ctx.schoolDay === false && w.kind === 'bus') return false;
    const start = clockMinutes(w.start);
    const end = start + w.minutes;
    return !ctx.busy.some((b) => b.start < end && b.end > start);
  });
}

/**
 * The study windows for one day: a one-off change if you made one (used as
 * is), else the template with your calendars applied.
 */
export function windowsFor(key: string, a: Availability, ctx?: DayContext): StudyWindow[] {
  const override = a.overrides[key];
  const list = override ?? applyContext(templateWindows(key, a), ctx);
  return [...list].sort((x, y) => clockMinutes(x.start) - clockMinutes(y.start));
}

/** Total minutes of each kind in a week of one template, for the summary. */
export function weeklyMinutes(a: Availability, season: 'off' | 'soccer'): Record<StudyWindow['kind'], number> {
  const total = { bus: 0, desk: 0, flexible: 0 };
  for (let day = 0; day < 7; day++) {
    const training = season === 'soccer' && a.trainingDays.includes(day);
    for (const w of a.windows) {
      if (!w.days.includes(day) || (w.season !== 'all' && w.season !== season)) continue;
      if (training && w.kind !== 'bus' && clockMinutes(w.start) >= TRAINING_FROM) continue;
      total[w.kind] += w.minutes;
    }
  }
  return total;
}
