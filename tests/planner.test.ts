import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseQuickAdd } from '../src/lib/planner/quickadd';
import { defaultAvailability, inSoccerSeason, windowsFor, weeklyMinutes } from '../src/lib/planner/availability';
import { addDays, dueLabel, weekday } from '../src/lib/planner/dates';
import { buildWeek, closePastDays, extraItem, EXTRA_WINDOW, type PlannerInput } from '../src/lib/planner/build';
import { prepPull, stageOf, blocksOf } from '../src/lib/planner/assessments';
import { finishedSets } from '../src/lib/planner/load';
import { createBackup, parseBackup, restoreBackup } from '../src/lib/backup';
import { DB_NAME, getAvailability, listTasks, resetDbConnection, saveAvailability, saveTask } from '../src/lib/db';
import type { DayPlan, Task, TestPlan } from '../src/lib/types';

// Saturday 24 October 2026
const TODAY = '2026-10-24';
let n = 0;
const id = () => `id${++n}`;

function task(title: string, fields: Partial<Task> = {}): Task {
  return {
    id: id(),
    title,
    subject: 'Chemistry',
    type: 'classwork',
    due: addDays(TODAY, 1),
    minutes: 20,
    spent: 0,
    required: true,
    status: 'open',
    notes: '',
    carryOvers: 0,
    created: n,
    ...fields,
  };
}

function assessment(fields: Partial<TestPlan>): TestPlan {
  return { id: id(), name: 'Test', subject: 'Chemistry', date: 0, skillIds: ['s1'], created: 0, ...fields };
}

const at = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

function input(fields: Partial<PlannerInput> = {}): PlannerInput {
  return {
    today: '2026-10-26', // a Monday in off season
    availability: defaultAvailability(),
    tasks: [],
    assessments: [],
    saved: new Map(),
    flashMinutes: () => 25,
    problemSubjects: ['Chemistry', 'Maths Extension 1', 'Maths Advanced'],
    newId: id,
    now: 0,
    ...fields,
  };
}

describe('quick add', () => {
  it('reads the example from the design', () => {
    expect(weekday(TODAY)).toBe(6); // 24 Oct 2026 is a Saturday
    const q = parseQuickAdd('chem finish q5-10 fri 20m', TODAY);
    expect(q).toMatchObject({ title: 'Finish q5-10', subject: 'Chemistry', due: '2026-10-30', minutes: 20, required: true, type: 'classwork' });
  });

  it('reads "cards" as flashcard work and keeps it in the title', () => {
    expect(parseQuickAdd('eng quote cards fri', TODAY)).toMatchObject({ title: 'Quote cards', study: 'flashcards' });
    expect(parseQuickAdd('chem q5-10', TODAY).study).toBe('desk');
  });

  it('defaults to due tomorrow, 20 minutes, no subject', () => {
    const q = parseQuickAdd('read chapter 4', TODAY);
    expect(q).toMatchObject({ title: 'Read chapter 4', subject: '', due: '2026-10-25', minutes: 20 });
    expect(q.found.due).toBe(false);
  });

  it('reads subjects, hours, optional and SmarterEd sets', () => {
    expect(parseQuickAdd('ext 1 polynomials set opt 1h30', TODAY)).toMatchObject({
      subject: 'Maths Extension 1',
      type: 'smartered',
      required: false,
      minutes: 90,
      title: 'Polynomials set',
    });
    expect(parseQuickAdd('x2 complex numbers 45min tmr', TODAY)).toMatchObject({ subject: 'Maths Extension 2', due: '2026-10-25', minutes: 45 });
    expect(parseQuickAdd('engineering report draft assignment week', TODAY)).toMatchObject({
      subject: 'Engineering Studies',
      type: 'assignment',
      due: '2026-10-31',
    });
  });

  it('reads dates day first, and rolls past dates to next year', () => {
    expect(parseQuickAdd('essay 3/11', TODAY).due).toBe('2026-11-03');
    expect(parseQuickAdd('essay 3/2', TODAY).due).toBe('2027-02-03');
    expect(parseQuickAdd('essay 3/2/27', TODAY).due).toBe('2027-02-03');
  });

  it('never picks today for a weekday name, and "next" means the week after', () => {
    // Saturday: "sat" is next Saturday, "mon" is the coming Monday, "next mon" a week later.
    expect(parseQuickAdd('x sat', TODAY).due).toBe('2026-10-31');
    expect(parseQuickAdd('x mon', TODAY).due).toBe('2026-10-26');
    // From Monday 26th, "fri" is the 30th and "next fri" is 6 November.
    expect(parseQuickAdd('x fri', '2026-10-26').due).toBe('2026-10-30');
    expect(parseQuickAdd('x next fri', '2026-10-26').due).toBe('2026-11-06');
  });
});

