import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { blockItem, changedItem, eventItem, withBlock } from '../src/lib/planner/blocks';
import { isSession, mondayOf, waitingForTick, weekSessions } from '../src/lib/planner/sessions';
import { defaultAvailability } from '../src/lib/planner/availability';
import { saveProblems } from '../src/lib/practice/save';
import { DB_NAME, flagProblem, getSourcePdf, keepSourcePdf, listProblems, resetDbConnection } from '../src/lib/db';
import type { DayPlan, PlanItem } from '../src/lib/types';

function item(fields: Partial<PlanItem> = {}): PlanItem {
  return { id: 'i1', kind: 'event', windowId: 'cal', start: '16:00', minutes: 30, pinned: true, status: 'todo', ...fields };
}

describe('session type on study blocks', () => {
  it('keeps Apply or Practice on events, blocks and what is dragged in', () => {
    expect(eventItem({ title: 'Ext 2 proofs', minutes: 30, session: 'apply' }).session).toBe('apply');
    expect(eventItem({ title: 'Dentist', minutes: 30 }).session).toBeUndefined();
    const a = withBlock(defaultAvailability(), { id: 'b1', name: 'Chem drill', minutes: 45, session: 'practice' });
    expect(a.blocks![0].session).toBe('practice');
    expect(blockItem(a.blocks![0], '17:00').session).toBe('practice');
  });

  it('ignores anything that is not a session type', () => {
    const a = withBlock(defaultAvailability(), { id: 'b1', name: 'x', minutes: 30, session: 'nap' as never });
    expect(a.blocks![0].session).toBeUndefined();
  });

  it('changes or clears the type from the item window', () => {
    expect(changedItem(item(), { session: 'apply' }).session).toBe('apply');
    expect(changedItem(item({ session: 'apply' }), { session: undefined }).session).toBeUndefined();
    expect(changedItem(item({ session: 'apply' }), { minutes: 45 }).session).toBe('apply');
  });
});

describe('sessions done this week', () => {
  // 2026-11-26 is a Thursday.
  const TODAY = '2026-11-26';
  const plans = new Map<string, DayPlan>([
    [
      '2026-11-23',
      {
        date: '2026-11-23',
        built: 0,
        items: [
          item({ id: 'a', kind: 'homework', status: 'done' }),
          item({ id: 'b', kind: 'event', title: 'Dentist', status: 'done' }),
          item({ id: 'c', kind: 'event', session: 'apply', status: 'done' }),
        ],
      },
    ],
    [
      TODAY,
      {
        date: TODAY,
        built: 0,
        items: [
          item({ id: 'd', kind: 'event', study: { skillIds: ['s1'] }, session: 'practice', status: 'done' }),
          item({ id: 'e', kind: 'problems', status: 'skipped' }),
          item({ id: 'f', kind: 'problems', started: true }),
        ],
      },
    ],
    // Last week: not counted.
    ['2026-11-22', { date: '2026-11-22', built: 0, items: [item({ id: 'g', kind: 'homework', status: 'done' })] }],
  ]);

  it('starts the week on Monday', () => {
    expect(mondayOf(TODAY)).toBe('2026-11-23');
    expect(mondayOf('2026-11-23')).toBe('2026-11-23');
    expect(mondayOf('2026-11-29')).toBe('2026-11-23');
  });

  it('counts done sessions Monday to Sunday, not plain events or skipped ones', () => {
    const w = weekSessions(TODAY, (d) => plans.get(d));
    expect(w).toEqual({ done: 3, planned: 4, apply: 1, practice: 1 });
  });

  it('treats an event with nothing to study and no type as not a session', () => {
    expect(isSession(item({ kind: 'event' }))).toBe(false);
    expect(isSession(item({ kind: 'event', session: 'practice' }))).toBe(true);
    expect(isSession(item({ kind: 'flashcards' }))).toBe(true);
  });

  it('asks about sessions that were started but not ticked', () => {
    expect(waitingForTick(plans.get(TODAY)).map((i) => i.id)).toEqual(['f']);
  });
});

describe('flagging questions and their original PDF', () => {
  beforeEach(async () => {
    await resetDbConnection();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  });

  const pic = (s: string) => ({ data: `data:image/png;base64,${s}`, width: 10, height: 10 });

  it('saves the PDF name and page each question came from', async () => {
    await saveProblems(
      { kind: 'new', subject: 'Mathematics Extension 1', name: 'Vectors' },
      [
        { question: pic('q1'), solution: pic('s1'), label: 'Q1', marks: 2, mc: false, key: 'k1', page: 4 },
        { question: pic('q2'), solution: null, label: 'Q2', marks: 2, mc: false, key: 'k2' },
      ],
      'textbook',
      '2.01 Vectors',
      Date.now(),
      'Ext 1 Ch 02 Vectors.pdf',
    );
    const [a, b] = await listProblems();
    expect(a.origin).toEqual({ file: 'Ext 1 Ch 02 Vectors.pdf', page: 4 });
    expect(b.origin).toEqual({ file: 'Ext 1 Ch 02 Vectors.pdf' });
  });

  it('leaves origin off typed questions', async () => {
    await saveProblems({ kind: 'new', subject: 'Chemistry', name: 'Acids' }, [{ questionText: 'Define an acid.', label: 'Q', marks: 1, mc: false, key: 't' }], 'typed', 'Typed question');
    expect((await listProblems())[0].origin).toBeUndefined();
  });

  it('flags a question with a note and takes the flag off again', async () => {
    await saveProblems({ kind: 'new', subject: 'Chemistry', name: 'Acids' }, [{ question: pic('q'), label: 'Q1', marks: 2, mc: false, key: 'k' }], 'snip', 'Paper');
    const [p] = await listProblems();
    const flagged = await flagProblem(p.id, ' Question cut off ', 1000);
    expect(flagged?.flag).toEqual({ note: 'Question cut off', at: 1000 });
    // Changing the note keeps when it was first flagged.
    expect((await flagProblem(p.id, 'Answer cut off', 2000))?.flag).toEqual({ note: 'Answer cut off', at: 1000 });
    const cleared = await flagProblem(p.id, null);
    expect(cleared?.flag).toBeUndefined();
    expect((await listProblems())[0].flag).toBeUndefined();
  });

  it('keeps an imported PDF on the device by name', async () => {
    const file = new File([new Uint8Array([37, 80, 68, 70])], 'Ext 1 Ch 02 Vectors.pdf', { type: 'application/pdf' });
    await keepSourcePdf(file, 5);
    const kept = await getSourcePdf('Ext 1 Ch 02 Vectors.pdf');
    expect(kept?.size).toBe(4);
    expect(kept?.saved).toBe(5);
  });
});
