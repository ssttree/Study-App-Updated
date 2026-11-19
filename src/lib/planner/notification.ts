// Reads a school assessment task notification (a Word .docx) and pulls out
// what the planner needs: subject, task name, kind, date (or one date per
// class), time, weighting and marks. It also keeps the useful sections
// (context, outcomes, requirements, submission, criteria) as text so the
// notification can be read in the app offline.
//
// The notifications are tables of "label | value" rows with heading rows
// like "Outcomes" between them. Nothing here needs a browser, so it runs in
// tests too.

import { unzipSync, strFromU8 } from 'fflate';
import { SUBJECTS, type AssessmentKind, type DateOption, type Deck, type NotificationSection, type Row, type Skill, type TestPlan } from '../types';

export type { DateOption, NotificationSection, Row, TaskNotification } from '../types';
import { dateKey, keyToTime } from './dates';

export interface ParsedNotification {
  name: string;
  subject: string;
  kind: AssessmentKind;
  /** First date option, or empty when none was found. */
  date: string;
  time?: string;
  dateOptions: DateOption[];
  weighting?: number;
  outOf?: number;
  /** Task number from the school, like 1 for "Assessment Task 1". */
  taskNumber?: number;
  /** Short topic text (context, chapters, modules, inquiry questions) used to pick skills and decks. */
  topicText: string;
  sections: NotificationSection[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Reading the Word file

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

/** Tidies a paragraph: no zero-width characters, single spaces, plain dashes and quotes. */
function tidy(text: string): string {
  return text
    .replace(/[​-‍﻿]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The document body as rows in reading order. Nested tables become their own
 * rows straight after the row that holds them.
 */
export function docxRows(documentXml: string): Row[] {
  const rows: Row[] = [];
  // Open tables, each with its current row and cell.
  const stack: { row: Row | null; cell: string[] | null }[] = [];
  let para: string | null = null;
  let inText = false;
  const re = /<(\/?)w:(tbl|tr|tc|p|t|tab|br|cr)(?=[\s/>])[^>]*?(\/?)>|<[^>]*>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(documentXml))) {
    const [, close, tag, selfClose, text] = m;
    if (text !== undefined) {
      if (inText && para !== null) para += decode(text);
      continue;
    }
    if (!tag) continue;
    const top = stack[stack.length - 1];
    if (tag === 'tbl') {
      if (close) stack.pop();
      else stack.push({ row: null, cell: null });
    } else if (tag === 'tr' && top) {
      if (close) top.row = null;
      else {
        top.row = [];
        rows.push(top.row);
      }
    } else if (tag === 'tc' && top) {
      if (close) top.cell = null;
      else if (top.row) {
        top.cell = [];
        top.row.push(top.cell);
      }
    } else if (tag === 'p') {
      if (selfClose) {
        if (top?.cell) top.cell.push('');
      } else if (!close) para = '';
      else if (para !== null) {
        const text = tidy(para);
        if (top?.cell) top.cell.push(text);
        else if (text) rows.push([[text]]);
        para = null;
      }
    } else if (tag === 't') {
      inText = !close && !selfClose;
    } else if ((tag === 'tab' || tag === 'br' || tag === 'cr') && para !== null) {
      para += ' ';
    }
  }
  return rows;
}

/** Unzips a .docx and returns its rows. Throws if it isn't a Word file. */
export function readDocx(bytes: Uint8Array): Row[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' });
  } catch {
    throw new Error('This is not a Word (.docx) file.');
  }
  const xml = files['word/document.xml'];
  if (!xml) throw new Error('This is not a Word (.docx) file.');
  return docxRows(strFromU8(xml));
}

// ---------------------------------------------------------------------------
// Working out the details

const cellText = (cell: string[]) => cell.filter(Boolean).join(' ');
const rowText = (row: Row) => row.map(cellText).filter(Boolean).join(' | ');
const filled = (row: Row) => row.filter((c) => cellText(c));

/** Section headings, in the words schools use. Missing from this list means it's a label row. */
const HEADINGS: [RegExp, string][] = [
  [/^context$/i, 'Context'],
  [/^outcomes?( assessed)?$/i, 'Outcomes'],
  [/^(requirements of the task|task requirements|task description|description of task)$/i, 'Requirements'],
  [/^generative ai/i, 'Generative AI'],
  [/^submission( instructions| details)?$/i, 'Submission'],
  [/^(assessment|marking) criteria$/i, 'Assessment criteria'],
  [/^marking guidelines?$/i, 'Marking guidelines'],
  [/^feedback$/i, 'Feedback'],
  [/^illness/i, 'Illness and misadventure'],
  [/^student declaration$/i, 'Declaration'],
  [/^all my own work/i, 'Declaration'],
];
/** Sections left out of the in-app copy: the same on every notification. */
const SKIP = new Set(['Illness and misadventure', 'Declaration']);

function headingOf(row: Row): string | null {
  const cells = filled(row);
  if (cells.length !== 1 || cells[0].filter(Boolean).length !== 1) return null;
  const text = cellText(cells[0]).replace(/[:.]$/, '').trim();
  for (const [re, name] of HEADINGS) if (re.test(text)) return name;
  return null;
}

/** "Date:" style label of a row, lower case without the colon, if its first cell is a short label. */
function labelOf(row: Row): string | null {
  const cells = filled(row);
  if (cells.length < 2) return null;
  const first = cellText(cells[0]).replace(/:$/, '').trim().toLowerCase();
  return first.length <= 20 ? first : null;
}

/** The value of a label row (everything after the first cell). */
function valueOf(row: Row): string[] {
  return filled(row).slice(1).flat().filter(Boolean);
}

const SUBJECT_RULES: [RegExp, (typeof SUBJECTS)[number]][] = [
  [/\b(extension|ext\.?)\s*2\b/i, 'Maths Extension 2'],
  [/\b(extension|ext\.?)\s*1\b/i, 'Maths Extension 1'],
  [/\bchem/i, 'Chemistry'],
  [/\bengineering\b/i, 'Engineering Studies'],
  [/\bbusiness\b/i, 'Business Studies'],
  [/\benglish\b/i, 'English Advanced'],
  [/\bmath/i, 'Maths Advanced'],
];

export function guessSubject(text: string): string {
  for (const [re, subject] of SUBJECT_RULES) if (re.test(text)) return subject;
  return '';
}

export function guessKind(text: string): AssessmentKind {
  if (/\btrials?\b|\bhsc exam|\bexamination\b|\byearly exam|\bhalf[- ]yearly\b/i.test(text)) return 'exam';
  if (/\bhand[- ]in\b|\bassignment\b|\breport\b|\bresearch\b|\bportfolio\b|\binvestigation\b|\btake[- ]home\b|\bdepth study\b|\bmulti-?modal\b/i.test(text)) return 'assignment';
  return 'test';
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAY_WORD = /\b(mon|tues?|wed(nes)?|thur?s?|fri|sat(ur)?|sun)(day)?\b,?\s*$/i;

function key(y: number, m: number, d: number): string | null {
  const t = new Date(y, m - 1, d);
  if (t.getMonth() !== m - 1 || t.getDate() !== d) return null;
  return dateKey(t.getTime());
}

/** A year for a date with none: the next time that day comes round. */
function nextYear(m: number, d: number, now: number): number {
  const today = dateKey(now);
  const y = new Date(now).getFullYear();
  const k = key(y, m, d);
  return k && k >= today ? y : y + 1;
}

/** A clock time in a paragraph, like "9.00 am" or "9:45am", as HH:MM. */
export function findTime(text: string): string | undefined {
  const m = /\b(\d{1,2})[.:](\d{2})\s*([ap])\.?m\b/i.exec(text) ?? /\b(\d{1,2})\s*([ap])\.?m\b/i.exec(text);
  if (!m) return undefined;
  const hasMinutes = m.length === 4;
  let h = Number(m[1]) % 12;
  const min = hasMinutes ? Number(m[2]) : 0;
  if ((hasMinutes ? m[3] : m[2]).toLowerCase() === 'p') h += 12;
  if (min > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Every date in a paragraph, with where it starts. */
function datesIn(text: string, yearHint: number | undefined, now: number): { date: string; at: number }[] {
  const found: { date: string; at: number }[] = [];
  const later4 = (from: number) => {
    const y = /\b(20\d\d)\b/.exec(text.slice(from));
    return y ? Number(y[1]) : undefined;
  };
  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g)) {
    const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    const k = key(y, Number(m[2]), Number(m[1]));
    if (k) found.push({ date: k, at: m.index });
  }
  const month = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${month}`, 'gi'))) {
    const mo = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    const d = Number(m[1]);
    const y = later4(m.index) ?? yearHint ?? nextYear(mo, d, now);
    const k = key(y, mo, d);
    if (k && !found.some((f) => Math.abs(f.at - m.index) < 3)) found.push({ date: k, at: m.index });
  }
  for (const m of text.matchAll(new RegExp(`\\b${month}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'gi'))) {
    const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    const d = Number(m[2]);
    const y = later4(m.index) ?? yearHint ?? nextYear(mo, d, now);
    const k = key(y, mo, d);
    if (k && !found.some((f) => f.date === k)) found.push({ date: k, at: m.index });
  }
  return found.sort((a, b) => a.at - b.at);
}

