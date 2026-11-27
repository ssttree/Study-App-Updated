// Which course a maths question belongs to: Advanced, Extension 1 or
// Extension 2. The Year 12 Extension 1 textbook mixes Advanced chapters and
// sections in with the Extension 1 work, and prints "EXT1" beside the
// Extension 1 sections and single questions; SmarterEd puts the course in each
// question's header (ADV, EXT1, EXT2). This lets the Extension 1 skills be
// practised without the Advanced questions, or the other way round.

import { parseHeader } from './smartered';
import type { Course, CourseChoice, Problem, Skill } from '../types';

export const COURSE_NAMES: Record<Course, string> = { adv: 'Advanced', ext1: 'Extension 1', ext2: 'Extension 2' };
export const COURSE_SHORT: Record<Course, string> = { adv: 'Adv', ext1: 'Ext 1', ext2: 'Ext 2' };

/** What a subject's own questions are, when nothing else says. */
export function subjectCourse(subject: string): Course | undefined {
  if (/extension 1/i.test(subject)) return 'ext1';
  if (/extension 2/i.test(subject)) return 'ext2';
  if (/^(maths|mathematics) advanced/i.test(subject)) return 'adv';
  return undefined;
}

/** Subjects that mix in work from the course below, so the choice of course matters. */
export function mixesCourses(subject: string): boolean {
  const c = subjectCourse(subject);
  return c === 'ext1' || c === 'ext2';
}

/** A SmarterEd or HSC course code: ADV, EXT1, EXT2 (and the older MA, ME, MX). */
export function courseFromCode(code: string | undefined): Course | undefined {
  const c = (code ?? '').toUpperCase().replace('*', '');
  if (c === 'ADV' || c === 'MA') return 'adv';
  if (c === 'EXT1' || c === 'ME') return 'ext1';
  if (c === 'EXT2' || c === 'MX') return 'ext2';
  return undefined;
}

/** Maths in Focus Year 12 Extension 1: the sections it marks EXT1, read from the chapter PDFs. */
export const MIF12_EXT1_SECTIONS: readonly string[] = ['1.10', '2.01', '2.02', '2.03', '2.04', '2.05', '2.06', '2.07', '3.05', '3.06', '3.07', '4.08', '4.09', '4.10', '5.09', '7.01', '7.02', '7.03', '7.04', '7.05', '7.06', '8.02', '8.04', '9.01', '9.02', '9.03', '9.04', '9.05', '9.06', '9.07', '12.01', '12.02', '12.03', '12.04', '12.05', '14.01', '14.02', '14.03', '14.04'];

/** Chapters that are Extension 1 all the way through: their Test yourself and Challenge questions are too. */
const MIF12_EXT1_CHAPTERS = new Set([2, 7, 9, 12, 14]);

/** Single questions marked EXT1 outside those sections (in tests, challenges and practice sets), by section. */
const MIF12_EXT1_MARKED: Record<string, number[]> = {
  '3.02': [8],
  '6.08': [4, 10],
  '8.06': [23],
  '8.07': [19, 20],
  'challenge1': [9, 10, 16],
  'challenge3': [2, 7, 8, 9, 10, 11, 12, 14],
  'challenge4': [2, 7, 10],
  'challenge8': [3, 4, 5, 9],
  'practice1': [2, 9, 11, 14, 18, 19, 21, 22, 23, 24, 26, 27, 28, 31, 32, 38, 40, 42, 46, 47, 50, 51, 52],
  'practice2': [2, 7, 8, 9, 10, 11, 15, 16, 17, 18, 25, 26, 31, 32, 35, 36, 40, 41, 42, 43, 46, 51, 56, 57, 62, 67, 68, 74, 79, 81, 82, 83],
  'practice3': [2, 3, 5, 6, 10, 13, 14, 20, 21, 32, 43, 50, 53, 55, 56, 59, 60, 61, 63, 64, 65, 66, 67, 68, 69],
  'practice4': [2, 4, 6, 7, 10, 11, 12, 13, 15, 17, 20, 24, 28, 30, 33, 36, 38, 39, 43, 44, 45],
  'test1': [5, 14, 29],
  'test3': [3, 4, 10, 11, 12, 13, 14, 17, 19, 20, 24, 25, 26],
  'test4': [11, 16, 20, 22, 23, 24, 26],
  'test5': [8, 26],
  'test8': [3, 6, 17],
};

