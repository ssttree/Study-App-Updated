// Saves imported questions: finds or makes the skill, stores the pictures
// and skips questions that are already in the app.

import { addPractice, listSkills, newId, problemKeys } from '../db';
import type { Problem, ProblemSource, Skill, StoredImage } from '../types';
import { newSkill } from './mix';

export interface Picture {
  data: string;
  width: number;
  height: number;
}

export interface DraftProblem {
  question: Picture;
  solution?: Picture | null;
  label: string;
  marks: number;
  mc: boolean;
  /** Identifies the question so importing the same sheet twice adds nothing. */
  key: string;
}

/** Either an existing skill's id or the details for a new one. */
export type SkillChoice =
  | { kind: 'existing'; id: string }
  | { kind: 'new'; subject: string; name: string; topic?: string; code?: string; dotPoint?: string; parentId?: string };

export interface SaveResult {
  skill: Skill;
  added: number;
  skipped: number;
}

/** A skill with this name in this subject already, if there is one. */
export function findSkill(skills: Skill[], subject: string, name: string): Skill | undefined {
  const norm = (s: string) => s.trim().toLowerCase();
  return skills.find((s) => s.subject === subject && norm(s.name) === norm(name));
}

export async function saveProblems(
  choice: SkillChoice,
  drafts: DraftProblem[],
  source: ProblemSource,
  from: string,
  now = Date.now(),
): Promise<SaveResult> {
  const skills = await listSkills();
  let skill: Skill;
  const toSave: Skill[] = [];
  if (choice.kind === 'existing') {
    const found = skills.find((s) => s.id === choice.id);
    if (!found) throw new Error('That skill no longer exists.');
    skill = found;
  } else {
    const existing = findSkill(skills, choice.subject, choice.name);
    skill =
      existing ??
      newSkill(
        {
          subject: choice.subject,
          name: choice.name.trim(),
          topic: choice.topic ?? '',
          code: choice.code ?? '',
          dotPoint: choice.dotPoint || undefined,
          parentId: choice.parentId,
        },
        now,
      );
  }
  // Your teacher only hands out a worksheet once the topic is taught, so importing switches it on.
  if (!skill.on) skill = { ...skill, on: true };
  toSave.push(skill);

  const keys = await problemKeys();
  const problems: Problem[] = [];
  const images: StoredImage[] = [];
  let skipped = 0;
  let order = now;
  for (const d of drafts) {
    const key = `${skill.id}|${d.key}`;
    if (keys.has(key)) {
      skipped++;
      continue;
    }
    keys.add(key);
    const q: StoredImage = { id: newId(), ...d.question };
    images.push(q);
    let solutionImage: string | undefined;
    if (d.solution) {
      const s: StoredImage = { id: newId(), ...d.solution };
      images.push(s);
      solutionImage = s.id;
    }
    problems.push({
      id: newId(),
      skillId: skill.id,
      source,
      label: d.label,
      from,
      key,
      marks: d.marks,
      mc: d.mc,
      questionImage: q.id,
      solutionImage,
      order: order++,
      created: now,
    });
  }
  await addPractice(toSave, problems, images);
  return { skill, added: problems.length, skipped };
}

/** ATAR Notes: solutions are pasted in the same order as the questions, so pair them by position. */
export function pairByOrder<Q, S>(questions: Q[], solutions: S[]): { question: Q; solution?: S }[] {
  return questions.map((question, i) => ({ question, solution: solutions[i] }));
}

/**
 * The skill a worksheet's questions are already saved in, when every one of
 * them is (the most common skill if they were spread out). Null when any
 * question is new.
 */
export function allKnown(keys: string[], known: Map<string, string>): string | null {
  if (!keys.length || !keys.every((k) => known.has(k))) return null;
  const count = new Map<string, number>();
  for (const k of keys) count.set(known.get(k)!, (count.get(known.get(k)!) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0][0];
}
