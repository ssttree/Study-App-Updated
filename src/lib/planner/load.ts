// Loads everything the planner needs, closes past days (carrying unfinished
// homework over), ticks off SmarterEd homework done in problem practice, and
// builds the plan for today and the next six days.

import {
  getAvailability,
  getCalendarCache,
  getSettings,
  listCards,
  listDecks,
  listPlans,
  logsSince,
  savePlans,
  saveTasks,
  listTasks,
} from '../db';
import { estimateMinutes } from '../load';
import { directionsOf, studyDayEnd, studyDayStart, summarise } from '../queue';
import { stateFor } from '../scheduler';
import { loadPractice, type PracticeCollection } from '../practice/load';
import { recommendSubjects } from '../practice/mix';
import type { Availability, Card, Deck, DayPlan, ReviewLog, Settings, Task, TestPlan } from '../types';
import { buildWeek, closePastDays, type BuiltDay, type PlannerInput } from './build';
import { daysBetween, todayKey } from './dates';
import { dayContext, type CalendarCache } from './calendar';

const DAY = 86_400_000;

export interface PlannerData {
  today: string;
  now: number;
  settings: Settings;
  availability: Availability;
  tasks: Task[];
  assessments: TestPlan[];
  practice: PracticeCollection;
  decks: Deck[];
  cards: Card[];
  logsToday: ReviewLog[];
  /** The last copy of your Google calendars, if connected. */
  calendars: CalendarCache | null;
  /** Flashcards still to do today. */
  cardsLeft: number;
  input: PlannerInput;
  days: BuiltDay[];
}

/**
 * Flashcard minutes for each day: today's real queue (plus what you already
 * did, so the block doesn't shrink as you go), later days from due dates and
 * the new card limit.
 */
export function flashEstimator(cards: Card[], decks: Deck[], logsToday: ReviewLog[], settings: Settings, today: string, now: number) {
  const summary = summarise(cards, decks, logsToday, settings, { kind: 'all' }, now);
  const doneMinutes = Math.round(logsToday.reduce((m, l) => m + l.durationMs, 0) / 60_000);
  const todayMinutes = summary.due.length + summary.newCards.length > 0 ? estimateMinutes(summary.due.length, summary.newCards.length) : 0;
  const dayEnd = studyDayEnd(now, settings.dayStartHour);
  let unseen = 0;
  for (const c of cards) for (const d of directionsOf(c)) if (stateFor(c, d).state === 0) unseen++;
  return (date: string): number => {
    if (!cards.length) return 0;
    const i = daysBetween(today, date);
    if (i <= 0) return todayMinutes + (todayMinutes > 0 || doneMinutes > 0 ? doneMinutes : 0);
    let due = 0;
    const from = dayEnd + (i - 1) * DAY;
    const to = dayEnd + i * DAY;
    for (const c of cards) {
      for (const d of directionsOf(c)) {
        const s = stateFor(c, d);
        if (s.state !== 0 && s.due > from && s.due <= to) due++;
      }
    }
    const fresh = Math.min(settings.newPerDay, Math.max(0, unseen - i * settings.newPerDay));
    return due + fresh > 0 ? estimateMinutes(due, fresh) : 0;
  };
}

/** SmarterEd homework is done once every question in its skill has been tried since it was set. */
export function finishedSets(tasks: Task[], practice: Pick<PracticeCollection, 'problems' | 'attempts'>, now: number): Task[] {
  const out: Task[] = [];
  for (const t of tasks) {
    if (t.status !== 'open' || !t.skillId) continue;
    const problems = practice.problems.filter((p) => p.skillId === t.skillId);
    if (!problems.length) continue;
    const tried = new Set(practice.attempts.filter((a) => a.at >= t.created && a.skillId === t.skillId).map((a) => a.problemId));
    if (problems.every((p) => tried.has(p.id))) out.push({ ...t, status: 'done', spent: t.minutes, finished: now });
  }
  return out;
}

export async function loadPlanner(now = Date.now()): Promise<PlannerData> {
  const settings = await getSettings();
  const today = todayKey(now, settings.dayStartHour);
  const [availability, storedTasks, plans, practice, decks, cards, logsToday, calendars] = await Promise.all([
    getAvailability(),
    listTasks(),
    listPlans(),
    loadPractice(now),
    listDecks(),
    listCards(),
    logsSince(studyDayStart(now, settings.dayStartHour)),
    getCalendarCache(),
  ]);

  let tasks = storedTasks;
  const merge = (changed: Task[]) => {
    const byId = new Map(changed.map((t) => [t.id, t]));
    tasks = tasks.map((t) => byId.get(t.id) ?? t);
  };
  const sets = finishedSets(tasks, practice, now);
  merge(sets);
  const closed = closePastDays(plans, tasks, today);
  merge(closed.tasks);
  const changedIds = new Set([...sets, ...closed.tasks].map((t) => t.id));
  const changedTasks = tasks.filter((t) => changedIds.has(t.id));
  if (changedTasks.length) await saveTasks(changedTasks);

  const saved = new Map<string, DayPlan>(plans.map((p) => [p.date, p]));
  for (const p of closed.plans) saved.set(p.date, p);
  if (closed.plans.length) await savePlans(closed.plans);

  const summary = summarise(cards, decks, logsToday, settings, { kind: 'all' }, now);
  const input: PlannerInput = {
    today,
    availability,
    tasks,
    assessments: practice.plans,
    saved,
    context: (date) => dayContext(calendars, date),
    flashMinutes: flashEstimator(cards, decks, logsToday, settings, today, now),
    problemSubjects: recommendSubjects(practice, now, practice.dayEnd).map((s) => s.subject),
    now,
  };
  const days = buildWeek(input);
  // Today's plan is saved, so tomorrow knows what was planned and not done.
  await savePlans([days[0].plan]);
  return {
    today,
    now,
    settings,
    availability,
    tasks,
    assessments: practice.plans,
    practice,
    decks,
    cards,
    logsToday,
    calendars,
    cardsLeft: summary.due.length + summary.newCards.length,
    input,
    days,
  };
}
