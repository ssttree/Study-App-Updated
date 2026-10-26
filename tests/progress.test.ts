import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildUnits,
  gradeOf,
  groupRecall,
  memoryRecall,
  scopeOf,
  subjectRecall,
  topicsOf,
  unitRecall,
  type UnitInput,
} from '../src/lib/progress/recall';
import { activities, periodRange, plannedMinutes, soFar } from '../src/lib/progress/activity';
import { isMonthEnd, liveFocus, reviewWaiting, reviewWeek } from '../src/lib/progress/review';
import { baselineOf, loadProgress, markRecall, waitingForMarks, weakList } from '../src/lib/progress/load';
import { buildDailyMix, makeSkillScheduler, newSkill, rateSkill } from '../src/lib/practice/mix';
import { makeScheduler, rate } from '../src/lib/scheduler';
import { blankCard } from '../src/lib/cards';
import { createBackup, parseBackup, restoreBackup } from '../src/lib/backup';
import {
  DB_NAME,
  listMarks,
  listWeeklyReviews,
  recordAttempt,
  recordReview,
  resetDbConnection,
  saveCard,
  saveDeck,
  saveMark,
  saveProblem,
  saveSkill,
  saveTestPlan,
  saveWeeklyReview,
} from '../src/lib/db';
import { DEFAULT_SETTINGS, type Attempt, type Card, type Deck, type Mark, type Problem, type ReviewLog, type Skill } from '../src/lib/types';

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 26, 18).getTime(); // Monday 26 Oct 2026, 6pm

const deck: Deck = { id: 'd1', name: 'Equilibrium', subject: 'Chemistry', module: 'Module 5', typingDefault: 'off', created: 0, updated: 0 };

function cardsWithHistory(n: number, reviewed: number, at: number): { cards: Card[]; logs: ReviewLog[] } {
  const scheduler = makeScheduler(DEFAULT_SETTINGS);
  const cards: Card[] = [];
  const logs: ReviewLog[] = [];
  for (let i = 0; i < n; i++) {
    let card: Card = { ...blankCard('d1'), topic: 'Le Chatelier', created: at - 30 * DAY };
    if (i < reviewed) {
      for (const t of [at - 20 * DAY, at - 10 * DAY]) {
        const r = rate(scheduler, card, 'forward', 3, { now: t });
        card = r.card;
        logs.push(r.log);
      }
    }
    cards.push(card);
  }
  return { cards, logs };
}

function skill(name: string, fields: Partial<Skill> = {}): Skill {
  return newSkill({ subject: 'Maths Extension 1', name, topic: 'Combinatorics', ...fields }, NOW - 40 * DAY);
}

function practised(s: Skill, ratings: [number, 1 | 2 | 3 | 4][]): { skill: Skill; attempts: Attempt[] } {
  const scheduler = makeSkillScheduler(DEFAULT_SETTINGS);
  const attempts: Attempt[] = [];
  let cur = s;
  for (const [at, rating] of ratings) {
    attempts.push({ id: `${s.id}-${at}`, problemId: 'p-' + s.id, skillId: s.id, at, rating, method: rating === 1 ? 'no' : 'yes', seconds: 300, stateBefore: cur.fsrs.state });
    cur = rateSkill(scheduler, cur, rating, at);
  }
  return { skill: cur, attempts };
}

function input(fields: Partial<UnitInput>): UnitInput {
  return { decks: [deck], cards: [], logs: [], skills: [], attempts: [], skillsWithProblems: new Set(), settings: DEFAULT_SETTINGS, ...fields };
}

