// Decides which cards to review now. Reviews that are due come first, new
// cards are mixed in up to the daily limit, and cards still being learned
// (short steps like 1 or 10 minutes) come back later in the same session.

import type { Card, Deck, Direction, ReviewLog, Settings } from './types';
import { stateFor } from './scheduler';

/** Cards due within this window count as due now, so a session can finish. */
export const LEARN_AHEAD_MS = 20 * 60_000;

export type StudyFilter =
  | { kind: 'all' }
  | { kind: 'subject'; subject: string }
  | { kind: 'deck'; deckId: string }
  | { kind: 'topic'; deckId: string; topic: string }
  | { kind: 'tag'; tag: string };

export interface QueueItem {
  card: Card;
  direction: Direction;
  due: number;
  isNew: boolean;
  /** Set when a card comes back later in the same session (learning steps). */
  requeued?: boolean;
}

/** Start of the current study day (rolls over at dayStartHour, 4am by default). */
export function studyDayStart(now: number, dayStartHour: number): number {
  const d = new Date(now);
  d.setHours(dayStartHour, 0, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}

export function studyDayEnd(now: number, dayStartHour: number): number {
  const d = new Date(studyDayStart(now, dayStartHour));
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function matchesFilter(card: Card, decks: Map<string, Deck>, filter: StudyFilter): boolean {
  switch (filter.kind) {
    case 'all':
      return true;
    case 'subject':
      return decks.get(card.deckId)?.subject === filter.subject;
    case 'deck':
      return card.deckId === filter.deckId;
    case 'topic':
      return card.deckId === filter.deckId && card.topic === filter.topic;
    case 'tag':
      return card.tags.includes(filter.tag);
  }
}

export function directionsOf(card: Card): Direction[] {
  return card.type === 'reversed' ? ['forward', 'reverse'] : ['forward'];
}

/** How many new cards have been started since the study day began. */
export function newDoneToday(logs: ReviewLog[], dayStart: number): number {
  return logs.filter((l) => l.reviewedAt >= dayStart && l.stateBefore === 0).length;
}

export interface QueueSummary {
  due: QueueItem[];
  newCards: QueueItem[];
  newLeftToday: number;
}

/**
 * Everything that could be studied right now for a filter. New cards are
 * capped by what is left of today's new card limit.
 */
export function summarise(
  cards: Card[],
  decks: Deck[],
  logsToday: ReviewLog[],
  settings: Settings,
  filter: StudyFilter,
  now = Date.now(),
): QueueSummary {
  const deckMap = new Map(decks.map((d) => [d.id, d]));
  const dayStart = studyDayStart(now, settings.dayStartHour);
  const dayEnd = studyDayEnd(now, settings.dayStartHour);
  const newLeftToday = Math.max(0, settings.newPerDay - newDoneToday(logsToday, dayStart));

  const due: QueueItem[] = [];
  const fresh: QueueItem[] = [];
  for (const card of cards) {
    if (!matchesFilter(card, deckMap, filter)) continue;
    for (const direction of directionsOf(card)) {
      const s = stateFor(card, direction);
      if (s.state === 0) {
        // Introduce the reverse side on a later day than the front, so the
        // answer to one is not fresh in your mind for the other.
        if (direction === 'reverse') {
          const fwd = card.fsrs;
          if (fwd.state === 0 || (fwd.lastReview ?? 0) >= dayStart) continue;
        }
        fresh.push({ card, direction, due: s.due, isNew: true });
      } else {
        // Learning cards use exact times, review cards count for the whole day.
        const limit = s.state === 2 ? dayEnd : now + LEARN_AHEAD_MS;
        if (s.due <= limit) due.push({ card, direction, due: s.due, isNew: false });
      }
    }
  }
  due.sort((a, b) => a.due - b.due);
  fresh.sort((a, b) => a.card.created - b.card.created);
  return { due, newCards: fresh.slice(0, newLeftToday), newLeftToday };
}

/** Spreads new cards evenly through the due reviews. */
export function buildQueue(summary: QueueSummary): QueueItem[] {
  const { due, newCards } = summary;
  if (newCards.length === 0) return [...due];
  if (due.length === 0) return [...newCards];
  const out: QueueItem[] = [];
  const gap = (due.length + newCards.length) / newCards.length;
  let nextNew = gap / 2;
  let d = 0;
  let n = 0;
  for (let i = 0; i < due.length + newCards.length; i++) {
    if (n < newCards.length && (i >= nextNew || d >= due.length)) {
      out.push(newCards[n++]);
      nextNew += gap;
    } else {
      out.push(due[d++]);
    }
  }
  return out;
}

/**
 * Picks the next card in a session. Anything due now comes first in queue
 * order; if only learning cards remain that are due in the next few minutes,
 * the soonest one is shown early rather than making you wait.
 */
export function pickNext(queue: QueueItem[], now = Date.now()): number {
  if (queue.length === 0) return -1;
  const ready = queue.findIndex((q) => !q.requeued || q.due <= now);
  if (ready !== -1) return ready;
  let best = -1;
  for (let i = 0; i < queue.length; i++) {
    if (queue[i].due <= now + LEARN_AHEAD_MS && (best === -1 || queue[i].due < queue[best].due)) {
      best = i;
    }
  }
  return best;
}
