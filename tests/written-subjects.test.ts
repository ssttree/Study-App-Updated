import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildDailyMix, costMinutes, newSkill, workMinutes } from '../src/lib/practice/mix';
import { addStarterSkills, saveProblems } from '../src/lib/practice/save';
import { guessOtherSubject, practiceStyle, STARTER_SKILLS } from '../src/lib/practice/subjects';
import { DB_NAME, deleteSkill, listImages, listProblems, listSkills, resetDbConnection } from '../src/lib/db';
import type { Problem } from '../src/lib/types';

const NOW = Date.UTC(2026, 9, 29, 8);

beforeEach(async () => {
  await resetDbConnection();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});

describe('Business and Engineering timing', () => {
  it('caps Business Studies at a 5 minute dot-point plan', () => {
    expect(costMinutes({ marks: 20 }, 'Business Studies')).toBe(5.5);
    expect(costMinutes({ marks: 2 }, 'Business Studies')).toBe(3.5);
    expect(workMinutes({ marks: 4 }, 'Business Studies')).toBe(5);
  });

  it('keeps 1.5 minutes a mark for Engineering, which has calculations', () => {
    expect(costMinutes({ marks: 4 }, 'Engineering Studies')).toBe(6.5);
    expect(costMinutes({ marks: 4 })).toBe(6.5);
  });

  it('fits more Business questions into a block', () => {
    const skills = ['Operations strategies', 'Marketing strategies', 'Role of financial management', 'Influences on human resources'].map((name) =>
      newSkill({ subject: 'Business Studies', name }, NOW),
    );
    const problems: Problem[] = skills.flatMap((s) =>
      [0, 1].map((i) => ({ id: `${s.id}${i}`, skillId: s.id, source: 'typed' as const, label: '', from: '', key: `${s.id}${i}`, marks: 10, mc: false, questionImage: '', questionText: 'Q', order: i, created: NOW })),
    );
    const mix = buildDailyMix({ skills, problems, attempts: [], plans: [] }, { subjects: ['Business Studies'], minutes: 35, now: NOW, rng: () => 0.5 });
    // 10 mark questions would take 15.5 minutes each if written out; planned, six fit.
    expect(mix.length).toBe(6);
  });
});

describe('practice wording', () => {
  it('asks about the concept in Business Studies and the method elsewhere', () => {
    expect(practiceStyle('Business Studies').methodQuestion).toMatch(/concept/);
    expect(practiceStyle('Business Studies').answerName).toBe('Marking guideline');
    expect(practiceStyle('Engineering Studies').methodQuestion).toMatch(/method or concept/);
    expect(practiceStyle('Chemistry').answerName).toBe('Worked solution');
  });
});

describe('subject from a NESA paper', () => {
  it('reads the cover page or the file name', () => {
    expect(guessOtherSubject('2023 HIGHER SCHOOL CERTIFICATE EXAMINATION Business Studies')).toBe('Business Studies');
    expect(guessOtherSubject('2022 HSC Engineering Studies Marking Guidelines')).toBe('Engineering Studies');
    expect(guessOtherSubject('', '2021-hsc-business-studies.pdf')).toBe('');
    expect(guessOtherSubject('', '2021 HSC Business Studies.pdf')).toBe('Business Studies');
    expect(guessOtherSubject('Some class notes')).toBe('');
  });
});

describe('starter skills', () => {
  it('adds the syllabus skills switched off, once', async () => {
    const added = await addStarterSkills('Business Studies', NOW);
    expect(added).toHaveLength(STARTER_SKILLS['Business Studies'].length);
    expect(added.every((s) => !s.on && s.subject === 'Business Studies')).toBe(true);
    expect(new Set(added.map((s) => s.topic))).toEqual(new Set(['Operations', 'Marketing', 'Finance', 'Human resources']));
    expect(await addStarterSkills('Business Studies', NOW)).toHaveLength(0);
    expect(await listSkills()).toHaveLength(added.length);
    expect(await addStarterSkills('Chemistry', NOW)).toHaveLength(0);
  });

  it('switches a starter skill on when questions are added to it', async () => {
    const [first] = await addStarterSkills('Engineering Studies', NOW);
    const result = await saveProblems({ kind: 'existing', id: first.id }, [{ questionText: 'Q', label: '', marks: 3, mc: false, key: 'q' }], 'typed', 'Typed');
    expect(result.skill.on).toBe(true);
  });
});

describe('typed questions', () => {
  it('saves text with no pictures and deletes cleanly', async () => {
    const result = await saveProblems(
      { kind: 'new', subject: 'Business Studies', name: 'Operations strategies' },
      [{ questionText: 'Explain outsourcing. ', solutionText: '- Defines it\n- Example', label: '2022 HSC Q23', marks: 4, mc: false, key: 'typed:Explain outsourcing.' }],
      'typed',
      '2022 HSC Q23',
    );
    expect(result.added).toBe(1);
    const [p] = await listProblems(result.skill.id);
    expect(p.questionImage).toBe('');
    expect(p.questionText).toBe('Explain outsourcing.');
    expect(p.solutionText).toBe('- Defines it\n- Example');
    expect(await listImages()).toHaveLength(0);
    await deleteSkill(result.skill.id);
    expect(await listProblems()).toHaveLength(0);
  });
});
