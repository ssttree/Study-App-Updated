import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { courseFromCode, courseOf, isExtensionWork, textbookCourse, withCourse } from '../src/lib/practice/course';
import { changedItem, eventItem, withBlock, blockItem } from '../src/lib/planner/blocks';
import { defaultAvailability } from '../src/lib/planner/availability';
import { itemText } from '../src/lib/planner/labels';
import { finishSession, rememberSession, sessionKindOf } from '../src/lib/planner/active';
import { DB_NAME, getPlan, resetDbConnection, savePlans } from '../src/lib/db';
import type { PlanItem, Problem, Skill } from '../src/lib/types';

// A plain stand-in for the browser's localStorage, which Node doesn't have.
const store = new Map<string, string>();
globalThis.localStorage ??= {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

const BOOK = 'Maths in Focus: Year 12 Mathematics Extension 1';
const key = (section: string, n: number) => `book:${BOOK}:${section}:${n}`;
const prob = (fields: Partial<Problem>): Problem => ({
  id: 'p',
  skillId: 's1',
  source: 'textbook',
  label: '',
  from: '',
  key: '',
  marks: 2,
  mc: false,
  questionImage: '',
  order: 0,
  created: 0,
  ...fields,
});

describe('Extension 1 or Advanced', () => {
  it('reads the textbook sections and single questions marked EXT1', () => {
    expect(courseOf(prob({ key: key('4.08', 3) }), 'Maths Extension 1')).toBe('ext1');
    expect(courseOf(prob({ key: key('4.01', 3) }), 'Maths Extension 1')).toBe('adv');
    expect(courseOf(prob({ key: key('6.08', 4) }), 'Maths Extension 1')).toBe('ext1');
    expect(courseOf(prob({ key: key('6.08', 5) }), 'Maths Extension 1')).toBe('adv');
    expect(courseOf(prob({ key: key('test4', 16) }), 'Maths Extension 1')).toBe('ext1');
    expect(courseOf(prob({ key: key('test4', 1) }), 'Maths Extension 1')).toBe('adv');
    // Every section of the vectors chapter is Extension 1, so its test is too.
    expect(courseOf(prob({ key: key('test2', 1) }), 'Maths Extension 1')).toBe('ext1');
    expect(courseOf(prob({ key: key('practice2', 15), label: 'Practice set 2 Q15 (4.08)' }), 'Maths Extension 1')).toBe('ext1');
    expect(courseOf(prob({ key: key('practice2', 1), label: 'Practice set 2 Q1 (4.02)' }), 'Maths Extension 1')).toBe('adv');
  });

  it('prefers what was saved at import, and SmarterEd headers', () => {
    expect(courseOf(prob({ key: key('4.01', 3), course: 'ext1' }), 'Maths Extension 1')).toBe('ext1');
    expect(courseOf(prob({ source: 'smartered', key: 'smartered:Functions, EXT1 F2 2007 HSC 2c' }), 'Maths Extension 1')).toBe('ext1');
    expect(courseOf(prob({ source: 'smartered', key: 'smartered:Calculus, ADV C3 2019 HSC 12a' }), 'Maths Extension 1')).toBe('adv');
    expect(courseOf(prob({ source: 'typed', key: 'typed:x' }), 'Maths Extension 1')).toBe('ext1');
    expect(courseFromCode('EXT2')).toBe('ext2');
  });

  it('works out a new import from the marks and the book', () => {
    expect(textbookCourse({ book: BOOK, section: '1.03', number: 2, extSections: ['1.10'] })).toBe('adv');
    expect(textbookCourse({ book: BOOK, section: '1.10', number: 2, extSections: ['1.10'] })).toBe('ext1');
    expect(textbookCourse({ book: BOOK, section: 'challenge1', number: 2, marked: true })).toBe('ext1');
    expect(textbookCourse({ book: 'Maths in Focus: Year 12 Mathematics Extension 2', section: '1.01', number: 1 })).toBe('ext2');
  });

  it('keeps only one course in the Extension subjects when asked', () => {
    const skills = [
      { id: 's1', subject: 'Maths Extension 1' },
      { id: 's2', subject: 'Chemistry' },
    ] as Skill[];
    const problems = [prob({ id: 'a', key: key('4.08', 1) }), prob({ id: 'b', key: key('4.01', 1) }), prob({ id: 'c', skillId: 's2', key: 'typed:c' })];
    const ids = (c: 'extension' | 'advanced' | undefined) => withCourse({ skills, problems }, c).problems.map((p) => p.id);
    expect(ids(undefined)).toEqual(['a', 'b', 'c']);
    expect(ids('extension')).toEqual(['a', 'c']);
    expect(ids('advanced')).toEqual(['b', 'c']);
    expect(isExtensionWork(problems[1], 'Maths Extension 1')).toBe(false);
  });
});

describe('subject and description on study blocks', () => {
  it('keeps a subject and a description on events and blocks', () => {
    const e = eventItem({ title: 'Proofs', minutes: 30, subject: 'Maths Extension 2', notes: ' Ex 2.03 Q1 to 10 ' });
    expect(e.subjects).toEqual(['Maths Extension 2']);
    expect(e.notes).toBe('Ex 2.03 Q1 to 10');
    const a = withBlock(defaultAvailability(), { id: 'b', name: 'Chem', minutes: 30, subject: 'Chemistry', notes: 'Module 7' });
    expect(blockItem(a.blocks![0], '16:00')).toMatchObject({ subjects: ['Chemistry'], notes: 'Module 7' });
  });

  it('changes or clears them from the item window', () => {
    const it: PlanItem = { id: 'i', kind: 'event', windowId: 'cal', minutes: 30, pinned: true, status: 'todo', subjects: ['Chemistry'], notes: 'x' };
    expect(changedItem(it, { subject: 'Maths Advanced', notes: '' })).toMatchObject({ subjects: ['Maths Advanced'] });
    expect(changedItem(it, { notes: '' }).notes).toBeUndefined();
    expect(changedItem(it, { subject: undefined }).subjects).toBeUndefined();
    // A problems item keeps the subjects the planner gave it.
    const p: PlanItem = { ...it, kind: 'problems', subjects: ['Chemistry'] };
    expect(changedItem(p, { subject: undefined }).subjects).toEqual(['Chemistry']);
  });

  it('shows the subject with the event', () => {
    const it: PlanItem = { id: 'i', kind: 'event', windowId: 'cal', minutes: 30, pinned: true, status: 'todo', title: 'Revision', subjects: ['Chemistry'] };
    expect(itemText(it, new Map(), new Map(), '2026-11-27').detail).toContain('Chem');
  });
});

describe('finishing a session ticks off the planner', () => {
  beforeEach(async () => {
    await resetDbConnection();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
    localStorage.clear();
  });

  const item = (fields: Partial<PlanItem>): PlanItem => ({ id: 'i1', kind: 'event', windowId: 'cal', start: '16:00', minutes: 30, pinned: true, status: 'todo', ...fields });

  it('knows what each item opens', () => {
    expect(sessionKindOf(item({ kind: 'flashcards' }))).toBe('flashcards');
    expect(sessionKindOf(item({ study: { deckIds: ['d'] } }))).toBe('flashcards');
    expect(sessionKindOf(item({ study: { skillIds: ['s'] } }))).toBe('practice');
    expect(sessionKindOf(item({}))).toBeNull();
  });

  it('ticks the item flashcards were started from, once', async () => {
    await savePlans([{ date: '2026-11-27', built: 0, items: [item({ study: { deckIds: ['d'] } })] }]);
    rememberSession('2026-11-27', 'i1', 1000);
    const t = await finishSession('flashcards', 2000);
    expect(t?.item.id).toBe('i1');
    expect(t?.weekDone).toBe(1);
    expect((await getPlan('2026-11-27'))!.items[0].status).toBe('done');
    expect(await finishSession('flashcards', 3000)).toBeNull();
  });

  it('leaves a practice item alone when flashcards finish', async () => {
    await savePlans([{ date: '2026-11-27', built: 0, items: [item({ study: { skillIds: ['s'] } })] }]);
    rememberSession('2026-11-27', 'i1', 1000);
    expect(await finishSession('flashcards', 2000)).toBeNull();
    expect((await finishSession('practice', 2000))?.item.id).toBe('i1');
  });

  it('forgets a session started long ago', async () => {
    await savePlans([{ date: '2026-11-27', built: 0, items: [item({ kind: 'flashcards' })] }]);
    rememberSession('2026-11-27', 'i1', 0);
    expect(await finishSession('flashcards', 7 * 3600_000)).toBeNull();
  });
});
