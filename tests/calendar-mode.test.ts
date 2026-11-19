import { describe, expect, it } from 'vitest';
import { defaultAvailability } from '../src/lib/planner/availability';
import { buildWeek, CALENDAR_WINDOW, calendarMode, EXTRA_WINDOW, type PlannerInput } from '../src/lib/planner/build';
import { firstFree, layoutDay } from '../src/lib/planner/timeline';
import { entryItem, trayFor, TRAY_BLOCK } from '../src/lib/planner/tray';
import { blockEvents } from '../src/lib/planner/calendar';
import type { DayPlan, PlanItem, Task } from '../src/lib/types';

const MON = '2026-10-26';

function task(fields: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Chem q5-10',
    subject: 'Chemistry',
    type: 'classwork',
    due: '2026-10-27',
    minutes: 90,
    spent: 0,
    required: true,
    status: 'open',
    notes: '',
    carryOvers: 0,
    created: 0,
    ...fields,
  };
}

function item(fields: Partial<PlanItem>): PlanItem {
  return { id: 'i1', kind: 'homework', windowId: CALENDAR_WINDOW, minutes: 30, pinned: true, status: 'todo', ...fields };
}

function input(fields: Partial<PlannerInput> = {}): PlannerInput {
  return {
    today: MON,
    availability: defaultAvailability(),
    tasks: [],
    assessments: [],
    saved: new Map(),
    flashMinutes: () => 25,
    problemSubjects: ['Chemistry'],
    now: 0,
    ...fields,
  };
}

describe('calendar mode', () => {
  it('is the default, and the windows planner is opt in', () => {
    expect(calendarMode(defaultAvailability())).toBe(true);
    expect(calendarMode({ ...defaultAvailability(), planMode: 'windows' })).toBe(false);
  });

  it('plans nothing by itself: a day is only what you placed', () => {
    const [mon] = buildWeek(input({ tasks: [task()] }), 1);
    expect(mon.windows).toEqual([]);
    expect(mon.plan.items).toEqual([]);
    expect(mon.warnings).toEqual([]);
  });

  it('keeps placed items at their times and drops homework for finished tasks', () => {
    const saved: DayPlan = {
      date: MON,
      built: 0,
      items: [
        item({ id: 'a', start: '17:00', taskId: 't1' }),
        item({ id: 'b', start: '16:00', kind: 'flashcards' }),
        item({ id: 'c', start: '18:00', taskId: 'gone' }),
        // Left by the old windows planner and never touched.
        item({ id: 'd', windowId: 'desk-pm', pinned: false }),
      ],
    };
    const [mon] = buildWeek(input({ tasks: [task()], saved: new Map([[MON, saved]]) }), 1);
    expect(mon.plan.items.map((it) => it.id)).toEqual(['b', 'a']);
    const lay = layoutDay(mon.windows, mon.plan.items);
    expect(lay.items.map((t) => [t.item.id, t.start, t.end])).toEqual([
      ['b', 16 * 60, 16 * 60 + 30],
      ['a', 17 * 60, 17 * 60 + 30],
    ]);
  });

  it('shows pinned items with no time as loose', () => {
    const saved: DayPlan = { date: MON, built: 0, items: [item({ id: 'x', windowId: 'desk-pm', kind: 'problems', subjects: ['Chemistry'] })] };
    const [mon] = buildWeek(input({ saved: new Map([[MON, saved]]) }), 1);
    expect(mon.plan.items[0].windowId).toBe(EXTRA_WINDOW);
    expect(layoutDay([], mon.plan.items).loose).toHaveLength(1);
  });

  it('sends each placed block to Google at its own time', () => {
    const part = blockEvents([{ date: MON, windows: [], plan: { items: [item({ id: 'a', start: '16:30', minutes: 45 })] } }], () => 'Chem');
    expect(part.events).toHaveLength(1);
    expect(part.events[0].key).toBe(`block:${MON}:a`);
    expect(new Date(part.events[0].end!).getTime() - new Date(part.events[0].start!).getTime()).toBe(45 * 60_000);
  });
});

describe('the next free time', () => {
  it('finds the first gap that fits, on 15 minute steps', () => {
    const busy = [
      { start: 9 * 60, end: 15 * 60 + 10 },
      { start: 16 * 60, end: 16 * 60 + 30 },
    ];
    expect(firstFree(busy, 30, 15 * 60)).toBe(15 * 60 + 15);
    expect(firstFree(busy, 60, 15 * 60)).toBe(16 * 60 + 30);
    expect(firstFree(busy, 30, 8 * 60)).toBe(8 * 60);
    expect(firstFree(busy, 30, 21 * 60 + 40)).toBe(null);
  });
});

describe('the to do tray', () => {
  const base = {
    date: MON,
    today: MON,
    tasks: [task()],
    assessments: [],
    plans: [] as DayPlan[],
    flashMinutes: () => 25,
    problemSubjects: ['Chemistry', 'Maths Advanced'],
    problemMinutes: 35,
  };

  it('lists flashcards, homework and practice', () => {
    const t = trayFor(base);
    expect(t.map((e) => e.key)).toEqual(['flashcards', 'task:t1', 'problems:Chemistry', 'problems:Maths Advanced']);
    expect(t[1]).toMatchObject({ minutes: TRAY_BLOCK, urgent: false });
    expect(t[1].detail).toContain('90 min left');
  });

  it('takes off what is already on the calendar', () => {
    const plans: DayPlan[] = [
      { date: MON, built: 0, items: [item({ kind: 'flashcards', start: '16:00' }), item({ id: 'h', taskId: 't1', minutes: 60, start: '17:00' })] },
    ];
    const t = trayFor({ ...base, plans });
    expect(t.find((e) => e.key === 'flashcards')).toBeUndefined();
    expect(t.find((e) => e.key === 'task:t1')).toMatchObject({ minutes: 30 });
    const all = trayFor({ ...base, plans: [{ date: MON, built: 0, items: [item({ taskId: 't1', minutes: 90, start: '17:00' })] }] });
    expect(all.find((e) => e.key === 'task:t1')).toBeUndefined();
  });

  it('adds test prep for a close assessment', () => {
    const [y, m, d] = [2026, 10, 30];
    const t = trayFor({ ...base, assessments: [{ id: 'a1', name: 'Module 5 test', subject: 'Chemistry', date: new Date(y, m - 1, d).getTime(), skillIds: ['s'], created: 0 }] });
    const prep = t.find((e) => e.key === 'prep:a1')!;
    expect(prep).toMatchObject({ kind: 'prep', assessmentId: 'a1' });
    expect(prep.detail).toContain('in 4 days');
  });

  it('makes a plan item at the time it was dropped', () => {
    const [, hw] = trayFor(base);
    expect(entryItem(hw, '16:45')).toMatchObject({ kind: 'homework', taskId: 't1', start: '16:45', minutes: 60 });
  });
});
