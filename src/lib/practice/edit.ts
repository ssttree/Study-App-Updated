// Fixing a saved question: its label, marks, multiple choice letter, level,
// and the question and answer themselves (typed text or a picture).

import type { Problem, ProblemLevel, StoredImage } from '../types';

/** One side of a question: typed text, a picture, or (answers only) nothing saved. */
export type ProblemPart =
  | { kind: 'text'; text: string }
  /** `id` is a picture already saved; `picture` is a new one to save. */
  | { kind: 'image'; id?: string; picture?: { data: string; width: number; height: number } }
  | { kind: 'none' };

export interface ProblemEdit {
  label: string;
  marks: number;
  mc: boolean;
  answerLetter?: string;
  level?: ProblemLevel;
  question: ProblemPart;
  solution: ProblemPart;
}

/** What the editor starts with for a saved question. */
export function editFor(p: Problem): ProblemEdit {
  return {
    label: p.label,
    marks: p.marks,
    mc: p.mc,
    answerLetter: p.answerLetter,
    level: p.level,
    question: p.questionText ? { kind: 'text', text: p.questionText } : p.questionImage ? { kind: 'image', id: p.questionImage } : { kind: 'text', text: '' },
    solution: p.solutionText ? { kind: 'text', text: p.solutionText } : p.solutionImage ? { kind: 'image', id: p.solutionImage } : { kind: 'none' },
  };
}

/** Why the edit can't be saved yet, or '' when it can. */
export function editProblemError(edit: ProblemEdit): string {
  const q = edit.question;
  if (q.kind === 'none' || (q.kind === 'text' && !q.text.trim()) || (q.kind === 'image' && !q.id && !q.picture)) {
    return 'The question needs some text or a picture.';
  }
  const s = edit.solution;
  if (s.kind === 'image' && !s.id && !s.picture) return 'Paste or choose a picture for the answer, or pick No answer.';
  return '';
}

export interface AppliedEdit {
  problem: Problem;
  /** New pictures to save. */
  add: StoredImage[];
  /** Pictures no longer used by this question, to delete. */
  remove: string[];
}

/**
 * The question with the edit applied. A changed picture gets a new id rather than
 * being overwritten, because pictures sync by id and are never changed once saved.
 */
export function applyEdit(p: Problem, edit: ProblemEdit, newId: () => string): AppliedEdit {
  const add: StoredImage[] = [];
  const remove: string[] = [];

  function side(part: ProblemPart, oldImage: string | undefined): { image?: string; text?: string } {
    if (part.kind === 'text' && part.text.trim()) {
      if (oldImage) remove.push(oldImage);
      return { text: part.text.trim() };
    }
    if (part.kind === 'image' && part.picture) {
      const img: StoredImage = { id: newId(), ...part.picture };
      add.push(img);
      if (oldImage) remove.push(oldImage);
      return { image: img.id };
    }
    if (part.kind === 'image' && part.id) {
      if (oldImage && oldImage !== part.id) remove.push(oldImage);
      return { image: part.id };
    }
    if (oldImage) remove.push(oldImage);
    return {};
  }

  const q = side(edit.question, p.questionImage || undefined);
  const s = side(edit.solution, p.solutionImage);
  const marks = Math.max(1, Math.min(25, Math.round(Number(edit.marks) || 1)));
  const letter = edit.mc && edit.answerLetter && /^[A-D]$/.test(edit.answerLetter) ? edit.answerLetter : undefined;
  const problem: Problem = {
    ...p,
    label: edit.label.trim(),
    marks,
    mc: edit.mc,
    answerLetter: letter,
    level: edit.level,
    questionImage: q.image ?? '',
    questionText: q.text,
    solutionImage: s.image,
    solutionText: s.text,
  };
  // Leave out empty optional fields, so the saved record stays tidy.
  for (const k of ['answerLetter', 'level', 'questionText', 'solutionImage', 'solutionText'] as const) {
    if (problem[k] === undefined) delete problem[k];
  }
  return { problem, add, remove };
}

/** The part of a key that is the same for every copy of a question (keys are "skillId|..."). */
function sharedKey(key: string): string | null {
  const i = key.indexOf('|');
  return i > 0 && i < key.length - 1 ? key.slice(i + 1) : null;
}

/** The same question saved into other skills, which the edit can fix too. */
export function copiesOf(p: Problem, all: Problem[]): Problem[] {
  const k = sharedKey(p.key);
  if (!k) return [];
  return all.filter((o) => o.id !== p.id && sharedKey(o.key) === k);
}

/**
 * The same edit for another copy of the question. A picture the edit kept as it
 * was stays as that copy's own picture; any other saved picture is copied across
 * (each copy keeps its own pictures, so deleting one copy never breaks another).
 */
export async function editForCopy(
  edit: ProblemEdit,
  original: Problem,
  copy: Problem,
  loadPicture: (id: string) => Promise<{ data: string; width: number; height: number } | undefined>,
): Promise<ProblemEdit> {
  async function side(part: ProblemPart, originalImage: string | undefined, copyImage: string | undefined): Promise<ProblemPart> {
    if (part.kind !== 'image' || part.picture || !part.id) return part;
    if (part.id === originalImage && copyImage) return { kind: 'image', id: copyImage };
    const picture = await loadPicture(part.id);
    return picture ? { kind: 'image', picture } : part;
  }
  return {
    ...edit,
    question: await side(edit.question, original.questionImage || undefined, copy.questionImage || undefined),
    solution: await side(edit.solution, original.solutionImage, copy.solutionImage),
  };
}
