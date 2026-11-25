// Words and links for plan items, shared by the planner and the Today screen.

import { href } from '../router.svelte';
import { reviewHref } from '../filters';
import { shortSubject } from '../practice/load';
import { taskSkillIds, type PlanItem, type StudyPick, type StudyWindow, type Task, type TestPlan, type WindowKind } from '../types';
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

/** Names of skills and decks, to say what a block is for. */
export interface StudyNames {
  skills: Map<string, string>;
  decks: Map<string, string>;
}

/** True when something was picked to study. */
export function hasPick(p: StudyPick | undefined): boolean {
  return !!(p?.skillIds?.length || p?.deckIds?.length);
}

/** "Equilibrium + Acids · Chem cards", or '' when nothing is picked or names aren't known. */
export function pickText(p: StudyPick | undefined, names?: StudyNames): string {
  if (!p || !names) return '';
  const list = (ids: string[] | undefined, from: Map<string, string>) => {
    const got = (ids ?? []).map((id) => from.get(id)).filter((n): n is string => !!n);
    return got.length > 2 ? `${got.slice(0, 2).join(' + ')} + ${got.length - 2} more` : got.join(' + ');
  };
  const skills = list(p.skillIds, names.skills);
  const decks = list(p.deckIds, names.decks);
  return [skills, decks ? `cards: ${decks}` : ''].filter(Boolean).join(' · ');
}

export function itemText(item: PlanItem, tasks: Map<string, Task>, assessments: Map<string, TestPlan>, today: string, names?: StudyNames): ItemText {
  const base = baseText(item, tasks, assessments, today);
  const picked = pickText(item.study, names);
  if (!picked) return base;
  // An event says what it's for; the others keep their own words and add the choice.
  return { title: base.title, detail: picked };
}

function baseText(item: PlanItem, tasks: Map<string, Task>, assessments: Map<string, TestPlan>, today: string): ItemText {
  const subjects = (item.subjects ?? []).map(shortSubject).join(' + ');
  switch (item.kind) {
    case 'event':
      return { title: item.title?.trim() || 'Event', detail: hasPick(item.study) ? 'Study block' : '' };
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

/** Practice for the picked skills, or '' when none are picked. */
export function skillsLink(p: StudyPick | undefined, minutes: number): string {
  const ids = p?.skillIds ?? [];
  if (!ids.length) return '';
  const m = `${Math.max(5, Math.round(minutes))}m`;
  return ids.length === 1 ? href('practice', 'run', 'skill', ids[0], m) : href('practice', 'run', 'skills', ids.join(','), m);
}

/** Flashcards for the picked decks, or '' when none are picked. */
export function decksLink(p: StudyPick | undefined): string {
  const ids = p?.deckIds ?? [];
  return ids.length ? reviewHref({ kind: 'decks', deckIds: ids }) : '';
}

/**
 * Where "Start" goes for an item: what you picked to study in it (skills
 * first), else what the item is. '' for an event with nothing picked.
 */
export function itemLink(item: PlanItem, tasks: Map<string, Task>): string {
  const picked = skillsLink(item.study, item.minutes) || decksLink(item.study);
  if (picked) return picked;
  const minutes = `${Math.max(5, Math.round(item.minutes))}m`;
  switch (item.kind) {
    case 'event':
      return '';
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
export function itemColour(item: Pick<PlanItem, 'kind' | 'study'>): string {
  if (item.kind === 'event') {
    if (item.study?.skillIds?.length) return 'var(--accent)';
    if (item.study?.deckIds?.length) return 'var(--info)';
    return 'var(--dot)';
  }
  if (item.kind === 'flashcards') return 'var(--info)';
  if (item.kind === 'homework') return 'var(--good)';
  if (item.kind === 'prep' || item.kind === 'final') return 'var(--warn)';
  return 'var(--accent)';
}
