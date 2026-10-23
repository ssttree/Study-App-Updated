// Wraps ts-fsrs, the FSRS spaced repetition algorithm. FSRS predicts when you
// are about to forget each card and schedules the next review just before
// that, aiming for the target retention (90% by default).

import {
  createEmptyCard,
  fsrs,
  Rating,
  type Card as FsrsCard,
  type Grade,
  type FSRS,
} from 'ts-fsrs';
import type { Card, Direction, FsrsState, ReviewLog, Settings } from './types';
import { newId } from './db';

export type RatingValue = 1 | 2 | 3 | 4;

export const RATINGS: { value: RatingValue; label: string }[] = [
  { value: 1, label: 'Again' },
  { value: 2, label: 'Hard' },
  { value: 3, label: 'Good' },
  { value: 4, label: 'Easy' },
];

export function makeScheduler(settings: Pick<Settings, 'retention'>): FSRS {
  return fsrs({ request_retention: settings.retention, enable_fuzz: true });
}

export function emptyState(now = Date.now()): FsrsState {
  return fromFsrs(createEmptyCard(new Date(now)));
}

export function toFsrs(s: FsrsState): FsrsCard {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsedDays,
    scheduled_days: s.scheduledDays,
    learning_steps: s.learningSteps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    last_review: s.lastReview === undefined ? undefined : new Date(s.lastReview),
  };
}

export function fromFsrs(c: FsrsCard): FsrsState {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsedDays: c.elapsed_days,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as FsrsState['state'],
    lastReview: c.last_review?.getTime(),
  };
}

export function stateFor(card: Card, direction: Direction): FsrsState {
  if (direction === 'reverse') return card.fsrsReverse ?? emptyState(card.created);
  return card.fsrs;
}

/** When each rating would bring the card back, for the labels on the buttons. */
export function previewIntervals(
  scheduler: FSRS,
  state: FsrsState,
  now = Date.now(),
): Record<RatingValue, number> {
  const preview = scheduler.repeat(toFsrs(state), new Date(now));
  return {
    1: preview[Rating.Again].card.due.getTime() - now,
    2: preview[Rating.Hard].card.due.getTime() - now,
    3: preview[Rating.Good].card.due.getTime() - now,
    4: preview[Rating.Easy].card.due.getTime() - now,
  };
}

/** Applies a rating and returns the updated card plus the log entry to save. */
export function rate(
  scheduler: FSRS,
  card: Card,
  direction: Direction,
  rating: RatingValue,
  opts: { now?: number; durationMs?: number; typedAnswer?: string } = {},
): { card: Card; log: ReviewLog } {
  const now = opts.now ?? Date.now();
  const before = stateFor(card, direction);
  const result = scheduler.next(toFsrs(before), new Date(now), rating as Grade);
  const after = fromFsrs(result.card);
  const updated: Card =
    direction === 'reverse' ? { ...card, fsrsReverse: after } : { ...card, fsrs: after };
  const log: ReviewLog = {
    id: newId(),
    cardId: card.id,
    direction,
    rating,
    stateBefore: before.state,
    reviewedAt: now,
    elapsedDays: result.log.elapsed_days,
    scheduledDays: result.log.scheduled_days,
    durationMs: opts.durationMs ?? 0,
    typedAnswer: opts.typedAnswer,
  };
  return { card: updated, log };
}

/** Short label for an interval, like "10m", "3h", "5d", "2mo". */
export function formatInterval(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d`;
  const months = days / 30.4;
  if (months < 12) return `${Math.round(months)}mo`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, '')}y`;
}