describe('study windows', () => {
  it('uses the off season template in October', () => {
    const a = defaultAvailability();
    expect(inSoccerSeason('2026-10-26', a)).toBe(false);
    expect(windowsFor('2026-10-26', a).map((w) => w.name)).toEqual(['Bus to school', 'Bus home', 'Before dinner']);
    expect(windowsFor('2026-10-27', a).map((w) => w.name)).toContain('Tuesday night');
    expect(windowsFor('2026-10-31', a).map((w) => w.name)).toEqual(['Saturday']);
    expect(windowsFor('2026-11-01', a).map((w) => `${w.name} ${w.start}`)).toEqual(['Sunday morning 08:00']);
  });

  it('drops evening desk windows on training nights in soccer season', () => {
    const a = defaultAvailability();
    // Tuesday 9 June 2026
    expect(inSoccerSeason('2026-06-09', a)).toBe(true);
    expect(windowsFor('2026-06-09', a).map((w) => w.name)).toEqual(['Bus to school', 'Bus home']);
    // Wednesday keeps its desk window; Saturday moves after the game.
    expect(windowsFor('2026-06-10', a).map((w) => w.name)).toContain('Before dinner');
    expect(windowsFor('2026-06-13', a).map((w) => w.name)).toEqual(['Saturday after the game']);
    expect(weeklyMinutes(a, 'soccer').desk).toBeLessThan(weeklyMinutes(a, 'off').desk);
  });

  it('lets one day be changed by hand', () => {
    const a = defaultAvailability();
    a.overrides['2026-10-26'] = [];
    expect(windowsFor('2026-10-26', a)).toEqual([]);
  });
});

