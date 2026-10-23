// Loads what most screens need in one go.

import { getSettings, listCards, listDecks, logsSince } from './db';
import { studyDayStart } from './queue';
import type { Card, Deck, ReviewLog, Settings } from './types';

export interface Collection {
  decks: Deck[];
  cards: Card[];
  logsToday: ReviewLog[];
  settings: Settings;
}

export async function loadCollection(now = Date.now()): Promise<Collection> {
  const settings = await getSettings();
  const [decks, cards, logsToday] = await Promise.all([
    listDecks(),
    listCards(),
    logsSince(studyDayStart(now, settings.dayStartHour)),
  ]);
  return { decks, cards, logsToday, settings };
}

/** Rough time estimate: about 8 seconds per review and 20 per new card. */
export function estimateMinutes(reviews: number, fresh: number): number {
  return Math.max(1, Math.round((reviews * 8 + fresh * 20) / 60));
}

export function plural(n: number, word: string, many = word + 's'): string {
  return `${n} ${n === 1 ? word : many}`;
}
