// Changes you make to a plan or a task. Each one saves straight away and the
// screen reloads, which rebuilds everything you haven't touched.

import { newId, saveTask, savePlans } from '../db';
import type { DayPlan, PlanItem, Task } from '../types';
import { remaining, type BuiltDay } from './build';
import type { QuickTask } from './quickadd';

export function taskFromQuick(q: QuickTask, now = Date.now()): Task {
  return {
    id: newId(),
    title: q.title,
    subject: q.subject,
    type: q.type,
    due: q.due,
    minutes: q.minutes,
    spent: 0,
    required: q.required,
    study: q.study,
    status: 'open',
    notes: '',
    carryOvers: 0,
    created: now,
  };
}

function withItem(plan: DayPlan, id: string, change: (it: PlanItem) => PlanItem): DayPlan {
  return { ...plan, items: plan.items.map((it) => (it.id === id ? change(it) : it)) };
}

/** Ticks an item off. Homework time counts towards its task, which is done once nothing is left. */
export async function completeItem(day: BuiltDay, item: PlanItem, tasks: Task[], now = Date.now()): Promise<void> {
  await savePlans([withItem(day.plan, item.id, (it) => ({ ...it, status: 'done' }))]);
  const task = item.taskId ? tasks.find((t) => t.id === item.taskId) : undefined;
  if (task && task.status === 'open') {
    const spent = task.spent + item.minutes;
    const done = spent >= task.minutes;
    await saveTask({ ...task, spent, status: done ? 'done' : 'open', finished: done ? now : undefined });
  }
}

/** Undoes a tick (or a skip). */
export async function reopenItem(day: BuiltDay, item: PlanItem, tasks: Task[]): Promise<void> {
  await savePlans([withItem(day.plan, item.id, (it) => ({ ...it, status: 'todo' }))]);
  const task = item.taskId ? tasks.find((t) => t.id === item.taskId) : undefined;
  if (task && item.status === 'done') {
    const spent = Math.max(0, task.spent - item.minutes);
    await saveTask({ ...task, spent, status: 'open', finished: undefined });
  }
}

export async function skipItem(day: BuiltDay, item: PlanItem): Promise<void> {
  await savePlans([withItem(day.plan, item.id, (it) => ({ ...it, status: 'skipped' }))]);
}

export async function togglePin(day: BuiltDay, item: PlanItem): Promise<void> {
  await savePlans([withItem(day.plan, item.id, (it) => ({ ...it, pinned: !it.pinned }))]);
}

/** Marks an item as started, so a rebuild doesn't move it while you work on it. */
export async function startItem(day: BuiltDay, item: PlanItem): Promise<void> {
  if (item.started) return;
  await savePlans([withItem(day.plan, item.id, (it) => ({ ...it, started: true }))]);
}

/** Changes the problem subject; the item is pinned so the choice sticks. */
export async function setSubject(day: BuiltDay, item: PlanItem, subjects: string[]): Promise<void> {
  await savePlans([withItem(day.plan, item.id, (it) => ({ ...it, kind: 'problems', assessmentId: undefined, subjects, pinned: true }))]);
}

export async function setMinutes(day: BuiltDay, item: PlanItem, minutes: number): Promise<void> {
  await savePlans([withItem(day.plan, item.id, (it) => ({ ...it, minutes: Math.max(5, Math.round(minutes)), pinned: true }))]);
}

/**
 * Moves an item to another window, on the same day or another one. Moving
 * pins it, so the next rebuild leaves it where you put it.
 */
export async function moveItem(days: BuiltDay[], fromDate: string, itemId: string, toDate: string, toWindow: string): Promise<void> {
  const from = days.find((d) => d.date === fromDate);
  const item = from?.plan.items.find((it) => it.id === itemId);
  if (!from || !item) return;
  const moved: PlanItem = { ...item, windowId: toWindow, pinned: true, status: 'todo', started: false };
  if (fromDate === toDate) {
    await savePlans([withItem(from.plan, itemId, () => moved)]);
    return;
  }
  const to = days.find((d) => d.date === toDate);
  const target: DayPlan = to?.plan ?? { date: toDate, items: [], built: Date.now() };
  await savePlans([
    { ...from.plan, items: from.plan.items.filter((it) => it.id !== itemId) },
    { ...target, items: [...target.items, moved] },
  ]);
}

export async function addItem(day: BuiltDay, item: PlanItem): Promise<void> {
  await savePlans([{ ...day.plan, items: [...day.plan.items, item] }]);
}

export async function removeItem(day: BuiltDay, item: PlanItem): Promise<void> {
  await savePlans([{ ...day.plan, items: day.plan.items.filter((it) => it.id !== item.id) }]);
}

// Tasks

export async function finishTask(task: Task, now = Date.now()): Promise<void> {
  await saveTask({ ...task, status: 'done', spent: Math.max(task.spent, task.minutes), finished: now });
}

export async function reopenTask(task: Task): Promise<void> {
  await saveTask({ ...task, status: 'open', finished: undefined, spent: Math.min(task.spent, Math.max(0, task.minutes - 5)) });
}

/** The three answers to "this has been carried over twice". Each one resets the count. */
export async function rescheduleTask(task: Task, due: string): Promise<void> {
  await saveTask({ ...task, due, carryOvers: 0 });
}

export async function shrinkTask(task: Task, minutes: number): Promise<void> {
  await saveTask({ ...task, minutes: task.spent + Math.max(5, minutes), carryOvers: 0 });
}

export async function dropTask(task: Task, now = Date.now()): Promise<void> {
  await saveTask({ ...task, status: 'dropped', carryOvers: 0, finished: now });
}

export { remaining };
