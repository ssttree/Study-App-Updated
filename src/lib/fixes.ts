// The list of app fixes: bugs and improvements noticed while using the app,
// saved from any screen and fixed later in one go.

import type { Fix, FixArea } from './types';
import type { Route } from './router.svelte';

/** The part of the app a screen belongs to, so a new fix starts with the right area. */
export function areaFor(route: Route['name']): FixArea {
  switch (route) {
    case 'decks':
    case 'deck':
    case 'card':
    case 'newCard':
    case 'custom':
    case 'customRun':
    case 'import':
    case 'review':
      return 'Flashcards';
    case 'practice':
    case 'plans':
    case 'plan':
    case 'skills':
    case 'skill':
    case 'pdfImport':
    case 'atarImport':
    case 'writeQuestion':
    case 'practiceRun':
      return 'Practice';
    case 'homework':
    case 'task':
      return 'Homework';
    case 'planner':
    case 'windows':
    case 'exams':
    case 'connect':
      return 'Planner';
    case 'progress':
    case 'progressSubject':
    case 'progressTopic':
    case 'activity':
    case 'marks':
    case 'marksImport':
    case 'mark':
    case 'weeklyReview':
      return 'Progress';
    default:
      return 'Other';
  }
}

/** The open fixes as a numbered list, oldest first, ready to paste into a chat. */
export function fixListText(fixes: Fix[]): string {
  const open = fixes.filter((f) => !f.done).sort((a, b) => a.created - b.created);
  const lines = open.map(
    (f, i) => `${i + 1}. [${f.kind === 'idea' ? 'Improvement' : 'Bug'}, ${f.area}] ${f.text}${f.where ? ` (from ${f.where})` : ''}`,
  );
  return `Study App fix list (${open.length} open):\n${lines.join('\n')}`;
}