describe('recall', () => {
  it('replays reviews so past recall can be read, and matches the saved state now', () => {
    const { cards, logs } = cardsWithHistory(1, 1, NOW);
    const [unit] = buildUnits(input({ cards, logs }));
    const memory = unit.memories[0];
    expect(memory.reviews).toHaveLength(2);
    expect(memory.reviews[1].stability).toBeCloseTo(cards[0].fsrs.stability, 6);
    expect(memoryRecall(memory, NOW - 25 * DAY)).toBeNull();
    // Straight after a review recall is close to 1, and it fades with time.
    expect(memoryRecall(memory, NOW - 10 * DAY)!).toBeGreaterThan(0.99);
    expect(memoryRecall(memory, NOW)!).toBeLessThan(memoryRecall(memory, NOW - 5 * DAY)!);
  });

  it('counts unstarted cards and skills as 0, so a barely started topic is not green', () => {
    const { cards, logs } = cardsWithHistory(4, 1, NOW);
    const [unit] = buildUnits(input({ cards, logs }));
    const r = unitRecall(unit, NOW)!;
    expect(r.started).toBe(true);
    expect(r.recall).toBeLessThan(0.3);

    const done = practised(skill('Arrangements'), [[NOW - 3 * DAY, 3]]);
    const units = buildUnits(input({ skills: [done.skill, skill('Circles'), skill('Groups')], attempts: done.attempts, skillsWithProblems: new Set([done.skill.id, ...['x']]) }));
    // Only skills with questions (or attempts) count: the two empty ones are left out.
    expect(units).toHaveLength(1);
  });

  it('averages topics into a subject, with coverage', () => {
    const a = practised(skill('Arrangements'), [[NOW - 2 * DAY, 3]]);
    const b = skill('Circles');
    const c = practised(skill('Vectors basics', { topic: 'Vectors' }), [[NOW - 1 * DAY, 4]]);
    const units = buildUnits(
      input({ skills: [a.skill, b, c.skill], attempts: [...a.attempts, ...c.attempts], skillsWithProblems: new Set([a.skill.id, b.id, c.skill.id]) }),
    );
    const topics = topicsOf(units);
    expect(topics.map((t) => t.name)).toEqual(['Combinatorics', 'Vectors']);
    const comb = groupRecall(topics[0].units, NOW);
    expect(comb.started).toBe(1);
    expect(comb.total).toBe(2);
    expect(comb.recall!).toBeLessThan(0.55);
    const subject = subjectRecall(topics, NOW);
    expect(subject.total).toBe(3);
    expect(subject.recall!).toBeGreaterThan(comb.recall!);
  });

  it('leaves out skills switched off and never practised, and English', () => {
    const off = skill('Not taught yet', { on: false });
    const eng = newSkill({ subject: 'English Advanced', name: 'Essay' }, NOW);
    const units = buildUnits(input({ skills: [off, eng], skillsWithProblems: new Set([off.id, eng.id]) }));
    expect(units).toHaveLength(0);
  });

  it('grades at 90 and 75, or 95 when an exam is near', () => {
    expect(gradeOf(null)).toBe('none');
    expect(gradeOf(0.91)).toBe('good');
    expect(gradeOf(0.91, true)).toBe('mid');
    expect(gradeOf(0.8)).toBe('mid');
    expect(gradeOf(0.6)).toBe('weak');
  });

  it('uses an assessment scope, or the whole subject when it has none', () => {
    const a = practised(skill('Arrangements'), [[NOW - 2 * DAY, 3]]);
    const v = practised(skill('Vectors basics', { topic: 'Vectors' }), [[NOW - 2 * DAY, 3]]);
    const units = buildUnits(input({ skills: [a.skill, v.skill], attempts: [...a.attempts, ...v.attempts], skillsWithProblems: new Set([a.skill.id, v.skill.id]) }));
    const plan = { id: 't', name: 'Test', subject: 'Maths Extension 1', date: NOW + 7 * DAY, skillIds: [a.skill.id], created: NOW };
    expect(scopeOf(plan, units, [a.skill, v.skill]).map((u) => u.name)).toEqual(['Arrangements']);
    expect(scopeOf({ ...plan, skillIds: [] }, units, [a.skill, v.skill])).toHaveLength(2);
  });
});

