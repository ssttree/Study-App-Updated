// Builds the daily plan from your study windows. Each morning (and whenever
// something changes) the plan is rebuilt, but anything you pinned, moved,
// started, finished or skipped stays where it is.
//
// 1. Bus windows get your due flashcards (never less than 10 minutes).
// 2. Desk windows get required homework, due soonest first. Homework marked
//    as flashcards goes on the bus (or in a study period) first; desk study
//    never goes on the bus.
// 3. Desk time left over goes to problems: test prep when an assessment is
//    close, otherwise the subject that needs it most.
// 4. Flexible windows only get optional things, so skipping one costs nothing.
// 5. Study periods at school get revision: flashcards the bus didn't cover,
//    then problems or test prep. Never desk homework.

import type { Availability, DayPlan, PlanItem, StudyWindow, Task, TestPlan } from '../types';
import { addDays, daysBetween } from './dates';
import { windowsFor, type DayContext } from './availability';
import { prepPull, stageOf } from './assessments';

export const MIN_FLASHCARDS = 10;
/** Shortest slice worth planning. */
export const MIN_SLICE = 10;
/** Longest problem block in one go; a longer window is split between two subjects. */
export const MAX_PROBLEMS = 50;
/** Window id for items added with "I've got 20 more minutes". */
export const EXTRA_WINDOW = 'extra';

export interface PlannerInput {
  today: string;
  availability: Availability;
  tasks: Task[];
  assessments: TestPlan[];
  /** Saved plans by date key. */
  saved: Map<string, DayPlan>;
  /** Flashcard minutes for a day (0 when there are no cards). */
  flashMinutes: (date: string) => number;
  /** What your Google calendars say about a day (work shifts, holidays), if connected. */
  context?: (date: string) => DayContext | undefined;
  /** Subjects ranked by how much they need problems today (empty with no skills). */
  problemSubjects: string[];
  newId?: () => string;
  now?: number;
}

export interface BuiltDay {
  date: string;
  windows: StudyWindow[];
  plan: DayPlan;
  /** Minutes still free in each window. */
  free: Record<string, number>;
  warnings: string[];
}

/** Minutes of a task still to do. */
export function remaining(task: Task): number {
  return Math.max(0, task.minutes - task.spent);
}

/** Tasks the planner should place: open and with time left. */
export function openTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.status === 'open' && remaining(t) > 0);
}

function keptItem(item: PlanItem): boolean {
  return item.pinned || item.status !== 'todo' || !!item.started;
}

export function buildWeek(input: PlannerInput, days = 7): BuiltDay[] {
  const out: BuiltDay[] = [];
  // Minutes of each task already planned: anything you pinned or moved to a
  // day this week counts up front, so the same work is not planned twice.
  const planned = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    for (const it of input.saved.get(addDays(input.today, i))?.items ?? []) {
      if (keptItem(it) && it.kind === 'homework' && it.taskId && it.status === 'todo') {
        planned.set(it.taskId, (planned.get(it.taskId) ?? 0) + it.minutes);
      }
    }
  }
  let lastSubject = '';
  for (let i = 0; i < days; i++) {
    const day = buildDay(addDays(input.today, i), i, input, planned, lastSubject);
    const prob = day.plan.items.find((it) => it.kind !== 'flashcards' && it.kind !== 'homework' && !it.optional);
    lastSubject = prob?.subjects?.[0] ?? '';
    out.push(day);
  }
  return out;
}

