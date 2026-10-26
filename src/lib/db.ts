// All data lives in the browser's IndexedDB, so the app works with no
// internet. Later phases add new object stores by bumping DB_VERSION and
// adding a case to upgrade(); existing data is kept.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { defaultAvailability } from './planner/availability';
import type { CalendarCache } from './planner/calendar';
import {
  DEFAULT_SETTINGS,
  type Attempt,
  type Availability,
  type DayPlan,
  DEFAULT_SYNC,
  taskAttachments,
  type SyncConfig,
  type Task,
  type Card,
  type Deck,
  type Problem,
  type ReviewLog,
  type Settings,
  type Skill,
  type StoredImage,
  type TestPlan,
  type Mark,
  type WeeklyReview,
} from './types';

interface StudyDB extends DBSchema {
  decks: { key: string; value: Deck };
  cards: { key: string; value: Card; indexes: { deckId: string } };
  reviewLogs: {
    key: string;
    value: ReviewLog;
    indexes: { cardId: string; reviewedAt: number };
  };
  meta: { key: string; value: unknown };
  skills: { key: string; value: Skill; indexes: { subject: string } };
  problems: { key: string; value: Problem; indexes: { skillId: string; key: string } };
  attempts: { key: string; value: Attempt; indexes: { skillId: string; problemId: string; at: number } };
  testPlans: { key: string; value: TestPlan };
  images: { key: string; value: StoredImage };
  tasks: { key: string; value: Task };
  plans: { key: string; value: DayPlan };
  marks: { key: string; value: Mark };
  weeklyReviews: { key: string; value: WeeklyReview };
}

