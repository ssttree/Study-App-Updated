import { describe, expect, it } from 'vitest';
import { applyContext, defaultAvailability, windowsFor } from '../src/lib/planner/availability';
import { blockEvents, dayContext, dueEvents, lessonAt, toCalEvent, type CalendarCache } from '../src/lib/planner/calendar';
import { subjectFromTitle } from '../src/lib/planner/quickadd';
import { clockMinutes } from '../src/lib/planner/dates';
import type { Task, TestPlan } from '../src/lib/types';

// Monday 26 October 2026
const MON = '2026-10-26';
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).getTime();

function cache(fields: Partial<CalendarCache> = {}): CalendarCache {
  return { fetched: 0, from: '2026-10-20', to: '2026-11-15', work: [], timetable: [], ...fields };
}
const lesson = (day: number, h: number, title: string) => ({ title, start: at(day, h), end: at(day, h + 1), allDay: false });

describe('reading your calendars', () => {
  it('takes out windows that clash with a shift, with time to get there', () => {
    const shift = { title: 'Work', start: at(26, 17), end: at(26, 21), allDay: false };
    const ctx = dayContext(cache({ work: [shift], timetable: [lesson(26, 9, 'Chem')] }), MON)!;
    expect(ctx.busy).toEqual([{ start: 16 * 60 + 30, end: 21 * 60 + 30 }]);
    expect(ctx.schoolDay).toBe(true);
    const all = windowsFor(MON, defaultAvailability());
    const left = windowsFor(MON, defaultAvailability(), ctx);
    for (const w of left) {
      const start = clockMinutes(w.start);
      expect(start + w.minutes <= 16 * 60 + 30 || start >= 21 * 60 + 30).toBe(true);
    }
    expect(left.length).toBeLessThan(all.length);
    expect(left.some((w) => w.kind === 'bus')).toBe(true);
  });

  it('drops the bus on a weekday with no lessons or a holiday', () => {
    const windows = windowsFor(MON, defaultAvailability());
    const someOtherDay = cache({ timetable: [lesson(27, 9, 'Chem')] });
    expect(applyContext(windows, dayContext(someOtherDay, MON)).some((w) => w.kind === 'bus')).toBe(false);
    const holiday = cache({ timetable: [lesson(26, 9, 'Chem'), { title: 'School holidays', start: at(26, 0), end: at(27, 0), allDay: true }] });
    expect(dayContext(holiday, MON)!.schoolDay).toBe(false);
    expect(dayContext(cache(), MON)!.schoolDay).toBeUndefined();
    expect(dayContext(cache({ from: '2026-11-01' }), MON)).toBeUndefined();
  });

  it('keeps a one-off change you made over the calendars', () => {
    const a = defaultAvailability();
    a.overrides[MON] = [{ id: 'x', name: 'Desk', days: [1], season: 'all', kind: 'desk', start: '18:00', minutes: 60 }];
    const ctx = { busy: [{ start: 0, end: 24 * 60 }] };
    expect(windowsFor(MON, a, ctx)).toHaveLength(1);
  });

  it('guesses the subject from the lesson on now', () => {
    const c = cache({ timetable: [lesson(26, 9, '12 Chemistry'), lesson(26, 10, 'Maths Ext 1')] });
    expect(lessonAt(c, at(26, 10, 30))).toBe('Maths Ext 1');
    expect(lessonAt(c, at(26, 11, 5))).toBe('Maths Ext 1');
    expect(lessonAt(c, at(26, 13))).toBeNull();
    expect(subjectFromTitle('12 Chemistry')).toBe('Chemistry');
    expect(subjectFromTitle('Maths Ext 1')).toBe('Maths Extension 1');
    expect(subjectFromTitle('MX2')).toBe('Maths Extension 2');
    expect(subjectFromTitle('English Adv')).toBe('English Advanced');
    expect(subjectFromTitle('Maths Advanced')).toBe('Maths Advanced');
    expect(subjectFromTitle('Engineering Studies')).toBe('Engineering Studies');
    expect(subjectFromTitle('Sport')).toBe('');
  });

  it('reads all-day events as dates', () => {
    expect(toCalEvent({ title: 'x', start: '2026-10-26', end: '2026-10-27', allDay: true }).start).toBe(at(26, 0));
  });
});

describe('writing to Google', () => {
  it('puts open homework and assessments on their due days', () => {
    const base: Task = {
      id: 't1', title: 'Finish q5', subject: 'Maths Extension 1', type: 'classwork', due: '2026-10-28', minutes: 20, spent: 0,
      required: true, status: 'open', notes: '', carryOvers: 0, created: 0,
    };
    const tasks = [base, { ...base, id: 't2', status: 'done' as const }, { ...base, id: 't3', required: false, title: 'Read' }];
    const test = { id: 'a1', name: 'Trial', subject: 'Chemistry', date: at(9, 9) + 31 * 86_400_000, kind: 'exam', weighting: 30 } as unknown as TestPlan;
    const { events } = dueEvents(tasks, [test], MON);
    expect(events.map((e) => e.title)).toEqual(['Ext 1: Finish q5', 'Ext 1: Read (optional)', expect.stringContaining('Trial')]);
    expect(events[0]).toMatchObject({ key: 'task:t1', date: '2026-10-28' });
    expect(events[2].key).toBe('assessment:a1');
  });

  it('makes one block per window with something planned', () => {
    const windows = [
      { id: 'desk-pm', name: 'Desk', days: [1], season: 'all' as const, kind: 'desk' as const, start: '16:30', minutes: 60 },
      { id: 'tue-night', name: 'Night', days: [1], season: 'all' as const, kind: 'desk' as const, start: '19:00', minutes: 30 },
    ];
    const items = [
      { id: 'i1', kind: 'flashcards' as const, windowId: 'desk-pm', minutes: 15, pinned: false, status: 'todo' as const },
      { id: 'i2', kind: 'problems' as const, windowId: 'desk-pm', minutes: 45, pinned: false, status: 'todo' as const },
      { id: 'i3', kind: 'problems' as const, windowId: 'tue-night', minutes: 30, pinned: false, status: 'skipped' as const },
    ];
    const part = blockEvents([{ date: MON, windows, plan: { items } }], (it) => it.kind);
    expect(part.events).toHaveLength(1);
    expect(part.events[0]).toMatchObject({ key: `block:${MON}:desk-pm`, title: 'Study: flashcards, problems' });
    expect(Date.parse(part.events[0].start!)).toBe(at(26, 16, 30));
    expect(Date.parse(part.events[0].end!)).toBe(at(26, 17, 30));
  });
});
