// Glue between the Anki reader and the app: loads SQLite, reads the file,
// turns the chosen Anki decks into app decks and cards, and saves them.

import type { SqlJsStatic } from 'sql.js';
import { addDecksAndCards, listCards, newId } from '../db';
import { emptyState } from '../scheduler';
import { SUBJECTS, type Card, type Deck } from '../types';
import { imageToDataUrl } from '../images';
import { readApkg, type AnkiCollection } from './read';
import { planImport, type DeckGroup, type DraftCard, type ImportPlan } from './convert';
import { MEDIA_PREFIX } from './html';

let sqlPromise: Promise<SqlJsStatic> | null = null;

/** SQLite is only loaded when an import starts, so the rest of the app stays quick to open. */
function loadSql(): Promise<SqlJsStatic> {
  sqlPromise ??= Promise.all([import('sql.js'), import('sql.js/dist/sql-wasm-browser.wasm?url')]).then(
    ([mod, wasm]) => mod.default({ locateFile: () => wasm.default }),
  );
  return sqlPromise;
}

export interface OpenedDeckFile {
  fileName: string;
  collection: AnkiCollection;
  plan: ImportPlan;
}

export async function openDeckFile(file: File): Promise<OpenedDeckFile> {
  const [SQL, bytes, existing] = await Promise.all([
    loadSql(),
    file.arrayBuffer().then((b) => new Uint8Array(b)),
    listCards(),
  ]);
  const collection = readApkg(bytes, SQL);
  const plan = planImport(collection, new Set(existing.map((c) => c.source)));
  return { fileName: file.name, collection, plan };
}

/** Guesses the school subject from an Anki deck name like "Chem::Module 5". */
export function guessSubject(path: string): string {
  const p = path.toLowerCase();
  const rules: [RegExp, (typeof SUBJECTS)[number]][] = [
    [/ext(ension)?\.?\s*2|\bx2\b|\bme2\b/, 'Maths Extension 2'],
    [/ext(ension)?\.?\s*1|\bx1\b|\bme1\b/, 'Maths Extension 1'],
    [/math|calculus|trig|algebra|statistic|probabilit/, 'Maths Advanced'],
    [/chem/, 'Chemistry'],
    [/english|poetry|novel|shakespeare/, 'English Advanced'],
    [/business/, 'Business Studies'],
    [/engineer/, 'Engineering Studies'],
  ];
  return rules.find(([re]) => re.test(p))?.[1] ?? 'Other';
}

/** What a group of imported cards turns into: a new deck, or added to one that exists. */
export type Destination =
  | { kind: 'new'; name: string; subject: string; module: string }
  | { kind: 'existing'; deckId: string };

export interface GroupChoice {
  group: DeckGroup;
  include: boolean;
  destination: Destination;
}

export function defaultChoice(group: DeckGroup): GroupChoice {
  const parts = group.path.split('::').map((s) => s.trim()).filter(Boolean);
  return {
    group,
    include: true,
    destination: {
      kind: 'new',
      name: parts[parts.length - 1] ?? 'Imported',
      subject: guessSubject(group.path),
      module: parts.length > 2 ? parts[parts.length - 2] : '',
    },
  };
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

/** Picture bytes to a data URL (large pictures are shrunk, like pictures added by hand). */
async function pictureUrl(name: string, bytes: Uint8Array): Promise<string | undefined> {
  const type = MIME[name.split('.').pop()?.toLowerCase() ?? ''];
  if (!type) return undefined;
  try {
    return await imageToDataUrl(new File([bytes as BlobPart], name, { type }));
  } catch {
    return undefined;
  }
}

/** Swaps picture placeholders for the pictures themselves; missing ones are removed. */
export function fillPictures(text: string, urls: Map<string, string>): string {
  return text
    .replace(/!\[\]\(anki-media:([^)]*)\)/g, (_, enc: string) => {
      const url = urls.get(decodeURIComponent(enc));
      return url ? `![](${url})` : '';
    })
    .trim();
}

export function draftToCard(draft: DraftCard, deckId: string, topic: string, urls: Map<string, string>, now: number): Card {
  return {
    id: newId(),
    deckId,
    topic,
    tags: draft.tags,
    type: draft.type,
    typing: draft.typing,
    front: fillPictures(draft.front, urls),
    back: fillPictures(draft.back, urls),
    ...(draft.answer ? { answer: draft.answer } : {}),
    ...(draft.frontImage && urls.get(draft.frontImage) ? { image: urls.get(draft.frontImage) } : {}),
    source: draft.source,
    fsrs: emptyState(now),
    ...(draft.type === 'reversed' ? { fsrsReverse: emptyState(now) } : {}),
    created: now,
    updated: now,
  };
}

export interface ImportResult {
  cards: number;
  decks: { id: string; name: string; added: number }[];
}

export async function runImport(
  opened: OpenedDeckFile,
  choices: GroupChoice[],
  existingDecks: Deck[],
  onProgress?: (text: string) => void,
): Promise<ImportResult> {
  const now = Date.now();
  const chosen = choices.filter((c) => c.include && c.group.cards.length > 0);

  // Pictures first, once each, only for the cards being imported.
  const names = new Set(chosen.flatMap((c) => c.group.cards.flatMap((card) => card.images)));
  const urls = new Map<string, string>();
  let done = 0;
  for (const name of names) {
    onProgress?.(`Copying pictures (${++done} of ${names.size})`);
    const bytes = opened.collection.media.get(name);
    const url = bytes && (await pictureUrl(name, bytes));
    if (url) urls.set(name, url);
  }

  onProgress?.('Saving cards');
  const newDecks: Deck[] = [];
  const cards: Card[] = [];
  const summary = new Map<string, { id: string; name: string; added: number }>();
  const newByName = new Map<string, Deck>();

  for (const choice of chosen) {
    let deck: Deck | undefined;
    const dest = choice.destination;
    if (dest.kind === 'existing') {
      deck = existingDecks.find((d) => d.id === dest.deckId);
    } else {
      // Two Anki decks given the same new name and subject share one deck.
      const name = dest.name.trim() || 'Imported';
      const key = `${dest.subject.trim()}\u0000${name}`;
      deck = newByName.get(key);
      if (!deck) {
        deck = {
          id: newId(),
          name,
          subject: dest.subject.trim() || 'Other',
          module: dest.module.trim(),
          typingDefault: 'off',
          created: now,
          updated: now,
        };
        newByName.set(key, deck);
        newDecks.push(deck);
      }
    }
    if (!deck) continue;
    // Cards added to a deck that already exists keep their Anki deck name as their topic.
    const topic = dest.kind === 'existing' ? (choice.group.path.split('::').pop()?.trim() ?? '') : '';
    for (const draft of choice.group.cards) cards.push(draftToCard(draft, deck.id, topic, urls, now));
    const s = summary.get(deck.id) ?? { id: deck.id, name: deck.name, added: 0 };
    s.added += choice.group.cards.length;
    summary.set(deck.id, s);
  }

  await addDecksAndCards(newDecks, cards);
  return { cards: cards.length, decks: [...summary.values()] };
}

