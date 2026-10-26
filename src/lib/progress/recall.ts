// Recall for the progress view. Every number comes from FSRS: the chance you
// could recall a card, or do a skill, at a given moment. The review history is
// replayed through FSRS, so any past day (trend lines, "what moved", recall on
// a test day) can be worked out without saving daily snapshots, and history
// survives a backup and restore.

import { default_w, forgetting_curve, type Grade } from 'ts-fsrs';
import { emptyState, fromFsrs, makeScheduler, stateFor, toFsrs } from '../scheduler';
import { directionsOf } from '../queue';
import { makeSkillScheduler, withChildren } from '../practice/mix';
import { rampOf } from '../planner/assessments';
import { SUBJECTS, type Attempt, type Card, type Deck, type FsrsState, type ReviewLog, type Settings, type Skill, type TestPlan } from '../types';

const DAY = 86_400_000;

/** English Advanced is tracked with the teacher, so it stays out of progress. */
export const PROGRESS_SUBJECTS = SUBJECTS.filter((s) => s !== 'English Advanced');
/** Shown as grey tiles until they have content. */
export const LATER_SUBJECTS = new Set<string>(['Business Studies', 'Engineering Studies']);

/** One thing FSRS schedules: a skill, or one direction of one card. */
export interface Memory {
  created: number;
  /** Stability after each review, oldest first. */
  reviews: { at: number; stability: number }[];
}

/** The smallest thing progress shows: a problem skill, or a flashcard topic in one deck. */
export interface Unit {
  /** "skill:<id>" or "cards:<deckId>:<topic>". */
  key: string;
  kind: 'skill' | 'cards';
  subject: string;
  topic: string;
  name: string;
  skill?: Skill;
  deckId?: string;
  /** The card topic inside the deck, for review links. Empty means cards with no topic. */
  cardTopic?: string;
  cardIds?: string[];
  memories: Memory[];
}

export function topicKey(subject: string, topic: string): string {
  return subject + '|' + topic;
}

/** Recall of one memory at a moment: null before its first review. */
export function memoryRecall(m: Memory, at: number): number | null {
  let last: Memory['reviews'][number] | undefined;
  for (const r of m.reviews) {
    if (r.at > at) break;
    last = r;
  }
  if (!last) return null;
  return forgetting_curve(default_w, Math.max(0, (at - last.at) / DAY), Math.max(last.stability, 0.01));
}

export interface UnitRecall {
  /** 0 to 1. Cards not started count as 0. */
  recall: number;
  started: boolean;
}

/** Recall of a unit at a moment, or null if it did not exist yet. */
export function unitRecall(u: Unit, at: number): UnitRecall | null {
  const live = u.memories.filter((m) => m.created <= at);
  if (!live.length) return null;
  let sum = 0;
  let started = false;
  for (const m of live) {
    const r = memoryRecall(m, at);
    if (r !== null) started = true;
    sum += r ?? 0;
  }
  return { recall: sum / live.length, started };
}

export interface GroupRecall {
  /** 0 to 1, unstarted units counted as 0. Null when nothing exists yet. */
  recall: number | null;
  started: number;
  total: number;
}

/** Average recall over units, with not-yet-started units counted as 0. */
export function groupRecall(units: Unit[], at: number): GroupRecall {
  let sum = 0;
  let started = 0;
  let total = 0;
  for (const u of units) {
    const r = unitRecall(u, at);
    if (!r) continue;
    total++;
    sum += r.started ? r.recall : 0;
    if (r.started) started++;
  }
  return { recall: total && started ? sum / total : null, started, total };
}

export interface Topic {
  subject: string;
  name: string;
  key: string;
  units: Unit[];
}

export function topicsOf(units: Unit[]): Topic[] {
  const map = new Map<string, Topic>();
  for (const u of units) {
    const key = topicKey(u.subject, u.topic);
    const t = map.get(key) ?? { subject: u.subject, name: u.topic, key, units: [] };
    t.units.push(u);
    map.set(key, t);
  }
  return [...map.values()].sort((a, b) => a.subject.localeCompare(b.subject) || a.name.localeCompare(b.name));
}

/** Subject mastery: the average of its topics' mastery, so one big topic does not drown the rest. */
export function subjectRecall(topics: Topic[], at: number): GroupRecall {
  let sum = 0;
  let n = 0;
  let started = 0;
  let total = 0;
  for (const t of topics) {
    const g = groupRecall(t.units, at);
    if (!g.total) continue;
    started += g.started;
    total += g.total;
    n++;
    sum += g.recall ?? 0;
  }
  return { recall: n && started ? sum / n : null, started, total };
}

export type Grade3 = 'good' | 'mid' | 'weak' | 'none';

export const GRADE_COLOUR: Record<Grade3, string> = {
  good: 'var(--good)',
  mid: 'var(--mid)',
  weak: 'var(--warn)',
  none: 'var(--dot)',
};

export const GRADE_TEXT: Record<Grade3, string> = {
  good: 'on top of it',
  mid: 'slipping',
  weak: 'needs work',
  none: 'not started',
};

/** Green 90%+ (95% when an exam is coming), amber 75% to 89%, red below 75%, grey when not started. */
export function gradeOf(recall: number | null, exam = false): Grade3 {
  if (recall === null) return 'none';
  if (recall >= (exam ? 0.95 : 0.9)) return 'good';
  if (recall >= 0.75) return 'mid';
  return 'weak';
}