/** Date options from the paragraphs of the Date row. */
export function findDates(paragraphs: string[], now: number): DateOption[] {
  const all = paragraphs.join(' ');
  const yearHint = /\b(20\d\d)\b/.exec(all) ? Number(/\b(20\d\d)\b/.exec(all)![1]) : undefined;
  const rowTime = findTime(all);
  const options: DateOption[] = [];
  for (const p of paragraphs) {
    for (const { date, at } of datesIn(p, yearHint, now)) {
      if (options.some((o) => o.date === date)) continue;
      const before = p.slice(0, at).replace(WEEKDAY_WORD, '').replace(/[\s,:-]+$/, '').trim();
      options.push({ date, time: findTime(p) ?? rowTime, label: before || undefined });
    }
  }
  // A label only helps tell several dates apart.
  if (options.length === 1) delete options[0].label;
  return options;
}

const GENERIC_NAME = /^(an?\s+)?(in[- ]?class\s+)?(topic\s+|half[- ]yearly\s+|yearly\s+|trial\s+)?(test|task|exam|examination|assessment)$/i;

/** "Task 1: Complex Numbers and Proof" from the Task row, with the Context line when the task row is generic. */
export function taskName(taskValue: string, context: string): { name: string; number?: number } {
  const clean = (s: string) =>
    s
      .replace(/^['"]+|['"]+$/g, '')
      .replace(/(\w)\s*-\s+/g, '$1 - ')
      .replace(/\s+/g, ' ')
      .trim();
  const split = (s: string) => {
    const m = /^(?:assessment\s+)?(?:task\s*)?#?\s*(\d+)\s*[:.\-]?\s*(.*)$/i.exec(s.trim());
    if (m && (/^(assessment\s+)?task|^#/i.test(s.trim()))) return { number: Number(m[1]), rest: clean(m[2]) };
    return { number: undefined, rest: clean(s) };
  };
  const task = split(taskValue);
  let rest = task.rest;
  let number = task.number;
  if (!rest || GENERIC_NAME.test(rest)) {
    const fromContext = split(context);
    // A context that reads like a long sentence isn't a name.
    if (fromContext.rest && fromContext.rest.length <= 60) rest = fromContext.rest;
    number ??= fromContext.number;
  }
  if (!rest) rest = 'Assessment';
  return { name: number !== undefined ? `Task ${number}: ${rest}` : rest, number };
}

/** "week 9" mentions in a piece of text. */
function weeks(text: string): number[] {
  return [...text.matchAll(/\bweek\s*(\d{1,2})\b/gi)].map((m) => Number(m[1]));
}

/**
 * Pulls the details out of a notification's rows. fileName is a fallback for
 * the subject; now decides the year when a date has none.
 */
export function parseNotification(rows: Row[], fileName: string, now = Date.now()): ParsedNotification {
  const sections: NotificationSection[] = [];
  const header: string[] = [];
  const labels = new Map<string, Row>();
  let current: NotificationSection | null = null;
  let stopped = false;

  for (const row of rows) {
    if (!filled(row).length) continue;
    const heading = headingOf(row);
    if (heading) {
      if (SKIP.has(heading)) stopped = stopped || heading === 'Declaration';
      current = { heading, rows: [] };
      if (!SKIP.has(heading) && !stopped && !sections.some((s) => s.heading === heading)) sections.push(current);
      continue;
    }
    const label = labelOf(row);
    if (label && /^(task|task name|title|date|due|due date|date due|weight|weighting|task weighting)$/.test(label)) {
      if (!labels.has(label)) labels.set(label, row);
      continue;
    }
    if (!current) {
      header.push(rowText(row));
      continue;
    }
    // Repeated content (merged cells copied into every column) adds nothing.
    const cells = row.filter((c, i) => i === 0 || cellText(c) !== cellText(row[0]));
    current.rows.push(cells);
  }

  const get = (...names: string[]) => names.map((n) => labels.get(n)).find(Boolean);
  const section = (heading: string) => sections.find((s) => s.heading === heading);
  const sectionText = (heading: string) => section(heading)?.rows.map(rowText).join('\n') ?? '';

  const headerText = header.join(' ');
  const subject = guessSubject(headerText) || guessSubject(fileName.replace(/[_-]+/g, ' '));
  const taskRow = get('task', 'task name', 'title');
  const taskValue = taskRow ? valueOf(taskRow).join(' ') : '';
  const context = sectionText('Context').split('\n')[0] ?? '';
  const { name, number } = taskName(taskValue, context);
  const kind = guessKind(`${headerText} ${taskValue}`);

  const dateRow = get('date', 'due', 'due date', 'date due');
  const dateOptions = dateRow ? findDates(valueOf(dateRow), now) : [];

  const weightRow = get('weight', 'weighting', 'task weighting');
  let weighting: number | undefined;
  let outOf: number | undefined;
  if (weightRow) {
    const cells = filled(weightRow).map(cellText);
    const w = /(\d+(?:\.\d+)?)\s*%/.exec(cells.slice(1).join(' '));
    if (w) weighting = Number(w[1]);
    const i = cells.findIndex((c) => /out of/i.test(c));
    if (i >= 0) {
      const n = /(\d+)\s*$/.exec(cells[i]) ?? /^\s*(\d+)/.exec(cells[i + 1] ?? '');
      if (n) outOf = Number(n[1]);
    }
  }

  // Topic text: the context, and lines naming chapters, modules, topics or inquiry questions.
  const topicLines = [context];
  for (const s of sections) {
    if (s.heading !== 'Outcomes' && s.heading !== 'Requirements' && s.heading !== 'Context') continue;
    for (const p of s.rows.flat(2)) {
      if (/\b(chapter|module|topic|unit)\s*\d|\?$|^topics? of study/i.test(p)) topicLines.push(p.replace(/^topics? of study:?/i, ''));
    }
  }
  const topicText = topicLines.filter(Boolean).join('\n');

  const warnings: string[] = [];
  if (!dateOptions.length) warnings.push('No date found. Pick it below.');
  if (dateOptions.length > 1) warnings.push('There is a different date for each class. Pick yours.');
  if (!subject) warnings.push('Subject not recognised. Pick it below.');
  // The submission section sometimes names a different week from the date row.
  const dateWeeks = [...new Set(weeks(dateRow ? valueOf(dateRow).join(' ') : ''))];
  const submitWeeks = [...new Set(weeks(sectionText('Submission')))];
  const odd = submitWeeks.filter((w) => !dateWeeks.includes(w));
  if (dateWeeks.length && odd.length) {
    warnings.push(
      `The submission instructions mention week ${odd.join(' and ')}, but the date says week ${dateWeeks.join(' and ')}. Check with your teacher which one is right.`,
    );
  }

  return {
    name,
    subject,
    kind,
    date: dateOptions[0]?.date ?? '',
    time: dateOptions[0]?.time,
    dateOptions,
    weighting,
    outOf,
    taskNumber: number,
    topicText,
    sections,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Skills and decks in scope

const STOP = new Set(
  'the and for with from into that this what does mean how are can its using use uses their than about other topic topics module unit chapter part year course applications introduction'.split(' '),
);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w))
    .map((w) => w.replace(/(ies)$/, 'y').replace(/s$/, ''));
}

/** Module numbers named in some text: "Module 5", "M5". */
function modules(text: string): number[] {
  return [...text.matchAll(/\b(?:module\s*|m)(\d{1,2})\b/gi)].map((m) => Number(m[1]));
}

/**
 * Whether a topic name (a skill's topic or a deck's module) is in scope:
 * a matching module number, or at least half its words in the notification's
 * topic text. A different module number rules it out.
 */
export function topicInScope(topic: string, topicText: string): boolean {
  if (!topic.trim()) return false;
  const named = modules(topicText);
  const own = modules(topic);
  if (own.length && named.length) return own.some((m) => named.includes(m));
  const want = words(topic);
  if (!want.length) return false;
  const have = new Set(words(topicText));
  const hits = want.filter((w) => have.has(w)).length;
  return hits >= Math.ceil(want.length / 2);
}

/** Top-level skills of the subject whose topic (or name) is in scope. */
export function skillsInScope(skills: Skill[], subject: string, topicText: string): string[] {
  return skills
    .filter((s) => s.subject === subject && !s.parentId && (topicInScope(s.topic, topicText) || (!s.topic && topicInScope(s.name, topicText))))
    .map((s) => s.id);
}

export function decksInScope(decks: Deck[], subject: string, topicText: string): string[] {
  return decks.filter((d) => d.subject === subject && (topicInScope(d.module, topicText) || topicInScope(d.name, topicText))).map((d) => d.id);
}

// ---------------------------------------------------------------------------
// Saving

/** An assessment already saved that this notification is about: same subject and task number, or same name. */
export function findExisting(plans: TestPlan[], subject: string, name: string, taskNumber?: number): TestPlan | undefined {
  const num = (n: string) => /^task\s*(\d+)\b/i.exec(n)?.[1];
  return plans.find(
    (p) =>
      p.subject === subject &&
      (p.name.trim().toLowerCase() === name.trim().toLowerCase() || (taskNumber !== undefined && num(p.name) === String(taskNumber))),
  );
}

export interface NotificationChoice {
  name: string;
  subject: string;
  kind: AssessmentKind;
  date: string;
  time?: string;
  weighting?: number;
  outOf?: number;
}

/**
 * The assessment to save for an uploaded notification. Updates an existing one
 * when it matches (keeping its id, mark and anything ticked by hand), and
 * ticks skills and decks whose topics the notification names.
 */
export function planFromNotification(
  parsed: ParsedNotification,
  choice: NotificationChoice,
  file: { fileName: string; fileId?: string },
  context: { plans: TestPlan[]; skills: Skill[]; decks: Deck[]; now: number; newId: () => string },
): { plan: TestPlan; existing?: TestPlan } {
  const existing = findExisting(context.plans, choice.subject, choice.name, parsed.taskNumber);
  const assignment = choice.kind === 'assignment';
  const skillIds = assignment ? [] : skillsInScope(context.skills, choice.subject, parsed.topicText);
  const deckIds = assignment ? [] : decksInScope(context.decks, choice.subject, parsed.topicText);
  const plan: TestPlan = {
    ...existing,
    id: existing?.id ?? context.newId(),
    created: existing?.created ?? context.now,
    name: choice.name.trim() || parsed.name,
    subject: choice.subject,
    kind: choice.kind,
    date: keyToTime(choice.date),
    time: choice.time,
    weighting: choice.weighting ?? existing?.weighting,
    outOf: choice.outOf ?? existing?.outOf,
    skillIds: [...new Set([...(existing?.skillIds ?? []), ...skillIds])],
    deckIds: [...new Set([...(existing?.deckIds ?? []), ...deckIds])],
    notification: {
      fileName: file.fileName,
      fileId: file.fileId,
      uploaded: context.now,
      sections: parsed.sections,
      dateOptions: parsed.dateOptions,
      warnings: parsed.warnings.filter((w) => !/^(No date found|Subject not recognised|There is a different date)/.test(w)),
    },
  };
  return { plan, existing };
}
