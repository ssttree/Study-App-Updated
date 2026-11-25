import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyEdit, copiesOf, editFor, editForCopy, editProblemError } from '../src/lib/practice/edit';
import { saveProblems } from '../src/lib/practice/save';
import { DB_NAME, getImage, listProblems, newId, resetDbConnection, updateProblems } from '../src/lib/db';
import type { Problem } from '../src/lib/types';

const PIC = { data: 'data:image/png;base64,AAAA', width: 10, height: 5 };

function problem(fields: Partial<Problem> = {}): Problem {
  return { id: 'p1', skillId: 's1', source: 'smartered', label: 'Q1', from: 'Sheet', key: 's1|k', marks: 2, mc: false, questionImage: 'qi', solutionImage: 'si', order: 1, created: 1, ...fields };
}

let n = 0;
const ids = () => `new${++n}`;

describe('editing a question', () => {
  beforeEach(() => (n = 0));

  it('changes nothing when saved as it was', () => {
    const p = problem({ mc: true, answerLetter: 'B' });
    const out = applyEdit(p, editFor(p), ids);
    expect(out.problem).toEqual(p);
    expect(out.add).toEqual([]);
    expect(out.remove).toEqual([]);
  });

  it('saves a new picture under a new id and drops the old one', () => {
    const p = problem();
    const out = applyEdit(p, { ...editFor(p), solution: { kind: 'image', id: 'si', picture: PIC } }, ids);
    expect(out.problem.solutionImage).toBe('new1');
    expect(out.add).toEqual([{ id: 'new1', ...PIC }]);
    expect(out.remove).toEqual(['si']);
  });

  it('turns a picture into typed text', () => {
    const p = problem();
    const out = applyEdit(p, { ...editFor(p), question: { kind: 'text', text: ' $x^2$ ' } }, ids);
    expect(out.problem.questionText).toBe('$x^2$');
    expect(out.problem.questionImage).toBe('');
    expect(out.remove).toEqual(['qi']);
  });

  it('can remove the answer', () => {
    const p = problem();
    const out = applyEdit(p, { ...editFor(p), solution: { kind: 'none' } }, ids);
    expect('solutionImage' in out.problem).toBe(false);
    expect(out.remove).toEqual(['si']);
  });

  it('fixes the letter, marks and label', () => {
    const p = problem({ mc: true, answerLetter: 'A' });
    const out = applyEdit(p, { ...editFor(p), answerLetter: 'C', marks: 0, label: ' 2020 HSC Q3 ' }, ids);
    expect(out.problem).toMatchObject({ answerLetter: 'C', marks: 1, label: '2020 HSC Q3' });
    const notMc = applyEdit(p, { ...editFor(p), mc: false }, ids);
    expect(notMc.problem.answerLetter).toBeUndefined();
  });

  it('needs a question', () => {
    const p = problem();
    expect(editProblemError(editFor(p))).toBe('');
    expect(editProblemError({ ...editFor(p), question: { kind: 'text', text: '  ' } })).not.toBe('');
    expect(editProblemError({ ...editFor(p), solution: { kind: 'image' } })).not.toBe('');
  });

  it('finds the copies of a question in other skills', () => {
    const p = problem();
    const all = [p, problem({ id: 'p2', skillId: 's2', key: 's2|k' }), problem({ id: 'p3', skillId: 's2', key: 's2|other' })];
    expect(copiesOf(p, all).map((c) => c.id)).toEqual(['p2']);
    expect(copiesOf(problem({ key: 'old-key' }), all)).toEqual([]);
  });

  it('gives a copy its own pictures', async () => {
    const p = problem();
    const copy = problem({ id: 'p2', skillId: 's2', key: 's2|k', questionImage: 'qi2', solutionImage: 'si2' });
    // Question kept, solution swapped for a new picture.
    const edit = { ...editFor(p), solution: { kind: 'image' as const, picture: PIC } };
    const forCopy = await editForCopy(edit, p, copy, async () => PIC);
    const out = applyEdit(copy, forCopy, ids);
    expect(out.problem.questionImage).toBe('qi2');
    expect(out.problem.solutionImage).toBe('new1');
    expect(out.remove).toEqual(['si2']);
  });
});

describe('saving an edited question', () => {
  beforeEach(async () => {
    await resetDbConnection();
    indexedDB.deleteDatabase(DB_NAME);
  });

  it('stores the change and its picture together', async () => {
    await saveProblems({ kind: 'new', subject: 'Chemistry', name: 'Moles' }, [{ question: PIC, solution: PIC, label: 'Q1', marks: 2, mc: false, key: 'k' }], 'snip', 'Sheet');
    const [p] = await listProblems();
    const out = applyEdit(p, { ...editFor(p), solution: { kind: 'text', text: 'n = m/M' } }, newId);
    await updateProblems([out]);
    const [after] = await listProblems();
    expect(after.solutionText).toBe('n = m/M');
    expect(after.solutionImage).toBeUndefined();
    expect(await getImage(p.solutionImage!)).toBeUndefined();
    expect(await getImage(p.questionImage)).toBeDefined();
  });
});
