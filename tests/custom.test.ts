import { describe, expect, it } from 'vitest';
import { customFromParts, customToParts, selectCustom, type CustomOptions } from '../src/lib/custom';
import { blankCard } from '../src/lib/cards';
import type { Deck, ReviewLog } from '../src/lib/types';

const now = new Date(2026, 9, 23, 20, 0).getTime();
const chem: Deck = { id: 'chem', name: 'Equilibrium', subject: 'Chemistry', module: '', typingDefault: 'off', created: 0, updated: 0 };
const maths: Deck = { id: 'maths', name: 'Calculus', subject: 'Maths Extension 1', module: '', typingDefault: 'off', created: 0, updated: 0 };

const a = { ...blankCard('chem', now), id: 'a', tags: ['exam'] };
const b = { ...blankCard('chem', now), id: 'b' };
const c = { ...blankCard('maths', now), id: 'c', tags: ['exam'] };

function log(cardId: string, rating: 1 | 2 | 3 | 4, hoursAgo: number): ReviewLog {
  return {
    id: `${cardId}-${hoursAgo}`,
    cardId,
    direction: 'forward',
    rating,
    stateBefore: 2,
    reviewedAt: now - hoursAgo * 3_600_000,
    elapsedDays: 0,
    scheduledDays: 0,
    durationMs: 0,
  };
}

const logs = [log('a', 3, 1), log('a', 1, 2), log('b', 1, 50), log('c', 3, 30)];
const opts = (o: Partial<CustomOptions>): CustomOptions => ({
  pick: 'today',
  days: 7,
  limit: 50,
  shuffle: false,
  filter: { kind: 'all' },
  ...o,
});
const ids = (o: Partial<CustomOptions>) => selectCustom([a, b, c], [chem, maths], logs, opts(o), now, 4).map((q) => q.card.id);

describe('selectCustom', () => {
  it('picks cards studied today once each', () => {
    expect(ids({ pick: 'today' })).toEqual(['a']);
  });

  it('picks cards forgotten within the chosen days', () => {
    expect(ids({ pick: 'missed', days: 1 })).toEqual(['a']);
    expect(ids({ pick: 'missed', days: 3 }).sort()).toEqual(['a', 'b']);
  });

  it('picks every card in a deck, subject or tag', () => {
    expect(ids({ pick: 'all', filter: { kind: 'deck', deckId: 'chem' } }).sort()).toEqual(['a', 'b']);
    expect(ids({ pick: 'all', filter: { kind: 'subject', subject: 'Maths Extension 1' } })).toEqual(['c']);
    expect(ids({ pick: 'all', filter: { kind: 'tag', tag: 'exam' } }).sort()).toEqual(['a', 'c']);
  });

  it('respects the card limit and can shuffle', () => {
    expect(ids({ pick: 'all', limit: 2 })).toHaveLength(2);
    const shuffled = selectCustom([a, b, c], [chem, maths], logs, opts({ pick: 'all', shuffle: true }), now, 4, () => 0);
    expect(shuffled.map((q) => q.card.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('custom study address', () => {
  it('round trips options through the address', () => {
    const o = opts({ pick: 'missed', days: 3, limit: 20, shuffle: true, filter: { kind: 'topic', deckId: 'chem', topic: 'Kc' } });
    expect(customFromParts(customToParts(o))).toEqual(o);
  });

  it('falls back to safe defaults for a broken address', () => {
    const o = customFromParts(['nonsense', 'x', '-5']);
    expect(o.pick).toBe('today');
    expect(o.days).toBe(7);
    expect(o.limit).toBe(50);
    expect(o.filter).toEqual({ kind: 'all' });
  });
});
