// Hand-made calendar events and the reusable blocks you drag in for sessions
// you plan again and again. Kept free of the screen so it can be tested.

import type { Availability, BlockTemplate, PlanItem, StudyPick } from '../types';

/** A pick with empty lists and repeats taken out, or undefined when nothing is left. */
export function cleanPick(p: StudyPick | undefined): StudyPick | undefined {
  const skillIds = [...new Set(p?.skillIds ?? [])].filter(Boolean);
  const deckIds = [...new Set(p?.deckIds ?? [])].filter(Boolean);
  if (!skillIds.length && !deckIds.length) return undefined;
  const out: StudyPick = {};
  if (skillIds.length) out.skillIds = skillIds;
  if (deckIds.length) out.deckIds = deckIds;
  return out;
}

/** Minutes kept to something sensible: 5 minutes to 12 hours, in whole minutes. */
export function cleanMinutes(m: number, fallback = 30): number {
  const n = Math.round(Number(m));
  return Number.isFinite(n) && n > 0 ? Math.min(12 * 60, Math.max(5, n)) : fallback;
}

export type EventFields = Pick<PlanItem, 'start' | 'minutes' | 'title' | 'study' | 'blockId'>;

/** The plan item for an event you add by hand (or drag in from a block). */
export function eventItem(f: EventFields): Omit<PlanItem, 'id' | 'windowId' | 'pinned' | 'status'> {
  const out: Omit<PlanItem, 'id' | 'windowId' | 'pinned' | 'status'> = {
    kind: 'event',
    start: f.start,
    minutes: cleanMinutes(f.minutes),
    title: f.title?.trim() || 'Event',
  };
  const study = cleanPick(f.study);
  if (study) out.study = study;
  if (f.blockId) out.blockId = f.blockId;
  return out;
}

/** What dragging a block onto `start` (HH:MM) makes. Later edits to the block leave it alone. */
export function blockItem(b: BlockTemplate, start: string): Omit<PlanItem, 'id' | 'windowId' | 'pinned' | 'status'> {
  return eventItem({ start, minutes: b.minutes, title: b.name, study: b.study, blockId: b.id });
}

export function blocksOf(a: Availability): BlockTemplate[] {
  return a.blocks ?? [];
}

/** Adds a block, or replaces the one with the same id. */
export function withBlock(a: Availability, b: BlockTemplate): Availability {
  const clean: BlockTemplate = { id: b.id, name: b.name.trim() || 'Study block', minutes: cleanMinutes(b.minutes) };
  const study = cleanPick(b.study);
  if (study) clean.study = study;
  const list = blocksOf(a);
  const blocks = list.some((x) => x.id === b.id) ? list.map((x) => (x.id === b.id ? clean : x)) : [...list, clean];
  return { ...a, blocks };
}

export function withoutBlock(a: Availability, id: string): Availability {
  return { ...a, blocks: blocksOf(a).filter((x) => x.id !== id) };
}

/** Changes made in an item's window: anything left out stays as it is. */
export interface ItemChanges {
  title?: string;
  minutes?: number;
  start?: string;
  study?: StudyPick | undefined;
  /** Opened from the window, so a rebuild leaves it alone. */
  started?: boolean;
}

export function changedItem(item: PlanItem, c: ItemChanges): PlanItem {
  const out: PlanItem = { ...item, pinned: true };
  if (c.title !== undefined && item.kind === 'event') out.title = c.title.trim() || 'Event';
  if (c.minutes !== undefined) out.minutes = cleanMinutes(c.minutes, item.minutes);
  if (c.start) out.start = c.start;
  if (c.started) out.started = true;
  if ('study' in c) {
    const study = cleanPick(c.study);
    if (study) out.study = study;
    else delete out.study;
  }
  return out;
}
