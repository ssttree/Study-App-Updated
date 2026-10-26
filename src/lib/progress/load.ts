// Loads everything the progress screens need and works out the numbers they
// share: subject and topic mastery, weak skills, the next exam and marks.

import {
  getSettings,
  listCards,
  listDecks,
  listMarks,
  listPlans,
  listReviewLogs,
  listWeeklyReviews,
} from '../db';
import { loadPractice } from '../practice/load';
import { studyDayEnd } from '../queue';
import { reviewHref } from '../filters';
import { customToParts } from '../custom';
import { href } from '../router.svelte';
import { stateFor } from '../scheduler';
import { directionsOf } from '../queue';
import { daysUntil, kindOf } from '../planner/assessments';
import { keyToTime, todayKey } from '../planner/dates';
import type { Attempt, Card, DayPlan, Deck, Mark, Problem, ReviewLog, Settings, Skill, TestPlan, WeeklyReview } from '../types';
import { activities, type Activity } from './activity';
import {
  buildUnits,
  examTopics,
  gradeOf,
  groupRecall,
  LATER_SUBJECTS,
  PROGRESS_SUBJECTS,
  scopeOf,
  subjectRecall,
  topicKey,
  topicsOf,
  trendPoints,
  unitRecall,
  type Grade3,
  type GroupRecall,
  type Topic,
  type Unit,
} from './recall';

const DAY = 86_400_000;

export interface ProgressData {
  now: number;
  today: string;
  settings: Settings;
  decks: Deck[];
  cards: Card[];
  logs: ReviewLog[];
  skills: Skill[];
  problems: Problem[];
  attempts: Attempt[];
  assessments: TestPlan[];
  dayPlans: DayPlan[];
  marks: Mark[];
  reviews: WeeklyReview[];
  units: Unit[];
  topics: Topic[];
  /** Topic keys inside an exam ramp: green needs 95%. */
  examTopics: Set<string>;
  activity: Activity[];
}

export async function loadProgress(now = Date.now()): Promise<ProgressData> {
  const settings = await getSettings();
  const [decks, cards, logs, practice, dayPlans, marks, reviews] = await Promise.all([
    listDecks(),
    listCards(),
    listReviewLogs(),
    loadPractice(now),
    listPlans(),
    listMarks(),
    listWeeklyReviews(),
  ]);
  const units = buildUnits({
    decks,
    cards,
    logs,
    skills: practice.skills,
    attempts: practice.attempts,
    skillsWithProblems: new Set(practice.problems.map((p) => p.skillId)),
    settings,
  });
  const skillSubject = new Map(practice.skills.map((s) => [s.id, s.subject]));
  return {
    now,
    today: todayKey(now, settings.dayStartHour),
    settings,
    decks,
    cards,
    logs,
    skills: practice.skills,
    problems: practice.problems,
    attempts: practice.attempts,
    assessments: practice.plans,
    dayPlans,
    marks,
    reviews,
    units,
    topics: topicsOf(units),
    examTopics: examTopics(practice.plans, units, practice.skills, now),
    activity: activities(logs, practice.attempts, cards, decks, skillSubject, settings.dayStartHour),
  };
}

export interface SubjectSummary {
  subject: string;
  recall: GroupRecall;
  grade: Grade3;
  /** Mastery at the start of each of the last 8 weeks (null before anything existed). */
  trend: (number | null)[];
  /** Engineering and Business before any content is added. */
  empty: boolean;
}

export function subjectSummaries(data: ProgressData): SubjectSummary[] {
  const extra = [...new Set(data.units.map((u) => u.subject))].filter((s) => !PROGRESS_SUBJECTS.includes(s as never));
  return [...PROGRESS_SUBJECTS, ...extra].map((subject) => {
    const topics = data.topics.filter((t) => t.subject === subject);
    const recall = subjectRecall(topics, data.now);
    const exam = topics.some((t) => data.examTopics.has(t.key));
    return {
      subject,
      recall,
      grade: gradeOf(recall.recall, exam),
      trend: trendPoints(data.now).map((at) => subjectRecall(topics, at).recall),
      empty: !topics.length,
    };
  }).filter((s) => !s.empty || LATER_SUBJECTS.has(s.subject) || PROGRESS_SUBJECTS.includes(s.subject as never));
}