function buildDay(
  date: string,
  index: number,
  input: PlannerInput,
  planned: Map<string, number>,
  lastSubject: string,
): BuiltDay {
  const makeId = input.newId ?? (() => crypto.randomUUID());
  const windows = windowsFor(date, input.availability, input.context?.(date));
  const ids = new Set(windows.map((w) => w.id));
  const taskById = new Map(input.tasks.map((t) => [t.id, t]));
  const saved = input.saved.get(date);
  const warnings: string[] = [];

  // Keep what you touched. Homework for a task that has gone or been finished elsewhere drops out.
  const items: PlanItem[] = (saved?.items ?? []).filter((it) => {
    if (!keptItem(it)) return false;
    if (it.kind === 'homework' && it.status === 'todo') {
      const t = it.taskId ? taskById.get(it.taskId) : undefined;
      if (!t || t.status !== 'open') return false;
    }
    return true;
  });
  const free: Record<string, number> = {};
  for (const w of windows) free[w.id] = w.minutes;
  for (const it of items) {
    if (ids.has(it.windowId)) free[it.windowId] -= it.minutes;
  }
  // A task skipped or finished today is not planned again today.
  const touchedToday = new Set(items.filter((it) => it.taskId && it.status !== 'todo').map((it) => it.taskId!));
  const left = (t: Task) => (touchedToday.has(t.id) ? 0 : remaining(t) - (planned.get(t.id) ?? 0));

  const add = (w: StudyWindow, item: Omit<PlanItem, 'id' | 'windowId' | 'pinned' | 'status'>) => {
    const full: PlanItem = { id: makeId(), windowId: w.id, pinned: false, status: 'todo', ...item };
    items.push(full);
    free[w.id] -= item.minutes;
    if (item.kind === 'homework' && item.taskId) planned.set(item.taskId, (planned.get(item.taskId) ?? 0) + item.minutes);
  };

  const bus = windows.filter((w) => w.kind === 'bus');
  const desk = windows.filter((w) => w.kind === 'desk');
  const flexible = windows.filter((w) => w.kind === 'flexible');
  const school = windows.filter((w) => w.kind === 'school');

  // 1. Flashcards.
  const flash = input.flashMinutes(date);
  if (flash > 0 && !items.some((it) => it.kind === 'flashcards')) {
    let want = Math.max(MIN_FLASHCARDS, flash);
    for (const w of bus) {
      const take = Math.min(want, free[w.id]);
      if (take >= 5) {
        add(w, { kind: 'flashcards', minutes: take });
        want -= take;
      }
      if (want <= 0) break;
    }
    // Cards the bus couldn't fit go in a study period, with room left for problems.
    for (const w of school) {
      if (want < 5) break;
      const take = Math.min(want, free[w.id] - (free[w.id] >= 2 * MIN_SLICE ? MIN_SLICE : 0));
      if (take >= 5) {
        add(w, { kind: 'flashcards', minutes: take });
        want -= take;
      }
    }
    // No bus today (weekends): a short block at the desk first, capped so problems still fit.
    if (!bus.length && desk.length) {
      const w = desk[0];
      const take = Math.min(Math.max(MIN_FLASHCARDS, Math.min(flash, 30)), free[w.id]);
      if (take >= 5) add(w, { kind: 'flashcards', minutes: take });
    }
  }

  // 2. Required homework, due soonest first.
  const required = openTasks(input.tasks)
    .filter((t) => t.required)
    .sort((a, b) => a.due.localeCompare(b.due) || a.created - b.created);
  for (const t of required) {
    let need = left(t);
    if (need <= 0) continue;
    // Flashcard homework fills the bus and study periods before it takes desk time.
    const places = t.study === 'flashcards' ? [...bus, ...school, ...desk] : desk;
    for (const w of places) {
      if (need <= 0) break;
      const take = Math.min(need, free[w.id]);
      if (take >= Math.min(need, MIN_SLICE)) {
        add(w, { kind: 'homework', minutes: take, taskId: t.id, subjects: t.subject ? [t.subject] : undefined });
        need -= take;
      }
    }
  }
  // Homework due tomorrow (or late) that still does not fit: say so rather than quietly cutting flashcards.
  const short = required.filter((t) => daysBetween(date, t.due) <= 1 && left(t) > 0);
  if (short.length) {
    const minutes = short.reduce((m, t) => m + left(t), 0);
    const pushable = items
      .filter((it) => it.kind === 'homework' && it.status === 'todo' && !it.pinned)
      .map((it) => taskById.get(it.taskId!)!)
      .filter((t) => t && daysBetween(date, t.due) > 1)
      .sort((a, b) => b.due.localeCompare(a.due))[0];
    const names = short.map((t) => `"${t.title}"`).join(', ');
    warnings.push(
      `${names} ${short.length === 1 ? 'is' : 'are'} due by tomorrow but ${minutes} min won't fit. ` +
        (pushable ? `Move "${pushable.title}" to another day, or add a window.` : 'Add a window or shrink an estimate.'),
    );
  }

  // 3. Problems in what is left of the desk windows.
  const choice = problemChoice(date, index, input, lastSubject);
  const used = new Set(items.filter((it) => it.subjects && it.kind !== 'homework').map((it) => it.subjects![0]));
  for (const w of desk) {
    if (!choice || items.some((it) => it.windowId === w.id && it.kind !== 'flashcards' && it.kind !== 'homework')) continue;
    // A long weekend window gets two blocks, so a second subject gets a turn.
    while (free[w.id] >= MIN_SLICE) {
      const minutes = free[w.id] >= MAX_PROBLEMS + 2 * MIN_SLICE ? MAX_PROBLEMS : free[w.id];
      const pick = choice.find((c) => !used.has(c.subject)) ?? choice[0];
      used.add(pick.subject);
      add(w, { kind: pick.kind, minutes, subjects: [pick.subject], assessmentId: pick.assessmentId });
    }
  }

  // 4. Flexible windows: optional homework, then extra problems.
  const optional = openTasks(input.tasks)
    .filter((t) => !t.required)
    .sort((a, b) => a.due.localeCompare(b.due) || a.created - b.created);
  const addOptional = (w: StudyWindow, list: Task[]) => {
    for (const t of list) {
      const need = left(t);
      if (need <= 0 || free[w.id] < Math.min(need, MIN_SLICE)) continue;
      add(w, { kind: 'homework', minutes: Math.min(need, free[w.id]), taskId: t.id, optional: true, subjects: t.subject ? [t.subject] : undefined });
    }
  };
  // Optional flashcard homework can use bus time the due cards left free.
  const optionalCards = optional.filter((t) => t.study === 'flashcards');
  for (const w of bus) addOptional(w, optionalCards);
  for (const w of flexible) {
    addOptional(w, optional);
    if (free[w.id] >= MIN_SLICE && input.problemSubjects.length) {
      const subject = input.problemSubjects.find((s) => !used.has(s)) ?? input.problemSubjects[0];
      add(w, { kind: 'problems', minutes: free[w.id], subjects: [subject], optional: true });
    }
  }

  // 5. Study periods: revision in what is left.
  for (const w of school) {
    if (!choice || free[w.id] < MIN_SLICE || items.some((it) => it.windowId === w.id && it.kind !== 'flashcards')) continue;
    const pick = choice.find((c) => !used.has(c.subject)) ?? choice[0];
    used.add(pick.subject);
    add(w, { kind: pick.kind, minutes: free[w.id], subjects: [pick.subject], assessmentId: pick.assessmentId });
  }

  // Pinned items whose window has gone (or extra time) show under "Extra time".
  for (const it of items) if (!ids.has(it.windowId)) it.windowId = EXTRA_WINDOW;

  const order = new Map(windows.map((w, i) => [w.id, i]));
  const kindOrder = { flashcards: 0, homework: 1, prep: 2, final: 2, problems: 3 };
  items.sort((a, b) => (order.get(a.windowId) ?? 99) - (order.get(b.windowId) ?? 99) || kindOrder[a.kind] - kindOrder[b.kind]);

  return {
    date,
    windows,
    plan: { date, items, built: input.now ?? Date.now(), closed: saved?.closed },
    free,
    warnings,
  };
}

