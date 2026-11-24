// Turns one SmarterEd PDF into question and solution pictures, ready to
// check and save. Pairs that look fine are ticked straight away; the review
// screen only asks about the ones the app is unsure of.

import { OpenPdf, SCALE } from './pdf';
import { findEntries, looksLikeSmarterEd, pairEntries, type Entry, type PageText, type Region, type Worksheet } from './smartered';
import type { DraftProblem, Picture } from './save';
import { guessOtherSubject } from './subjects';
import {
  answerLetter,
  answersStart,
  chapterFromName,
  findAnswers,
  findFrames,
  findQuestions,
  levelOf,
  looksLikeTextbook,
  practiceTitle,
  type BookAnswer,
  type BookLayout,
  type BookQuestion,
  type Frame,
} from './textbook';
import type { ProblemLevel } from '../types';

export interface DraftPair extends DraftProblem {
  question: Picture;
  number: number;
  header: string;
  /** Why the app wants you to look at this one. Empty means it looked fine. */
  problems: string[];
  include: boolean;
  /** The skills this question goes into (see groupBySkill). Missing means the sheet's skill. */
  skills?: string[];
  /** Textbook level, from the colour of the question number. */
  level?: ProblemLevel;
  answerLetter?: string;
}

export interface AnalysedSheet {
  pdf: OpenPdf;
  sheet: Worksheet;
  smarterEd: boolean;
  pairs: DraftPair[];
  /** Set for one exercise of a textbook chapter: each exercise becomes its own skill. */
  textbook?: { section: string; book: string; chapter: number };
}

const TALL = 2.2;

/** Opens a second PDF, like a NESA marking guideline, to snip the answers from. */
export function openAnswers(file: File): Promise<OpenPdf> {
  return OpenPdf.open(file);
}

export async function analyseSheet(file: File, onProgress?: (done: number, total: number) => void): Promise<AnalysedSheet> {
  const pdf = await OpenPdf.open(file);
  const text = await pdf.text();
  const sheet = findEntries(text, file.name);
  const smarterEd = looksLikeSmarterEd(text);
  if (!smarterEd && !sheet.subject) sheet.subject = guessOtherSubject((text[0]?.items ?? []).map((i) => i.str).join(' '), file.name);
  const pairs: DraftPair[] = [];
  // Not a SmarterEd sheet: no automatic questions, you snip them by hand instead.
  const list = smarterEd ? pairEntries(sheet) : [];
  let done = 0;
  for (const { question, solution } of list) {
    const q = await pdf.crop(question.regions);
    const s = solution ? await pdf.crop(solution.regions) : null;
    pairs.push(makePair(question, solution, q, s));
    onProgress?.(++done, list.length);
  }
  return { pdf, sheet, smarterEd, pairs };
}

function makePair(question: Entry, solution: Entry | undefined, q: Picture | null, s: Picture | null): DraftPair {
  const problems: string[] = [];
  if (!q) problems.push('No question found in its box');
  if (!solution) problems.push('No matching worked solution');
  else if (!s) problems.push('Worked solution box is empty');
  if (question.regions.length > 1) problems.push('Question runs onto the next column');
  if (q && q.height > q.width * TALL) problems.push('Question picture is very tall');
  if (!question.marks && !question.header.mc) problems.push('Marks not found, set to 2');
  return {
    number: question.header.number,
    header: question.header.text,
    label: question.header.label,
    marks: question.marks || 2,
    mc: question.header.mc,
    key: `smartered:${question.header.text}`,
    question: q ?? { data: '', width: 0, height: 0 },
    solution: s,
    problems,
    include: !!q,
  };
}

/**
 * Reads any PDF: a textbook chapter becomes one sheet per exercise, anything
 * else one sheet (SmarterEd questions found automatically, other PDFs snipped by hand).
 */
export async function analyseFile(file: File, onProgress?: (text: string) => void): Promise<AnalysedSheet[]> {
  const pdf = await OpenPdf.open(file);
  const text = await pdf.text();
  if (looksLikeTextbook(text)) return analyseTextbook(pdf, text, file.name, onProgress);
  pdf.destroy();
  return [await analyseSheet(file, (done, total) => onProgress?.(`cropping ${done} of ${total}`))];
}

/** Marks for a textbook question, used to size practice sessions: harder questions take longer. */
const LEVEL_MARKS: Record<ProblemLevel, number> = { foundation: 2, mastery: 3, complex: 4 };

/** "Maths in Focus: Year 12 Mathematics Extension 1" is Maths Extension 1. */
export function bookSubject(book: string): string {
  if (/Extension 2/i.test(book)) return 'Maths Extension 2';
  if (/Extension 1/i.test(book)) return 'Maths Extension 1';
  if (/Advanced|Mathematics/i.test(book)) return 'Maths Advanced';
  return '';
}

