// Turns one SmarterEd PDF into question and solution pictures, ready to
// check and save. Pairs that look fine are ticked straight away; the review
// screen only asks about the ones the app is unsure of.

import { OpenPdf } from './pdf';
import { findEntries, looksLikeSmarterEd, pairEntries, type Entry, type Worksheet } from './smartered';
import type { DraftProblem, Picture } from './save';

export interface DraftPair extends DraftProblem {
  number: number;
  header: string;
  /** Why the app wants you to look at this one. Empty means it looked fine. */
  problems: string[];
  include: boolean;
}

export interface AnalysedSheet {
  pdf: OpenPdf;
  sheet: Worksheet;
  smarterEd: boolean;
  pairs: DraftPair[];
}

const TALL = 2.2;

export async function analyseSheet(file: File, onProgress?: (done: number, total: number) => void): Promise<AnalysedSheet> {
  const pdf = await OpenPdf.open(file);
  const text = await pdf.text();
  const sheet = findEntries(text, file.name);
  const smarterEd = looksLikeSmarterEd(text);
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