export const DB_NAME = 'study-app';
const DB_VERSION = 4;

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
      if (oldVersion < 2) {
        // Problem practice.
        database.createObjectStore('skills', { keyPath: 'id' }).createIndex('subject', 'subject');
        const problems = database.createObjectStore('problems', { keyPath: 'id' });
        problems.createIndex('skillId', 'skillId');
        problems.createIndex('key', 'key');
        const attempts = database.createObjectStore('attempts', { keyPath: 'id' });
        attempts.createIndex('skillId', 'skillId');
        attempts.createIndex('problemId', 'problemId');
        attempts.createIndex('at', 'at');
        database.createObjectStore('testPlans', { keyPath: 'id' });
        database.createObjectStore('images', { keyPath: 'id' });
      }
      if (oldVersion < 3) {
        // Planner and homework. Assessments live in testPlans.
        database.createObjectStore('tasks', { keyPath: 'id' });
        database.createObjectStore('plans', { keyPath: 'date' });
      }
      if (oldVersion < 4) {
        // Progress: real marks and the Sunday weekly review.
        database.createObjectStore('marks', { keyPath: 'id' });
        database.createObjectStore('weeklyReviews', { keyPath: 'week' });
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

/** Adds new decks and cards in one go, so an import either all lands or none of it does. */
export async function addDecksAndCards(decks: Deck[], cards: Card[]): Promise<void> {
  const database = await db();
  const tx = database.transaction(['decks', 'cards'], 'readwrite');
  for (const deck of decks) await tx.objectStore('decks').put(deck);
  for (const card of cards) await tx.objectStore('cards').put(card);
  await tx.done;
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

/** Everything a backup holds. Practice data is optional so old backups still restore. */
export interface AllData {
  decks: Deck[];
  cards: Card[];
  reviewLogs: ReviewLog[];
  settings: Settings;
  skills?: Skill[];
  problems?: Problem[];
  attempts?: Attempt[];
  testPlans?: TestPlan[];
  images?: StoredImage[];
  tasks?: Task[];
  plans?: DayPlan[];
  availability?: Availability;
  marks?: Mark[];
  weeklyReviews?: WeeklyReview[];
}

const ALL_STORES = [
  'decks',
  'cards',
  'reviewLogs',
  'meta',
  'skills',
  'problems',
  'attempts',
  'testPlans',
  'images',
  'tasks',
  'plans',
  'marks',
  'weeklyReviews',
] as const;

/** Replaces everything with the given data (used by backup restore). */
export async function replaceAll(data: AllData): Promise<void> {
  const database = await db();
  const tx = database.transaction(ALL_STORES, 'readwrite');
  await Promise.all(ALL_STORES.filter((s) => s !== 'meta').map((s) => tx.objectStore(s).clear()));
  for (const deck of data.decks) await tx.objectStore('decks').put(deck);
  for (const card of data.cards) await tx.objectStore('cards').put(card);
  for (const log of data.reviewLogs) await tx.objectStore('reviewLogs').put(log);
  for (const skill of data.skills ?? []) await tx.objectStore('skills').put(skill);
  for (const problem of data.problems ?? []) await tx.objectStore('problems').put(problem);
  for (const attempt of data.attempts ?? []) await tx.objectStore('attempts').put(attempt);
  for (const plan of data.testPlans ?? []) await tx.objectStore('testPlans').put(plan);
  for (const image of data.images ?? []) await tx.objectStore('images').put(image);
  for (const task of data.tasks ?? []) await tx.objectStore('tasks').put(task);
  for (const plan of data.plans ?? []) await tx.objectStore('plans').put(plan);
  for (const mark of data.marks ?? []) await tx.objectStore('marks').put(mark);
  for (const review of data.weeklyReviews ?? []) await tx.objectStore('weeklyReviews').put(review);
  await tx.objectStore('meta').put(data.settings, 'settings');
  if (data.availability) await tx.objectStore('meta').put(data.availability, 'availability');
  else await tx.objectStore('meta').delete('availability');
  await tx.done;
}

// Problem practice

export async function listSkills(): Promise<Skill[]> {
  const skills = await (await db()).getAll('skills');
  return skills.sort((a, b) => a.subject.localeCompare(b.subject) || a.topic.localeCompare(b.topic) || a.name.localeCompare(b.name));
}

export async function getSkill(id: string): Promise<Skill | undefined> {
  return (await db()).get('skills', id);
}

export async function saveSkill(skill: Skill): Promise<void> {
  await (await db()).put('skills', { ...skill, updated: Date.now() });
}

/** Deletes a skill with its questions, pictures and attempts. Sub-skills go too. */
export async function deleteSkill(id: string): Promise<void> {
  const database = await db();
  const children = (await database.getAll('skills')).filter((s) => s.parentId === id).map((s) => s.id);
  const tx = database.transaction(['skills', 'problems', 'attempts', 'images', 'testPlans'], 'readwrite');
  for (const skillId of [id, ...children]) {
    const problems = await tx.objectStore('problems').index('skillId').getAll(skillId);
    for (const p of problems) await deleteProblemInTx(storesOf(tx), p);
    for (const key of await tx.objectStore('attempts').index('skillId').getAllKeys(skillId)) {
      await tx.objectStore('attempts').delete(key);
    }
    await tx.objectStore('skills').delete(skillId);
  }
  for (const plan of await tx.objectStore('testPlans').getAll()) {
    if (plan.skillIds.some((s) => s === id || children.includes(s))) {
      await tx.objectStore('testPlans').put({ ...plan, skillIds: plan.skillIds.filter((s) => s !== id && !children.includes(s)) });
    }
  }
  await tx.done;
}

export async function listProblems(skillId?: string): Promise<Problem[]> {
  const database = await db();
  const problems = skillId ? await database.getAllFromIndex('problems', 'skillId', skillId) : await database.getAll('problems');
  return problems.sort((a, b) => a.order - b.order);
}

export async function getProblem(id: string): Promise<Problem | undefined> {
  return (await db()).get('problems', id);
}

export async function saveProblem(problem: Problem): Promise<void> {
  await (await db()).put('problems', problem);
}

/** Moves questions to another skill (used to split out a sub-skill). Their attempts move too. */
export async function moveProblems(problemIds: string[], skillId: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(['problems', 'attempts'], 'readwrite');
  for (const id of problemIds) {
    const p = await tx.objectStore('problems').get(id);
    if (!p) continue;
    await tx.objectStore('problems').put({ ...p, skillId });
    for (const a of await tx.objectStore('attempts').index('problemId').getAll(id)) {
      await tx.objectStore('attempts').put({ ...a, skillId });
    }
  }
  await tx.done;
}

export async function deleteProblem(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(['problems', 'attempts', 'images'], 'readwrite');
  const p = await tx.objectStore('problems').get(id);
  if (p) await deleteProblemInTx(storesOf(tx), p);
  await tx.done;
}

type ProblemStores = {
  problems: { delete(key: string): Promise<void> };
  attempts: { index(name: 'problemId'): { getAllKeys(query: string): Promise<string[]> }; delete(key: string): Promise<void> };
  images: { delete(key: string): Promise<void> };
};

function storesOf(tx: { objectStore(name: 'problems' | 'attempts' | 'images'): unknown }): ProblemStores {
  return {
    problems: tx.objectStore('problems') as ProblemStores['problems'],
    attempts: tx.objectStore('attempts') as ProblemStores['attempts'],
    images: tx.objectStore('images') as ProblemStores['images'],
  };
}

async function deleteProblemInTx(stores: ProblemStores, p: Problem): Promise<void> {
  for (const key of await stores.attempts.index('problemId').getAllKeys(p.id)) await stores.attempts.delete(key);
  await stores.images.delete(p.questionImage);
  if (p.solutionImage) await stores.images.delete(p.solutionImage);
  await stores.problems.delete(p.id);
}

/** Which skill each saved question is in, by key, so a worksheet that is already in the app is recognised. */
export async function problemSkillsByKey(): Promise<Map<string, string>> {
  return new Map((await (await db()).getAll('problems')).map((p) => [p.key, p.skillId]));
}

/** Keys of problems already saved, so an import can skip repeats. */
export async function problemKeys(): Promise<Set<string>> {
  return new Set((await (await db()).getAll('problems')).map((p) => p.key));
}

/** Adds skills, problems and their pictures in one go, so an import either all lands or none of it does. */
export async function addPractice(skills: Skill[], problems: Problem[], images: StoredImage[]): Promise<void> {
  const database = await db();
  const tx = database.transaction(['skills', 'problems', 'images'], 'readwrite');
  for (const skill of skills) await tx.objectStore('skills').put(skill);
  for (const image of images) await tx.objectStore('images').put(image);
  for (const problem of problems) await tx.objectStore('problems').put(problem);
  await tx.done;
}

export async function getImage(id: string): Promise<StoredImage | undefined> {
  return (await db()).get('images', id);
}

export async function saveImage(image: StoredImage): Promise<void> {
  await (await db()).put('images', image);
}

export async function deleteImage(id: string): Promise<void> {
  await (await db()).delete('images', id);
}

export async function listImages(): Promise<StoredImage[]> {
  return (await db()).getAll('images');
}

/** Saves the skill's new schedule and the attempt together. */
export async function recordAttempt(skill: Skill, attempt: Attempt, problem?: Problem): Promise<void> {
  const database = await db();
  const tx = database.transaction(['skills', 'attempts', 'problems'], 'readwrite');
  await tx.objectStore('skills').put({ ...skill, updated: Date.now() });
  await tx.objectStore('attempts').add(attempt);
  if (problem) await tx.objectStore('problems').put(problem);
  await tx.done;
}

export async function listAttempts(since = 0): Promise<Attempt[]> {
  return (await db()).getAllFromIndex('attempts', 'at', IDBKeyRange.lowerBound(since));
}

export async function listTestPlans(): Promise<TestPlan[]> {
  const plans = await (await db()).getAll('testPlans');
  return plans.sort((a, b) => a.date - b.date);
}

export async function getTestPlan(id: string): Promise<TestPlan | undefined> {
  return (await db()).get('testPlans', id);
}

export async function saveTestPlan(plan: TestPlan): Promise<void> {
  await (await db()).put('testPlans', plan);
}

export async function deleteTestPlan(id: string): Promise<void> {
  await (await db()).delete('testPlans', id);
}

// Planner and homework

export async function listTasks(): Promise<Task[]> {
  return (await db()).getAll('tasks');
}

export async function getTask(id: string): Promise<Task | undefined> {
  return (await db()).get('tasks', id);
}

export async function saveTask(task: Task): Promise<void> {
  await (await db()).put('tasks', task);
}

export async function saveTasks(tasks: Task[]): Promise<void> {
  const tx = (await db()).transaction('tasks', 'readwrite');
  for (const t of tasks) await tx.store.put(t);
  await tx.done;
}

/** Deletes a task and its attached PDFs. Plans that mention it just drop the item when they rebuild. */
export async function deleteTask(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(['tasks', 'images'], 'readwrite');
  const task = await tx.objectStore('tasks').get(id);
  for (const file of task ? taskAttachments(task) : []) await tx.objectStore('images').delete(file.id);
  await tx.objectStore('tasks').delete(id);
  await tx.done;
}

export async function listPlans(): Promise<DayPlan[]> {
  return (await db()).getAll('plans');
}

export async function getPlan(date: string): Promise<DayPlan | undefined> {
  return (await db()).get('plans', date);
}

export async function savePlans(plans: DayPlan[]): Promise<void> {
  const tx = (await db()).transaction('plans', 'readwrite');
  for (const p of plans) await tx.store.put(p);
  await tx.done;
}

export async function getAvailability(): Promise<Availability> {
  const stored = (await (await db()).get('meta', 'availability')) as Availability | undefined;
  return stored ?? defaultAvailability();
}

/** Only true once the weekly windows have been saved at least once. */
export async function hasAvailability(): Promise<boolean> {
  return (await (await db()).get('meta', 'availability')) !== undefined;
}

export async function saveAvailability(availability: Availability): Promise<void> {
  await (await db()).put('meta', availability, 'availability');
}

// Progress

export async function listMarks(): Promise<Mark[]> {
  const marks = await (await db()).getAll('marks');
  return marks.sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
}

export async function saveMark(mark: Mark): Promise<void> {
  await (await db()).put('marks', mark);
}

export async function deleteMark(id: string): Promise<void> {
  await (await db()).delete('marks', id);
}

export async function listWeeklyReviews(): Promise<WeeklyReview[]> {
  return (await db()).getAll('weeklyReviews');
}

export async function saveWeeklyReview(review: WeeklyReview): Promise<void> {
  await (await db()).put('weeklyReviews', review);
}

// Phone and Google Calendar (this laptop only)

export async function getSyncConfig(): Promise<SyncConfig> {
  const stored = (await (await db()).get('meta', 'sync')) as Partial<SyncConfig> | undefined;
  return { ...DEFAULT_SYNC, ...stored };
}

export async function saveSyncConfig(config: SyncConfig): Promise<void> {
  await (await db()).put('meta', config, 'sync');
}

/** The last copy of your work and timetable calendars, so planning works offline. */
export async function getCalendarCache(): Promise<CalendarCache | null> {
  return ((await (await db()).get('meta', 'calendarCache')) as CalendarCache | undefined) ?? null;
}

export async function saveCalendarCache(cache: CalendarCache | null): Promise<void> {
  const database = await db();
  if (cache) await database.put('meta', cache, 'calendarCache');
  else await database.delete('meta', 'calendarCache');
}
