// Builds problem sets. FSRS schedules each skill; each time a skill is due,
// one question from it goes into the mix, and the mix is shuffled so you
// have to work out which method each question needs (interleaving).

import { fsrs, type FSRS, type Grade } from 'ts-fsrs';
import { newId } from '../db';
import { emptyState, fromFsrs, toFsrs, type RatingValue } from '../scheduler';
import type { Attempt, Problem, Settings, Skill, TestPlan } from '../types';
import { rampOf } from '../planner/assessments';

const DAY = 86_400_000;
/** A question can come back once this long has passed since you last did it. */
export const REUSE_AFTER_DAYS = 60;
/** How many not-yet-due weak skills join each daily mix to keep old topics warm. */
export const MAINTENANCE = 2;

export interface MixItem {
  problem: Problem;
  skill: Skill;
}

export interface PracticeData {
  skills: Skill[];
  problems: Problem[];
  attempts: Attempt[];
  plans: TestPlan[];
}

export function newSkill(fields: Pick<Skill, 'subject' | 'name'> & Partial<Skill>, now = Date.now()): Skill {
  return {
    id: newId(),
    topic: '',
    code: '',
    on: true,
    fsrs: emptyState(now),
    created: now,
    updated: now,
    ...fields,
  };
}

/** SmarterEd's guide: about 1.5 minutes per mark, plus half a minute to mark it. */
export function costMinutes(problem: Pick<Problem, 'marks'>): number {
  return (problem.marks > 0 ? problem.marks : 2) * 1.5 + 0.5;
}

/** Skills that can be practised: switched on and holding at least one question. */
export function activeSkills(data: Pick<PracticeData, 'skills' | 'problems'>): Skill[] {
  const withProblems = new Set(data.problems.map((p) => p.skillId));
  return data.skills.filter((s) => s.on && withProblems.has(s.id));
}

/** A skill and its sub-skills, so a test plan can pick a whole worksheet. */
export function withChildren(skillIds: string[], skills: Skill[]): Set<string> {
  const ids = new Set(skillIds);
  for (const s of skills) if (s.parentId && ids.has(s.parentId)) ids.add(s.id);
  return ids;
}

/** True when the skill is due by the end of the study day. */
export function isDue(skill: Skill, dayEnd: number): boolean {
  return skill.fsrs.state === 0 || skill.fsrs.due <= dayEnd;
}

function lastSeen(attempts: Attempt[]): Map<string, number> {
  const seen = new Map<string, number>();
  for (const a of attempts) seen.set(a.problemId, Math.max(seen.get(a.problemId) ?? 0, a.at));
  return seen;
}

/**
 * Picks the question to show for a skill: one you have never done, else one
 * not done for 60 days, else the one done longest ago. Questions that fit the
 * time left are preferred.
 */
export function pickProblem(
  pool: Problem[],
  seen: Map<string, number>,
  now: number,
  minutesLeft = Infinity,
  rng: () => number = Math.random,
  exclude: Set<string> = new Set(),
): Problem | null {
  const options = pool.filter((p) => !exclude.has(p.id));
  if (!options.length) return null;
  const fits = options.filter((p) => costMinutes(p) <= minutesLeft);
  const from = fits.length ? fits : options;
  const unseen = from.filter((p) => !seen.has(p.id));
  if (unseen.length) return unseen[Math.floor(rng() * unseen.length)];
  const rested = from.filter((p) => now - seen.get(p.id)! >= REUSE_AFTER_DAYS * DAY);
  const list = rested.length ? rested : from;
  return [...list].sort((a, b) => seen.get(a.id)! - seen.get(b.id)!)[0];
}

/** Skills you recently confused with each skill (from "No, wrong method" answers). */
function confusions(attempts: Attempt[], now: number): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const a of attempts) {
    if (!a.confusedWith || now - a.at > REUSE_AFTER_DAYS * DAY) continue;
    for (const [x, y] of [
      [a.skillId, a.confusedWith],
      [a.confusedWith, a.skillId],
    ]) {
      const list = map.get(x) ?? [];
      if (!list.includes(y)) list.push(y);
      map.set(x, list);
    }
  }
  return map;
}

