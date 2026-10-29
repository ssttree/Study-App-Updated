// Marks as you'd write them: "58/60" for the mark and "=5" for a rank tied
// with someone else. Also reads a whole Markdown file of Year 11 tasks, so
// the baseline goes in at once instead of one form at a time.

import { subjectFromTitle } from '../planner/quickadd';
import { dateKey } from '../planner/dates';
import { PROGRESS_SUBJECTS } from './recall';
import type { Mark } from '../types';

export interface MarkValue {
  mark: number;
  outOf: number;
}

export interface RankValue {
  rank: number;
  rankOf?: number;
  /** "=5": tied with someone else. */
  tied: boolean;
}

/** "58/60", "58 / 60", "58 out of 60", "29.5/30" or "97%". Null when it can't be read. */
export function parseMarkText(text: string): MarkValue | null {
  const t = text.trim().toLowerCase();
  let m = /^(\d+(?:\.\d+)?)\s*(?:\/|out of|of)\s*(\d+(?:\.\d+)?)$/.exec(t);
  if (m) return { mark: Number(m[1]), outOf: Number(m[2]) };
  m = /^(\d+(?:\.\d+)?)\s*%$/.exec(t);
  if (m) return { mark: Number(m[1]), outOf: 100 };
  return null;
}

/** "=5", "5", "5th", "=5/24", "5 of 24". Null when it can't be read. */
export function parseRankText(text: string): RankValue | null {
  const t = text.trim().toLowerCase().replace(/^(?:rank(?:ed)?|position|place)\s*:?\s*/, '');
  const m = /^(=)?\s*(\d+)(?:st|nd|rd|th)?(?:\s*(?:\/|out of|of)\s*(\d+))?$/.exec(t);
  if (!m || Number(m[2]) < 1) return null;
  return { rank: Number(m[2]), rankOf: m[3] ? Number(m[3]) : undefined, tied: !!m[1] };
}

export function markText(m: Pick<Mark, 'mark' | 'outOf'>): string {
  return `${m.mark}/${m.outOf}`;
}

/** "=5/24", "5", or "" with no rank. */
export function rankText(m: Pick<Mark, 'rank' | 'rankOf' | 'rankTied'>): string {
  if (!m.rank) return '';
  return `${m.rankTied ? '=' : ''}${m.rank}${m.rankOf ? '/' + m.rankOf : ''}`;
}

/** One task read from the file, or the line it couldn't read. */
export type ImportRow =
  | { ok: true; line: number; subject: string; name: string; date: string; datePlaced: boolean; mark: MarkValue; rank: RankValue | null }
  | { ok: false; line: number; text: string; problem: string };

/** The subject a heading, cell or line names, if any. */
function subjectIn(text: string): string {
  const s = subjectFromTitle(text);
  return (PROGRESS_SUBJECTS as readonly string[]).includes(s) ? s : '';
}

/** Rough term dates, for tasks given as "Term 2" with no date. */
const TERM_MONTH = [3, 6, 9, 11];

function dateIn(text: string, year: number): string {
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(text);
  if (m) {
    const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    return dateKey(new Date(y, Number(m[2]) - 1, Number(m[1])).getTime());
  }
  m = /\b(?:term|t)\s*([1-4])\b/i.exec(text);
  if (m) return dateKey(new Date(year, TERM_MONTH[Number(m[1]) - 1] - 1, 15).getTime());
  return '';
}

const MARK_IN = /(\d+(?:\.\d+)?)\s*(?:\/|out of)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*%/i;
const RANK_IN = /(?:\brank(?:ed)?|\bposition|\bplace)\s*:?\s*(=?\s*\d+(?:\s*(?:\/|of)\s*\d+)?)|(?:^|[\s,;|(])(=\s*\d+(?:\s*\/\s*\d+)?)/i;
const DATE_IN = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2})\b/;

const COLUMNS: Record<string, RegExp> = {
  subject: /^(subject|course|class)$/,
  name: /^(task|name|assessment|test|title|what)$/,
  date: /^(date|when|due|term)$/,
  mark: /^(mark|marks|result|score|grade)$/,
  outOf: /^(out of|total|max)$/,
  rank: /^(rank|position|place)$/,
  rankOf: /^(rank out of|of how many|cohort|class size)$/,
};

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/**
 * Reads Year 11 tasks from Markdown. Either a table with columns like
 * Subject | Task | Date | Mark | Rank, or headings for subjects with one task
 * per line under them: "- Module 1 test, 58/60, rank =5, 14/3/2025".
 * `year` is the calendar year of Year 11, used for "Term 2" and missing dates.
 */