interface Choice {
  kind: 'problems' | 'prep' | 'final';
  subject: string;
  assessmentId?: string;
}

/**
 * What the problem time goes to on a day, best first. An assessment in its
 * focus or final stage takes it as test prep; close assessments share the
 * days by how hard they pull, so one subject doesn't eat a whole fortnight.
 */
export function problemChoice(date: string, index: number, input: PlannerInput, lastSubject: string): Choice[] | null {
  const withSkills = input.assessments.filter((a) => a.kind !== 'assignment' && a.skillIds.length > 0);
  const pulls = withSkills
    .map((a) => ({ a, pull: prepPull(a, date), stage: stageOf(a, date) }))
    .filter((p) => p.pull > 0)
    .sort((x, y) => y.pull - x.pull);
  const choices: Choice[] = [];

  const urgent = pulls.filter((p) => p.stage === 'focus' || p.stage === 'final');
  if (urgent.length) {
    // Alternate when the runner-up is nearly as pressing as the leader and the leader had yesterday.
    let order = urgent;
    if (urgent.length > 1 && urgent[0].a.subject === lastSubject && urgent[1].pull >= urgent[0].pull * 0.6) {
      order = [urgent[1], urgent[0], ...urgent.slice(2)];
    }
    for (const p of order) {
      choices.push({ kind: p.stage === 'final' ? 'final' : 'prep', subject: p.a.subject, assessmentId: p.a.id });
    }
  }

  // Normal days: rotate through the subjects that need it most, with subjects
  // in their build stage counted twice so they come up more often.
  const ranked = input.problemSubjects.slice(0, 3);
  const building = pulls.filter((p) => p.stage === 'build').map((p) => p.a.subject);
  const pool = [...building, ...building, ...ranked].filter((s) => input.problemSubjects.includes(s) || building.includes(s));
  if (pool.length) {
    const start = index % pool.length;
    const rotated = [...pool.slice(start), ...pool.slice(0, start)];
    const unique = [...new Set(rotated)];
    const ordered = unique.length > 1 && unique[0] === lastSubject ? [...unique.slice(1), unique[0]] : unique;
    for (const s of ordered) choices.push({ kind: 'problems', subject: s });
  }
  return choices.length ? choices : null;
}