describe('activity', () => {
  it('splits weeks on Monday, fortnights and months', () => {
    expect(periodRange('week', '2026-10-26')).toMatchObject({ start: '2026-10-26', end: '2026-11-01' });
    expect(periodRange('week', '2026-11-01', 1)).toMatchObject({ start: '2026-10-19', end: '2026-10-25' });
    expect(periodRange('fortnight', '2026-10-28')).toMatchObject({ start: '2026-10-19', end: '2026-11-01' });
    expect(periodRange('month', '2026-10-28', 1)).toMatchObject({ start: '2026-09-01', end: '2026-09-30' });
  });

  it('compares this week so far with last week at the same point', () => {
    const list = [
      { date: '2026-10-27', subject: 'Chemistry', kind: 'cards' as const, minutes: 1 },
      { date: '2026-10-20', subject: 'Chemistry', kind: 'cards' as const, minutes: 1 },
      { date: '2026-10-23', subject: 'Chemistry', kind: 'problems' as const, minutes: 10 },
    ];
    const { now, before } = soFar(list, 'week', '2026-10-27');
    expect(now.cards).toBe(1);
    expect(before.cards).toBe(1);
    // Friday last week is after "Tuesday" so it is not counted yet.
    expect(before.questions).toBe(0);
  });

  it('counts reviews on the study day they happened', () => {
    const late = new Date(2026, 9, 27, 1).getTime(); // 1am counts for Monday
    const acts = activities(
      [{ id: 'l', cardId: 'c', direction: 'forward', rating: 3, stateBefore: 0, reviewedAt: late, elapsedDays: 0, scheduledDays: 1, durationMs: 60_000 }],
      [],
      [{ ...blankCard('d1'), id: 'c' }],
      [deck],
      new Map(),
      4,
    );
    expect(acts[0]).toMatchObject({ date: '2026-10-26', subject: 'Chemistry', minutes: 1 });
  });

  it('adds up planned minutes, leaving optional items out', () => {
    const plans = [
      {
        date: '2026-10-26',
        built: 0,
        items: [
          { id: 'a', kind: 'flashcards' as const, windowId: 'w', minutes: 20, pinned: false, status: 'todo' as const },
          { id: 'b', kind: 'problems' as const, windowId: 'w', minutes: 30, pinned: false, status: 'todo' as const, optional: true },
        ],
      },
    ];
    expect(plannedMinutes(plans, '2026-10-26', '2026-11-01')).toBe(20);
    expect(plannedMinutes(plans, '2026-11-02', '2026-11-08')).toBeNull();
  });
});

describe('weekly review', () => {
  it('belongs to the Sunday just gone and waits until done or skipped', () => {
    expect(reviewWeek('2026-10-25')).toBe('2026-10-25');
    expect(reviewWeek('2026-10-28')).toBe('2026-10-25');
    expect(reviewWaiting([], '2026-10-28')).toBe(true);
    expect(reviewWaiting([{ week: '2026-10-25', status: 'skipped', focusSkillIds: [], note: '', at: 0 }], '2026-10-28')).toBe(false);
    expect(isMonthEnd('2026-10-25')).toBe(true);
    expect(isMonthEnd('2026-10-18')).toBe(false);
  });

  it('keeps focus skills live for the week after, with a week of grace', () => {
    const r = { week: '2026-10-25', status: 'done' as const, focusSkillIds: ['s1'], note: '', at: 0 };
    expect(liveFocus([r], '2026-10-27')).toEqual(['s1']);
    expect(liveFocus([r], '2026-11-07')).toEqual(['s1']);
    expect(liveFocus([r], '2026-11-08')).toEqual([]);
  });

  it('puts focus skills into the daily mix ahead of other due skills', () => {
    const skills: Skill[] = [];
    const problems: Problem[] = [];
    for (let i = 0; i < 6; i++) {
      const s = { ...skill('Skill ' + i), fsrs: { ...skill('x').fsrs, state: 2 as const, due: NOW - DAY, stability: 5, lastReview: NOW - 6 * DAY } };
      skills.push(s);
      problems.push({ id: 'p' + i, skillId: s.id, source: 'smartered', label: '', from: '', key: 'k' + i, marks: 3, mc: false, questionImage: '', order: i, created: 0 });
    }
    const focus = skills[5].id;
    const mix = buildDailyMix({ skills, problems, attempts: [], plans: [], focus: [focus] }, { subjects: ['Maths Extension 1'], minutes: 6, now: NOW, dayEnd: NOW, rng: () => 0.5 });
    expect(mix.map((m) => m.skill.id)).toContain(focus);
    expect(mix).toHaveLength(1);
  });
});