export interface MixOptions {
  subjects: string[];
  minutes: number;
  now?: number;
  dayEnd?: number;
  rng?: () => number;
}

/** The daily mix: due skills first, then new ones, then a couple of weak ones, until the time is used. */
export function buildDailyMix(data: PracticeData, opts: MixOptions): MixItem[] {
  const now = opts.now ?? Date.now();
  const dayEnd = opts.dayEnd ?? now;
  const rng = opts.rng ?? Math.random;
  const skills = activeSkills(data).filter((s) => opts.subjects.includes(s.subject));
  const due = skills.filter((s) => s.fsrs.state !== 0 && s.fsrs.due <= dayEnd).sort((a, b) => a.fsrs.due - b.fsrs.due);
  const fresh = skills.filter((s) => s.fsrs.state === 0).sort((a, b) => a.created - b.created);
  const weak = skills
    .filter((s) => s.fsrs.state !== 0 && s.fsrs.due > dayEnd)
    .sort((a, b) => a.fsrs.stability - b.fsrs.stability);

  // A test coming up in this subject gets first claim on the time: its due
  // skills, then its other skills not practised in the last two days, weakest first.
  const planIds = withChildren(
    activePlans(data.plans, now)
      .filter((p) => opts.subjects.includes(p.subject))
      .flatMap((p) => p.skillIds),
    data.skills,
  );
  const recent = new Set(data.attempts.filter((a) => now - a.at < 2 * DAY).map((a) => a.skillId));
  const planFirst = [
    ...[...due, ...fresh].filter((s) => planIds.has(s.id)),
    ...weak.filter((s) => planIds.has(s.id) && !recent.has(s.id)).sort((a, b) => retrievability(a, now) - retrievability(b, now)),
  ];
  const rest = (list: Skill[]) => list.filter((s) => !planIds.has(s.id));
  const order = [...planFirst, ...rest(due), ...rest(fresh), ...rest(weak).slice(0, MAINTENANCE)];
  const first = (list: Skill[]) => [...list.filter((s) => planIds.has(s.id)), ...rest(list)];
  let items = fill(order, data, opts.minutes, now, rng, skills);
  // Nothing due at all: keep the weakest skills ticking over instead of an empty session.
  if (!items.length) items = fill(first(weak), data, opts.minutes, now, rng, skills);
  // Few skills so far (early in the year): go round them again with different questions to fill the block.
  const used = new Set(items.map((i) => i.problem.id));
  let left = opts.minutes - items.reduce((m, i) => m + costMinutes(i.problem), 0);
  const again = [...new Map([...items.map((i) => i.skill), ...first(weak)].map((s) => [s.id, s])).values()];
  for (let round = 0; round < 5 && left >= 2; round++) {
    const more = fill(again, data, left, now, rng, skills, used, false, false);
    if (!more.length) break;
    for (const it of more) {
      used.add(it.problem.id);
      left -= costMinutes(it.problem);
    }
    items = [...items, ...more];
  }
  return arrange(items, rng);
}

/** Test prep: only the plan's skills, the least practised since the plan started first, round after round. */
export function buildTestPrep(data: PracticeData, plan: TestPlan, minutes: number, now = Date.now(), rng = Math.random): MixItem[] {
  const ids = withChildren(plan.skillIds, data.skills);
  // The plan's skills count even if not switched on yet: you chose them for this test.
  const withProblems = new Set(data.problems.map((p) => p.skillId));
  const skills = data.skills.filter((s) => ids.has(s.id) && withProblems.has(s.id));
  const counts = new Map<string, number>();
  for (const a of data.attempts) if (a.at >= plan.created && ids.has(a.skillId)) counts.set(a.skillId, (counts.get(a.skillId) ?? 0) + 1);
  const order = [...skills].sort(
    (a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0) || retrievability(a, now) - retrievability(b, now),
  );
  const items: MixItem[] = [];
  const used = new Set<string>();
  let left = minutes;
  // Keep going round the skills until the time is full or the questions run out.
  for (let round = 0; round < 6 && left > 0; round++) {
    const before = items.length;
    const roundItems = fill(order, data, left, now, rng, skills, used, false, round === 0);
    for (const it of roundItems) {
      used.add(it.problem.id);
      left -= costMinutes(it.problem);
    }
    items.push(...roundItems);
    if (items.length === before) break;
  }
  return arrange(items, rng);
}

