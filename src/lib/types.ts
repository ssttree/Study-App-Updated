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
  lastBackupAt?: number;
}

export const DEFAULT_SETTINGS: Settings = {
  retention: 0.9,
  newPerDay: 20,
  dayStartHour: 4,
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