export interface TopicSummary {
  topic: Topic;
  recall: GroupRecall;
  grade: Grade3;
  exam: boolean;
  trend: (number | null)[];
  /** Recall on the next exam that covers this topic, if one is set. */
  examRecall: { plan: TestPlan; recall: number | null } | null;
}

export function topicSummaries(data: ProgressData, subject: string): TopicSummary[] {
  const exams = upcoming(data);
  return data.topics
    .filter((t) => t.subject === subject)
    .map((topic) => {
      const recall = groupRecall(topic.units, data.now);
      const exam = data.examTopics.has(topic.key);
      const plan = exams.find((p) => scopeOf(p, data.units, data.skills).some((u) => topicKey(u.subject, u.topic) === topic.key));
      return {
        topic,
        recall,
        grade: gradeOf(recall.recall, exam),
        exam,
        trend: trendPoints(data.now).map((at) => groupRecall(topic.units, at).recall),
        examRecall: plan ? { plan, recall: groupRecall(topic.units, examMoment(plan)).recall } : null,
      };
    })
    .sort((a, b) => (a.recall.recall ?? -1) - (b.recall.recall ?? -1));
}

/** Tests and exams from today on, soonest first. Assignments are left out (no recall to forecast). */
export function upcoming(data: Pick<ProgressData, 'assessments' | 'today'>): TestPlan[] {
  return data.assessments.filter((a) => kindOf(a) !== 'assignment' && daysUntil(a, data.today) >= 0).sort((a, b) => a.date - b.date);
}

/** 9am on the day, roughly when a test starts. */
export function examMoment(plan: TestPlan): number {
  return plan.date + 9 * 3_600_000;
}

export interface ExamForecast {
  plan: TestPlan;
  days: number;
  /** Recall on the day if nothing more is done. */
  recall: number | null;
  grade: Grade3;
  /** Topics on it that would be red on the day. */
  redTopics: string[];
}

export function forecast(data: ProgressData, plan: TestPlan): ExamForecast {
  const scope = scopeOf(plan, data.units, data.skills);
  const at = examMoment(plan);
  const recall = groupRecall(scope, at).recall;
  const topics = topicsOf(scope);
  return {
    plan,
    days: daysUntil(plan, data.today),
    recall,
    grade: gradeOf(recall, true),
    redTopics: topics.filter((t) => gradeOf(groupRecall(t.units, at).recall, true) === 'weak').map((t) => t.name),
  };
}

export interface WeakItem {
  unit: Unit;
  recall: number;
  score: number;
  onExam: boolean;
  wrongMethod: number;
  lapses: number;
}

/**
 * Started skills and flashcard topics ranked by weakness: low recall counts
 * most, then "wrong method" taps and Again ratings in the last 30 days, and
 * anything on an exam inside its prep ramp is boosted. The weights are a
 * first guess, to tune with real data.
 */