/** One skill on its own, as many questions as fit. Handy straight after importing a worksheet. */
export function buildSkillSet(data: PracticeData, skillId: string, minutes: number, now = Date.now(), rng = Math.random): MixItem[] {
  const skill = data.skills.find((s) => s.id === skillId);
  if (!skill) return [];
  const pool = data.problems.filter((p) => p.skillId === skillId);
  const seen = lastSeen(data.attempts);
  const items: MixItem[] = [];
  const used = new Set<string>();
  let left = minutes;
  while (left > 0) {
    const p = pickProblem(pool, seen, now, left, rng, used);
    if (!p || (costMinutes(p) > left && items.length)) break;
    items.push({ problem: p, skill });
    used.add(p.id);
    left -= costMinutes(p);
  }
  return items;
}

function fill(
  order: Skill[],
  data: PracticeData,
  minutes: number,
  now: number,
  rng: () => number,
  allowed: Skill[],
  exclude: Set<string> = new Set(),
  pairConfused = true,
  /** Let the first question run over the time, so a short block still gets one. */
  allowOver = true,
): MixItem[] {
  const seen = lastSeen(data.attempts);
  const confused = pairConfused ? confusions(data.attempts, now) : new Map<string, string[]>();
  const items: MixItem[] = [];
  const used = new Set<string>();
  let left = minutes;
  const add = (skill: Skill): boolean => {
    if (used.has(skill.id)) return false;
    const pool = data.problems.filter((p) => p.skillId === skill.id);
    const p = pickProblem(pool, seen, now, left, rng, exclude);
    if (!p) return false;
    const cost = costMinutes(p);
    if (cost > left && (items.length || !allowOver)) return false;
    used.add(skill.id);
    items.push({ problem: p, skill });
    left -= cost;
    return true;
  };
  for (const skill of order) {
    if (left <= 0) break;
    if (!add(skill)) continue;
    // Put a skill you mixed up with this one right beside it, so you practise telling them apart.
    for (const otherId of confused.get(skill.id) ?? []) {
      const other = allowed.find((s) => s.id === otherId);
      if (other && left > 0) add(other);
    }
  }
  return items;
}

/**
 * Orders the questions: skills from the same topic sit next to each other
 * (they look alike, which is what makes telling them apart worth practising),
 * topics and skills are shuffled, and no two questions in a row share a skill.
 */
export function arrange(items: MixItem[], rng: () => number = Math.random): MixItem[] {
  const groups = new Map<string, MixItem[]>();
  for (const it of items) {
    const key = it.skill.subject + '|' + (it.skill.topic || it.skill.code || it.skill.id);
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }
  const ordered = shuffle([...groups.values()], rng).flatMap((g) => shuffle(g, rng));
  // Fix any two in a row from the same skill by swapping with a later one.
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].skill.id !== ordered[i - 1].skill.id) continue;
    const j = ordered.findIndex((it, k) => k > i && it.skill.id !== ordered[i - 1].skill.id && (k + 1 >= ordered.length || ordered[k + 1].skill.id !== ordered[i].skill.id));
    if (j > 0) [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  }
  return ordered;
}

