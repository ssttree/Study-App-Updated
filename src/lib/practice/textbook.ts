// Finds the exercise questions and their answers in a textbook chapter PDF,
// laid out like Maths In Focus (Cengage): the chapter's pages, then that
// chapter's answers at the back.
//
// Questions: each exercise starts with "EXERCISE 1.04" and the section title
// under it, then numbered questions inside an orange frame. Each number sits
// in a coloured badge: green square Foundation, blue circle Mastery, red
// hexagon Complex. "Test yourself" and "Challenge exercise" at the end of the
// chapter are numbered the same way, with no frame; Test yourself questions
// have a tag in the margin naming the section they test, like "1.07".
//
// Answers: two columns, "Chapter 1", then "Exercise 1.01" and the question
// numbers in bold, sometimes several on one line ("28 26  29 122b  30 38th term").
//
// The pages are cut out as pictures (see pdf.ts), so this file only works out
// where each question and answer is. Frames and badge colours come from the
// page pixels (findFrames, levelOf), so the text layout and the pixels can be
// tested apart.

import type { PageText, Region, TextItem } from './smartered';
import type { Pixels } from './crop';
import type { ProblemLevel } from '../types';

export type Level = ProblemLevel;

/** An orange exercise frame on one page, in PDF units with y measured from the top. */
export interface Frame {
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

export type SectionKind = 'exercise' | 'test' | 'challenge';

export interface BookSection {
  /** "1.04", "test1" or "challenge1". */
  key: string;
  kind: SectionKind;
  /** "Arithmetic series", "Test yourself 1", "Challenge exercise 1". */
  title: string;
  /** Questions in this range are multiple choice, from "For Questions 1 to 5, select ...". */
  mc?: [number, number];
}

/** Where a question number is, so the page pixels can be checked for its badge colour. */
export interface Mark {
  page: number;
  /** Centre of the number, PDF units, y from the top. */
  x: number;
  y: number;
}

export interface BookQuestion {
  section: string;
  number: number;
  regions: Region[];
  badge: Mark;
  /** Margin tag naming the section it tests, like "1.07" (Test yourself only). */
  tag?: string;
  mc: boolean;
}

export interface BookAnswer {
  section: string;
  number: number;
  regions: Region[];
  /** The answer's text, used to read a multiple choice letter. */
  text: string;
}

export interface BookLayout {
  chapter: number;
  /** "Sequences and series", from the file name or the first page. */
  title: string;
  /** "Maths in Focus: Year 12 Mathematics Extension 1", from the page footers. */
  book: string;
  sections: BookSection[];
  questions: BookQuestion[];
  /** First page of the answers, 0 based. */
  answersFrom: number;
}

interface Token {
  page: number;
  item: TextItem;
  number: number;
  section: string;
}

const NUMBER = /^\d{1,2}$/;
const TAG = /^(\d{1,2}\.\d{2}),?$/;
const EXERCISE = /\bEXERCISE\s+(\d{1,2})\.(\d{2})\b/;
const FOOTER = 37;
const HEADER = 40;

const top = (page: PageText, item: TextItem) => page.height - item.y;

/** True for a chapter PDF laid out like Maths In Focus: exercises and an answers section. */
export function looksLikeTextbook(pages: PageText[]): boolean {
  let exercises = 0;
  let answers = false;
  for (const p of pages) {
    for (const i of p.items) {
      if (EXERCISE.test(i.str.trim())) exercises++;
      if (isAnswersHeading(i)) answers = true;
    }
  }
  return exercises > 0 && answers;
}

/** Index of the page that starts the answers, or the page count if there are none. */
export function answersStart(pages: PageText[]): number {
  const i = pages.findIndex((p) => p.items.some((it) => isAnswersHeading(it)));
  return i < 0 ? pages.length : i;
}

/** "ANSWERS" at the start of the answers, or a "Chapter 2" heading inside them. */
function isAnswersHeading(it: TextItem): boolean {
  const s = it.str.trim();
  return (s === 'ANSWERS' && it.h >= 18) || (!!it.sans && /^Chapter \d{1,2}$/.test(s) && it.h >= 11 && it.h < 16);
}

/** Items grouped into lines (same baseline), top to bottom, each line left to right. */
function lines(items: TextItem[]): TextItem[][] {
  const sorted = [...items].filter((i) => !i.rotated).sort((a, b) => b.y - a.y || a.x - b.x);
  const out: TextItem[][] = [];
  for (const it of sorted) {
    const line = out[out.length - 1];
    if (line && Math.abs(line[0].y - it.y) < 2.5) line.push(it);
    else out.push([it]);
  }
  for (const l of out) l.sort((a, b) => a.x - b.x);
  return out;
}

const lineText = (l: TextItem[]) =>
  l
    .map((i) => i.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .trim();

/** "Ext 1 Ch 01 Sequences and series.pdf" gives chapter 1, "Sequences and series". */
export function chapterFromName(fileName: string): { chapter: number; title: string } | null {
  const m = /\bCh(?:apter)?\s*0*(\d{1,2})\s+(.+?)(?:\.pdf)?$/i.exec(fileName);
  return m ? { chapter: Number(m[1]), title: m[2].trim() } : null;
}

/**
 * Finds the sections and numbered questions before the answers. frames(page)
 * gives the orange frames found on a page, so a question stops at its frame.
 */
export function findQuestions(pages: PageText[], frames: (page: number) => Frame[], fileName = ''): BookLayout {
  const answersFrom = answersStart(pages);
  const sections: BookSection[] = [];
  const tokens: Token[] = [];
  let section: BookSection | null = null;
  let last = 0;
  let chapter = 0;
  let book = '';
  let exerciseAt: { page: number; y: number } | null = null;
  let titleItems: TextItem[] = [];

  for (let p = 0; p < answersFrom; p++) {
    const page = pages[p];
    for (const line of lines(page.items)) {
      const text = lineText(line);
      if (!book) {
        const b = /(Maths in Focus:.*?Mathematics(?: Extension \d| Advanced)?)/.exec(text);
        if (b) book = b[1];
      }
      const first = line[0];
      if (first.y < FOOTER || first.y > page.height - HEADER) continue;
      const ex = EXERCISE.exec(text);
      if (ex) {
        chapter ||= Number(ex[1]);
        const key = `${Number(ex[1])}.${ex[2]}`;
        section = { key, kind: 'exercise', title: '' };
        sections.push(section);
        last = 0;
        exerciseAt = { page: p, y: first.y };
        titleItems = [];
        continue;
      }
      // The section title sits under "EXERCISE 1.04", in larger type.
      // A title with a fraction in it ("Solving dy/dx = f(x)g(y)") spreads over a few baselines.
      if (section?.kind === 'exercise' && last === 0 && exerciseAt && exerciseAt.page === p && exerciseAt.y - first.y < 48) {
        if (line.some((i) => i.h >= 12) && !(first.sans && NUMBER.test(first.str.trim()))) {
          titleItems.push(...line.filter((i) => i.h >= 9));
          section.title = tidyTitle(titleItems);
          continue;
        }
      }
      const big = line.find((i) => i.h >= 14 && /^[A-Za-z]{3}/.test(i.str.trim()));
      if (big) {
        const t = lineText(line.filter((i) => i.h >= 14 && /[A-Za-z]/.test(i.str)));
        if (/^Test yourself/i.test(t)) {
          section = { key: `test${chapter}`, kind: 'test', title: `Test yourself ${chapter || ''}`.trim() };
          sections.push(section);
          last = 0;
        } else if (/^Challenge exercise/i.test(t)) {
          section = { key: `challenge${chapter}`, kind: 'challenge', title: `Challenge exercise ${chapter || ''}`.trim() };
          sections.push(section);
          last = 0;
        } else {
          // A new heading (a section banner, an investigation, the chapter summary) ends the exercise.
          section = null;
        }
        continue;
      }
      if (!section) continue;
      const mc = /For Questions? (\d+) (?:to|and) (\d+),? (?:select|choose)/i.exec(text);
      if (mc) section.mc = [Number(mc[1]), Number(mc[2])];
      for (const it of line) {
        const s = it.str.trim();
        // Question numbers sit at the left edge of the text, never out in a diagram.
        if (!it.sans || !NUMBER.test(s) || it.h < 9 || it.h > 11 || it.x > page.width * 0.22) continue;
        const n = Number(s);
        // Numbers count up; anything else (a list, a page number) is not a question.
        if (n <= last || n > last + 3) continue;
        // A question number starts its line, apart from a margin tag beside it.
        const before = line.filter((o) => o.x < it.x - 1 && !(o.sans && (TAG.test(o.str.trim()) || o.h < 9)));
        if (before.length) continue;
        tokens.push({ page: p, item: it, number: n, section: section.key });
        last = n;
      }
    }
  }

  if (!chapter) chapter = chapterFromName(fileName)?.chapter ?? 0;
  const questions: BookQuestion[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1]?.section === t.section ? tokens[i + 1] : undefined;
    const sec = sections.find((s) => s.key === t.section)!;
    questions.push({
      section: t.section,
      number: t.number,
      regions: questionRegions(pages, frames, t, next, tokens),
      badge: { page: t.page, x: t.item.x + t.item.w / 2, y: top(pages[t.page], t.item) - t.item.h * 0.35 },
      tag: sec.kind === 'test' ? marginTag(pages[t.page], t.item) : undefined,
      mc: !!sec.mc && t.number >= sec.mc[0] && t.number <= sec.mc[1],
    });
  }
  const named = chapterFromName(fileName);
  return {
    chapter,
    title: named && named.chapter === chapter ? named.title : '',
    book,
    sections: sections.filter((s) => questions.some((q) => q.section === s.key)),
    questions,
    answersFrom,
  };
}

/** A section title from its pieces, left to right: a stacked "dy" over "dx" reads "dy/dx". */
function tidyTitle(items: TextItem[]): string {
  return [...items]
    .sort((a, b) => a.x - b.x || b.y - a.y)
    .map((i) => i.str.trim())
    .join(' ')
    .replace(/\bd(\w) d(\w)\b/g, 'd$1/d$2')
    .replace(/\s*([()])\s*/g, '$1')
    .replace(/\)(\w)/g, ') $1')
    .replace(/(\w)\(/g, (m, c) => (/[a-z]/i.test(c) && c.length === 1 ? m : `${c} (`))
    .replace(/\s+/g, ' ')
    .replace(/^EXT1 /, '')
    .trim();
}

/** The section tag ("1.07") in the margin beside a question number, if there is one. */
function marginTag(page: PageText, num: TextItem): string | undefined {
  let best: { tag: string; d: number } | undefined;
  for (const it of page.items) {
    const m = TAG.exec(it.str.trim());
    if (!m || !it.sans) continue;
    const side = it.x < num.x - 8 || it.x > page.width * 0.75;
    const d = Math.abs(it.y - num.y);
    if (side && d < 16 && (!best || d < best.d)) best = { tag: m[1], d };
  }
  return best?.tag;
}

function frameAt(list: Frame[], x: number, y: number): Frame | undefined {
  return list.find((f) => x >= f.x0 - 2 && x <= f.x1 && y >= f.top - 4 && y <= f.bottom);
}

/** Bottom of the usable page: above the Foundation/Mastery/Complex key and the footer. */
function pageBottom(page: PageText): number {
  const key = page.items.find((i) => i.str.trim() === 'Foundation' && i.y < 120);
  return key ? top(page, key) - key.h - 4 : page.height - FOOTER;
}

/** Right edge for unframed questions: left of any margin tags on the right. */
function pageRight(page: PageText): number {
  const tags = page.items.filter((i) => i.sans && TAG.test(i.str.trim()) && i.x > page.width * 0.75);
  return tags.length ? Math.min(...tags.map((t) => t.x)) - 8 : page.width - 50;
}

/**
 * Top of the line a question or answer number starts: fractions and powers
 * on that line reach higher than the number itself.
 */
function lineTop(page: PageText, it: TextItem, pad = 2, reach = 0.75): number {
  let y = it.y + it.h;
  for (const o of page.items) {
    if (o.y > it.y + 0.5 && o.y <= it.y + it.h * reach && o.x >= it.x - 2 && o.x < it.x + 250) y = Math.max(y, o.y + o.h);
  }
  return page.height - y - pad;
}

/**
 * Where an answer line starts. Limits on a sum (the 6 over a sigma) and
 * small scripts belong to their own line even when they reach towards the
 * next one, so the cut goes in the gap between the two lines, or just above
 * this line's tallest part when they overlap.
 */
function answerTop(page: PageText, it: TextItem): number {
  const mid = page.width / 2;
  const sameCol = (o: TextItem) => (it.x < mid - 2 ? o.x < mid - 2 : o.x >= mid - 2);
  const col = page.items.filter((o) => sameCol(o) && Math.abs(o.y - it.y) < 45);
  const big = col.filter((o) => o.h >= 12);
  // The line an item sits on: a script hanging off a big sign sits on that sign's line.
  const lineY = (o: TextItem) => {
    if (o.h < it.h * 0.95) {
      const sign = big.find((b) => Math.abs(o.x - b.x) < 15 && Math.abs(o.y - b.y) < 16);
      if (sign) return sign.y;
    }
    return o.y;
  };
  // Font size overstates how far glyphs reach: tops at about 0.75 of it, descenders 0.2 below.
  let ownTop = it.y + it.h * 0.75;
  let prevBottom = Infinity;
  for (const o of col) {
    const y = lineY(o);
    const script =
      o.h < it.h * 0.95 && y === o.y && o.y > it.y && o.y <= it.y + it.h &&
      !col.some((c) => c !== o && c.h >= it.h * 0.95 && Math.abs(c.y - o.y) < 3);
    // Fraction numerators and powers sit up to most of a line above the baseline.
    const raised = y === o.y && o.y > it.y && o.y <= it.y + it.h * 0.9;
    if (Math.abs(y - it.y) < 3.5 || script || raised) ownTop = Math.max(ownTop, o.y + o.h * 0.75);
    else if (y > it.y + 3.5) prevBottom = Math.min(prevBottom, o.y - o.h * 0.2);
  }
  const cut = Number.isFinite(prevBottom) && prevBottom > ownTop ? Math.min((prevBottom + ownTop) / 2, ownTop + 4) : ownTop + 0.3;
  return page.height - cut;
}

const numberTop = (page: PageText, it: TextItem) => lineTop(page, it);
const numberLeft = (it: TextItem) => it.x + it.w / 2 - 10;

function questionRegions(pages: PageText[], frames: (page: number) => Frame[], t: Token, next: Token | undefined, all: Token[]): Region[] {
  const page = pages[t.page];
  const qTop = numberTop(page, t.item);
  const frame = frameAt(frames(t.page), t.item.x, top(page, t.item));
  const right = (p: number, f?: Frame) => (f ? f.x1 - 1.5 : pageRight(pages[p]));
  const bottom = (p: number, f?: Frame) => (f ? f.bottom - 1.5 : pageBottom(pages[p]));
  const regions: Region[] = [];
  // Badges stick out a little left of the number, but never past the frame.
  const x0 = frame ? Math.max(numberLeft(t.item), frame.x0 + 1.5) : numberLeft(t.item);
  if (next && next.page === t.page) {
    regions.push({ page: t.page, x0, x1: right(t.page, frame), top: qTop, bottom: numberTop(page, next.item) - 1 });
    return regions;
  }
  regions.push({ page: t.page, x0, x1: right(t.page, frame), top: qTop, bottom: bottom(t.page, frame) });
  if (next) {
    // Runs on over the page (rarely more than one).
    for (let p = t.page + 1; p <= next.page && p <= t.page + 2; p++) {
      const pg = pages[p];
      const f = frames(p).sort((a, b) => a.top - b.top)[0];
      const onPage = all.filter((o) => o.page === p);
      const left = Math.max(onPage.length ? Math.min(...onPage.map((o) => numberLeft(o.item))) : 50, f ? f.x0 + 1.5 : 0);
      const end = p === next.page ? numberTop(pg, next.item) - 1 : bottom(p, f);
      const start = f && f.top < end ? f.top + 1.5 : HEADER;
      if (end - start > 6) regions.push({ page: p, x0: left, x1: right(p, f), top: start, bottom: end, continued: true });
    }
  } else if (frame && t.page + 1 < pages.length) {
    // Last question: carry on only into a frame at the top of the next page with no other questions in it.
    const p = t.page + 1;
    const f = frames(p).sort((a, b) => a.top - b.top)[0];
    const pg = pages[p];
    if (f && f.top < 90 && !all.some((o) => o.page === p && top(pg, o.item) >= f.top && top(pg, o.item) <= f.bottom)) {
      regions.push({ page: p, x0: f.x0 + 1.5, x1: f.x1 - 1.5, top: f.top + 1.5, bottom: f.bottom - 1.5, continued: true });
    }
  }
  return regions;
}

interface AnswerToken {
  page: number;
  col: number;
  item: TextItem;
  /** A section heading or the end of the chapter: only bounds the answer before it. */
  stop: boolean;
  section: string;
  number: number;
  /** "7, 8 a ...": one answer for two questions. */
  shared?: boolean;
}

/** An answer number, alone or run into its first part letter ("8 a"), or shared ("7,"). */
const ANSWER_NUMBER = /^(\d{1,2})(,)?(?:\s+[a-z])?$/;

/**
 * Finds the answers for one chapter. The first answer page can end the
 * previous chapter and the last can start the next, so only the part under
 * "Chapter N" counts.
 */
export function findAnswers(pages: PageText[], chapter: number, from = answersStart(pages)): BookAnswer[] {
  const tokens: AnswerToken[] = [];
  let inChapter = false;
  let section = '';
  let last = 0;
  for (let p = from; p < pages.length; p++) {
    const page = pages[p];
    const mid = page.width / 2;
    for (let col = 0; col < 2; col++) {
      const items = page.items.filter((i) => (col === 0 ? i.x < mid - 2 : i.x >= mid - 2) && i.y > FOOTER && i.y < page.height - HEADER);
      // Left edge of the column, from the answer numbers and headings (graphs can stick out further).
      const colLeft = Math.min(...items.filter((i) => i.sans && (ANSWER_NUMBER.test(i.str.trim()) || i.h >= 9.5)).map((i) => i.x));
      for (const line of lines(items)) {
        const text = lineText(line);
        const first = line[0];
        const ch = /^Chapter (\d{1,2})$/.exec(text);
        if (ch && first.h >= 11) {
          if (inChapter) tokens.push({ page: p, col, item: first, stop: true, section: '', number: 0 });
          inChapter = Number(ch[1]) === chapter;
          section = '';
          continue;
        }
        if (!inChapter) continue;
        // Headings are bold, a little larger than the answers, and start with a word.
        if (first.sans && first.h >= 9.5 && first.h < 12 && /^[A-Za-z]{3}/.test(first.str.trim())) {
          const ex = /^Exercise (\d{1,2})\.(\d{2})/.exec(text);
          if (ex) section = `${Number(ex[1])}.${ex[2]}`;
          else if (/^Test yourself/i.test(text)) section = `test${chapter}`;
          else if (/^Challenge exercise/i.test(text)) section = `challenge${chapter}`;
          else section = '';
          last = 0;
          tokens.push({ page: p, col, item: first, stop: true, section: '', number: 0 });
          continue;
        }
        if (!section) continue;
        let onLine = false;
        for (const it of line) {
          const s = it.str.trim();
          const m = ANSWER_NUMBER.exec(s);
          if (!it.sans || !m || it.h > 9.5) continue;
          const n = Number(m[1]);
          if (n <= last || n > last + 3) continue;
          // Answers start at the column's left edge, or follow another answer on the same line.
          // Anything else is a label on a graph.
          if (!onLine && it.x - colLeft > 16) continue;
          onLine = true;
          tokens.push({ page: p, col, item: it, stop: false, section, number: n, shared: !!m[2] });
          last = n;
        }
      }
    }
  }
  if (inChapter) tokens.push({ page: pages.length - 1, col: 1, item: { str: '', x: 0, y: 0, w: 0, h: 0 }, stop: true, section: '', number: 0 });

  const answers: BookAnswer[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.stop) continue;
    const page = pages[t.page];
    const mid = page.width / 2;
    const colRight = (col: number, pg: PageText) => (col === 0 ? mid - 4 : pg.width - 30);
    const tTop = answerTop(page, t.item);
    const same = tokens[i + 1];
    const right = same && same.page === t.page && same.col === t.col && Math.abs(same.item.y - t.item.y) < 2.5 ? same.item.x - 3 : colRight(t.col, page);
    // The next thing lower down ends this answer: in this column, or the next column or page.
    const below = tokens.slice(i + 1).find((o) => o.page !== t.page || o.col !== t.col || o.item.y < t.item.y - 2.5);
    const regions: Region[] = [];
    const x0 = t.item.x - 3;
    if (below && below.page === t.page && below.col === t.col) {
      regions.push({ page: t.page, x0, x1: right, top: tTop, bottom: answerTop(page, below.item) - 0.5 });
    } else {
      regions.push({ page: t.page, x0, x1: right, top: tTop, bottom: page.height - FOOTER });
      // Runs into the next column (or page) until the next answer there.
      if (below) {
        let p = t.page;
        let col = t.col;
        for (let step = 0; step < 2; step++) {
          col++;
          if (col > 1) {
            col = 0;
            p++;
          }
          if (p >= pages.length) break;
          const pg = pages[p];
          const colItems = pg.items.filter((it) => (col === 0 ? it.x < pg.width / 2 - 2 : it.x >= pg.width / 2 - 2) && it.y > FOOTER);
          const left = colItems.length ? Math.min(...colItems.map((it) => it.x)) - 3 : col === 0 ? 50 : pg.width / 2;
          const hit = below.page === p && below.col === col;
          const end = hit ? answerTop(pg, below.item) - 0.5 : pg.height - FOOTER;
          if (end - HEADER > 4) regions.push({ page: p, x0: left, x1: colRight(col, pg), top: HEADER, bottom: end, continued: true });
          if (hit || below.page < p || (below.page === p && below.col < col)) break;
        }
      }
    }
    answers.push({ section: t.section, number: t.number, regions, text: regionText(pages, regions, t.item) });
  }
  // "7, 8 a ...": question 7 gets the same answer as 8.
  for (let i = answers.length - 2; i >= 0; i--) {
    const t = tokens.find((o) => !o.stop && o.section === answers[i].section && o.number === answers[i].number);
    const next = answers[i + 1];
    if (t?.shared && next.section === answers[i].section) {
      const [first, ...rest] = next.regions;
      answers[i] = { ...answers[i], regions: [{ ...first, x0: Math.min(first.x0, answers[i].regions[0].x0) }, ...rest], text: next.text };
    }
  }
  return answers;
}