export function parseMarksMarkdown(text: string, year: number): ImportRow[] {
  const rows: ImportRow[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let subject = '';
  let header: string[] | null = null;
  let placed = 0;
  // A task with no date keeps its order in the file: one a fortnight from February.
  const fallbackDate = () => dateKey(new Date(year, 1, 1 + 14 * placed++).getTime());

  const push = (line: number, raw: string, f: { subject: string; name: string; date: string; mark: string; rank: string }) => {
    const mark = parseMarkText(f.mark);
    if (!f.subject) return rows.push({ ok: false, line, text: raw, problem: 'No subject. Put it under a subject heading or in a Subject column.' });
    if (!mark) return rows.push({ ok: false, line, text: raw, problem: 'No mark like 58/60.' });
    if (mark.outOf <= 0 || mark.mark > mark.outOf) return rows.push({ ok: false, line, text: raw, problem: 'The mark is more than the total.' });
    const rank = f.rank ? parseRankText(f.rank) : null;
    if (f.rank && !rank) return rows.push({ ok: false, line, text: raw, problem: `Couldn't read the rank "${f.rank}". Write it like =5 or 5.` });
    const date = dateIn(f.date, year);
    rows.push({ ok: true, line, subject: f.subject, name: f.name || 'Task', date: date || fallbackDate(), datePlaced: !date, mark, rank });
  };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    const n = i + 1;
    if (!line) {
      header = null;
      return;
    }
    // Table rows.
    if (line.startsWith('|')) {
      const c = cells(line);
      if (c.every((x) => /^:?-{2,}:?$/.test(x))) return;
      if (!header) {
        const lower = c.map((x) => x.toLowerCase().replace(/[*_]/g, ''));
        if (lower.some((x) => COLUMNS.mark.test(x))) {
          header = lower.map((x) => Object.keys(COLUMNS).find((k) => COLUMNS[k].test(x)) ?? '');
          return;
        }
      }
      if (header) {
        const get = (k: string) => c[header!.indexOf(k)] ?? '';
        const outOf = get('outOf');
        const rankOf = get('rankOf');
        const mark = outOf && /^\d/.test(get('mark')) && !get('mark').includes('/') ? `${get('mark')}/${outOf}` : get('mark');
        const rank = rankOf && get('rank') && !get('rank').includes('/') ? `${get('rank')}/${rankOf}` : get('rank');
        push(n, raw, { subject: subjectIn(get('subject')) || subject, name: get('name'), date: get('date'), mark, rank });
        return;
      }
    }
    header = null;
    // Headings name the subject for the lines below them.
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      subject = subjectIn(heading[1]) || subject;
      return;
    }
    const listed = /^(?:[-*+]|\d+[.)])\s+/.test(line);
    const body = line.replace(/^(?:[-*+]|\d+[.)])\s+/, '');
    const markMatch = MARK_IN.exec(body);
    if (!markMatch) {
      // A line that is only a subject name works like a heading.
      const s = subjectIn(body.replace(/[*_:]/g, ''));
      if (s && body.length < 40) subject = s;
      // A task in a list with no mark is a mistake worth showing; other text is just notes.
      else if (listed) rows.push({ ok: false, line: n, text: raw, problem: 'No mark like 58/60.' });
      return;
    }
    const rankMatch = RANK_IN.exec(body.replace(markMatch[0], ' '));
    const dateMatch = DATE_IN.exec(body);
    // The name is what's left once the mark, rank and date are taken out. "Term 2" stays in it.
    let name = body;
    for (const m of [markMatch[0], rankMatch?.[0], dateMatch?.[0]]) if (m) name = name.replace(m, ' ');
    name = name
      .replace(/\b(?:mark|result|score)\s*:?/gi, ' ')
      .replace(/[(),;|:–—-]+\s*$/g, '')
      .replace(/\s*[(),;|]\s*/g, ' ')
      .replace(/\s+[-–—:]\s+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[-–—:,]$/, '')
      .trim();
    const own = subjectIn(name.split(/\s+/).slice(0, 3).join(' '));
    push(n, raw, {
      subject: subject || own,
      name,
      date: dateMatch?.[0] ?? body,
      mark: markMatch[0],
      rank: (rankMatch?.[1] ?? rankMatch?.[2] ?? '').replace(/\s+/g, ''),
    });
  });
  return rows;
}

/** A Mark from an imported row. An existing Year 11 task with the same subject and name is updated. */
export function markFromRow(row: Extract<ImportRow, { ok: true }>, existing: Mark[], makeId: () => string, now = Date.now()): Mark {
  const same = existing.find((m) => m.year === 11 && m.subject === row.subject && m.name.toLowerCase() === row.name.toLowerCase());
  return {
    id: same?.id ?? makeId(),
    subject: row.subject,
    name: row.name,
    date: row.date,
    mark: row.mark.mark,
    outOf: row.mark.outOf,
    rank: row.rank?.rank,
    rankOf: row.rank?.rankOf,
    rankTied: row.rank?.tied || undefined,
    year: 11,
    topics: [],
    created: same?.created ?? now,
  };
}
