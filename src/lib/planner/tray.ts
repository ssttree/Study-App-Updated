// The to do tray beside the calendar: everything you could put on it. In
// calendar mode nothing is planned for you, so this is where study comes from:
// drag an entry onto a time, or press Add for the next free time.

import type { DayPlan, PlanItem, PlanItemKind, Task, TestPlan } from '../types';
import { dateKey, daysBetween, dueLabel } from './dates';
import { remaining } from './build';
import { stageOf, STAGE_LABEL } from './assessments';
import { shortSubject } from './quickadd';

export interface TrayEntry {
  key: string;
  kind: PlanItemKind;
  title: string;
  detail: string;
  /** How long a block it makes. */
  minutes: number;
  taskId?: string;
  subjects?: string[];
  assessmentId?: string;
  /** Due by the day it's for, or a test in its last days. */
  urgent?: boolean;
}

/** The longest homework block one drag makes; drag again for more. */
export const TRAY_BLOCK = 60;

export interface TrayInput {
  /** The day the tray is for (flashcards and "due" are worked out for it). */
  date: string;
  today: string;
  tasks: Task[];
  assessments: TestPlan[];
  /** Plans from today on, to see what is already on the calendar. */
  plans: DayPlan[];
  flashMinutes: (date: string) => number;
  problemSubjects: string[];
  problemMinutes: number;
}

const open = (it: PlanItem) => it.status === 'todo';

export function trayFor(input: TrayInput): TrayEntry[] {
  const out: TrayEntry[] = [];
  const upcoming = input.plans.filter((p) => p.date >= input.today);
  const onDay = input.plans.find((p) => p.date === input.date)?.items ?? [];

  // Flashcards, once a day.
  const flash = input.flashMinutes(input.date);
  if (flash > 0 && !onDay.some((it) => it.kind === 'flashcards' && it.status !== 'skipped')) {
    out.push({ key: 'flashcards', kind: 'flashcards', title: 'Flashcards', detail: 'Everything due, new cards mixed in', minutes: Math.max(10, Math.min(flash, 45)) });
  }

  // Homework with time not yet on the calendar.
  const placed = new Map<string, number>();
  for (const p of upcoming) for (const it of p.items) if (it.taskId && open(it)) placed.set(it.taskId, (placed.get(it.taskId) ?? 0) + it.minutes);
  const tasks = input.tasks
    .filter((t) => t.status === 'open')
    .sort((a, b) => Number(b.required) - Number(a.required) || a.due.localeCompare(b.due) || a.created - b.created);
  for (const t of tasks) {
    const left = remaining(t) - (placed.get(t.id) ?? 0);
    if (left < 5) continue;
    const bits = [t.subject ? shortSubject(t.subject) : '', dueLabel(t.due, input.today), `${left} min left`];
    if (!t.required) bits.push('optional');
    out.push({
      key: `task:${t.id}`,
      kind: 'homework',
      title: t.title,
      detail: bits.filter(Boolean).join(' · '),
      minutes: Math.min(left, TRAY_BLOCK),
      taskId: t.id,
      subjects: t.subject ? [t.subject] : undefined,
      urgent: t.required && t.due <= input.date,
    });
  }

  // Test prep for assessments that are close.
  const prep = input.assessments
    .filter((a) => a.kind !== 'assignment' && a.skillIds.length)
    .map((a) => ({ a, stage: stageOf(a, input.date) }))
    .filter((x) => x.stage === 'build' || x.stage === 'focus' || x.stage === 'final')
    .sort((x, y) => x.a.date - y.a.date);
  for (const { a, stage } of prep) {
    const days = daysBetween(input.today, dateKey(a.date));
    const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days > 1 ? `in ${days} days` : '';
    out.push({
      key: `prep:${a.id}`,
      kind: stage === 'final' ? 'final' : 'prep',
      title: stage === 'final' ? `${a.name}: timed set` : `${a.name} prep`,
      detail: [shortSubject(a.subject), `${STAGE_LABEL[stage]} stage`, when].filter(Boolean).join(' · '),
      minutes: 45,
      subjects: [a.subject],
      assessmentId: a.id,
      urgent: stage === 'final',
    });
  }

  // Problem practice in the subjects that need it most.
  for (const s of input.problemSubjects.slice(0, 3)) {
    out.push({
      key: `problems:${s}`,
      kind: 'problems',
      title: `${shortSubject(s)} problems`,
      detail: 'Daily mix, on paper',
      minutes: input.problemMinutes,
      subjects: [s],
    });
  }
  return out;
}

/** The plan item an entry makes, placed at `start` (HH:MM). */
export function entryItem(e: TrayEntry, start: string): Omit<PlanItem, 'id' | 'windowId' | 'pinned' | 'status'> {
  return { kind: e.kind, start, minutes: e.minutes, taskId: e.taskId, subjects: e.subjects, assessmentId: e.assessmentId };
}