async function analyseTextbook(pdf: OpenPdf, pages: PageText[], fileName: string, onProgress?: (text: string) => void): Promise<AnalysedSheet[]> {
  // The orange exercise frames come from the pixels, so each question page is drawn once to find them.
  const frames = new Map<number, Frame[]>();
  const end = answersStart(pages);
  for (let p = 0; p < end; p++) {
    onProgress?.(`reading page ${p + 1} of ${end}`);
    const page = await pdf.page(p);
    frames.set(p, findFrames(page.pixels, SCALE));
    pdf.release(p);
  }
  const layout = findQuestions(pages, (p) => frames.get(p) ?? [], fileName);
  const answers = findAnswers(pages, layout.chapter, layout.answersFrom, layout.practice);
  const chapterTitle = layout.title || chapterFromName(fileName)?.title || `Chapter ${layout.chapter}`;
  const subject = bookSubject(layout.book) || guessOtherSubject(fileName, fileName);
  const topic = layout.practice === undefined ? `Ch ${layout.chapter} ${chapterTitle}` : 'Practice sets';
  const bookKey = (layout.book || fileName).replace(/\s+/g, ' ').trim();

  const sheets = new Map<string, AnalysedSheet>();
  const sheetFor = (key: string, title: string): AnalysedSheet => {
    let sheet = sheets.get(key);
    if (!sheet) {
      sheet = {
        pdf,
        sheet: { title, courseLine: layout.book, subject, topic, code: '', questions: [], solutions: [] },
        smarterEd: false,
        pairs: [],
        textbook: { section: key, book: layout.book, chapter: layout.chapter },
      };
      sheets.set(key, sheet);
    }
    return sheet;
  };
  // Exercises first, in book order, so Test yourself questions can join the exercise they test.
  for (const s of layout.sections) if (s.kind === 'exercise') sheetFor(s.key, `${s.key} ${s.title}`.trim());

  const total = layout.questions.length;
  let done = 0;
  for (const q of layout.questions) {
    onProgress?.(`cutting out question ${++done} of ${total}`);
    const section = layout.sections.find((s) => s.key === q.section)!;
    const answer = answers.find((a) => a.section === q.section && a.number === q.number);
    pdf.releaseBefore(Math.min(...q.regions.map((r) => r.page)));
    const level = levelOf((await pdf.page(q.badge.page)).pixels, q.badge, SCALE);
    const picture = await pdf.crop(q.regions, true, 'image/webp', { thin: 10, gap: 8 });
    let target: AnalysedSheet;
    if (section.kind === 'test' && q.tag && sheets.has(q.tag)) target = sheets.get(q.tag)!;
    else if (section.kind === 'exercise') target = sheets.get(section.key)!;
    else if (section.kind === 'practice') target = sheetFor(section.key, practiceTitle(section.title, layout, fileName));
    else target = sheetFor(section.key, `Ch ${layout.chapter} ${section.kind === 'test' ? 'Test yourself' : 'Challenge exercise'}`);
    target.pairs.push(makeBookPair(q, section.title, section.kind, level, picture, answer, bookKey));
  }
  // Answers sit together at the back, so crop them in page order.
  const pending = [...sheets.values()].flatMap((s) => s.pairs as BookPair[]).filter((p) => p.answerRegions);
  pending.sort((a, b) => a.answerRegions![0].page - b.answerRegions![0].page);
  done = 0;
  for (const p of pending) {
    onProgress?.(`cutting out answer ${++done} of ${pending.length}`);
    pdf.releaseBefore(p.answerRegions![0].page);
    p.solution = await pdf.crop(p.answerRegions!, true, 'image/webp', { thin: 8, gap: 3 });
    if (!p.solution) p.problems.push('Answer box is empty');
    delete p.answerRegions;
  }
  pdf.releaseBefore(pages.length);
  return [...sheets.values()].filter((s) => s.pairs.length);
}


type BookPair = DraftPair & { answerRegions?: Region[] };

function makeBookPair(
  q: BookQuestion,
  sectionTitle: string,
  kind: BookLayout['sections'][number]['kind'],
  level: ProblemLevel | null,
  picture: Picture | null,
  answer: BookAnswer | undefined,
  book: string,
): BookPair {
  // A practice set question names the exercise it comes from, to go back to if it goes wrong.
  const label =
    kind === 'exercise' ? `Ex ${q.section} Q${q.number}` : `${sectionTitle} Q${q.number}${kind === 'practice' && q.tag ? ` (${q.tag})` : ''}`;
  const problems: string[] = [];
  if (!picture) problems.push('No question found in its box');
  if (!answer) problems.push('No matching answer');
  if (!level) problems.push('Level not found');
  if (picture && picture.height > picture.width * TALL) problems.push('Question picture is very tall');
  const letter = q.mc && answer ? answerLetter(answer.text) : null;
  return {
    number: q.number,
    header: label,
    label,
    marks: level ? LEVEL_MARKS[level] : 3,
    mc: q.mc,
    key: `book:${book}:${q.section}:${q.number}`,
    question: picture ?? { data: '', width: 0, height: 0 },
    solution: null,
    problems,
    include: !!picture,
    level: level ?? undefined,
    answerLetter: letter ?? undefined,
    answerRegions: answer?.regions,
  };
}
