import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  answerLetter,
  chapterFromName,
  findAnswers,
  findFrames,
  findQuestions,
  levelOf,
  looksLikeTextbook,
  type Frame,
} from '../src/lib/practice/textbook';
import { levelChosen, withLevels } from '../src/lib/practice/mix';
import type { PageText } from '../src/lib/practice/smartered';
import type { Problem } from '../src/lib/types';

// Layout only (question numbers, headings, margin tags, page footers and the
// orange frames found in the page pictures) from two Maths In Focus Extension 1
// chapters. The book's sentences are left out.
const load = (name: string) => {
  const raw = JSON.parse(readFileSync(new URL(`./fixtures/textbook/${name}.json`, import.meta.url), 'utf8'));
  return { pages: raw.pages as PageText[], frames: (p: number) => (raw.frames[p] ?? []) as Frame[] };
};

describe('textbook chapters', () => {
  it('finds every exercise, its title and its questions in chapter 1', () => {
    const { pages, frames } = load('ch01');
    expect(looksLikeTextbook(pages)).toBe(true);
    const book = findQuestions(pages, frames, 'Ext 1 Ch 01 Sequences and series.pdf');
    expect(book.chapter).toBe(1);
    expect(book.title).toBe('Sequences and series');
    expect(book.book).toBe('Maths in Focus: Year 12 Mathematics Extension 1');
    expect(book.sections.map((s) => s.key)).toEqual([
      '1.01', '1.02', '1.03', '1.04', '1.05', '1.06', '1.07', '1.08', '1.09', '1.10', 'test1', 'challenge1',
    ]);
    expect(book.sections.find((s) => s.key === '1.04')!.title).toBe('Arithmetic series');
    // "EXT1" sits in front of the title of the Extension 1 section.
    expect(book.sections.find((s) => s.key === '1.10')!.title).toBe('Proof by mathematical induction');
    const count = (key: string) => book.questions.filter((q) => q.section === key).map((q) => q.number);
    expect(count('1.01')).toEqual([...Array(27).keys()].map((i) => i + 1));
    expect(count('1.03')).toHaveLength(31);
    expect(count('test1')).toHaveLength(31);
    expect(count('challenge1')).toHaveLength(16);
  });

  it('keeps each question inside its orange frame and runs it over the page when needed', () => {
    const { pages, frames } = load('ch01');
    const book = findQuestions(pages, frames);
    const q10 = book.questions.find((q) => q.section === '1.01' && q.number === 10)!;
    // The last question on the page stops at the frame, above the Foundation/Mastery/Complex key.
    const frame = frames(q10.regions[0].page)[0];
    expect(q10.regions[0].bottom).toBeLessThanOrEqual(frame.bottom);
    expect(q10.regions[0].x1).toBeLessThanOrEqual(frame.x1);
    // Q11 starts the next page.
    const q11 = book.questions.find((q) => q.section === '1.01' && q.number === 11)!;
    expect(q11.regions[0].page).toBe(q10.regions[0].page + 1);
  });

  it('reads the Test yourself tags and multiple choice questions', () => {
    const { pages, frames } = load('ch01');
    const book = findQuestions(pages, frames);
    const test = book.questions.filter((q) => q.section === 'test1');
    expect(test.slice(0, 4).map((q) => q.tag)).toEqual(['1.07', '1.08', '1.03', '1.08']);
    expect(test.filter((q) => q.mc).map((q) => q.number)).toEqual([1, 2, 3, 4, 5]);
    expect(book.questions.filter((q) => q.section !== 'test1').every((q) => !q.tag && !q.mc)).toBe(true);
  });

  it('matches every question to its answer', () => {
    const { pages, frames } = load('ch01');
    const book = findQuestions(pages, frames);
    const answers = findAnswers(pages, book.chapter, book.answersFrom);
    for (const q of book.questions) {
      expect(answers.find((a) => a.section === q.section && a.number === q.number), `${q.section} Q${q.number}`).toBeDefined();
    }
    // Answers from the next chapter on the same page are left out.
    expect(answers.every((a) => a.section.startsWith('1.') || a.section.endsWith('1'))).toBe(true);
    // "28 26   29 122b   30 38th term": three answers on one line, each its own box.
    const [a28, a29] = ['1.03', '1.03'].map((s, i) => answers.find((a) => a.section === s && a.number === 28 + i)!);
    expect(a28.regions[0].x1).toBeLessThan(a29.regions[0].x0 + 5);
    expect(answerLetter(answers.find((a) => a.section === 'test1' && a.number === 1)!.text)).toBe('C');
  });

  it('reads section titles with fractions in them and pairs a whole chapter', () => {
    const { pages, frames } = load('ch12');
    const book = findQuestions(pages, frames, 'Ext 1 Ch 12 Differential equations.pdf');
    expect(book.sections.map((s) => s.title).slice(0, 4)).toEqual([
      'Slope fields',
      'Solving dy/dx = f(x)',
      'Solving dy/dx = g(y)',
      'Solving dy/dx = f(x) g(y)',
    ]);
    const answers = findAnswers(pages, book.chapter, book.answersFrom);
    const missing = book.questions.filter((q) => !answers.some((a) => a.section === q.section && a.number === q.number));
    expect(missing).toEqual([]);
    expect(book.questions.length).toBeGreaterThan(70);
  });

  it('gets the chapter from the file name', () => {
    expect(chapterFromName('Ext 1 Ch 03 Trigonometric functions.pdf')).toEqual({ chapter: 3, title: 'Trigonometric functions' });
    expect(chapterFromName('worksheet.pdf')).toBeNull();
  });
});