describe('building the plan', () => {
  it('puts flashcards on the bus, homework at the desk and problems in what is left', () => {
    const t = task('Finish q5-10', { minutes: 20 });
    const [mon] = buildWeek(input({ tasks: [t] }));
    const byWindow = (w: string) => mon.plan.items.filter((it) => it.windowId === w).map((it) => `${it.kind}:${it.minutes}`);
    expect(byWindow('bus-am')).toEqual(['flashcards:25']);
    expect(byWindow('desk-pm')).toEqual(['homework:20', 'problems:25']);
    expect(mon.warnings).toEqual([]);
  });

  it('never plans less than 10 minutes of flashcards', () => {
    const [mon] = buildWeek(input({ flashMinutes: () => 2 }));
    expect(mon.plan.items.find((it) => it.kind === 'flashcards')?.minutes).toBe(10);
  });

  it('plans required homework by due date and warns when tomorrow does not fit', () => {
    const later = task('Essay plan', { minutes: 30, due: '2026-10-30' });
    const big = task('Prac write-up', { minutes: 80, due: '2026-10-27' });
    const [mon, tue] = buildWeek(input({ tasks: [later, big] }));
    const homework = mon.plan.items.filter((it) => it.kind === 'homework');
    // The write-up is due first, so it takes the whole desk window.
    expect(homework).toHaveLength(1);
    expect(homework[0]).toMatchObject({ taskId: big.id, minutes: 45, windowId: 'desk-pm' });
    expect(mon.warnings[0]).toContain('Prac write-up');
    // The rest of it goes on the next day, ahead of the essay plan.
    const tueHw = tue.plan.items.filter((it) => it.kind === 'homework' && it.windowId === 'desk-pm');
    expect(tueHw.map((it) => [it.taskId, it.minutes])).toEqual([
      [big.id, 35],
      [later.id, 10],
    ]);
  });

  it('never puts desk study on the bus, even short work when the desk is full', () => {
    const big = task('Prac write-up', { minutes: 45 });
    const small = task('Questions', { minutes: 15 });
    const [mon] = buildWeek(input({ tasks: [big, small] }));
    const windows = mon.plan.items.filter((it) => it.kind === 'homework').map((it) => it.windowId);
    expect(windows.every((w) => w === 'desk-pm')).toBe(true);
    expect(mon.warnings[0]).toContain('Questions');
  });

  it('puts flashcard homework on the bus before the desk', () => {
    const big = task('Prac write-up', { minutes: 45 });
    const vocab = task('Vocab cards', { minutes: 15, study: 'flashcards' });
    const [mon] = buildWeek(input({ tasks: [big, vocab] }));
    expect(mon.plan.items.find((it) => it.taskId === vocab.id)?.windowId).toMatch(/^bus/);
    expect(mon.plan.items.find((it) => it.taskId === big.id)?.windowId).toBe('desk-pm');
    expect(mon.warnings).toEqual([]);
  });

  it('lets optional flashcard homework use spare bus time', () => {
    const cards = task('Extra cards', { minutes: 10, required: false, study: 'flashcards', due: '2026-10-29' });
    const [mon] = buildWeek(input({ tasks: [cards], flashMinutes: () => 10 }));
    expect(mon.plan.items.find((it) => it.taskId === cards.id)).toMatchObject({ optional: true });
    expect(mon.plan.items.find((it) => it.taskId === cards.id)?.windowId).toMatch(/^bus/);
  });

  it('only puts optional things in flexible windows', () => {
    const opt = task('Extra set', { required: false, minutes: 15, due: '2026-10-29' });
    const req = task('Questions', { minutes: 45, due: '2026-10-28' });
    const [, tue] = buildWeek(input({ tasks: [opt, req] }));
    const flex = tue.plan.items.filter((it) => it.windowId === 'tue-night');
    expect(flex.every((it) => it.optional)).toBe(true);
    expect(flex[0]).toMatchObject({ kind: 'homework', taskId: opt.id });
  });

  it('keeps pinned, started, done and skipped items when it rebuilds', () => {
    const t = task('Questions', { minutes: 20 });
    const saved: DayPlan = {
      date: '2026-10-26',
      built: 0,
      items: [
        { id: 'pinned', kind: 'problems', windowId: 'desk-pm', minutes: 30, subjects: ['Maths Advanced'], pinned: true, status: 'todo' },
        { id: 'loose', kind: 'problems', windowId: 'desk-pm', minutes: 45, subjects: ['Chemistry'], pinned: false, status: 'todo' },
        { id: 'skipped', kind: 'homework', windowId: 'desk-pm', minutes: 20, taskId: t.id, pinned: false, status: 'skipped' },
      ],
    };
    const [mon] = buildWeek(input({ tasks: [t], saved: new Map([[saved.date, saved]]) }));
    const ids = mon.plan.items.map((it) => it.id);
    expect(ids).toContain('pinned');
    expect(ids).toContain('skipped');
    expect(ids).not.toContain('loose');
    // A skipped task is not planned again the same day.
    expect(mon.plan.items.filter((it) => it.taskId === t.id)).toHaveLength(1);
  });

  it('does not plan work again today that was moved to a later day', () => {
    const t = task('Worksheet', { minutes: 20, due: '2026-10-29' });
    const tue: DayPlan = {
      date: '2026-10-27',
      built: 0,
      items: [{ id: 'moved', kind: 'homework', windowId: 'desk-pm', minutes: 20, taskId: t.id, pinned: true, status: 'todo' }],
    };
    const [mon, tuesday] = buildWeek(input({ tasks: [t], saved: new Map([[tue.date, tue]]) }), 2);
    expect(mon.plan.items.some((it) => it.taskId === t.id)).toBe(false);
    expect(tuesday.plan.items.filter((it) => it.taskId === t.id).map((it) => it.id)).toEqual(['moved']);
  });

  it('gives problem time to test prep when an assessment is close', () => {
    const test = assessment({ date: at('2026-10-30') }); // 4 days out: focus stage
    const [mon] = buildWeek(input({ assessments: [test] }));
    expect(mon.plan.items.find((it) => it.windowId === 'desk-pm')).toMatchObject({ kind: 'prep', assessmentId: test.id, subjects: ['Chemistry'] });
    const final = buildWeek(input({ today: '2026-10-29', assessments: [test] }))[0];
    expect(final.plan.items.find((it) => it.windowId === 'desk-pm')?.kind).toBe('final');
  });

  it('shares close exams between days instead of one subject taking every evening', () => {
    const chem = assessment({ subject: 'Chemistry', kind: 'exam', date: at('2026-11-02'), weighting: 20 });
    const ext1 = assessment({ subject: 'Maths Extension 1', kind: 'exam', date: at('2026-11-03'), weighting: 20 });
    const days = buildWeek(input({ assessments: [chem, ext1] }), 4);
    const subjects = days
      .filter((d) => d.windows.some((w) => w.id === 'desk-pm'))
      .map((d) => d.plan.items.find((it) => it.windowId === 'desk-pm')?.subjects?.[0]);
    expect(new Set(subjects).size).toBe(2);
  });

  it('splits a long weekend window between two subjects', () => {
    const [sat] = buildWeek(input({ today: '2026-10-31', flashMinutes: () => 0 }), 1);
    const blocks = sat.plan.items.map((it) => [it.kind, it.minutes, it.subjects?.[0]]);
    expect(blocks).toEqual([
      ['problems', 50, 'Chemistry'],
      ['problems', 40, 'Maths Extension 1'],
    ]);
    // With flashcards first, what is left stays one block.
    const [withCards] = buildWeek(input({ today: '2026-10-31' }), 1);
    expect(withCards.plan.items.map((it) => [it.kind, it.minutes])).toEqual([
      ['flashcards', 25],
      ['problems', 65],
    ]);
  });

  it('rotates the problem subject over the week', () => {
    const days = buildWeek(input(), 3);
    const subjects = days.map((d) => d.plan.items.find((it) => it.kind === 'problems')?.subjects?.[0]);
    expect(subjects[0]).not.toBe(subjects[1]);
  });

  it('adds the next best thing for "I\'ve got 20 more minutes"', () => {
    const a = task('A', { minutes: 20 });
    const b = task('B', { minutes: 30, due: '2026-10-29', required: false });
    const [mon] = buildWeek(input({ tasks: [a, b] }));
    const extra = extraItem(mon, { tasks: [a, b], problemSubjects: ['Chemistry'] }, 20, id);
    expect(extra).toMatchObject({ kind: 'homework', taskId: b.id, minutes: 20, windowId: EXTRA_WINDOW, pinned: true });
  });
});

