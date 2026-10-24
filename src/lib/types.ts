// The shapes of everything the app stores. Kept in one place so later
// features (problem practice, planner, progress) can add their own records
// next to these without touching the flashcard ones.

export type TypingMode = 'off' | 'always' | 'optional';

/** A card can follow its deck's typing setting or pick its own. */
export type CardTypingMode = 'deck' | TypingMode;

/** basic: front asks, back answers. reversed: also asks back to front. */
export type CardType = 'basic' | 'reversed';

/** Which way round a card is being asked. Basic cards only use 'forward'. */
export type Direction = 'forward' | 'reverse';

export interface Deck {
  id: string;
  name: string;
  subject: string;
  module: string;
  typingDefault: TypingMode;
  created: number;
  updated: number;
}

/**
 * FSRS memory state for one direction of a card. Dates are stored as
 * millisecond timestamps so backups are plain JSON.
 */
export interface FsrsState {
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  /** 0 New, 1 Learning, 2 Review, 3 Relearning (same numbers as ts-fsrs). */
  state: 0 | 1 | 2 | 3;
  lastReview?: number;
}

export interface Card {
  id: string;
  deckId: string;
  topic: string;
  tags: string[];
  type: CardType;
  typing: CardTypingMode;
  /** Markdown with Obsidian-style $inline$ and $$display$$ maths. */
  front: string;
  back: string;
  /**
   * What a typed answer is checked against, written plainly
   * (e.g. "barium, calcium" or "N2 + 3H2 <=> 2NH3"). Empty means use the
   * first line of the back. "|" separates other accepted answers.
   */
  answer?: string;
  /** Optional picture shown on the front, stored as a data URL. */
  image?: string;
  /** Where the card came from, e.g. "manual" or "anki:Chem deck". */
  source: string;
  fsrs: FsrsState;
  /** Only used when type is 'reversed'. */
  fsrsReverse?: FsrsState;
  created: number;
  updated: number;
}

/** One rating of one card. Never edited, used later for stats and the FSRS optimiser. */
export interface ReviewLog {
  id: string;
  cardId: string;
  direction: Direction;
  /** 1 Again, 2 Hard, 3 Good, 4 Easy */
  rating: 1 | 2 | 3 | 4;
  /** The card's state before this review (0 means it was a new card). */
  stateBefore: 0 | 1 | 2 | 3;
  reviewedAt: number;
  elapsedDays: number;
  scheduledDays: number;
  /** How long the card was on screen, in milliseconds. */
  durationMs: number;
  /** What was typed, for typed-answer reviews. */
  typedAnswer?: string;
}

export interface Settings {
  /** Target recall chance FSRS aims for, 0.9 normally, 0.95 before exams. */
  retention: number;
  newPerDay: number;
  /** Hour the study day rolls over, so a late night review counts for that day. */
  dayStartHour: number;
  /** Length of the evening problem block, in minutes. */
  problemMinutes: number;
  lastBackupAt?: number;
}

export const DEFAULT_SETTINGS: Settings = {
  retention: 0.9,
  newPerDay: 20,
  dayStartHour: 4,
  problemMinutes: 35,
};

export const SUBJECTS = [
  'Maths Advanced',
  'Maths Extension 1',
  'Maths Extension 2',
  'English Advanced',
  'Chemistry',
  'Business Studies',
  'Engineering Studies',
] as const;

// Problem practice. FSRS schedules skills (one subtopic, usually one SmarterEd
// worksheet), not single questions, so you practise the method rather than
// remembering the answer to one question.

export interface Skill {
  id: string;
  subject: string;
  name: string;
  /** Wider topic it belongs to, like "F2 Polynomials" or "Module 3: Reactive Chemistry". */
  topic: string;
  /** Short syllabus code from the worksheet, like "F2" or "M3". */
  code: string;
  /** Set for sub-skills split out of a broad worksheet. */
  parentId?: string;
  /** Optional syllabus dot point, like "ME-F2.1". */
  dotPoint?: string;
  /** Only skills taught in class (switched on) join the schedule. */
  on: boolean;
  fsrs: FsrsState;
  created: number;
  updated: number;
}

