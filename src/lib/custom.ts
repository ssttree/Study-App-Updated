// Custom study: go over cards again whenever you like, outside the schedule.
// Practising here never changes when cards are due, so it cannot upset FSRS.

import { directionsOf, matchesFilter, studyDayStart, type QueueItem, type StudyFilter } from './queue';
import { stateFor } from './scheduler';
import { filterFromParts, filterToParts } from './filters';
import type { Card, Deck, ReviewLog } from './types';

/** today: cards reviewed today. missed: cards rated Again recently. all: every card in the scope. */
export type CustomPick = 'today' | 'missed' | 'all';

export interface CustomOptions {
  pick: CustomPick;
  /** For 'missed': how many days back to look. */
  days: number;
  limit: number;
  shuffle: boolean;
  filter: StudyFilter;
}

export const DEFAULT_CUSTOM: CustomOptions = { pick: 'today', days: 7, limit: 50, shuffle: true, filter: { kind: 'all' } };

export function customToParts(o: CustomOptions): string[] {
  return [o.pick, String(o.days), String(o.limit), o.shuffle ? 'shuffle' : 'inorder', ...filterToParts(o.filter)];
}

export function customFromParts(parts: string[]): CustomOptions {
  const [pick, days, limit, order, ...rest] = parts;
  const num = (s: string | undefined, d: number) => {
    const n = Math.round(Number(s));
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    pick: pick === 'missed' || pick === 'all' ? pick : 'today',
    days: num(days, DEFAULT_CUSTOM.days),
    limit: Math.min(num(limit, DEFAULT_CUSTOM.limit), 9999),
    shuffle: order !== 'inorder',
    filter: filterFromParts(rest),
  };
}

/** How far back the review history needs to go for these options. */
export function logsNeededSince(o: CustomOptions, now: number, dayStartHour: number): number {
  const dayStart = studyDayStart(now, dayStartHour);
  return o.pick === 'missed' ? Math.min(dayStart, now - o.days * 86_400_000) : dayStart;
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function selectCustom(
  cards: Card[],
  decks: Deck[],
  logs: ReviewLog[],
  o: CustomOptions,
  now = Date.now(),
  dayStartHour = 4,
  random: () => number = Math.random,
): QueueItem[] {
  const deckMap = new Map(decks.map((d) => [d.id, d]));
  const inScope = cards.filter((c) => matchesFilter(c, deckMap, o.filter));
  let items: QueueItem[] = [];

  if (o.pick === 'all') {
    for (const card of inScope) {
      for (const direction of directionsOf(card)) {
        // Skip a reverse side that has never been introduced.
        if (direction === 'reverse' && stateFor(card, direction).state === 0 && card.fsrs.state === 0) continue;
        items.push({ card, direction, due: 0, isNew: false });
      }
    }
  } else {
    const since = logsNeededSince(o, now, dayStartHour);
    const wanted = logs.filter((l) => l.reviewedAt >= since && (o.pick === 'today' || l.rating === 1));
    // Most recent first, one entry per card side.
    wanted.sort((a, b) => b.reviewedAt - a.reviewedAt);
    const byId = new Map(inScope.map((c) => [c.id, c]));
    const seen = new Set<string>();
    for (const log of wanted) {
      const key = `${log.cardId}:${log.direction}`;
      const card = byId.get(log.cardId);
      if (!card || seen.has(key)) continue;
      seen.add(key);
      items.push({ card, direction: log.direction, due: 0, isNew: false });
    }
  }

  if (o.shuffle) items = shuffled(items, random);
  return items.slice(0, o.limit);
}