describe('carry-overs', () => {
  it('counts unfinished homework once per day', () => {
    const t = task('Questions');
    const plan = (date: string): DayPlan => ({
      date,
      built: 0,
      items: [{ id: id(), kind: 'homework', windowId: 'desk-pm', minutes: 20, taskId: t.id, pinned: false, status: 'todo' }],
    });
    const first = closePastDays([plan('2026-10-26'), plan('2026-10-27')], [t], '2026-10-28');
    expect(first.tasks[0].carryOvers).toBe(2);
    expect(first.plans.every((p) => p.closed)).toBe(true);
    // Closed days are not counted again.
    const again = closePastDays(first.plans, first.tasks, '2026-10-29');
    expect(again.tasks).toEqual([]);
  });

  it('leaves today and finished work alone', () => {
    const t = task('Questions', { status: 'done' });
    const p: DayPlan = { date: '2026-10-27', built: 0, items: [{ id: 'x', kind: 'homework', windowId: 'w', minutes: 20, taskId: t.id, pinned: false, status: 'todo' }] };
    expect(closePastDays([p], [t], '2026-10-28').tasks).toEqual([]);
    expect(closePastDays([p], [{ ...t, status: 'open' }], '2026-10-27').plans).toEqual([]);
  });
});

describe('assessments', () => {
  it('ramps class tests at 21/7/2 days and exams at 42/14/3', () => {
    const test = assessment({ date: at('2026-11-20') });
    expect(stageOf(test, '2026-10-26')).toBe('none');
    expect(stageOf(test, '2026-10-30')).toBe('build');
    expect(stageOf(test, '2026-11-13')).toBe('focus');
    expect(stageOf(test, '2026-11-18')).toBe('final');
    expect(stageOf(test, '2026-11-21')).toBe('past');
    const exam = assessment({ kind: 'exam', date: at('2026-12-07') });
    expect(stageOf(exam, '2026-10-26')).toBe('build');
    expect(stageOf(exam, '2026-11-23')).toBe('focus');
    expect(stageOf(exam, '2026-12-04')).toBe('final');
    expect(stageOf(assessment({ kind: 'exam', date: at('2026-12-07'), ramp: { build: 10, focus: 5, final: 1 } }), '2026-11-23')).toBe('none');
  });

  it('pulls harder for heavier and closer assessments', () => {
    const near = assessment({ date: at('2026-10-30'), weighting: 15 });
    const far = assessment({ date: at('2026-11-10'), weighting: 15 });
    const heavy = assessment({ date: at('2026-11-10'), weighting: 40 });
    expect(prepPull(near, '2026-10-26')).toBeGreaterThan(prepPull(far, '2026-10-26'));
    expect(prepPull(heavy, '2026-10-26')).toBeGreaterThan(prepPull(far, '2026-10-26'));
    expect(prepPull(assessment({ kind: 'assignment', date: at('2026-10-30') }), '2026-10-26')).toBe(0);
  });

  it('groups a trials fortnight into one block', () => {
    const blocks = blocksOf([
      assessment({ date: at('2027-08-02') }),
      assessment({ date: at('2027-08-05') }),
      assessment({ date: at('2027-08-12') }),
      assessment({ date: at('2027-09-20') }),
    ]);
    expect(blocks.map((b) => b.length)).toEqual([3, 1]);
  });
});

