// Turns a read Anki collection into cards for this app. Every card starts
// fresh in FSRS (no Anki review history comes across).

import type { CardType, CardTypingMode } from '../types';
import type { AnkiCollection, AnkiNote, AnkiNoteType } from './read';
import { clozeAnswer, clozeNumbers, htmlToMarkdown, plainAnswer, renderTemplate } from './html';

export interface DraftCard {
  front: string;
  back: string;
  answer?: string;
  type: CardType;
  typing: CardTypingMode;
  tags: string[];
  /** "anki:<note guid>" (plus ":c<n>" for cloze), used to spot re-imports. */
  source: string;
  /** Picture moved to the card's picture slot (when the front has exactly one). */
  frontImage?: string;
  /** Every picture file the card needs. */
  images: string[];
}

export interface DeckGroup {
  ankiDeckId: number;
  /** Full Anki name, e.g. "Chemistry::Module 5". */
  path: string;
  cards: DraftCard[];
}

export interface ImportPlan {
  groups: DeckGroup[];
  /** Notes that could not come across, grouped by reason. */
  skipped: { reason: string; count: number }[];
  /** Cards already in the app from an earlier import, left out. */
  alreadyImported: number;
  /** Cards that had sound removed. */
  audioRemoved: number;
  /** Picture names the cards use that were missing from the file. */
  missingImages: string[];
}

export function planImport(col: AnkiCollection, existingSources: Set<string> = new Set()): ImportPlan {
  const groups = new Map<number, DeckGroup>();
  const skipped = new Map<string, number>();
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  let alreadyImported = 0;
  let audioRemoved = 0;
  const missing = new Set<string>();

  const cardsByNote = new Map<number, { deckId: number; ord: number }[]>();
  for (const c of col.cards) {
    const list = cardsByNote.get(c.noteId) ?? [];
    list.push({ deckId: c.deckId, ord: c.ord });
    cardsByNote.set(c.noteId, list);
  }

  for (const note of col.notes) {
    const noteType = col.noteTypes.get(note.noteTypeId);
    const ankiCards = cardsByNote.get(note.id) ?? [];
    if (!noteType) {
      skip('Unknown note type');
      continue;
    }
    if (ankiCards.length === 0) continue;
    if (/image occlusion/i.test(noteType.name)) {
      skip('Image occlusion cards (not supported yet)');
      continue;
    }
    const deckId = ankiCards[0].deckId;
    const deckName = col.decks.get(deckId) ?? 'Imported';
    const drafts = noteType.cloze
      ? clozeDrafts(note, noteType, ankiCards.map((c) => c.ord), deckName)
      : [basicDraft(note, noteType, ankiCards.map((c) => c.ord), deckName)];

    for (const draft of drafts) {
      if (!draft || (!draft.front.trim() && !draft.frontImage) || !draft.back.trim()) {
        skip('Empty front or back');
        continue;
      }
      if (existingSources.has(draft.source)) {
        alreadyImported++;
        continue;
      }
      if ((draft as DraftWithAudio).hadAudio) audioRemoved++;
      delete (draft as DraftWithAudio).hadAudio;
      for (const img of draft.images) if (!col.media.has(img)) missing.add(img);
      const group = groups.get(deckId) ?? { ankiDeckId: deckId, path: deckName, cards: [] };
      group.cards.push(draft);
      groups.set(deckId, group);
    }
  }

  return {
    groups: [...groups.values()].sort((a, b) => a.path.localeCompare(b.path)),
    skipped: [...skipped].map(([reason, count]) => ({ reason, count })),
    alreadyImported,
    audioRemoved,
    missingImages: [...missing],
  };
}

type DraftWithAudio = DraftCard & { hadAudio?: boolean };

function fieldMap(note: AnkiNote, noteType: AnkiNoteType): Record<string, string> {
  const fields: Record<string, string> = {};
  noteType.fields.forEach((name, i) => (fields[name] = note.fields[i] ?? ''));
  return fields;
}

function cleanTags(tags: string[]): string[] {
  // Anki uses "::" for nested tags; this app's tags are flat.
  return [...new Set(tags.filter((t) => t.toLowerCase() !== 'leech').map((t) => t.replaceAll('::', '/')))];
}

function draftFrom(
  questionHtml: string,
  answerHtml: string,
  extra: Pick<DraftCard, 'type' | 'typing' | 'tags' | 'source' | 'answer'>,
): DraftWithAudio {
  const q = htmlToMarkdown(questionHtml);
  const a = htmlToMarkdown(answerHtml);
  let front = q.markdown;
  let frontImage: string | undefined;
  if (q.images.length === 1) {
    // A single front picture goes in the card's own picture slot, which the
    // editor shows as a picture rather than as a long line of text.
    frontImage = q.images[0];
    front = front.replace(/!\[\]\(anki-media:[^)]*\)/, '').replace(/\n{3,}/g, '\n\n').trim();
  }
  return {
    ...extra,
    front,
    back: a.markdown,
    frontImage,
    images: [...new Set([...q.images, ...a.images])],
    hadAudio: q.hadAudio || a.hadAudio,
  };
}

function basicDraft(note: AnkiNote, noteType: AnkiNoteType, ords: number[], deckName: string): DraftWithAudio | null {
  const fields = fieldMap(note, noteType);
  const firstOrd = Math.min(...ords);
  const template = noteType.templates[firstOrd] ?? noteType.templates[0];
  if (!template) return null;

  const ctx = { fields, deckName, tags: note.tags };
  const question = renderTemplate(template.qfmt, { ...ctx, side: 'question' });
  const answer = renderTemplate(template.afmt, { ...ctx, side: 'answer', frontSide: question.html });

  // Anki's "and reversed" note types make a second card asking the other way
  // round. This app does that with one reversed card.
  const reversed = noteType.templates.length === 2 && ords.includes(0) && ords.includes(1);
  const typeField = question.typeField;
  return draftFrom(question.html, answer.html, {
    type: reversed ? 'reversed' : 'basic',
    typing: typeField ? 'always' : 'deck',
    answer: typeField ? plainAnswer(fields[typeField] ?? '') || undefined : undefined,
    tags: cleanTags(note.tags),
    source: `anki:${note.guid}`,
  });
}

function clozeDrafts(note: AnkiNote, noteType: AnkiNoteType, ords: number[], deckName: string): (DraftWithAudio | null)[] {
  const fields = fieldMap(note, noteType);
  const template = noteType.templates[0];
  if (!template) return [];
  // The field the template clozes, usually "Text".
  const clozeField = template.qfmt.match(/\{\{(?:[^}:]*:)*cloze:([^}]+)\}\}/)?.[1]?.trim() ?? noteType.fields[0];
  const numbers = clozeNumbers(fields[clozeField] ?? '');
  const wanted = numbers.filter((n) => ords.includes(n - 1));

  return wanted.map((n) => {
    const ctx = { fields, deckName, tags: note.tags, cloze: n };
    const question = renderTemplate(template.qfmt, { ...ctx, side: 'question' });
    const answer = renderTemplate(template.afmt, { ...ctx, side: 'answer', frontSide: question.html });
    // The back shows the whole sentence with the answer in bold, plus any extra notes.
    return draftFrom(question.html, answer.html, {
      type: 'basic',
      typing: question.typeField ? 'always' : 'deck',
      answer: clozeAnswer(fields[clozeField] ?? '', n) || undefined,
      tags: cleanTags(note.tags),
      source: `anki:${note.guid}:c${n}`,
    });
  });
}
