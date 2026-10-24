import { describe, expect, it } from 'vitest';
import { clipToHours, defaultAvailability, weeklyMinutes, windowsFor } from '../src/lib/planner/availability';
import { buildWeek, type PlannerInput } from '../src/lib/planner/build';
import { buildHomeworkSet, newSkill } from '../src/lib/practice/mix';
import { allKnown } from '../src/lib/practice/save';
import { taskAttachments, taskSkillIds, type Problem, type Skill, type StudyWindow, type Task } from '../src/lib/types';

const MON = '2026-10-26';
let n = 0;
const id = () => `x${++n}`;

function input(fields: Partial<PlannerInput> = {}): PlannerInput {
  return {
    today: MON,
    availability: defaultAvailability(),
    tasks: [],
    assessments: [],
    saved: new Map(),
    flashMinutes: () => 25,
    problemSubjects: ['Chemistry', 'Maths Extension 1'],
    newId: id,
    now: 0,
    ...fields,
  };
}

function task(fields: Partial<Task> = {}): Task {
  return {
    id: id(), title: 'Homework', subject: 'Chemistry', type: 'classwork', due: '2026-10-27', minutes: 30, spent: 0,
    required: true, status: 'open', notes: '', carryOvers: 0, created: 0, ...fields,
  };
}

const window = (fields: Partial<StudyWindow>): StudyWindow => ({
  id: id(), name: 'W', days: [1], start: '19:00', minutes: 60, kind: 'desk', season: 'all', ...fields,
});

describe('study hours', () => {
  it('trims windows to "not after 8pm" and drops ones that end up too short', () => {
    const late = window({ start: '19:30', minutes: 60 });
    const tooLate = window({ start: '19:55', minutes: 30 });
    const bus = window({ kind: 'bus', start: '20:30', minutes: 30 });
    const out = clipToHours([late, tooLate, bus], { latest: '20:00' });
    expect(out.map((w) => [w.start, w.minutes])).toEqual([
      ['19:30', 30],
      ['20:30', 30],
    ]);
    expect(clipToHours([window({ start: '07:00', minutes: 90 })], { earliest: '08:00' })[0]).toMatchObject({ start: '08:00', minutes: 30 });
    expect(clipToHours([late], {})).toEqual([late]);
  });

  it('applies to every day, one-off days too, and the weekly totals', () => {
    const a = { ...defaultAvailability(), latest: '18:00' };
    const desk = windowsFor(MON, a).find((w) => w.kind === 'desk')!;
    expect(desk.start).toBe('17:20');
    expect(desk.minutes).toBe(40);
    a.overrides[MON] = [window({ start: '19:00' })];
    expect(windowsFor(MON, a)).toEqual([]);
    expect(weeklyMinutes(a, 'off').desk).toBe(5 * 40 + 90 + 90);
  });
});

describe('school study periods', () => {
  it('get revision, never homework', () => {
    const a = defaultAvailability();
    a.windows.push(window({ id: 'sp', name: 'Study period', start: '11:00', minutes: 60, kind: 'school', days: [1, 3] }));
    const hw = task({ minutes: 200 });
    const [mon] = buildWeek(input({ availability: a, tasks: [hw] }), 1);
    const sp = mon.plan.items.filter((it) => it.windowId === 'sp');
    expect(sp.length).toBeGreaterThan(0);
    expect(sp.every((it) => it.kind !== 'homework')).toBe(true);
    expect(sp.reduce((m, it) => m + it.minutes, 0)).toBe(60);
  });

  it('take the flashcards the bus could not fit, leaving room for problems', () => {
    const a = defaultAvailability();
    a.windows.push(window({ id: 'sp', start: '11:00', minutes: 60, kind: 'school', days: [1] }));
    const [mon] = buildWeek(input({ availability: a, flashMinutes: () => 150 }), 1);
    const sp = mon.plan.items.filter((it) => it.windowId === 'sp');
    expect(sp.map((it) => [it.kind, it.minutes])).toEqual([
      ['flashcards', 50],
      ['problems', 10],
    ]);
  });

  it('vanish on school holidays', () => {
    const a = defaultAvailability();
    a.windows.push(window({ id: 'sp', start: '11:00', minutes: 60, kind: 'school', days: [1] }));
    expect(windowsFor(MON, a, { busy: [], schoolDay: false }).some((w) => w.id === 'sp')).toBe(false);
  });
});

describe('homework with several PDFs', () => {
  it('reads old and new style links', () => {
    expect(taskSkillIds({ skillId: 'a' })).toEqual(['a']);
    expect(taskSkillIds({ skillIds: ['a', 'b'], skillId: 'a' })).toEqual(['a', 'b']);
    expect(taskSkillIds({})).toEqual([]);
    expect(taskAttachments({ attachmentId: 'i', attachmentName: 'q.pdf' })).toEqual([{ id: 'i', name: 'q.pdf' }]);
    expect(taskAttachments({ attachments: [] })).toEqual([]);
  });

  it('recognises a worksheet whose questions are all in the app already', () => {
    const known = new Map([
      ['k1', 's1'],
      ['k2', 's1'],
      ['k3', 's2'],
    ]);
    expect(allKnown(['k1', 'k2', 'k3'], known)).toBe('s1');
    expect(allKnown(['k1', 'new'], known)).toBeNull();
    expect(allKnown([], known)).toBeNull();
  });

  it('works through every worksheet in order, untried questions first', () => {
    const skills: Skill[] = ['A', 'B'].map((name) => ({ ...newSkill({ subject: 'Chemistry', name, topic: '', code: '' }, 0), id: name }));
    const problems: Problem[] = skills.flatMap((s) =>
      [2, 1, 0].map((i) => ({
        id: `${s.id}${i}`, skillId: s.id, source: 'smartered' as const, label: `Q${i + 1}`, from: s.name, key: `${s.id}${i}`,
        marks: 2, mc: false, questionImage: '', order: i, created: 0,
      })),
    );
    const attempts = [{ id: 'a', problemId: 'A0', skillId: 'A', at: 100, rating: 3 as const, method: 'yes' as const, seconds: 60, stateBefore: 0 as const }];
    const set = buildHomeworkSet({ skills, problems, attempts, plans: [] }, ['A', 'B'], 50, 60);
    expect(set.map((it) => it.problem.id)).toEqual(['A1', 'A2', 'B0', 'B1', 'B2']);
    expect(buildHomeworkSet({ skills, problems, attempts, plans: [] }, ['A', 'B'], 50, 6).map((it) => it.problem.id)).toEqual(['A1']);
  });
});
