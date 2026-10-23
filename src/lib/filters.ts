import { href } from './router.svelte';
import type { StudyFilter } from './queue';
import type { Deck } from './types';

/** Turns the parts of a #/review/... address into a study filter. */
export function filterFromParts(parts: string[]): StudyFilter {
  const [kind, a, b] = parts;
  if (kind === 'subject' && a) return { kind: 'subject', subject: a };
  if (kind === 'deck' && a) return { kind: 'deck', deckId: a };
  if (kind === 'topic' && a && b) return { kind: 'topic', deckId: a, topic: b };
  if (kind === 'tag' && a) return { kind: 'tag', tag: a };
  return { kind: 'all' };
}

export function filterToParts(filter: StudyFilter): string[] {
  switch (filter.kind) {
    case 'all':
      return [];
    case 'subject':
      return ['subject', filter.subject];
    case 'deck':
      return ['deck', filter.deckId];
    case 'topic':
      return ['topic', filter.deckId, filter.topic];
    case 'tag':
      return ['tag', filter.tag];
  }
}

export function reviewHref(filter: StudyFilter): string {
  return href('review', ...filterToParts(filter));
}

/** A short name for a filter, like "Chemistry" or "#exam". */
export function filterLabel(filter: StudyFilter, decks: Deck[]): string {
  switch (filter.kind) {
    case 'all':
      return 'All subjects';
    case 'subject':
      return filter.subject;
    case 'deck':
      return decks.find((d) => d.id === filter.deckId)?.name ?? 'Deck';
    case 'topic':
      return filter.topic;
    case 'tag':
      return `#${filter.tag}`;
  }
}