export interface BookQuestionInfo {
  /** "Maths in Focus: Year 12 Mathematics Extension 1". */
  book: string;
  /** "4.08", "test4", "challenge4" or "practice2". */
  section: string;
  number: number;
  /** "EXT1" printed beside the number. */
  marked?: boolean;
  /** Margin tag naming the section it tests. */
  tag?: string;
  /** Sections this PDF marks EXT1. */
  extSections?: readonly string[];
}

/** The course of a textbook question. */
export function textbookCourse(q: BookQuestionInfo): Course | undefined {
  if (/extension 2/i.test(q.book)) return 'ext2';
  if (/advanced/i.test(q.book)) return 'adv';
  if (!/extension 1/i.test(q.book)) return undefined;
  const year12 = /year 12/i.test(q.book);
  const ext = new Set([...(q.extSections ?? []), ...(year12 ? MIF12_EXT1_SECTIONS : [])]);
  if (q.marked || ext.has(q.section) || (q.tag && ext.has(q.tag))) return 'ext1';
  if (year12 && MIF12_EXT1_MARKED[q.section]?.includes(q.number)) return 'ext1';
  const chapter = /^(?:test|challenge)(\d+)$/.exec(q.section);
  if (year12 && chapter && MIF12_EXT1_CHAPTERS.has(Number(chapter[1]))) return 'ext1';
  return 'adv';
}

/**
 * A question's course: the one saved with it, else worked out from how it was
 * imported (older imports), else its skill's subject.
 */
export function courseOf(p: Pick<Problem, 'course' | 'key' | 'label'>, subject = ''): Course | undefined {
  if (p.course) return p.course;
  const book = /^book:(.*):([a-z]*\d+(?:\.\d+)?):(\d+)$/.exec(p.key);
  if (book) {
    const tag = /\((\d{1,2}\.\d{2})\)/.exec(p.label)?.[1];
    return textbookCourse({ book: book[1], section: book[2], number: Number(book[3]), tag }) ?? subjectCourse(subject);
  }
  if (p.key.startsWith('smartered:')) {
    const h = parseHeader(`1. ${p.key.slice('smartered:'.length)}`);
    const c = courseFromCode(h?.course);
    if (c) return c;
  }
  return subjectCourse(subject);
}

/** How a skill's questions split by course. */
export function courseCounts(problems: Pick<Problem, 'course' | 'key' | 'label'>[], subject: string): Partial<Record<Course, number>> {
  const out: Partial<Record<Course, number>> = {};
  for (const p of problems) {
    const c = courseOf(p, subject);
    if (c) out[c] = (out[c] ?? 0) + 1;
  }
  return out;
}

/** In an Extension subject: whether a question is the Extension work itself (not Advanced or Ext 1 review). */
export function isExtensionWork(p: Pick<Problem, 'course' | 'key' | 'label'>, subject: string): boolean {
  const own = subjectCourse(subject);
  const c = courseOf(p, subject);
  return !c || c === own;
}

/**
 * Keeps only the Extension questions (or only the ones from the course below)
 * in the Extension subjects. Other subjects are left alone.
 */
export function withCourse<T extends { problems: Problem[]; skills: Skill[] }>(data: T, choice: CourseChoice | undefined): T {
  if (!choice) return data;
  const subjectOf = new Map(data.skills.map((s) => [s.id, s.subject]));
  return {
    ...data,
    problems: data.problems.filter((p) => {
      const subject = subjectOf.get(p.skillId) ?? '';
      if (!mixesCourses(subject)) return true;
      return isExtensionWork(p, subject) === (choice === 'extension');
    }),
  };
}
