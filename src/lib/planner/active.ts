// The planner session you're in right now. Start on a calendar item remembers
// it here, and finishing the flashcards or practice it opened ticks it off,
// so you don't have to go back and tick it yourself.

import { getPlan, listTasks } from '../db';
import type { DayPlan, PlanItem } from '../types';
import { addDays } from './dates';
import { mondayOf, weekSessions } from './sessions';
import { completeItem } from './actions';
import type { BuiltDay } from './build';

const KEY = 'study-app:active-session';
/** A session left open longer than this is forgotten. */
const STALE_MS = 6 * 60 * 60_000;

export type SessionKind = 'flashcards' | 'practice';

interface Active {
  date: string;
  itemId: string;
  at: number;
}

export function rememberSession(date: string, itemId: string, now = Date.now()): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ date, itemId, at: now } satisfies Active));
  } catch {
    /* private window: it just won't tick itself */
  }
}

function readActive(now: number): Active | null {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Active | null;
    if (!a || typeof a.itemId !== 'string' || now - a.at > STALE_MS) return null;
    return a;
  } catch {
    return null;
  }
}

/** What an item opens when you Start it, so only the matching kind of session ticks it. */
export function sessionKindOf(it: PlanItem): SessionKind | null {
  if (it.kind === 'flashcards') return 'flashcards';
  if (it.study?.deckIds?.length && !it.study.skillIds?.length) return 'flashcards';
  if (it.study?.skillIds?.length || it.kind === 'problems' || it.kind === 'prep' || it.kind === 'final') return 'practice';
  return null;
}

/**
 * Called when a flashcard review or a practice block is finished. Ticks off
 * the calendar item it was started from and returns it (null if there was
 * nothing to tick).
 */
export interface Ticked {
  item: PlanItem;
  /** Sessions done this week, counting this one. */
  weekDone: number;
}

export async function finishSession(kind: SessionKind, now = Date.now()): Promise<Ticked | null> {
  const a = readActive(now);
  if (!a) return null;
  const plan = await getPlan(a.date);
  const item = plan?.items.find((i) => i.id === a.itemId);
  // An item with both decks and skills is ticked by whichever finishes.
  const kindOk = item && (sessionKindOf(item) === kind || (item.study?.deckIds?.length && item.study?.skillIds?.length));
  if (!plan || !item || item.status !== 'todo' || !kindOk) return null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  const day: BuiltDay = { date: a.date, plan, windows: [], free: {}, warnings: [] };
  await completeItem(day, item, await listTasks(), now);
  const monday = mondayOf(a.date);
  const plans = new Map<string, DayPlan | undefined>();
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    plans.set(d, await getPlan(d));
  }
  return { item: { ...item, status: 'done' }, weekDone: weekSessions(a.date, (d) => plans.get(d)).done };
}
