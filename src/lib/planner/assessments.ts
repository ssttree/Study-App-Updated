// Assessments ramp up prep in three stages before the day. Class tests start
// 21 days out, trials and the HSC 42 days out, so spaced practice has time to
// work; the night before stays light because sleep does more than cramming.

import type { AssessmentKind, RampDays, TestPlan } from '../types';
import { daysBetween, dateKey } from './dates';

export const DEFAULT_RAMP: Record<Exclude<AssessmentKind, 'assignment'>, RampDays> = {
  test: { build: 21, focus: 7, final: 2 },
  exam: { build: 42, focus: 14, final: 3 },
};

export const KIND_LABEL: Record<AssessmentKind, string> = {
  test: 'Class test',
  exam: 'Trial or HSC exam',
  assignment: 'Assignment',
};

/** none: too far off. build, focus, final: the ramp. past: the day has gone. */
export type Stage = 'none' | 'build' | 'focus' | 'final' | 'past';

export const STAGE_LABEL: Record<Stage, string> = {
  none: 'Later',
  build: 'Build',
  focus: 'Focus',
  final: 'Final',
  past: 'Done',
};

export function kindOf(a: TestPlan): AssessmentKind {
  return a.kind ?? 'test';
}

export function rampOf(a: TestPlan): RampDays | null {
  const kind = kindOf(a);
  if (kind === 'assignment') return null;
  return a.ramp ?? DEFAULT_RAMP[kind];
}

/** Days from today until the assessment (0 on the day). */
export function daysUntil(a: TestPlan, today: string): number {
  return daysBetween(today, dateKey(a.date));
}

export function stageOf(a: TestPlan, today: string): Stage {
  const days = daysUntil(a, today);
  if (days < 0) return 'past';
  const ramp = rampOf(a);
  if (!ramp) return 'none';
  if (days <= ramp.final) return 'final';
  if (days <= ramp.focus) return 'focus';
  if (days <= ramp.build) return 'build';
  return 'none';
}

/** What each stage changes, in a sentence, for the assessment page. */
export const STAGE_TEXT: Record<Exclude<Stage, 'none' | 'past'>, string> = {
  build: 'This subject is picked for problems more often, and its in-scope skills come first.',
  focus: 'Test prep mode: problems only from in-scope skills, weakest first. In-scope flashcards aim for 95% recall instead of 90%.',
  final: 'Timed mixed sets under exam conditions, plus a quick look at every in-scope skill you got the wrong method on.',
};

/**
 * How much an assessment should pull on today's problem time. Closer and
 * heavier assessments pull harder, so a fortnight of trials is spread by
 * date and weighting rather than one subject taking every evening.
 */
export function prepPull(a: TestPlan, today: string): number {
  const stage = stageOf(a, today);
  if (stage === 'none' || stage === 'past') return 0;
  const days = Math.max(1, daysUntil(a, today));
  const weight = a.weighting && a.weighting > 0 ? a.weighting : 15;
  const stageBoost = stage === 'final' ? 3 : stage === 'focus' ? 2 : 1;
  return (weight / 15) * stageBoost * (10 / (days + 3));
}

/**
 * Groups assessments that land close together (within 10 days of the one
 * before) into blocks, like a trials fortnight, for the timeline view.
 */
export function blocksOf(list: TestPlan[]): TestPlan[][] {
  const sorted = [...list].sort((a, b) => a.date - b.date);
  const blocks: TestPlan[][] = [];
  for (const a of sorted) {
    const last = blocks[blocks.length - 1];
    if (last && (a.date - last[last.length - 1].date) / 86_400_000 <= 10) last.push(a);
    else blocks.push([a]);
  }
  return blocks;
}

/** Flashcard decks in scope of an assessment in its focus or final stage: they aim for 95% recall. */
export function examDeckIds(list: TestPlan[], today: string): Set<string> {
  const ids = new Set<string>();
  for (const a of list) {
    const stage = stageOf(a, today);
    if (stage === 'focus' || stage === 'final') for (const d of a.deckIds ?? []) ids.add(d);
  }
  return ids;
}

/** Recall target for exam-week cards. */
export const EXAM_RETENTION = 0.95;
