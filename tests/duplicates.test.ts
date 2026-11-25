import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  findDuplicates,
  fingerprintFromPixels,
  normaliseQuestion,
  pairKey,
  pictureSimilarity,
  similarity,
} from '../src/lib/practice/duplicates';
import { groupBySkill, saveProblems, choiceFor } from '../src/lib/practice/save';
import { DB_NAME, listAttempts, listProblems, mergeProblems, recordAttempt, resetDbConnection } from '../src/lib/db';
import type { Problem, Skill } from '../src/lib/types';

describe('normalising question text', () => {
  it('ignores spacing, capitals and Markdown', () => {
    expect(normaliseQuestion('**Calculate** the  mass of 2.5 mol of water.')).toBe(
      normaliseQuestion('calculate the mass of 2.5 mol of water'),
    );
  });

  it('ignores maths and chemistry formatting', () => {
    const a = normaliseQuestion('Calculate the pH of a $0.01\\ \\text{mol L}^{-1}$ solution of $\\ce{HCl}$.');
    const b = normaliseQuestion('Calculate the pH of a 0.01 mol L⁻¹ solution of HCl');
    expect(a).toBe(b);
    expect(normaliseQuestion('Balance $\\ce{H2 + O2 -> H2O}$')).toBe(normaliseQuestion('Balance H₂ + O₂ → H₂O'));
  });

  it('keeps the numbers and operators that make questions different', () => {
    expect(normaliseQuestion('Solve $2x+1=5$')).not.toBe(normaliseQuestion('Solve $2x-1=5$'));
    expect(normaliseQuestion('Find 2.5 mol')).not.toBe(normaliseQuestion('Find 25 mol'));
  });

  it('scores close wording high and different wording low', () => {
    const a = normaliseQuestion('Explain why the boiling point of water is higher than hydrogen sulfide.');
    const b = normaliseQuestion('Explain why the boiling point of water is higher than that of hydrogen sulfide.');
    const c = normaliseQuestion('Describe a test to tell an alkene from an alkane using bromine water.');
    expect(similarity(a, b)).toBeGreaterThan(0.92);
    expect(similarity(a, c)).toBeLessThan(0.5);
  });
});

const skill = (id: string, subject = 'Chemistry'): Skill => ({ id, subject, name: id }) as Skill;
let n = 0;
const problem = (skillId: string, fields: Partial<Problem>): Problem => ({
  id: `p${++n}`,
  skillId,
  source: 'typed',
  label: 'Q',
  from: '',
  key: `${skillId}|typed:${fields.questionText ?? n}`,
  marks: 1,
  mc: false,
  questionImage: '',
  order: n,
  created: n * 86_400_000,
  ...fields,
});