/** Rounded down, so 89.6% never shows as a green-looking 90% graded amber. */
export function pct(recall: number | null): string {
  return recall === null ? '–' : `${Math.floor(recall * 100)}%`;
}

function replay(created: number, ratings: { at: number; rating: number }[], step: (s: FsrsState, at: number, rating: number) => FsrsState, current: FsrsState): Memory {
  const reviews: Memory['reviews'] = [];
  let s = emptyState(created);
  for (const r of ratings) {
    s = step(s, r.at, r.rating);
    reviews.push({ at: r.at, stability: s.stability });
  }
  // The saved state is the truth for now (questions can move between skills), so the last point follows it.
  if (current.state !== 0 && current.lastReview) {
    const last = reviews[reviews.length - 1];
    if (last && last.at <= current.lastReview) reviews[reviews.length - 1] = { at: current.lastReview, stability: current.stability };
    else if (!last) reviews.push({ at: current.lastReview, stability: current.stability });
  }
  return { created, reviews };
}

function groupBy<T>(list: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of list) {
    const k = key(item);
    const group = map.get(k);
    if (group) group.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export interface UnitInput {
  decks: Deck[];
  cards: Card[];
  logs: ReviewLog[];
  skills: Skill[];
  attempts: Attempt[];
  /** Skill ids that hold at least one question. */
  skillsWithProblems: Set<string>;
  settings: Pick<Settings, 'retention'>;
}

/**
 * Builds every unit. Skills switched off and never practised are left out
 * (not taught yet), as are skills with no questions.
 */
export function buildUnits(input: UnitInput): Unit[] {
  const units: Unit[] = [];
  const skillScheduler = makeSkillScheduler(input.settings);
  const byskill = groupBy(input.attempts, (a) => a.skillId);
  for (const skill of input.skills) {
    const attempts = (byskill.get(skill.id) ?? []).sort((a, b) => a.at - b.at);
    if (!input.skillsWithProblems.has(skill.id) && !attempts.length) continue;
    if (!skill.on && !attempts.length && skill.fsrs.state === 0) continue;
    if (!PROGRESS_SUBJECTS.includes(skill.subject as never)) continue;
    const memory = replay(
      skill.created,
      attempts,
      (s, at, rating) => fromFsrs(skillScheduler.next(toFsrs(s), new Date(at), rating as Grade).card),
      skill.fsrs,
    );
    units.push({
      key: 'skill:' + skill.id,
      kind: 'skill',
      subject: skill.subject,
      topic: skill.topic || skill.code || 'Other',
      name: skill.name,
      skill,
      memories: [memory],
    });
  }

  const cardScheduler = makeScheduler(input.settings);
  const decks = new Map(input.decks.map((d) => [d.id, d]));
  const logsByCard = groupBy(input.logs, (l) => l.cardId);
  const cardUnits = new Map<string, Unit>();
  for (const card of input.cards) {
    const deck = decks.get(card.deckId);
    if (!deck || !PROGRESS_SUBJECTS.includes(deck.subject as never)) continue;
    const key = `cards:${deck.id}:${card.topic}`;
    let unit = cardUnits.get(key);
    if (!unit) {
      unit = {
        key,
        kind: 'cards',
        subject: deck.subject,
        topic: deck.module || deck.name,
        name: card.topic ? `${card.topic} cards` : `${deck.name} cards`,
        deckId: deck.id,
        cardTopic: card.topic,
        cardIds: [],
        memories: [],
      };
      cardUnits.set(key, unit);
    }
    unit.cardIds!.push(card.id);
    const logs = (logsByCard.get(card.id) ?? []).sort((a, b) => a.reviewedAt - b.reviewedAt);
    for (const dir of directionsOf(card)) {
      const mine = logs.filter((l) => l.direction === dir).map((l) => ({ at: l.reviewedAt, rating: l.rating }));
      unit.memories.push(
        replay(card.created, mine, (s, at, rating) => fromFsrs(cardScheduler.next(toFsrs(s), new Date(at), rating as Grade).card), stateFor(card, dir)),
      );
    }
  }
  units.push(...cardUnits.values());
  return units;
}

/** The units an assessment covers: its skills (and their sub-skills) and its decks, else its whole subject. */
export function scopeOf(plan: TestPlan, units: Unit[], skills: Skill[]): Unit[] {
  const ids = withChildren(plan.skillIds, skills);
  const decks = new Set(plan.deckIds ?? []);
  const inScope = units.filter((u) => (u.skill && ids.has(u.skill.id)) || (u.deckId && decks.has(u.deckId)));
  return inScope.length ? inScope : units.filter((u) => u.subject === plan.subject);
}

/**
 * Topics that are inside an exam's prep ramp (21 days before a test, 42 before
 * trials or the HSC). Their green line moves up to 95%.
 */
export function examTopics(plans: TestPlan[], units: Unit[], skills: Skill[], now: number): Set<string> {
  const out = new Set<string>();
  for (const p of plans) {
    const ramp = rampOf(p);
    if (!ramp || p.date + DAY <= now || p.date - ramp.build * DAY > now) continue;
    for (const u of scopeOf(p, units, skills)) out.add(topicKey(u.subject, u.topic));
  }
  return out;
}

/** Start of each of the last n weeks up to now, oldest first, for trend lines. */
export function trendPoints(now: number, n = 8): number[] {
  return Array.from({ length: n }, (_, i) => now - (n - 1 - i) * 7 * DAY);
}