function shuffle<T>(list: T[], rng: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Chance of remembering the skill right now (1 for skills never practised, so they sort last). */
export function retrievability(skill: Skill, now: number): number {
  if (skill.fsrs.state === 0 || !skill.fsrs.lastReview) return 1;
  const days = Math.max(0, (now - skill.fsrs.lastReview) / DAY);
  // FSRS-5 forgetting curve.
  return Math.pow(1 + (19 / 81) * (days / Math.max(skill.fsrs.stability, 0.01)), -0.5);
}

/**
 * Tests and exams that are coming up and inside their prep ramp (21 days for
 * a class test, 42 for trials and the HSC). Assignments have no questions.
 */
export function activePlans(plans: TestPlan[], now: number): TestPlan[] {
  return plans.filter((p) => {
    const ramp = rampOf(p);
    return ramp && p.date + DAY > now && p.date - ramp.build * DAY <= now;
  });
}

/**
 * FSRS for skills. Unlike flashcards there are no learning steps of a few
 * minutes: a skill you got wrong comes back tomorrow, not later tonight.
 */
export function makeSkillScheduler(settings: Pick<Settings, 'retention'>): FSRS {
  return fsrs({ request_retention: settings.retention, enable_fuzz: true, enable_short_term: false });
}

/** Applies a rating to a skill's FSRS schedule. */
export function rateSkill(scheduler: FSRS, skill: Skill, rating: RatingValue, now = Date.now()): Skill {
  const result = scheduler.next(toFsrs(skill.fsrs), new Date(now), rating as Grade);
  return { ...skill, fsrs: fromFsrs(result.card) };
}

export interface SubjectScore {
  subject: string;
  score: number;
  due: number;
  fresh: number;
  daysSince: number | null;
  testInDays: number | null;
  reason: string;
}

/**
 * Which subject needs problems most today: how many skills are due, how weak
 * they are, how long since its last problem block, and how close its next test is.
 */
export function recommendSubjects(data: PracticeData, now: number, dayEnd: number): SubjectScore[] {
  const skills = activeSkills(data);
  const subjects = [...new Set(skills.map((s) => s.subject))];
  const lastBySkill = new Map<string, number>();
  for (const a of data.attempts) lastBySkill.set(a.skillId, Math.max(lastBySkill.get(a.skillId) ?? 0, a.at));
  return subjects
    .map((subject) => {
      const mine = skills.filter((s) => s.subject === subject);
      const due = mine.filter((s) => s.fsrs.state !== 0 && s.fsrs.due <= dayEnd);
      const fresh = mine.filter((s) => s.fsrs.state === 0).length;
      const weakness = due.reduce((sum, s) => sum + (1 - retrievability(s, now)), 0);
      const last = Math.max(0, ...mine.map((s) => lastBySkill.get(s.id) ?? 0));
      const daysSince = last ? Math.floor((now - last) / DAY) : null;
      const plan = activePlans(data.plans, now)
        .filter((p) => p.subject === subject)
        .sort((a, b) => a.date - b.date)[0];
      const testInDays = plan ? Math.max(0, Math.ceil((plan.date - now) / DAY)) : null;
      let score = due.length * 3 + weakness * 4 + Math.min(fresh, 4) * 2 + Math.min(daysSince ?? 7, 7);
      const rampDays = plan ? (rampOf(plan)?.build ?? 21) : 21;
      if (testInDays !== null) score += (rampDays + 1 - testInDays) * 1.5 * (21 / rampDays);
      const reasons: string[] = [];
      if (testInDays !== null) reasons.push(testInDays === 0 ? 'test today' : `test in ${testInDays} day${testInDays === 1 ? '' : 's'}`);
      if (due.length) reasons.push(`${due.length} skill${due.length === 1 ? '' : 's'} due`);
      if (fresh) reasons.push(`${fresh} new skill${fresh === 1 ? '' : 's'}`);
      if (daysSince === null) reasons.push('not practised yet');
      else if (daysSince >= 2) reasons.push(`last practised ${daysSince} days ago`);
      return { subject, score, due: due.length, fresh, daysSince, testInDays, reason: reasons.join(', ') };
    })
    .sort((a, b) => b.score - a.score);
}

/** Builds the attempt record for one marked question. */
export function makeAttempt(
  fields: Omit<Attempt, 'id' | 'stateBefore'>,
  skillBefore: Skill,
): Attempt {
  return { id: newId(), stateBefore: skillBefore.fsrs.state, ...fields };
}