describe('finding duplicates', () => {
  const skills = [skill('acids'), skill('moles'), skill('vectors', 'Maths Extension 1')];

  it('finds the same question typed with different formatting', () => {
    const a = problem('acids', { questionText: 'Calculate the pH of $0.01$ mol/L $\\ce{HCl}$.' });
    const b = problem('acids', { questionText: 'calculate the pH of 0.01 mol/L HCl' });
    const c = problem('acids', { questionText: 'Define a Brønsted–Lowry acid.' });
    const groups = findDuplicates([a, b, c], skills);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('same');
    expect(groups[0].problems.map((p) => p.id)).toEqual([a.id, b.id]);
  });

  it('finds almost the same wording and the same question in another skill', () => {
    const a = problem('acids', { questionText: 'Explain why the boiling point of water is higher than hydrogen sulfide.' });
    const b = problem('moles', { questionText: 'Explain why the boiling point of water is higher than that of hydrogen sulfide.' });
    const groups = findDuplicates([a, b], skills);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('close');
  });

  it('leaves out copies made by putting one question into several skills', () => {
    const a = problem('acids', { questionText: 'Same', key: 'acids|typed:Same question text here', created: 1000 });
    const b = problem('moles', { questionText: 'Same', key: 'moles|typed:Same question text here', created: 1200 });
    expect(findDuplicates([a, b], skills)).toHaveLength(0);
    // The same question added again to another skill weeks later is a duplicate.
    expect(findDuplicates([a, { ...b, created: 1000 + 30 * 86_400_000 }], skills)).toHaveLength(1);
    expect(findDuplicates([a, b], skills)).toHaveLength(0);
  });

  it('only compares within a subject and skips pairs marked as different', () => {
    const a = problem('acids', { questionText: 'Find the magnitude of the vector 3i + 4j.' });
    const b = problem('vectors', { questionText: 'Find the magnitude of the vector 3i + 4j.' });
    expect(findDuplicates([a, b], skills)).toHaveLength(0);
    const c = problem('moles', { questionText: 'Find the magnitude of the vector 3i + 4j.' });
    expect(findDuplicates([a, c], skills)).toHaveLength(1);
    expect(findDuplicates([a, c], skills, new Map(), [pairKey(c.id, a.id)])).toHaveLength(0);
  });

  it('matches pictures that look the same', () => {
    // A made up "page" of text lines; the copy has more margin and slight noise.
    const page = (seed: number, pad: number, noise = 0) => {
      // Lines of "words": dark blocks of random width with gaps, from a seeded random source.
      let r = seed;
      const rand = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
      const w = 400 + pad * 2, h = 60 + pad * 2;
      const g = new Uint8Array(w * h).fill(255);
      for (let line = 0; line < 3; line++) {
        let x = 0;
        while (x < 400) {
          const word = 10 + Math.floor(rand() * 40);
          for (let y = line * 20; y < line * 20 + 12; y++) for (let i = x; i < Math.min(400, x + word); i++) g[(y + pad) * w + i + pad] = 20 + (noise ? (i * y) % noise : 0);
          x += word + 6 + Math.floor(rand() * 10);
        }
      }
      return fingerprintFromPixels(g, w, h);
    };
    const f1 = page(1, 4);
    const f2 = page(1, 30, 40);
    const f3 = page(2, 4);
    expect(pictureSimilarity(f1, f2)).toBeGreaterThan(0.95);
    expect(pictureSimilarity(f1, f3)).toBeLessThan(0.8);
    expect(pictureSimilarity(f1, { ...f1, ratio: f1.ratio * 2 })).toBe(0);
    const a = problem('acids', { questionImage: 'i1', source: 'atarnotes' });
    const b = problem('acids', { questionImage: 'i2', source: 'atarnotes' });
    const c = problem('acids', { questionImage: 'i3', source: 'atarnotes' });
    const prints = new Map([['i1', f1], ['i2', f2], ['i3', f3]]);
    const groups = findDuplicates([a, b, c], skills, prints);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('picture');
    expect(groups[0].problems.map((p) => p.id)).toEqual([a.id, b.id]);
    // Two look-alike questions from the same textbook chapter are different questions.
    const t1 = { ...a, source: 'textbook' as const, from: 'Ch 1' };
    const t2 = { ...b, source: 'textbook' as const, from: 'Ch 1' };
    expect(findDuplicates([t1, t2], skills, prints)).toHaveLength(0);
    // A third copy that looks like both is paired with the closer one only.
    const t3 = { ...problem('acids', { questionImage: 'i4', source: 'atarnotes' }), from: 'Topic test' };
    const both = findDuplicates([t1, t2, t3], skills, new Map([...prints, ['i4', f1]]));
    expect(both).toHaveLength(1);
    expect(both[0].problems.map((p) => p.id).sort()).toEqual([t1.id, t3.id].sort());
  });
});

describe('saving and merging', () => {
  beforeEach(async () => {
    await resetDbConnection();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  });

  const typed = (questionText: string) => ({ questionText, solutionText: 'x', label: 'Q', marks: 2, mc: false, key: `typed:${questionText}` });

  it('skips a typed question already in the skill with different formatting', async () => {
    const first = await saveProblems({ kind: 'new', subject: 'Chemistry', name: 'Acids' }, [typed('Calculate the pH of $\\ce{HCl}$.')], 'typed', 'f');
    const again = await saveProblems(
      { kind: 'existing', id: first.skill.id },
      [typed('calculate the pH of HCl'), typed('calculate  the pH of HCl!'), typed('Define an acid.')],
      'typed',
      'f',
    );
    expect(again.added).toBe(1);
    expect(again.skipped).toBe(2);
  });

  it('still puts one question into several skills', async () => {
    const draft = { ...typed('Calculate the pH of HCl.'), skills: ['new:Acids', 'new:Titration'] };
    for (const [target, group] of groupBySkill([draft])) await saveProblems(choiceFor(target, { kind: 'new', subject: 'Chemistry', name: 'Main' }, 'Chemistry'), group, 'typed', 'f');
    expect(await listProblems()).toHaveLength(2);
  });

  it('keeps one copy and moves the goes from the others to it', async () => {
    const r = await saveProblems({ kind: 'new', subject: 'Chemistry', name: 'Acids' }, [typed('One'), typed('Two')], 'typed', 'f');
    const [keep, drop] = await listProblems(r.skill.id);
    await recordAttempt(r.skill, { id: 'a1', problemId: drop.id, skillId: r.skill.id, at: 1, rating: 3, method: 'yes', seconds: 60, stateBefore: 2 } as never);
    await mergeProblems(keep.id, [drop.id]);
    expect((await listProblems()).map((p) => p.id)).toEqual([keep.id]);
    expect((await listAttempts())[0].problemId).toBe(keep.id);
  });
});
