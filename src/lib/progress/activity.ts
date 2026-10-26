// Effort over time: reviews, questions and minutes per week, fortnight or
// month. Totals only, no streaks, so a missed day never "breaks" anything.

import { addDays, dateKey, daysBetween, keyToTime, todayKey, weekday } from '../planner/dates';
import type { Attempt, Card, DayPlan, Deck, ReviewLog } from '../types';

export type Period = 'week' | 'fortnight' | 'month';

export const PERIOD_LABEL: Record<Period, string> = { week: 'Week', fortnight: 'Fortnight', month: 'Month' };

/** One review or one question, on the study day it happened. */
export interface Activity {
  date: string;
  subject: string;
  kind: 'cards' | 'problems';
  minutes: number;
}

export function activities(logs: ReviewLog[], attempts: Attempt[], cards: Card[], decks: Deck[], skillSubject: Map<string, string>, dayStartHour: number): Activity[] {
  const deckSubject = new Map(decks.map((d) => [d.id, d.subject]));
  const cardSubject = new Map(cards.map((c) => [c.id, deckSubject.get(c.deckId) ?? '']));
  const out: Activity[] = [];
  for (const l of logs) {
    out.push({ date: todayKey(l.reviewedAt, dayStartHour), subject: cardSubject.get(l.cardId) ?? '', kind: 'cards', minutes: l.durationMs / 60_000 });
  }
  for (const a of attempts) {
    out.push({ date: todayKey(a.at, dayStartHour), subject: skillSubject.get(a.skillId) ?? '', kind: 'problems', minutes: a.seconds / 60 });
  }
  return out;
}

export interface Range {
  start: string;
  /** Inclusive. */
  end: string;
  label: string;
}

/** Weeks start on Monday. offset 0 is the period holding today, 1 the one before, and so on. */
export function periodRange(period: Period, today: string, offset = 0): Range {
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  if (period === 'week') {
    const start = addDays(monday, -7 * offset);
    return { start, end: addDays(start, 6), label: short(start) };
  }
  if (period === 'fortnight') {
    const start = addDays(monday, -7 - 14 * offset);
    return { start, end: addDays(start, 13), label: short(start) };
  }
  const t = new Date(keyToTime(today));
  const first = new Date(t.getFullYear(), t.getMonth() - offset, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  return { start: dateKey(first.getTime()), end: dateKey(last.getTime()), label: first.toLocaleDateString('en-AU', { month: 'short' }) };
}

function short(key: string): string {
  return new Date(keyToTime(key)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

export interface Totals {
  cards: number;
  questions: number;
  cardMinutes: number;
  problemMinutes: number;
  minutes: number;
}

export function totals(list: Activity[], start: string, end: string): Totals {
  const t: Totals = { cards: 0, questions: 0, cardMinutes: 0, problemMinutes: 0, minutes: 0 };
  for (const a of list) {
    if (a.date < start || a.date > end) continue;
    if (a.kind === 'cards') {
      t.cards++;
      t.cardMinutes += a.minutes;
    } else {
      t.questions++;
      t.problemMinutes += a.minutes;
    }
  }
  t.minutes = t.cardMinutes + t.problemMinutes;
  return t;
}

/** This period so far, and the one before up to the same point, for a fair comparison. */
export function soFar(list: Activity[], period: Period, today: string): { now: Totals; before: Totals } {
  const cur = periodRange(period, today, 0);
  const prev = periodRange(period, today, 1);
  const into = daysBetween(cur.start, today);
  const prevEnd = addDays(prev.start, into) < prev.end ? addDays(prev.start, into) : prev.end;
  return { now: totals(list, cur.start, today), before: totals(list, prev.start, prevEnd) };
}

export function bySubject(list: Activity[], start: string, end: string): { subject: string; totals: Totals }[] {
  const subjects = [...new Set(list.filter((a) => a.date >= start && a.date <= end).map((a) => a.subject))];
  return subjects
    .map((subject) => ({ subject: subject || 'No subject', totals: totals(list.filter((a) => a.subject === subject), start, end) }))
    .sort((a, b) => b.totals.minutes - a.totals.minutes);
}

/** Minutes the planner had planned in a range (optional items left out), from the days the app was opened. */
export function plannedMinutes(plans: DayPlan[], start: string, end: string): number | null {
  const inRange = plans.filter((p) => p.date >= start && p.date <= end);
  if (!inRange.length) return null;
  return inRange.reduce((m, p) => m + p.items.filter((i) => !i.optional).reduce((s, i) => s + i.minutes, 0), 0);
}

/** "5 h 10", "40 min". */
export function hoursText(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
