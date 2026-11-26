// Study sessions ticked off this week, for the counter on the planner.
// Kept free of the screen so it can be tested.

import type { DayPlan, PlanItem } from '../types';
import { addDays, weekday } from './dates';
import { hasPick } from './labels';

/** Monday of the week a date key is in. */
export function mondayOf(key: string): string {
  return addDays(key, -((weekday(key) + 6) % 7));
}

/**
 * A study session: anything on the plan except a plain event with nothing to
 * study in it (like the dentist). An event with a session type counts too.
 */
export function isSession(it: PlanItem): boolean {
  if (it.kind !== 'event') return true;
  return hasPick(it.study) || !!it.session;
}

export interface WeekSessions {
  done: number;
  /** Sessions on the plan this week that weren't skipped. */
  planned: number;
  apply: number;
  practice: number;
}

/**
 * Sessions done Monday to Sunday of the week `today` is in.
 * `isDone` decides what counts as done (flashcards can be done with no tick).
 */
export function weekSessions(
  today: string,
  planFor: (date: string) => DayPlan | undefined,
  isDone: (it: PlanItem, date: string) => boolean = (it) => it.status === 'done',
): WeekSessions {
  const out: WeekSessions = { done: 0, planned: 0, apply: 0, practice: 0 };
  const start = mondayOf(today);
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    for (const it of planFor(date)?.items ?? []) {
      if (it.status === 'skipped' || !isSession(it)) continue;
      out.planned += 1;
      if (!isDone(it, date)) continue;
      out.done += 1;
      if (it.session === 'apply') out.apply += 1;
      if (it.session === 'practice') out.practice += 1;
    }
  }
  return out;
}

/** Items opened with Start today that haven't been ticked yet: ask if they're finished. */
export function waitingForTick(plan: DayPlan | undefined): PlanItem[] {
  return (plan?.items ?? []).filter((it) => it.started && it.status === 'todo' && isSession(it));
}
