import { href } from './router.svelte';
import type { StudyFilter } from './queue';

/** Turns the parts of a #/review/... address into a study filter. */
export function filterFromParts(parts: string[]): StudyFilter {
  const [kind, a, b] = parts;
  if (kind === 'subject' && a) return { kind: 'subject', subject: a };
  if (kind === 'deck' && a) return { kind: 'deck', deckId: a };
  if (kind === 'topic' && a && b) return { kind: 'topic', deckId: a, topic: b };
  return { kind: 'all' };
}

export function reviewHref(filter: StudyFilter): string {
  switch (filter.kind) {
    case 'all':
      return href('review');
    case 'subject':
      return href('review', 'subject', filter.subject);
    case 'deck':
      return href('review', 'deck', filter.deckId);
    case 'topic':
      return href('review', 'topic', filter.deckId, filter.topic);
  }
}