export type ProblemSource = 'smartered' | 'atarnotes' | 'snip';

export interface Problem {
  id: string;
  skillId: string;
  source: ProblemSource;
  /** Where it came from, like "2016 HSC Q2" or "NESA 2019 Sample Exam Q2". */
  label: string;
  /** The worksheet or topic test it was imported from. */
  from: string;
  /** Used to skip questions already imported, e.g. the SmarterEd header. */
  key: string;
  marks: number;
  mc: boolean;
  /** Correct letter for multiple choice, once known. */
  answerLetter?: string;
  /** Ids in the images store, kept apart so lists of problems stay light. */
  questionImage: string;
  solutionImage?: string;
  /** Position in the worksheet, to keep the original order. */
  order: number;
  created: number;
}

export type MethodChoice = 'yes' | 'partly' | 'no';
export type MistakeTag = 'slip' | 'content' | 'misread' | 'time';

/** One go at one problem on paper. Never edited, used for weak spots later. */
export interface Attempt {
  id: string;
  problemId: string;
  skillId: string;
  at: number;
  /** 1 Again, 2 Hard, 3 Good, 4 Easy */
  rating: 1 | 2 | 3 | 4;
  method: MethodChoice;
  confusedWith?: string;
  mistake?: MistakeTag;
  /** Multiple choice letter picked, if any. */
  picked?: string;
  seconds: number;
  /** The skill's state before (0 means it was new). */
  stateBefore: 0 | 1 | 2 | 3;
  /** Test prep plan this attempt was part of, if any. */
  planId?: string;
}

export type AssessmentKind = 'test' | 'exam' | 'assignment';

/** Days before an assessment that each prep stage starts. */
export interface RampDays {
  build: number;
  focus: number;
  final: number;
}

/**
 * An assessment: a class test, an exam (trials or HSC) or an assignment.
 * Started life as a problem practice "test plan", so the store keeps that
 * name and the newer fields are optional for plans made before the planner.
 */
export interface TestPlan {
  id: string;
  name: string;
  subject: string;
  /** Test day as a timestamp (local midnight). */
  date: number;
  skillIds: string[];
  created: number;
  /** Missing means a class test. */
  kind?: AssessmentKind;
  /** Percent of the course mark, if known. */
  weighting?: number;
  /** Custom ramp for this one; missing means the default for its kind. */
  ramp?: RampDays;
  /** Flashcard decks in scope: their cards aim for 95% recall in the focus stage. */
  deckIds?: string[];
  /** Filled in afterwards. */
  mark?: number;
  outOf?: number;
  /** Skills that went badly, pulled forward in the schedule. */
  badSkillIds?: string[];
}

// Planner and homework.

export type TaskType = 'classwork' | 'smartered' | 'assignment' | 'other';
export type TaskStatus = 'open' | 'done' | 'dropped';

export interface Task {
  id: string;
  title: string;
  /** One of SUBJECTS, or empty when not known. */
  subject: string;
  type: TaskType;
  /** Due date as a local date key, YYYY-MM-DD. */
  due: string;
  /** Time estimate in minutes. */
  minutes: number;
  /** Minutes already done, for tasks split over more than one window. */
  spent: number;
  required: boolean;
  status: TaskStatus;
  notes: string;
  /** How many times it was planned for a day and not finished. */
  carryOvers: number;
  /** Date key of the last plan it was carried over from, so it only counts once a day. */
  carriedFrom?: string;
  /** Practice skills for a SmarterEd set (one per worksheet). Use taskSkillIds() to read. */
  skillIds?: string[];
  /** Older single-skill link, from before a task could have several worksheets. */
  skillId?: string;
  /** Assignment milestone: the assessment it belongs to. */
  assessmentId?: string;
  /** Attached PDFs, kept in the images store. Use taskAttachments() to read. */
  attachments?: { id: string; name: string }[];
  /** Older single attachment. */
  attachmentId?: string;
  attachmentName?: string;
  created: number;
  finished?: number;
}

