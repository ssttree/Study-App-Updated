import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  findDates,
  findTime,
  guessKind,
  guessSubject,
  parseNotification,
  planFromNotification,
  readDocx,
  taskName,
  topicInScope,
} from '../src/lib/planner/notification';
import type { Skill, TestPlan } from '../src/lib/types';

const NOW = new Date(2026, 10, 19).getTime();

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
const cell = (...paras: string[]) => `<w:tc><w:tcPr/>${paras.map(p).join('')}</w:tc>`;
const row = (...cells: string[][]) => `<w:tr>${cells.map((c) => cell(...c)).join('')}</w:tr>`;
const table = (...rows: string[]) => `<w:tbl>${rows.join('')}</w:tbl>`;
const docx = (body: string) =>
  zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`),
  });

// Shaped like the Maths Extension 2 notification: a topic test with one date and time.
const ext2 = docx(
  table(
    row(['Assessment Task Notification ', 'Topic Test'], []),
    row(['Yr 12 Mathematics Extension 2'], []),
    row(['Context']),
    row(['Task 1 – ‘Complex Numbers and Proof”']),
    row(['Task:'], ['Assessment Task 1- In class Test']),
    row(['Date:'], ['Term 4, Week 10, Tuesday 9.00 am 15/12/2026']),
    row(['Weight:'], ['15%'], ['Marked out of'], ['51']),
    row(['Outcomes']),
    row(['ME2-12-01 Selects and applies the language of proof', '', 'Topics of Study: Using the textbook', 'Chapter 1 Complex Numbers', 'Chapter 2 Mathematical Proof']),
    row(['Illness Misadventure']),
    row(['Contact the College.']),
  ),
);

// Shaped like the Chemistry one: a date for each class.
const chem = docx(
  table(
    row(['Assessment Task Notification', 'In Class Task', 'Year 12 Chemistry'], []),
    row(['Context']),
    row(['Module 5:  Equilibrium and Acid Reactions']),
    row(['Task:'], ['Assessment Task 1: Working Scientifically Skills ']),
    row(['Date:'], ['12CHEMA (Line 2) Monday 30th November 2026, Week 8. ', '12CHEMB (Line 6) Tuesday 1st December 2026, Week 8. ', 'Time Allocated: 60 minutes']),
    row(['Weight:'], ['20 %'], ['Marked Out of'], ['100']),
    row(['Requirements of the Task']),
    row(['Inquiry Questions', 'What factors affect equilibrium and how?']),
  ) + p('Student Declaration') + p('I declare this is my own work'),
);

// Shaped like the Engineering one: a hand-in report whose submission week differs from the date.
const eng = docx(
  table(
    row(['Assessment Task Notification ', 'Hand In Task', 'Year 12 Engineering Studies'], []),
    row(['Context']),
    row(['Students will show their understanding of Civil Engineering focusing on truss analysis.']),
    row(['Task'], ['#1 Civil Engineering Report- Truss Analysis']),
    row(['Date:'], ['9:45am, Wednesday, 16th of December, Week 10, Term 4, 2026']),
    row(['Weight:'], ['Weight 25%'], ['Marked Out of'], ['100']),
    row(['Submission Instructions']),
    row(['Your report is to be submitted in week 9 Term 4 via Stile.', 'All drawings to be submitted in week 9 Term 4.']),
    row(['Assessment Criteria']),
    row(['Tasks'], ['Marking']),
    row(['Title Page'], ['/2']),
  ),
);

describe('reading a notification', () => {
  it('reads a topic test with one date and time', () => {
    const n = parseNotification(readDocx(ext2), 'HSC_Ext_2_Task_1.docx', NOW);
    expect(n.subject).toBe('Maths Extension 2');
    expect(n.kind).toBe('test');
    expect(n.name).toBe('Task 1: Complex Numbers and Proof');
    expect(n.taskNumber).toBe(1);
    expect(n.date).toBe('2026-12-15');
    expect(n.time).toBe('09:00');
    expect(n.weighting).toBe(15);
    expect(n.outOf).toBe(51);
    expect(n.topicText).toContain('Chapter 2 Mathematical Proof');
    expect(n.sections.map((s) => s.heading)).toEqual(['Context', 'Outcomes']);
    expect(n.warnings).toEqual([]);
  });

  it('gives one date per class, labelled', () => {
    const n = parseNotification(readDocx(chem), 'chem.docx', NOW);
    expect(n.subject).toBe('Chemistry');
    expect(n.name).toBe('Task 1: Working Scientifically Skills');
    expect(n.dateOptions).toEqual([
      { date: '2026-11-30', time: undefined, label: '12CHEMA (Line 2)' },
      { date: '2026-12-01', time: undefined, label: '12CHEMB (Line 6)' },
    ]);
    expect(n.weighting).toBe(20);
    expect(n.warnings[0]).toMatch(/different date for each class/);
    // The declaration page after the details is left out.
    expect(n.sections.map((s) => s.heading)).toEqual(['Context', 'Requirements']);
  });

  it('reads a hand-in report and flags a submission week that differs from the date', () => {
    const n = parseNotification(readDocx(eng), 'eng.docx', NOW);
    expect(n.subject).toBe('Engineering Studies');
    expect(n.kind).toBe('assignment');
    expect(n.name).toBe('Task 1: Civil Engineering Report - Truss Analysis');
    expect(n.date).toBe('2026-12-16');
    expect(n.time).toBe('09:45');
    expect(n.weighting).toBe(25);
    expect(n.warnings).toEqual([
      'The submission instructions mention week 9, but the date says week 10. Check with your teacher which one is right.',
    ]);
    expect(n.sections.find((s) => s.heading === 'Assessment criteria')?.rows).toEqual([[['Tasks'], ['Marking']], [['Title Page'], ['/2']]]);
  });

  it('refuses files that are not Word documents', () => {
    expect(() => readDocx(strToU8('%PDF-1.7'))).toThrow(/not a Word/);
  });
});

describe('details', () => {
  it('reads dates written different ways', () => {
    expect(findDates(['Friday 3 April'], NOW)).toEqual([{ date: '2027-04-03', time: undefined }]);
    expect(findDates(['March 12, 2027 at 2pm'], NOW)).toEqual([{ date: '2027-03-12', time: '14:00' }]);
    expect(findDates(['due 5.3.27'], NOW)[0].date).toBe('2027-03-05');
  });

  it('reads times', () => {
    expect(findTime('9.00 am')).toBe('09:00');
    expect(findTime('1:30pm')).toBe('13:30');
    expect(findTime('12 pm')).toBe('12:00');
    expect(findTime('60 minutes')).toBeUndefined();
  });

  it('guesses subject and kind', () => {
    expect(guessSubject('Year 12 Mathematics Extension 1')).toBe('Maths Extension 1');
    expect(guessSubject('Yr 12 Mathematics Advanced')).toBe('Maths Advanced');
    expect(guessSubject('Business Studies')).toBe('Business Studies');
    expect(guessKind('Trial HSC Examination')).toBe('exam');
    expect(guessKind('Topic Test')).toBe('test');
    expect(guessKind('Hand In Task')).toBe('assignment');
  });

  it('names tasks', () => {
    expect(taskName('Assessment Task 2: Depth Study', '').name).toBe('Task 2: Depth Study');
    expect(taskName('In class test', 'Module 7 Organic Chemistry').name).toBe('Module 7 Organic Chemistry');
  });

  it('matches topics by module number or words', () => {
    const text = 'Module 5: Equilibrium and Acid Reactions\nChapter 1 Complex Numbers';
    expect(topicInScope('Module 5: Equilibrium and Acid Reactions', text)).toBe(true);
    expect(topicInScope('Module 6: Acid/base Reactions', text)).toBe(false);
    expect(topicInScope('Complex numbers', text)).toBe(true);
    expect(topicInScope('Mechanics', text)).toBe(false);
  });
});

describe('saving', () => {
  const skill = (id: string, topic: string, subject = 'Chemistry'): Skill =>
    ({ id, subject, name: id, topic, code: '', fsrs: { state: 0 } }) as unknown as Skill;
  const parsed = parseNotification(readDocx(chem), 'chem.docx', NOW);
  const choice = { name: parsed.name, subject: 'Chemistry', kind: parsed.kind, date: '2026-12-01', weighting: 20, outOf: 100 };
  const skills = [skill('eq', 'Module 5: Equilibrium and Acid Reactions'), skill('acid', 'Module 6: Acid/base Reactions'), skill('cx', 'Complex Numbers', 'Maths Extension 2')];

  it('adds a new assessment with in-scope skills and the notification', () => {
    const { plan, existing } = planFromNotification(parsed, choice, { fileName: 'chem.docx', fileId: 'f1' }, {
      plans: [],
      skills,
      decks: [],
      now: NOW,
      newId: () => 'new',
    });
    expect(existing).toBeUndefined();
    expect(plan.id).toBe('new');
    expect(plan.skillIds).toEqual(['eq']);
    expect(plan.notification?.fileId).toBe('f1');
    expect(plan.notification?.dateOptions).toHaveLength(2);
    // The class choice was made, so that warning isn't kept.
    expect(plan.notification?.warnings).toEqual([]);
  });

  it('updates the same task instead of adding a second one', () => {
    const old: TestPlan = { id: 'old', name: 'Task 1: WS skills', subject: 'Chemistry', date: 0, skillIds: ['mine'], created: 5, mark: 18 };
    const { plan, existing } = planFromNotification(parsed, choice, { fileName: 'chem.docx' }, {
      plans: [old],
      skills,
      decks: [],
      now: NOW,
      newId: () => 'new',
    });
    expect(existing?.id).toBe('old');
    expect(plan.id).toBe('old');
    expect(plan.created).toBe(5);
    expect(plan.mark).toBe(18);
    expect(plan.skillIds).toEqual(['mine', 'eq']);
  });
});
