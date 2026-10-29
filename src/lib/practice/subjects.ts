// How problem practice works in each subject. Maths and Chemistry are
// worked on paper and checked against a worked solution. Business Studies
// and Engineering Studies use past HSC questions: you plan the answer in
// dot points and check it against the marking guideline.

export interface PracticeStyle {
  /** What to do with the question, shown under it. */
  task: string;
  /** What the answer is called: "Worked solution" or "Marking guideline". */
  answerName: string;
  /** The question asked before rating. */
  methodQuestion: string;
  /** Word for the end of block summary: "method" or "concept". */
  methodWord: string;
}

const WORKED: PracticeStyle = {
  task: 'Work it on paper',
  answerName: 'Worked solution',
  methodQuestion: 'Did you pick the right method?',
  methodWord: 'method',
};

const STYLES: Record<string, PracticeStyle> = {
  'Business Studies': {
    task: 'Plan your answer on paper in dot points: name the concept, explain it, and give a business example',
    answerName: 'Marking guideline',
    methodQuestion: 'Did you pick the right concept?',
    methodWord: 'concept',
  },
  // Engineering mixes calculations (mechanics, electricity) with written answers.
  'Engineering Studies': {
    task: 'Work it on paper. For a written question, plan your answer in dot points',
    answerName: 'Answer or marking guideline',
    methodQuestion: 'Did you pick the right method or concept?',
    methodWord: 'method',
  },
};

export function practiceStyle(subject: string): PracticeStyle {
  return STYLES[subject] ?? WORKED;
}

/** Subjects where long answers are planned, not written out, so a question never takes more than a few minutes. */
export function plansAnswers(subject: string): boolean {
  return subject === 'Business Studies';
}

export interface StarterSkill {
  topic: string;
  name: string;
}

/**
 * Starting skills for subjects that have no SmarterEd worksheets, taken from
 * the Stage 6 syllabus. They start switched off and turn on once questions
 * are added, like a worksheet from your teacher.
 */
export const STARTER_SKILLS: Record<string, StarterSkill[]> = {
  'Business Studies': [
    ...['Role of operations management', 'Influences on operations', 'Operations processes', 'Operations strategies'].map((name) => ({ topic: 'Operations', name })),
    ...['Role of marketing', 'Influences on marketing', 'Marketing process', 'Marketing strategies'].map((name) => ({ topic: 'Marketing', name })),
    ...['Role of financial management', 'Influences on financial management', 'Processes of financial management', 'Financial management strategies'].map(
      (name) => ({ topic: 'Finance', name }),
    ),
    ...['Role of human resource management', 'Influences on human resources', 'Processes of human resource management', 'Strategies in human resource management', 'Effectiveness of human resource management'].map(
      (name) => ({ topic: 'Human resources', name }),
    ),
  ],
  'Engineering Studies': [
    ...module('Civil structures', ['History and society', 'Mechanics (trusses, stress and bending)', 'Materials', 'Drawing']),
    ...module('Personal and public transport', ['History and society', 'Mechanics (friction, energy and power)', 'Materials', 'Electricity and electronics', 'Drawing']),
    ...module('Lifting devices', ['History and society', 'Mechanics (machines and hydraulics)', 'Materials', 'Electricity and electronics', 'Drawing']),
    ...module('Aeronautical engineering', ['History and society', 'Mechanics (flight forces and fluids)', 'Materials', 'Drawing']),
    ...module('Telecommunications engineering', ['History and society', 'Electricity and electronics', 'Materials', 'Drawing']),
  ],
};

function module(topic: string, parts: string[]): StarterSkill[] {
  return parts.map((part) => ({ topic, name: `${topic}: ${part.charAt(0).toLowerCase()}${part.slice(1)}` }));
}

/**
 * Guesses the subject of a PDF that is not a SmarterEd sheet, like a NESA
 * past paper or its marking guideline, from the first page and the file name.
 */
export function guessOtherSubject(firstPage: string, fileName = ''): string {
  const text = `${firstPage} ${fileName}`.toLowerCase();
  if (/business\s*stud/.test(text)) return 'Business Studies';
  if (/engineering\s*stud/.test(text)) return 'Engineering Studies';
  if (/chemistry/.test(text)) return 'Chemistry';
  if (/extension\s*2|ext\s*2/.test(text)) return 'Maths Extension 2';
  if (/extension\s*1|ext\s*1/.test(text)) return 'Maths Extension 1';
  if (/mathematics\s*advanced|maths?\s*adv/.test(text)) return 'Maths Advanced';
  return '';
}