describe('SmarterEd homework', () => {
  it('is done once every question in the skill has been tried since it was set', () => {
    const t = task('Set', { type: 'smartered', skillId: 'k', created: 100 });
    const problems = [{ skillId: 'k', id: 'p1' }, { skillId: 'k', id: 'p2' }] as never[];
    const attempt = (problemId: string, atTime: number) => ({ skillId: 'k', problemId, at: atTime }) as never;
    expect(finishedSets([t], { problems, attempts: [attempt('p1', 200)] }, 300)).toEqual([]);
    expect(finishedSets([t], { problems, attempts: [attempt('p1', 50), attempt('p2', 200)] }, 300)).toEqual([]);
    expect(finishedSets([t], { problems, attempts: [attempt('p1', 150), attempt('p2', 200)] }, 300)[0]).toMatchObject({ status: 'done' });
  });
});

describe('backup', () => {
  beforeEach(async () => {
    await resetDbConnection();
    indexedDB.deleteDatabase(DB_NAME);
  });

  it('keeps homework, plans and study windows', async () => {
    await saveTask(task('Essay'));
    const a = defaultAvailability();
    a.trainingDays = [1, 3];
    await saveAvailability(a);
    const backup = parseBackup(JSON.parse(JSON.stringify(await createBackup())));
    expect(backup.tasks).toHaveLength(1);
    await resetDbConnection();
    indexedDB.deleteDatabase(DB_NAME);
    await restoreBackup(backup);
    expect((await listTasks())[0].title).toBe('Essay');
    expect((await getAvailability()).trainingDays).toEqual([1, 3]);
  });

  it('restores an old backup without planner data', async () => {
    const old = parseBackup({ format: 'study-app-backup', version: 2, decks: [], cards: [], reviewLogs: [] });
    expect(old.tasks).toEqual([]);
    await restoreBackup(old);
    expect((await getAvailability()).windows.length).toBeGreaterThan(0);
  });
});

it('labels due dates plainly', () => {
  expect(dueLabel('2026-10-23', TODAY)).toBe('1 day late');
  expect(dueLabel(TODAY, TODAY)).toBe('due today');
  expect(dueLabel('2026-10-25', TODAY)).toBe('due tomorrow');
  expect(dueLabel('2026-10-28', TODAY)).toMatch(/^due Wed/);
});