/** bus: flashcards (and light homework). desk: homework and paper problems. flexible: only optional items. */
/** school: a study period at school, filled with revision (flashcards and problems, no homework). */
export type WindowKind = 'bus' | 'desk' | 'flexible' | 'school';
/** Which weekly template a window belongs to. */
export type Season = 'all' | 'off' | 'soccer';

export interface StudyWindow {
  id: string;
  name: string;
  /** 0 Sunday to 6 Saturday. */
  days: number[];
  /** 24 hour time, HH:MM. */
  start: string;
  minutes: number;
  kind: WindowKind;
  season: Season;
}

export interface Availability {
  windows: StudyWindow[];
  /** Soccer season, as MM-DD, inclusive. */
  soccerStart: string;
  soccerEnd: string;
  /** Training nights in season (0 Sunday to 6 Saturday): desk windows from 4pm vanish. */
  trainingDays: number[];
  /** One-off days, by date key. Replaces the template for that day. */
  overrides: Record<string, StudyWindow[]>;
  /** Study hours (HH:MM): home and school windows are trimmed to fit. Empty or missing means no limit. */
  earliest?: string;
  latest?: string;
}

export type PlanItemKind = 'flashcards' | 'homework' | 'problems' | 'prep' | 'final';
export type PlanItemStatus = 'todo' | 'done' | 'skipped';

export interface PlanItem {
  id: string;
  kind: PlanItemKind;
  windowId: string;
  minutes: number;
  taskId?: string;
  /** Problem subjects (problems), or the subject being prepped. */
  subjects?: string[];
  assessmentId?: string;
  /** Pinned items stay put when the plan rebuilds. Moving an item pins it. */
  pinned: boolean;
  status: PlanItemStatus;
  /** Opened at least once, so a rebuild leaves it alone. */
  started?: boolean;
  /** Only in flexible windows: fine to skip. */
  optional?: boolean;
}

export interface DayPlan {
  /** Date key, YYYY-MM-DD. */
  date: string;
  items: PlanItem[];
  built: number;
  /** Set once unfinished homework from this day has been carried over. */
  closed?: boolean;
}

/** A cropped question or solution picture, as a data URL. */
export interface StoredImage {
  id: string;
  data: string;
  width: number;
  height: number;
}

/** Phone inbox and Google Calendar settings. Kept on this laptop only, never in backups. */
export interface SyncConfig {
  /** The APP_KEY set on the Railway server. */
  key: string;
  /** Google calendars the app reads (never changes). Empty means none. */
  workCalendarId: string;
  timetableCalendarId: string;
  /** Write due dates and study blocks to the app's own two calendars. */
  pushDue: boolean;
  pushBlocks: boolean;
  connected?: boolean;
  lastSync?: number;
  lastError?: string;
}

export const DEFAULT_SYNC: SyncConfig = {
  key: '',
  workCalendarId: '',
  timetableCalendarId: '',
  pushDue: true,
  pushBlocks: true,
};

/** Every skill a homework task is linked to, old or new style. */
export function taskSkillIds(t: Pick<Task, 'skillIds' | 'skillId'>): string[] {
  return t.skillIds ?? (t.skillId ? [t.skillId] : []);
}

/** Every PDF attached to a homework task, old or new style. */
export function taskAttachments(t: Pick<Task, 'attachments' | 'attachmentId' | 'attachmentName'>): { id: string; name: string }[] {
  return t.attachments ?? (t.attachmentId ? [{ id: t.attachmentId, name: t.attachmentName ?? 'PDF' }] : []);
}
