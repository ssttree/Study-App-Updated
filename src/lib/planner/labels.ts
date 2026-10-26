// Words and links for plan items, shared by the planner and the Today screen.

import { href } from '../router.svelte';
import { reviewHref } from '../filters';
import { shortSubject } from '../practice/load';
import { taskSkillIds, type PlanItem, type StudyWindow, type Task, type TestPlan, type WindowKind } from '../types';
import { clockMinutes, clockText, dueLabel } from './dates';

export const KINDS: WindowKind[] = ['bus', 'desk', 'flexible', 'school'];

export const KIND_TEXT: Record<WindowKind, string> = {
  bus: 'Bus',
  desk: 'Desk',
  flexible: 'Flexible',
  school: 'Study period',
};

export const KIND_HINT: Record<WindowKind, string> = {
  bus: 'Flashcards, and short homework if the desk is full',
  desk: 'Homework, then problems on paper',
  flexible: 'Only optional things, so skipping it costs nothing',
  school: 'At school: revision only (flashcards, then problems or test prep)',
};

export function windowTime(w: StudyWindow): string {
  const start = clockMinutes(w.start);
  return `${clockText(start)} to ${clockText(start + w.minutes)}`;
}

export interface ItemText {
  title: string;
  detail: string;
}

export function itemText(item: PlanItem, tasks: Map<string, Task>, assessments: Map<string, TestPlan>, today: string): ItemText {
  const subjects = (item.subjects ?? []).map(shortSubject).join(' + ');
  switch (item.kind) {
    case 'flashcards':
      return { title: 'Flashcards', detail: 'Everything due, new cards mixed in' };
    case 'homework': {
      const t = item.taskId ? tasks.get(item.taskId) : undefined;
      if (!t) return { title: 'Homework', detail: '' };
      const bits = [t.subject ? shortSubject(t.subject) : '', dueLabel(t.due, today)];
      if (t.minutes - t.spent > item.minutes) bits.push(`part of ${t.minutes - t.spent} min left`);
      if (!t.required) bits.push('optional');
      return { title: t.title, detail: bits.filter(Boolean).join(' · ') };
    }
    case 'problems':
      return { title: `${subjects} problems`, detail: item.optional ? 'Extra, on paper' : 'Daily mix, on paper' };
    case 'prep': {
      const a = item.assessmentId ? assessments.get(item.assessmentId) : undefined;
      return { title: `${a?.name ?? subjects} prep`, detail: 'Test prep: in-scope skills, weakest first' };
    }
    case 'final': {
      const a = item.assessmentId ? assessments.get(item.assessmentId) : undefined;
      return { title: `${a?.name ?? subjects}: timed set`, detail: 'Exam conditions, then check skills you got the wrong method on' };
    }
  }
}

/** Where "Start" goes for an item. */
export function itemLink(item: PlanItem, tasks: Map<string, Task>): string {
  const minutes = `${Math.max(5, Math.round(item.minutes))}m`;
  switch (item.kind) {
    case 'flashcards':
      return reviewHref({ kind: 'all' });
    case 'homework': {
      const t = item.taskId ? tasks.get(item.taskId) : undefined;
      if (t && taskSkillIds(t).length) return href('practice', 'run', 'task', t.id, minutes);
      if (t?.type === 'smartered') return href('practice', 'import', 'task', t.id);
      return href('planner', 'task', item.taskId ?? 'new');
    }
    case 'problems':
      return href('practice', 'run', 'mix', ...(item.subjects ?? []), minutes);
    case 'prep':
    case 'final':
      return item.assessmentId ? href('practice', 'run', 'plan', item.assessmentId, minutes) : href('practice');
  }
}

/** Dot colour by kind, matching the rest of the app. */
export function itemColour(item: PlanItem): string {
  if (item.kind === 'flashcards') return 'var(--info)';
  if (item.kind === 'homework') return 'var(--good)';
  if (item.kind === 'prep' || item.kind === 'final') return 'var(--warn)';
  return 'var(--accent)';
}
