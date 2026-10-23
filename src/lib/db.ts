// All data lives in the browser's IndexedDB, so the app works with no
// internet. Later phases add new object stores by bumping DB_VERSION and
// adding a case to upgrade(); existing data is kept.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { DEFAULT_SETTINGS, type Card, type Deck, type ReviewLog, type Settings } from './types';

interface StudyDB extends DBSchema {
  decks: { key: string; value: Deck };
  cards: { key: string; value: Card; indexes: { deckId: string } };
  reviewLogs: {
    key: string;
    value: ReviewLog;
    indexes: { cardId: string; reviewedAt: number };
  };
  meta: { key: string; value: unknown };
}

export const DB_NAME = 'study-app';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<StudyDB>> | null = null;

export function db(): Promise<IDBPDatabase<StudyDB>> {
  dbPromise ??= openDB<StudyDB>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('decks', { keyPath: 'id' });
        const cards = database.createObjectStore('cards', { keyPath: 'id' });
        cards.createIndex('deckId', 'deckId');
        const logs = database.createObjectStore('reviewLogs', { keyPath: 'id' });
        logs.createIndex('cardId', 'cardId');
        logs.createIndex('reviewedAt', 'reviewedAt');
        database.createObjectStore('meta');
      }
    },
    // A newer version of the app opened in another tab: step aside so it can upgrade.
    blocking() {
      dbPromise?.then((d) => d.close());
      dbPromise = null;
    },
  });
  return dbPromise;
}

/** Only for tests: close the open connection so a fresh database is used. */
export async function resetDbConnection(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

export function newId(): string {
  return crypto.randomUUID();
}

// Decks

export async function listDecks(): Promise<Deck[]> {
  const decks = await (await db()).getAll('decks');
  return decks.sort((a, b) => a.subject.localeCompare(b.subject) || a.name.localeCompare(b.name));
}

export async function getDeck(id: string): Promise<Deck | undefined> {
  return (await db()).get('decks', id);
}

export async function saveDeck(deck: Deck): Promise<void> {
  await (await db()).put('decks', { ...deck, updated: Date.now() });
}

/** Deletes a deck, its cards and their review history. */
export async function deleteDeck(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(['decks', 'cards', 'reviewLogs'], 'readwrite');
  const cardIds = await tx.objectStore('cards').index('deckId').getAllKeys(id);
  for (const cardId of cardIds) {
    await deleteCardInTx(tx.objectStore('cards'), tx.objectStore('reviewLogs'), cardId);
  }
  await tx.objectStore('decks').delete(id);
  await tx.done;
}

// Cards

export async function listCards(deckId?: string): Promise<Card[]> {
  const database = await db();
  return deckId ? database.getAllFromIndex('cards', 'deckId', deckId) : database.getAll('cards');
}

export async function getCard(id: string): Promise<Card | undefined> {
  return (await db()).get('cards', id);
}

export async function saveCard(card: Card): Promise<void> {
  await (await db()).put('cards', { ...card, updated: Date.now() });
}

export async function deleteCard(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(['cards', 'reviewLogs'], 'readwrite');
  await deleteCardInTx(tx.objectStore('cards'), tx.objectStore('reviewLogs'), id);
  await tx.done;
}

type CardStore = { delete(key: string): Promise<void> };
type LogStore = {
  index(name: 'cardId'): { getAllKeys(query: string): Promise<string[]> };
  delete(key: string): Promise<void>;
};

async function deleteCardInTx(cards: CardStore, logs: LogStore, id: string): Promise<void> {
  const logIds = await logs.index('cardId').getAllKeys(id);
  for (const logId of logIds) await logs.delete(logId);
  await cards.delete(id);
}

// Review logs

/** Saves the updated card and its review log together, so neither is lost alone. */
export async function recordReview(card: Card, log: ReviewLog): Promise<void> {
  const database = await db();
  const tx = database.transaction(['cards', 'reviewLogs'], 'readwrite');
  await tx.objectStore('cards').put({ ...card, updated: Date.now() });
  await tx.objectStore('reviewLogs').add(log);
  await tx.done;
}

export async function logsSince(since: number): Promise<ReviewLog[]> {
  return (await db()).getAllFromIndex('reviewLogs', 'reviewedAt', IDBKeyRange.lowerBound(since));
}

export async function listReviewLogs(): Promise<ReviewLog[]> {
  return (await db()).getAll('reviewLogs');
}

// Settings

export async function getSettings(): Promise<Settings> {
  const stored = (await (await db()).get('meta', 'settings')) as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await (await db()).put('meta', settings, 'settings');
}

/** Replaces everything with the given data (used by backup restore). */
export async function replaceAll(data: {
  decks: Deck[];
  cards: Card[];
  reviewLogs: ReviewLog[];
  settings: Settings;
}): Promise<void> {
  const database = await db();
  const tx = database.transaction(['decks', 'cards', 'reviewLogs', 'meta'], 'readwrite');
  await Promise.all([
    tx.objectStore('decks').clear(),
    tx.objectStore('cards').clear(),
    tx.objectStore('reviewLogs').clear(),
  ]);
  for (const deck of data.decks) await tx.objectStore('decks').put(deck);
  for (const card of data.cards) await tx.objectStore('cards').put(card);
  for (const log of data.reviewLogs) await tx.objectStore('reviewLogs').put(log);
  await tx.objectStore('meta').put(data.settings, 'settings');
  await tx.done;
}