describe('page pixels', () => {
  const blank = (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255), width: w, height: h });
  const paint = (p: ReturnType<typeof blank>, x0: number, y0: number, x1: number, y1: number, rgb: number[]) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * p.width + x) * 4;
        [p.data[i], p.data[i + 1], p.data[i + 2]] = rgb;
      }
  };

  it('finds an orange frame', () => {
    const p = blank(600, 400);
    const orange = [245, 121, 37];
    paint(p, 50, 20, 52, 380, orange);
    paint(p, 500, 20, 502, 380, orange);
    paint(p, 50, 378, 502, 380, orange);
    expect(findFrames(p, 1)).toEqual([{ x0: 50, x1: 500, top: 20, bottom: 380 }]);
  });

  it('tells the levels apart by badge colour', () => {
    const p = blank(100, 40);
    paint(p, 5, 5, 25, 25, [16, 160, 80]); // green square
    paint(p, 40, 5, 60, 25, [20, 115, 180]); // blue circle
    paint(p, 75, 5, 95, 25, [210, 35, 40]); // red hexagon
    expect(levelOf(p, { x: 15, y: 15 }, 1)).toBe('foundation');
    expect(levelOf(p, { x: 50, y: 15 }, 1)).toBe('mastery');
    expect(levelOf(p, { x: 85, y: 15 }, 1)).toBe('complex');
    expect(levelOf(blank(40, 40), { x: 20, y: 20 }, 1)).toBeNull();
  });
});

describe('level filter', () => {
  const problem = (id: string, level?: Problem['level']) => ({ id, level }) as Problem;

  it('keeps questions at the chosen levels and any without a level', () => {
    expect(levelChosen(problem('a', 'complex'), ['foundation'])).toBe(false);
    expect(levelChosen(problem('b'), ['foundation'])).toBe(true);
    expect(levelChosen(problem('c', 'complex'), undefined)).toBe(true);
    const data = { skills: [], attempts: [], plans: [], problems: [problem('a', 'foundation'), problem('b', 'mastery'), problem('c')] };
    expect(withLevels(data, ['mastery']).problems.map((p) => p.id)).toEqual(['b', 'c']);
    expect(withLevels(data, undefined)).toBe(data);
  });
});