export function weakList(data: ProgressData): WeakItem[] {
  const since = data.now - 30 * DAY;
  const unitOfCard = new Map<string, string>();
  for (const u of data.units) for (const id of u.cardIds ?? []) unitOfCard.set(id, u.key);
  const lapses = new Map<string, number>();
  const wrong = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
  for (const l of data.logs) if (l.reviewedAt >= since && l.rating === 1 && unitOfCard.has(l.cardId)) bump(lapses, unitOfCard.get(l.cardId)!);
  for (const a of data.attempts) {
    if (a.at < since) continue;
    const k = 'skill:' + a.skillId;
    if (a.rating === 1) bump(lapses, k);
    if (a.method === 'no') bump(wrong, k);
    else if (a.method === 'partly') bump(wrong, k, 0.5);
  }
  const out: WeakItem[] = [];
  for (const unit of data.units) {
    const r = unitRecall(unit, data.now);
    if (!r?.started) continue;
    const onExam = data.examTopics.has(topicKey(unit.subject, unit.topic));
    const w = wrong.get(unit.key) ?? 0;
    const l = lapses.get(unit.key) ?? 0;
    // Card topics collect lapses across many cards, so they count per card rather than in full.
    const lapseScore = unit.kind === 'cards' ? (l / Math.max(1, unit.memories.length)) * 20 : l * 5;
    let score = (1 - r.recall) * 100 + w * 8 + lapseScore;
    if (onExam) score *= 1.3;
    out.push({ unit, recall: r.recall, score, onExam, wrongMethod: w, lapses: l });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Where "Practise" goes: the skill on its own, or the cards in that topic (due ones if any, else a practice run). */
export function practiseHref(data: Pick<ProgressData, 'cards' | 'now' | 'settings'>, unit: Unit): string {
  if (unit.skill) return href('practice', 'run', 'skill', unit.skill.id);
  const filter = unit.cardTopic ? { kind: 'topic' as const, deckId: unit.deckId!, topic: unit.cardTopic } : { kind: 'deck' as const, deckId: unit.deckId! };
  const ids = new Set(unit.cardIds);
  const dayEnd = studyDayEnd(data.now, data.settings.dayStartHour);
  const due = data.cards.some((c) => ids.has(c.id) && directionsOf(c).some((d) => {
    const s = stateFor(c, d);
    return s.state !== 0 && s.due <= dayEnd;
  }));
  if (due) return reviewHref(filter);
  return href('custom', 'run', ...customToParts({ pick: 'all', days: 7, limit: 30, shuffle: true, filter }));
}

/** Recall on the day of a mark, over its topics (or its assessment's scope). */
export function markRecall(data: ProgressData, mark: Mark): number | null {
  const at = keyToTime(mark.date) + 9 * 3_600_000;
  const plan = mark.assessmentId ? data.assessments.find((a) => a.id === mark.assessmentId) : undefined;
  let scope = plan ? scopeOf(plan, data.units, data.skills) : [];
  if (mark.topics.length) {
    const keys = new Set(mark.topics.map((t) => topicKey(mark.subject, t)));
    scope = data.units.filter((u) => keys.has(topicKey(u.subject, u.topic)));
  }
  if (!scope.length) return null;
  return groupRecall(scope, at).recall;
}

export interface Baseline {
  /** Average percent across Year 11 tasks. */
  pct: number | null;
  /** Average rank across tasks with a rank. */
  rank: number | null;
  count: number;
}

export function baselineOf(marks: Mark[], subject: string): Baseline {
  const y11 = marks.filter((m) => m.year === 11 && m.subject === subject && m.outOf > 0);
  const ranked = y11.filter((m) => m.rank);
  return {
    pct: y11.length ? (y11.reduce((s, m) => s + m.mark / m.outOf, 0) / y11.length) * 100 : null,
    rank: ranked.length ? ranked.reduce((s, m) => s + m.rank!, 0) / ranked.length : null,
    count: y11.length,
  };
}

export function markPct(m: Pick<Mark, 'mark' | 'outOf'>): number {
  return m.outOf > 0 ? (m.mark / m.outOf) * 100 : 0;
}

/** Past tests and exams with no mark entered yet, so the form can be pre-filled. */
export function waitingForMarks(data: ProgressData): TestPlan[] {
  const marked = new Set(data.marks.map((m) => m.assessmentId).filter(Boolean));
  return data.assessments
    .filter((a) => daysUntil(a, data.today) <= 0 && !marked.has(a.id))
    .sort((a, b) => b.date - a.date);
}

/** Topic names for a subject, for the marks form. */
export function subjectTopics(data: ProgressData, subject: string): string[] {
  return data.topics.filter((t) => t.subject === subject).map((t) => t.name);
}
