import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  arrange,
  buildDailyMix,
  buildSkillSet,
  buildTestPrep,
  costMinutes,
  makeSkillScheduler,
  newSkill,
  pickProblem,
  rateSkill,
  recommendSubjects,
  type MixItem,
  type PracticeData,
} from '../src/lib/practice/mix';
import { pairByOrder, saveProblems } from '../src/lib/practice/save';
import { BACKUP_VERSION, createBackup, parseBackup, restoreBackup } from '../src/lib/backup';
import {
  DB_NAME,
  deleteSkill,
  getImage,
  listAttempts,
  listProblems,
  listSkills,
  moveProblems,
  recordAttempt,
  resetDbConnection,
} from '../src/lib/db';
import { DEFAULT_SETTINGS, type Attempt, type Problem, type Skill } from '../src/lib/types';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 24, 8);
let seed = 1;
const rng = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

function skill(name: string, fields: Partial<Skill> = {}): Skill {
  return newSkill({ subject: 'Maths Extension 1', name, topic: 'F2 Polynomials', code: 'F2', ...fields }, NOW - 30 * DAY);
}

function reviewed(s: Skill, dueInDays: number, stability = 5): Skill {
  return { ...s, fsrs: { ...s.fsrs, state: 2, due: NOW + dueInDays * DAY, stability, lastReview: NOW - 3 * DAY, reps: 2 } };
}

