import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { parseQuestionsFile, questionHeading, subjectName } from '../src/lib/practice/qfile';

const SAMPLE = `---
subject: Chemistry
from: 2023 Trial Paper
---

## Le Chatelier's principle
topic: Module 5 Equilibrium

### Q21 · 3 marks
Explain what happens to $K_{eq}$ when temperature rises.

#### Answer
It depends on whether the forward reaction is exothermic.

### Q3 · MC
Which change shifts the equilibrium right?

#### Answer
B

## Skill: Geometric series
subject: Maths Adv

### 2019 HSC Q12a | 2 marks
Find $S_{10}$.

#### Solution
$S_{10} = 1023$
`;

describe('questions file', () => {
  it('reads skills, questions and answers', () => {
    const f = parseQuestionsFile(SAMPLE);
    expect(f.from).toBe('2023 Trial Paper');
    expect(f.problems).toEqual([]);
    expect(f.skills.map((s) => [s.subject, s.name, s.topic, s.questions.length])).toEqual([
      ['Chemistry', "Le Chatelier's principle", 'Module 5 Equilibrium', 2],
      ['Maths Advanced', 'Geometric series', '', 1],
    ]);
    const q = f.skills[0].questions[0];
    expect(q.label).toBe('Q21');
    expect(q.marks).toBe(3);
    expect(q.questionText).toContain('K_{eq}');
    expect(q.solutionText).toBe('It depends on whether the forward reaction is exothermic.');
    expect(f.skills[0].questions[1]).toMatchObject({ mc: true, marks: 1, solutionText: 'B' });
    expect(f.skills[1].questions[0]).toMatchObject({ label: '2019 HSC Q12a', marks: 2, solutionText: '$S_{10} = 1023$' });
  });

  it('flags missing subjects and empty files', () => {
    expect(parseQuestionsFile('## Thing\n\n### Q1\nWhat?\n#### Answer\nThis').problems[0]).toMatch(/no subject/);
    expect(parseQuestionsFile('just text').problems[0]).toMatch(/No questions/);
  });

  it('reads headings and subject names', () => {
    expect(questionHeading('Question 4 (5 marks)')).toEqual({ label: 'Question 4', marks: 5, mc: false });
    expect(questionHeading('Question 4 · (5 marks)')).toEqual({ label: 'Question 4', marks: 5, mc: false });
    expect(subjectName('ext1')).toBe('Maths Extension 1');
    expect(subjectName('Physics')).toBe('');
  });
});

describe('questions in several skills', () => {
  it('groups each question under every skill it goes into', async () => {
    const { groupBySkill, choiceFor, MAIN_SKILL } = await import('../src/lib/practice/save');
    const a: { n: number; skills?: string[] } = { n: 1 };
    const b = { n: 2, skills: ['s1', MAIN_SKILL] };
    const c = { n: 3, skills: ['s1', 'new:Vectors', 's1'] };
    const groups = groupBySkill([a, b, c]);
    expect([...groups.keys()]).toEqual([MAIN_SKILL, 's1', 'new:Vectors']);
    expect(groups.get(MAIN_SKILL)!.map((x) => x.n)).toEqual([1, 2]);
    expect(groups.get('s1')!.map((x) => x.n)).toEqual([2, 3]);
    const main = { kind: 'existing', id: 'm' } as const;
    expect(choiceFor(MAIN_SKILL, main, 'Maths Extension 1')).toBe(main);
    expect(choiceFor('s1', main, 'Maths Extension 1')).toEqual({ kind: 'existing', id: 's1' });
    expect(choiceFor('new:Vectors', main, 'Maths Extension 1')).toEqual({ kind: 'new', subject: 'Maths Extension 1', name: 'Vectors' });
  });

  it('saves a copy into each skill', async () => {
    const { saveProblems } = await import('../src/lib/practice/save');
    const { listProblems } = await import('../src/lib/db');
    const draft = { questionText: 'Find $x$.', solutionText: '$x=2$', label: 'Q1', marks: 2, mc: false, key: 'typed:multi-skill' };
    const one = await saveProblems({ kind: 'new', subject: 'Maths Advanced', name: 'Multi A' }, [draft], 'typed', 'test');
    const two = await saveProblems({ kind: 'new', subject: 'Maths Advanced', name: 'Multi B' }, [draft], 'typed', 'test');
    expect(one.added).toBe(1);
    expect(two.added).toBe(1);
    const all = (await listProblems()).filter((p) => p.label === 'Q1' && p.from === 'test');
    expect(new Set(all.map((p) => p.skillId))).toEqual(new Set([one.skill.id, two.skill.id]));
  });
});
