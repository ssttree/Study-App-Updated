import type { Card, Deck, TypingMode } from './types';
import { emptyState } from './scheduler';
import { newId } from './db';

/** Splits "calculus, #chain-rule  exam" into ["calculus", "chain-rule", "exam"]. */
export function parseTags(input: string): string[] {
  const tags = input
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#/, '').trim())
    .filter(Boolean);
  return [...new Set(tags)];
}

export function blankCard(deckId: string, now = Date.now()): Card {
  return {
    id: newId(),
    deckId,
    topic: '',
    tags: [],
    type: 'basic',
    typing: 'deck',
    front: '',
    back: '',
    source: 'manual',
    fsrs: emptyState(now),
    created: now,
    updated: now,
  };
}

/** The typing setting that applies to a card once its deck default is taken into account. */
export function effectiveTyping(card: Card, deck: Deck | undefined): TypingMode {
  return card.typing === 'deck' ? (deck?.typingDefault ?? 'off') : card.typing;
}