function problems(s: Skill, n: number, marks = 2): Problem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${s.id}-p${i}`,
    skillId: s.id,
    source: 'smartered' as const,
    label: `Q${i + 1}`,
    from: s.name,
    key: `${s.id}|${i}`,
    marks,
    mc: false,
    questionImage: `img-${s.id}-${i}`,
    order: i,
    created: NOW,
  }));
}

function attempt(p: Problem, at: number, fields: Partial<Attempt> = {}): Attempt {
  return { id: `${p.id}-${at}`, problemId: p.id, skillId: p.skillId, at, rating: 3, method: 'yes', seconds: 60, stateBefore: 2, ...fields };
}

describe('time budget', () => {
  it('uses 1.5 minutes per mark plus marking time', () => {
    expect(costMinutes({ marks: 3 })).toBe(5);
    expect(costMinutes({ marks: 1 })).toBe(2);
  });
});

describe('picking a question', () => {
  const s = skill('Remainder theorem');
  const pool = problems(s, 3);
  it('prefers questions never done', () => {
    const seen = new Map([
      [pool[0].id, NOW - DAY],
      [pool[1].id, NOW - 2 * DAY],
    ]);
    expect(pickProblem(pool, seen, NOW)!.id).toBe(pool[2].id);
  });
  it('then the one done longest ago', () => {
    const seen = new Map(pool.map((p, i) => [p.id, NOW - (i + 1) * DAY]));
    expect(pickProblem(pool, seen, NOW)!.id).toBe(pool[2].id);
  });
  it('prefers questions that fit the time left', () => {
    const mixed = [...problems(s, 1, 5), ...problems(skill('x'), 1, 1)];
    expect(pickProblem(mixed, new Map(), NOW, 3)!.marks).toBe(1);
  });
});

describe('daily mix', () => {
  const due1 = reviewed(skill('Remainder theorem'), -2);
  const due2 = reviewed(skill('Inequalities', { topic: 'F1 Functions', code: 'F1' }), -1);
  const notDue = reviewed(skill('Inverse functions', { topic: 'F1 Functions', code: 'F1' }), 10, 2);
  const strong = reviewed(skill('Sums of roots'), 30, 50);
  const fresh = skill('Parametric');
  const off = { ...skill('Not taught'), on: false };
  const chem = reviewed(skill('Moles', { subject: 'Chemistry', topic: 'M2', code: 'M2' }), -5);
  const all = [due1, due2, notDue, strong, fresh, off, chem];
  const data: PracticeData = { skills: all, problems: all.flatMap((s) => problems(s, 4)), attempts: [], plans: [] };

  it('takes due skills first, then new, then the weakest, from the chosen subject only', () => {
    const mix = buildDailyMix(data, { subjects: ['Maths Extension 1'], minutes: 60, now: NOW, dayEnd: NOW + DAY, rng });
    const names = mix.map((m) => m.skill.name);
    expect(new Set(names)).toEqual(new Set(['Remainder theorem', 'Inequalities', 'Parametric', 'Inverse functions', 'Sums of roots']));
    expect(names).not.toContain('Not taught');
    expect(names).not.toContain('Moles');
  });

  it('stops when the time is used up', () => {
    const mix = buildDailyMix(data, { subjects: ['Maths Extension 1'], minutes: 8, now: NOW, dayEnd: NOW + DAY, rng });
    expect(mix.map((m) => m.skill.name)).toEqual(expect.arrayContaining(['Remainder theorem', 'Inequalities']));
    expect(mix).toHaveLength(2);
  });

  it('puts a skill you mixed up next to the one you confused it with', () => {
    const p = data.problems.find((x) => x.skillId === due1.id)!;
    const withConfusion = { ...data, attempts: [attempt(p, NOW - 2 * DAY, { method: 'no', confusedWith: strong.id })] };
    const mix = buildDailyMix(withConfusion, { subjects: ['Maths Extension 1'], minutes: 10, now: NOW, dayEnd: NOW + DAY, rng });
    expect(mix.map((m) => m.skill.name)).toContain('Sums of roots');
  });

  it('gives a test plan first claim on the time', () => {
    const plan = { id: 'plan', name: 'Test', subject: 'Maths Extension 1', date: NOW + 10 * DAY, skillIds: [strong.id], created: NOW - DAY };
    const mix = buildDailyMix({ ...data, plans: [plan] }, { subjects: ['Maths Extension 1'], minutes: 8, now: NOW, dayEnd: NOW + DAY, rng });
    expect(mix.map((m) => m.skill.name)).toContain('Sums of roots');
  });
});

describe('arranging', () => {
  it('never puts the same skill twice in a row when it can be avoided', () => {
    const a = skill('A');
    const b = skill('B');
    const items: MixItem[] = [
      ...problems(a, 3).map((p) => ({ problem: p, skill: a })),
      ...problems(b, 3).map((p) => ({ problem: p, skill: b })),
    ];
    for (let t = 0; t < 20; t++) {
      const out = arrange(items, rng);
      for (let i = 1; i < out.length; i++) expect(out[i].skill.id).not.toBe(out[i - 1].skill.id);
    }
  });

  it('keeps skills from the same topic together', () => {
    const f1 = [skill('a', { code: 'F1', topic: 'F1' }), skill('b', { code: 'F1', topic: 'F1' })];
    const f2 = [skill('c'), skill('d')];
    const items = [...f1, ...f2].map((s) => ({ problem: problems(s, 1)[0], skill: s }));
    const out = arrange(items, rng).map((m) => m.skill.topic);
    expect(out[0]).toBe(out[1]);
    expect(out[2]).toBe(out[3]);
  });
});

describe('test prep', () => {
  it('only uses the plan skills and goes round them more than once', () => {
    const a = reviewed(skill('A'), 5);
    const b = reviewed(skill('B'), 5);
    const c = reviewed(skill('C'), -1);
    const data: PracticeData = { skills: [a, b, c], problems: [a, b, c].flatMap((s) => problems(s, 3)), attempts: [], plans: [] };
    const plan = { id: 'p', name: 'T', subject: 'Maths Extension 1', date: NOW + 7 * DAY, skillIds: [a.id, b.id], created: NOW };
    const set = buildTestPrep(data, plan, 20, NOW, rng);
    expect(set.every((m) => m.skill.id !== c.id)).toBe(true);
    expect(set.filter((m) => m.skill.id === a.id).length).toBeGreaterThanOrEqual(2);
    expect(new Set(set.map((m) => m.problem.id)).size).toBe(set.length);
  });

  it('includes sub-skills of a chosen worksheet', () => {
    const parent = skill('Graphing');
    const child = skill('Reciprocal graphs', { parentId: parent.id });
    const data: PracticeData = { skills: [parent, child], problems: problems(child, 2), attempts: [], plans: [] };
    const plan = { id: 'p', name: 'T', subject: 'Maths Extension 1', date: NOW + 7 * DAY, skillIds: [parent.id], created: NOW };
    expect(buildTestPrep(data, plan, 10, NOW, rng).map((m) => m.skill.name)).toContain('Reciprocal graphs');
  });
});

describe('a short list of skills', () => {
  it('goes round them again with different questions to fill the block', () => {
    const a = skill('A');
    const b = skill('B', { topic: 'F1', code: 'F1' });
    const data: PracticeData = { skills: [a, b], problems: [...problems(a, 6), ...problems(b, 6)], attempts: [], plans: [] };
    const mix = buildDailyMix(data, { subjects: ['Maths Extension 1'], minutes: 30, now: NOW, dayEnd: NOW + DAY, rng });
    expect(mix.length).toBe(8);
    expect(new Set(mix.map((m) => m.problem.id)).size).toBe(8);
    for (let i = 1; i < mix.length; i++) expect(mix[i].skill.id).not.toBe(mix[i - 1].skill.id);
  });
});

describe('one skill on its own', () => {
  it('fills the time from that skill without repeats', () => {
    const s = skill('A');
    const set = buildSkillSet({ skills: [s], problems: problems(s, 10), attempts: [], plans: [] }, s.id, 15, NOW, rng);
    // 2 mark questions take 3.5 minutes each, so 4 fit in 15 minutes.
    expect(set).toHaveLength(4);
    expect(new Set(set.map((m) => m.problem.id)).size).toBe(4);
  });
});

describe('scheduling skills', () => {
  it('moves a skill forward with FSRS', () => {
    const s = skill('A');
    const after = rateSkill(makeSkillScheduler(DEFAULT_SETTINGS), s, 3, NOW);
    expect(after.fsrs.state).not.toBe(0);
    expect(after.fsrs.due).toBeGreaterThan(NOW);
  });

  it('brings a missed skill back the next day, not in a few minutes', () => {
    const after = rateSkill(makeSkillScheduler(DEFAULT_SETTINGS), skill('A'), 1, NOW);
    expect(after.fsrs.due - NOW).toBeGreaterThanOrEqual(DAY * 0.9);
  });

  it('recommends the subject with the most due work', () => {
    const maths = reviewed(skill('A'), -3);
    const chem = reviewed(skill('M', { subject: 'Chemistry' }), 5);
    const data: PracticeData = { skills: [maths, chem], problems: [...problems(maths, 1), ...problems(chem, 1)], attempts: [], plans: [] };
    const ranked = recommendSubjects(data, NOW, NOW + DAY);
    expect(ranked[0].subject).toBe('Maths Extension 1');
    expect(ranked[0].reason).toContain('1 skill due');
    const plan = { id: 'p', name: 'T', subject: 'Chemistry', date: NOW + 2 * DAY, skillIds: [chem.id], created: NOW };
    expect(recommendSubjects({ ...data, plans: [plan] }, NOW, NOW + DAY)[0].subject).toBe('Chemistry');
  });
});

describe('ATAR Notes pairing', () => {
  it('pairs solutions with questions by order', () => {
    expect(pairByOrder(['q1', 'q2', 'q3'], ['s1', 's2'])).toEqual([
      { question: 'q1', solution: 's1' },
      { question: 'q2', solution: 's2' },
      { question: 'q3', solution: undefined },
    ]);
  });
});

describe('saving practice', () => {
  beforeEach(async () => {
    await resetDbConnection();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  });

  const pic = (s: string) => ({ data: `data:image/png;base64,${s}`, width: 10, height: 10 });
  const drafts = [1, 2, 3].map((n) => ({ question: pic(`q${n}`), solution: pic(`s${n}`), label: `Q${n}`, marks: n, mc: false, key: `k${n}` }));

  it('makes the skill, stores pictures and skips repeats', async () => {
    const first = await saveProblems({ kind: 'new', subject: 'Chemistry', name: 'Chemical Reactions', topic: 'Module 3', code: 'M3' }, drafts, 'smartered', 'sheet');
    expect(first.added).toBe(3);
    expect(first.skill.on).toBe(true);
    const again = await saveProblems({ kind: 'new', subject: 'Chemistry', name: 'chemical reactions' }, drafts, 'smartered', 'sheet');
    expect(again.skill.id).toBe(first.skill.id);
    expect(again.added).toBe(0);
    expect(again.skipped).toBe(3);
    const saved = await listProblems(first.skill.id);
    expect(saved.map((p) => p.label)).toEqual(['Q1', 'Q2', 'Q3']);
    expect((await getImage(saved[0].questionImage))?.data).toContain('q1');
  });

  it('moves questions into a sub-skill and deletes cleanly', async () => {
    const { skill: parent } = await saveProblems({ kind: 'new', subject: 'Maths Extension 1', name: 'Graphing' }, drafts, 'smartered', 'sheet');
    const child = await saveProblems({ kind: 'new', subject: 'Maths Extension 1', name: 'Reciprocal', parentId: parent.id }, [], 'smartered', 'sheet');
    const qs = await listProblems(parent.id);
    await recordAttempt(parent, attempt(qs[0], NOW));
    await moveProblems([qs[0].id], child.skill.id);
    expect((await listProblems(child.skill.id)).length).toBe(1);
    expect((await listAttempts())[0].skillId).toBe(child.skill.id);
    await deleteSkill(parent.id);
    expect(await listSkills()).toHaveLength(0);
    expect(await listProblems()).toHaveLength(0);
    expect(await getImage(qs[0].questionImage)).toBeUndefined();
  });

  it('backs up and restores practice data with its pictures', async () => {
    await saveProblems({ kind: 'new', subject: 'Chemistry', name: 'Moles' }, drafts, 'atarnotes', 'Test 1');
    const backup = JSON.parse(JSON.stringify(await createBackup()));
    expect(backup.version).toBe(BACKUP_VERSION);
    await deleteSkill((await listSkills())[0].id);
    await restoreBackup(parseBackup(backup));
    const problemsBack = await listProblems();
    expect(problemsBack).toHaveLength(3);
    expect((await getImage(problemsBack[0].solutionImage!))?.data).toContain('s1');
  });

  it('still restores backups made before practice existed', () => {
    const old = { format: 'study-app-backup', version: 1, exportedAt: '', decks: [], cards: [], reviewLogs: [], settings: {} };
    const parsed = parseBackup(old);
    expect(parsed.skills).toEqual([]);
    expect(parsed.settings.problemMinutes).toBe(35);
  });
});
