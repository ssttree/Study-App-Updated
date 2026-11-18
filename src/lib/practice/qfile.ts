// Reads a questions file: a Markdown file of typed questions and answers,
// grouped into skills. Claude writes these from documents Rhys uploads in
// chat (past papers, worksheets, class handouts), and the app imports them
// as typed questions in problem practice.
//
//   ---
//   subject: Chemistry
//   from: 2023 Trial Paper
//   ---
//
//   ## Le Chatelier's principle
//   topic: Module 5 Equilibrium
//
//   ### Q21 · 3 marks
//   Question, Markdown with $maths$.
//
//   #### Answer
//   Answer or marking guideline.
//
// A "## " heading starts a skill ("Skill:" in front is fine), and may be
// followed by "subject:" and "topic:" lines. A "### " heading starts a
// question: parts split by "·" or "|", where "3 marks" sets the marks, "MC"
// marks multiple choice, and the rest is the label. "#### Answer" (or
// Solution) starts the answer.

import { SUBJECTS } from '../types';
import type { DraftProblem } from './save';

export interface QSkill {
  subject: string;
  name: string;
  topic: string;
  questions: DraftProblem[];
}

export interface QFile {
  from: string;
  skills: QSkill[];
  /** Things that couldn't be read, to show before importing. */
  problems: string[];
}

const ALIASES: Record<string, string> = {
  'maths adv': 'Maths Advanced',
  'mathematics advanced': 'Maths Advanced',
  advanced: 'Maths Advanced',
  adv: 'Maths Advanced',
  'maths ext 1': 'Maths Extension 1',
  'maths extension 1': 'Maths Extension 1',
  'mathematics extension 1': 'Maths Extension 1',
  'ext 1': 'Maths Extension 1',
  ext1: 'Maths Extension 1',
  'maths ext 2': 'Maths Extension 2',
  'mathematics extension 2': 'Maths Extension 2',
  'ext 2': 'Maths Extension 2',
  ext2: 'Maths Extension 2',
  english: 'English Advanced',
  'english adv': 'English Advanced',
  chem: 'Chemistry',
  business: 'Business Studies',
  engineering: 'Engineering Studies',
};

/** The app's name for a subject, or '' if it isn't one of yours. */
export function subjectName(text: string): string {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const exact = SUBJECTS.find((s) => s.toLowerCase() === t);
  return exact ?? ALIASES[t] ?? '';
}

function field(line: string): [string, string] | null {
  const m = /^\s*(subject|from|topic|source)\s*:\s*(.*)$/i.exec(line);
  return m ? [m[1].toLowerCase(), m[2].trim()] : null;
}

/** Reads the "### " heading of a question: label, marks and multiple choice. */
export function questionHeading(text: string): { label: string; marks: number; mc: boolean } {
  let marks = 0;
  let mc = false;
  const label: string[] = [];
  for (const raw of text.split(/[·|]/)) {
    let part = raw.trim();
    const m = /\(?\b(\d+)\s*marks?\b\)?/i.exec(part);
    if (m) {
      marks = Number(m[1]);
      part = part.replace(m[0], '').trim();
    }
    if (/^\(?(mc|multiple choice)\)?$/i.test(part)) mc = true;
    else if (part) label.push(part);
  }
  if (mc && !marks) marks = 1;
  return { label: label.join(' · '), marks: marks || 1, mc };
}

export function parseQuestionsFile(src: string): QFile {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: QFile = { from: '', skills: [], problems: [] };
  let subject = '';
  let i = 0;

  // Front matter.
  if (lines[0]?.trim() === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const f = field(line);
        if (f?.[0] === 'subject') subject = f[1];
        if (f?.[0] === 'from' || f?.[0] === 'source') out.from = f[1];
      }
      i = end + 1;
    }
  }

  let skill: QSkill | null = null;
  let q: { head: string; question: string[]; answer: string[]; inAnswer: boolean } | null = null;
  let qCount = 0;

  const finishQuestion = () => {
    if (!q || !skill) return;
    const questionText = q.question.join('\n').trim();
    const solutionText = q.answer.join('\n').trim();
    const head = questionHeading(q.head);
    if (!questionText) out.problems.push(`"${q.head}" in ${skill.name} has no question text, so it was left out.`);
    else {
      if (!solutionText) out.problems.push(`"${q.head}" in ${skill.name} has no answer.`);
      skill.questions.push({
        questionText,
        solutionText,
        label: head.label,
        marks: head.marks,
        mc: head.mc,
        key: `typed:${questionText}`,
      });
    }
    q = null;
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    const h2 = /^##\s+(?!#)(.*)$/.exec(line);
    const h3 = /^###\s+(?!#)(.*)$/.exec(line);
    const h4 = /^####\s+(.*)$/.exec(line);
    if (h2) {
      finishQuestion();
      skill = { subject, name: h2[1].replace(/^skill\s*:\s*/i, '').trim(), topic: '', questions: [] };
      out.skills.push(skill);
      // subject: and topic: lines straight after the heading.
      while (i + 1 < lines.length) {
        const f = field(lines[i + 1]);
        if (!f && lines[i + 1].trim()) break;
        i++;
        if (f?.[0] === 'subject') skill.subject = f[1];
        if (f?.[0] === 'topic') skill.topic = f[1];
      }
      continue;
    }
    if (h3) {
      finishQuestion();
      qCount++;
      if (!skill) {
        skill = { subject, name: 'Imported questions', topic: '', questions: [] };
        out.skills.push(skill);
      }
      q = { head: h3[1].trim() || `Question ${qCount}`, question: [], answer: [], inAnswer: false };
      continue;
    }
    if (h4 && q && /^(answer|solution|marking|worked)/i.test(h4[1].trim())) {
      q.inAnswer = true;
      continue;
    }
    if (q) (q.inAnswer ? q.answer : q.question).push(line);
  }
  finishQuestion();

  for (const s of out.skills) {
    const name = subjectName(s.subject);
    if (!name) out.problems.push(s.subject ? `"${s.subject}" isn't one of your subjects (in ${s.name}).` : `${s.name} has no subject.`);
    s.subject = name;
  }
  out.skills = out.skills.filter((s) => s.questions.length);
  if (!out.skills.length) out.problems.push('No questions found. Each question needs a "### " heading.');
  return out;
}