/**
 * Closes days that have passed: homework planned and not finished is carried
 * over, counting once per day. After two carry-overs the planner asks what to do.
 */
export function closePastDays(plans: DayPlan[], tasks: Task[], today: string): { plans: DayPlan[]; tasks: Task[] } {
  const changedPlans: DayPlan[] = [];
  const changedTasks = new Map<string, Task>();
  for (const plan of [...plans].sort((a, b) => a.date.localeCompare(b.date))) {
    if (plan.closed || plan.date >= today) continue;
    for (const it of plan.items) {
      if (it.kind !== 'homework' || it.status !== 'todo' || !it.taskId || it.optional) continue;
      const t = changedTasks.get(it.taskId) ?? tasks.find((x) => x.id === it.taskId);
      if (!t || t.status !== 'open' || t.carriedFrom === plan.date) continue;
      changedTasks.set(t.id, { ...t, carryOvers: t.carryOvers + 1, carriedFrom: plan.date });
    }
    changedPlans.push({ ...plan, closed: true });
  }
  return { plans: changedPlans, tasks: [...changedTasks.values()] };
}

/** Carry-overs before the planner asks whether to reschedule, shrink or drop a task. */
export const ASK_AFTER_CARRIES = 2;

/**
 * "I've got 20 more minutes": the next best thing. Homework not yet planned
 * today first (required, then optional), otherwise problems.
 */
export function extraItem(
  day: BuiltDay,
  input: Pick<PlannerInput, 'tasks' | 'problemSubjects'>,
  minutes = 20,
  makeId: () => string = () => crypto.randomUUID(),
): PlanItem | null {
  const plannedToday = new Map<string, number>();
  for (const it of day.plan.items) if (it.taskId) plannedToday.set(it.taskId, (plannedToday.get(it.taskId) ?? 0) + it.minutes);
  const candidates = openTasks(input.tasks)
    .filter((t) => remaining(t) - (plannedToday.get(t.id) ?? 0) > 0)
    .sort((a, b) => Number(b.required) - Number(a.required) || a.due.localeCompare(b.due));
  const base = { id: makeId(), windowId: EXTRA_WINDOW, pinned: true, status: 'todo' as const };
  const t = candidates[0];
  if (t) {
    const need = remaining(t) - (plannedToday.get(t.id) ?? 0);
    return { ...base, kind: 'homework', taskId: t.id, minutes: Math.min(minutes, need), subjects: t.subject ? [t.subject] : undefined };
  }
  if (input.problemSubjects.length) {
    const doneSubjects = new Set(day.plan.items.filter((it) => it.kind === 'problems').map((it) => it.subjects?.[0]));
    const subject = input.problemSubjects.find((s) => !doneSubjects.has(s)) ?? input.problemSubjects[0];
    return { ...base, kind: 'problems', minutes, subjects: [subject] };
  }
  return null;
}
