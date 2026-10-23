import { describe, expect, it } from 'vitest';
import { blankCard, parseTags, effectiveTyping } from '../src/lib/cards';
import { formatInterval, makeScheduler, previewIntervals, rate } from '../src/lib/scheduler';
import { buildQueue, pickNext, studyDayStart, summarise } from '../src/lib/queue';
import { DEFAULT_SETTINGS, type Deck } from '../src/lib/types';

const deck: Deck = {
  id: 'd1',
  name: 'Equilibrium',
  subject: 'Chemistry',
  module: 'Module 5',
  typingDefault: 'off',
  created: 0,
  updated: 0,
};

describe('scheduler', () => {
  it('schedules a new card and logs the review', () => {
    const s = makeScheduler(DEFAULT_SETTINGS);
    const now = Date.UTC(2026, 9, 23, 8);
    const card = blankCard('d1', now);
    const { card: after, log } = rate(s, card, 'forward', 3, { now });
    expect(after.fsrs.state).not.toBe(0);
    expect(after.fsrs.due).toBeGreaterThan(now);
    expect(log.stateBefore).toBe(0);
    expect(log.rating).toBe(3);
  });

  it('gives longer intervals for better ratings', () => {
    const s = makeScheduler(DEFAULT_SETTINGS);
    const now = Date.UTC(2026, 9, 23, 8);
    const i = previewIntervals(s, blankCard('d1', now).fsrs, now);
    expect(i[1]).toBeLessThanOrEqual(i[2]);
    expect(i[2]).toBeLessThanOrEqual(i[3]);
    expect(i[3]).toBeLessThan(i[4]);
  });

  it('keeps the two directions of a reversed card separate', () => {
    const s = makeScheduler(DEFAULT_SETTINGS);
    const now = Date.UTC(2026, 9, 23, 8);
    const card = { ...blankCard('d1', now), type: 'reversed' as const };
    const { card: after } = rate(s, card, 'reverse', 4, { now });
    expect(after.fsrs.state).toBe(0);
    expect(after.fsrsReverse?.state).not.toBe(0);
  });

  it('formats intervals', () => {
    expect(formatInterval(60_000)).toBe('1m');
    expect(formatInterval(10 * 60_000)).toBe('10m');
    expect(formatInterval(3 * 3_600_000)).toBe('3h');
    expect(formatInterval(5 * 86_400_000)).toBe('5d');
    expect(formatInterval(90 * 86_400_000)).toBe('3mo');
  });
});

describe('queue', () => {
  const now = new Date(2026, 9, 23, 18, 0).getTime();

  it('caps new cards at the daily limit', () => {
    const cards = Array.from({ length: 30 }, (_, i) => blankCard('d1', now - 1000 + i));
    const s = summarise(cards, [deck], [], DEFAULT_SETTINGS, { kind: 'all' }, now);
    expect(s.newCards).toHaveLength(20);
    expect(s.due).toHaveLength(0);
  });

  it('counts new cards already studied today', () => {
    const cards = Array.from({ length: 30 }, (_, i) => blankCard('d1', now - 1000 + i));
    const logs = Array.from({ length: 15 }, (_, i) => ({
      id: `l${i}`,
      cardId: 'x',
      direction: 'forward' as const,
      rating: 3 as const,
      stateBefore: 0 as const,
      reviewedAt: now - 60_000,
      elapsedDays: 0,
      scheduledDays: 0,
      durationMs: 0,
    }));
    const s = summarise(cards, [deck], logs, DEFAULT_SETTINGS, { kind: 'all' }, now);
    expect(s.newCards).toHaveLength(5);
  });

  it('filters by subject', () => {
    const cards = [blankCard('d1', now), blankCard('other', now)];
    const s = summarise(cards, [deck], [], DEFAULT_SETTINGS, { kind: 'subject', subject: 'Chemistry' }, now);
    expect(s.newCards).toHaveLength(1);
  });

  it('introduces the reverse side on a later day', () => {
    const s = makeScheduler(DEFAULT_SETTINGS);
    const card = { ...blankCard('d1', now - 5000), type: 'reversed' as const };
    const studied = rate(s, card, 'forward', 3, { now: now - 1000 }).card;
    const today = summarise([studied], [deck], [], DEFAULT_SETTINGS, { kind: 'all' }, now);
    expect(today.newCards.filter((q) => q.direction === 'reverse')).toHaveLength(0);
    const later = now + 2 * 86_400_000;
    const tomorrow = summarise([studied], [deck], [], DEFAULT_SETTINGS, { kind: 'all' }, later);
    expect(tomorrow.newCards.filter((q) => q.direction === 'reverse')).toHaveLength(1);
  });

  it('spreads new cards through reviews', () => {
    const due = Array.from({ length: 6 }, (_, i) => ({ card: blankCard('d1'), direction: 'forward' as const, due: i, isNew: false }));
    const fresh = Array.from({ length: 2 }, () => ({ card: blankCard('d1'), direction: 'forward' as const, due: 0, isNew: true }));
    const q = buildQueue({ due, newCards: fresh, newLeftToday: 2 });
    expect(q).toHaveLength(8);
    expect(q[0].isNew).toBe(false);
    expect(q.filter((x) => x.isNew)).toHaveLength(2);
  });

  it('shows requeued learning cards only when due or nearly due', () => {
    const item = { card: blankCard('d1'), direction: 'forward' as const, isNew: false, requeued: true };
    expect(pickNext([{ ...item, due: now + 60 * 60_000 }], now)).toBe(-1);
    expect(pickNext([{ ...item, due: now + 5 * 60_000 }], now)).toBe(0);
  });

  it('rolls the study day over at 4am', () => {
    const lateNight = new Date(2026, 9, 24, 1, 30).getTime();
    expect(new Date(studyDayStart(lateNight, 4)).getDate()).toBe(23);
  });
});

describe('cards', () => {
  it('parses tags', () => {
    expect(parseTags('#exam, formula  #exam')).toEqual(['exam', 'formula']);
  });

  it('uses the deck typing setting unless the card overrides it', () => {
    const card = blankCard('d1');
    expect(effectiveTyping(card, { ...deck, typingDefault: 'always' })).toBe('always');
    expect(effectiveTyping({ ...card, typing: 'optional' }, deck)).toBe('optional');
  });
});