describe('progress data', () => {
  beforeEach(async () => {
    await resetDbConnection();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  });

  async function seed() {
    await saveDeck(deck);
    const { cards, logs } = cardsWithHistory(2, 2, NOW);
    for (const c of cards) await saveCard(c);
    for (const l of logs) await recordReview(cards.find((c) => c.id === l.cardId)!, l);
    const base = skill('Arrangements');
    await saveSkill(base);
    await saveProblem({ id: 'p1', skillId: base.id, source: 'smartered', label: '', from: '', key: 'k', marks: 2, mc: false, questionImage: '', order: 0, created: 0 });
    const done = practised(base, [[NOW - 5 * DAY, 1]]);
    for (const a of done.attempts) await recordAttempt(done.skill, a);
    await saveTestPlan({ id: 't1', name: 'Ext 1 test', subject: 'Maths Extension 1', date: new Date(2026, 9, 20).getTime(), skillIds: [base.id], created: NOW - 30 * DAY });
    return { skill: done.skill };
  }

  it('ranks weak skills with wrong methods and lapses first', async () => {
    const { skill } = await seed();
    const data = await loadProgress(NOW);
    const weak = weakList(data);
    expect(weak[0].unit.skill?.id).toBe(skill.id);
    expect(weak[0].wrongMethod).toBe(1);
    expect(weak[0].lapses).toBe(1);
  });

  it('lists past assessments without a mark, and works out recall on the day', async () => {
    await seed();
    let data = await loadProgress(NOW);
    expect(waitingForMarks(data).map((a) => a.id)).toEqual(['t1']);
    const mark: Mark = { id: 'm1', subject: 'Maths Extension 1', name: 'Ext 1 test', date: '2026-10-20', mark: 30, outOf: 40, year: 12, topics: [], assessmentId: 't1', created: NOW };
    await saveMark(mark);
    data = await loadProgress(NOW);
    expect(waitingForMarks(data)).toHaveLength(0);
    // The only practice was on 21 Oct, after the test, so nothing was known on the day.
    expect(markRecall(data, mark)).toBeNull();
  });

  it('averages Year 11 marks and ranks into a baseline', () => {
    const m = (mark: number, rank?: number): Mark => ({ id: String(mark), subject: 'Chemistry', name: 'Task', date: '2025-06-01', mark, outOf: 100, rank, year: 11, topics: [], created: 0 });
    expect(baselineOf([m(70, 8), m(80, 6), m(90)], 'Chemistry')).toEqual({ pct: 80, rank: 7, count: 3 });
    expect(baselineOf([], 'Chemistry').pct).toBeNull();
  });

  it('keeps marks and weekly reviews in backups', async () => {
    await saveMark({ id: 'm1', subject: 'Chemistry', name: 'Y11 exam', date: '2025-11-01', mark: 70, outOf: 100, rank: 5, year: 11, topics: [], created: 0 });
    await saveWeeklyReview({ week: '2026-10-25', status: 'done', focusSkillIds: ['s'], note: 'Good week', at: 0 });
    const backup = JSON.parse(JSON.stringify(await createBackup()));
    await resetDbConnection();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
    await restoreBackup(parseBackup(backup));
    expect((await listMarks())[0].rank).toBe(5);
    expect((await listWeeklyReviews())[0].note).toBe('Good week');
  });
});