function regionText(pages: PageText[], regions: Region[], skip: TextItem): string {
  const parts: string[] = [];
  for (const r of regions) {
    const pg = pages[r.page];
    const inside = pg.items.filter((i) => i !== skip && i.x >= r.x0 && i.x < r.x1 && top(pg, i) > r.top && top(pg, i) <= r.bottom + 1);
    for (const l of lines(inside)) parts.push(lineText(l));
  }
  return parts.join('\n');
}

/** The letter from a multiple choice answer like "B", or null. */
export function answerLetter(text: string): string | null {
  const m = /^\s*([A-D])\s*$/.exec(text.split('\n')[0] ?? '');
  return m ? m[1] : null;
}

// ---- Pixels -------------------------------------------------------------

/** Orange frame lines: about rgb(245, 121, 37). */
function isFrameColour(r: number, g: number, b: number): boolean {
  return r > 215 && g > 85 && g < 160 && b < 90;
}

/**
 * Finds the orange exercise frames on a rendered page: pairs of long orange
 * vertical lines with the same top and bottom. scale is pixels per PDF unit.
 */
export function findFrames(p: Pixels, scale: number): Frame[] {
  const minRun = Math.round(40 * scale);
  const segs: { x: number; y0: number; y1: number }[] = [];
  for (let x = 0; x < p.width; x++) {
    let start = -1;
    for (let y = 0; y <= p.height; y++) {
      const i = (y * p.width + x) * 4;
      const on = y < p.height && isFrameColour(p.data[i], p.data[i + 1], p.data[i + 2]);
      if (on && start < 0) start = y;
      if (!on && start >= 0) {
        if (y - start >= minRun) segs.push({ x, y0: start, y1: y });
        start = -1;
      }
    }
  }
  // Lines are a few pixels thick: keep the first column of each.
  const lines = segs.filter((s) => !segs.some((o) => o.x === s.x - 1 && Math.abs(o.y0 - s.y0) < 4 && Math.abs(o.y1 - s.y1) < 4));
  const out: Frame[] = [];
  for (const a of lines) {
    const b = lines.find((o) => o.x - a.x > 150 * scale && Math.abs(o.y0 - a.y0) < 6 && Math.abs(o.y1 - a.y1) < 6);
    if (b && !out.some((f) => Math.abs(f.x0 - a.x / scale) < 2 && Math.abs(f.top - a.y0 / scale) < 2)) {
      out.push({ x0: a.x / scale, x1: b.x / scale, top: a.y0 / scale, bottom: a.y1 / scale });
    }
  }
  return out;
}

/** The level from the colour of the badge behind a question number, or null if there is no badge. */
export function levelOf(p: Pixels, mark: Pick<Mark, 'x' | 'y'>, scale: number): Level | null {
  const counts = { foundation: 0, mastery: 0, complex: 0 };
  const cx = mark.x * scale;
  const cy = mark.y * scale;
  const r = 7 * scale;
  for (let y = Math.max(0, Math.round(cy - r)); y < Math.min(p.height, cy + r); y++) {
    for (let x = Math.max(0, Math.round(cx - r)); x < Math.min(p.width, cx + r); x++) {
      const i = (y * p.width + x) * 4;
      const R = p.data[i];
      const G = p.data[i + 1];
      const B = p.data[i + 2];
      if (Math.max(R, G, B) - Math.min(R, G, B) < 70 || isFrameColour(R, G, B)) continue;
      if (G > R + 30 && G > B) counts.foundation++;
      else if (B > R + 60 && B > G) counts.mastery++;
      else if (R > G + 90 && R > B + 60) counts.complex++;
    }
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n >= 12 * scale * scale ? (best as Level) : null;
}
