// The Sunday weekly review: which week it belongs to, whether it is waiting,
// and which focus skills are live. Kept free of the database so the practice
// mix can use it cheaply.

import { addDays, daysBetween, keyToTime, weekday } from '../planner/dates';
import type { WeeklyReview } from '../types';

/** The Sunday a review belongs to: today on a Sunday, else the Sunday just gone. */
export function reviewWeek(today: string): string {
  return addDays(today, -weekday(today));
}

/** On the last Sunday of a month the review looks back over the month instead. */
export function isMonthEnd(sunday: string): boolean {
  return new Date(keyToTime(addDays(sunday, 7))).getMonth() !== new Date(keyToTime(sunday)).getMonth();
}

/** The review waits on the home screen from Sunday until it is done or skipped. */
export function reviewWaiting(reviews: WeeklyReview[], today: string): boolean {
  const week = reviewWeek(today);
  return !reviews.some((r) => r.week === week);
}

/** Focus skills from the latest finished review, live for the week after it (plus a week's grace if the next is missed). */
export function liveFocus(reviews: WeeklyReview[], today: string): string[] {
  return liveReview(reviews, today)?.focusSkillIds ?? [];
}

/** The latest finished review whose focus skills still apply. */
export function liveReview(reviews: WeeklyReview[], today: string): WeeklyReview | undefined {
  return reviews
    .filter((r) => r.status === 'done' && daysBetween(r.week, today) >= 0 && daysBetween(r.week, today) < 14)
    .sort((a, b) => b.week.localeCompare(a.week))[0];
}
