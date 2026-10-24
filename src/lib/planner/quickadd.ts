// Quick add: one short line becomes a homework task, so adding one mid-lesson
// takes a few seconds. "chem finish q5-10 fri 20m" is a Chemistry task due
// Friday that should take 20 minutes. Anything it can't find gets a default.

import type { TaskType } from '../types';
import { addDays, dateKey, weekday } from './dates';

export const DEFAULT_MINUTES = 20;
export const QUICK_MINUTES = [10, 20, 30, 60] as const;

/** Short names you can type for each subject. Checked as whole words. */
export const SUBJECT_WORDS: Record<string, string> = {
  adv: 'Maths Advanced',
  advanced: 'Maths Advanced',
  maths: 'Maths Advanced',
  math: 'Maths Advanced',
  ext1: 'Maths Extension 1',
  x1: 'Maths Extension 1',
  e1: 'Maths Extension 1',
  ext2: 'Maths Extension 2',
  x2: 'Maths Extension 2',
  e2: 'Maths Extension 2',
  english: 'English Advanced',
  eng: 'English Advanced',
  chem: 'Chemistry',
  chemistry: 'Chemistry',
  bus: 'Business Studies',
  business: 'Business Studies',
  biz: 'Business Studies',
  engin: 'Engineering Studies',
  engineering: 'Engineering Studies',
  engg: 'Engineering Studies',
};

const DAY_WORDS: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

const TYPE_WORDS: Record<string, TaskType> = {
  set: 'smartered',
  smartered: 'smartered',
  smarted: 'smartered',
  worksheet: 'smartered',
  assignment: 'assignment',
  assn: 'assignment',
};

export interface QuickTask {
  title: string;
  subject: string;
  type: TaskType;
  due: string;
  minutes: number;
  required: boolean;
  /** What was worked out from the line, for the preview under the box. */
  found: { subject: boolean; due: boolean; minutes: boolean; type: boolean; optional: boolean };
}

/** Parses one quick add line. `today` is the current date key. */
export function parseQuickAdd(line: string, today: string): QuickTask {
  const found = { subject: false, due: false, minutes: false, type: false, optional: false };
  let subject = '';
  let due = '';
  let minutes = 0;
  let type: TaskType = 'classwork';
  let required = true;
  const words = line.trim().split(/\s+/).filter(Boolean);
  const keep: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const raw = words[i];
    const w = raw.toLowerCase().replace(/[.,;]+$/, '');
    // "ext 1", "ext 2", "x 1"
    if ((w === 'ext' || w === 'x') && /^[12]$/.test(words[i + 1] ?? '') && !found.subject) {
      subject = SUBJECT_WORDS['ext' + words[i + 1]];
      found.subject = true;
      i++;
      continue;
    }
    if (!found.subject && SUBJECT_WORDS[w]) {
      subject = SUBJECT_WORDS[w];
      found.subject = true;
      continue;
    }
    if (!found.due) {
      const d = dueWord(w, words[i + 1]?.toLowerCase(), today);
      if (d) {
        due = d.key;
        found.due = true;
        i += d.used - 1;
        continue;
      }
    }
    if (!found.minutes) {
      const m = minutesWord(w);
      if (m) {
        minutes = m;
        found.minutes = true;
        continue;
      }
    }
    if (w === 'opt' || w === 'optional' || w === '?') {
      required = false;
      found.optional = true;
      continue;
    }
    if (!found.type && TYPE_WORDS[w]) {
      type = TYPE_WORDS[w];
      found.type = true;
      // "set" and "assignment" also read well in the title, so keep them.
      keep.push(raw);
      continue;
    }
    keep.push(raw);
  }

  let title = keep.join(' ').trim();
  if (!title) title = type === 'smartered' ? 'SmarterEd set' : 'Homework';
  title = title[0].toUpperCase() + title.slice(1);
  return {
    title,
    subject,
    type,
    due: due || addDays(today, 1),
    minutes: minutes || DEFAULT_MINUTES,
    required,
    found,
  };
}

function dueWord(w: string, next: string | undefined, today: string): { key: string; used: number } | null {
  if (w === 'today' || w === 'tonight' || w === 'tod') return { key: today, used: 1 };
  if (['tomorrow', 'tmr', 'tmrw', 'tom', 'tomoz'].includes(w)) return { key: addDays(today, 1), used: 1 };
  if (w === 'week' || w === 'wk') return { key: addDays(today, 7), used: 1 };
  if (w in DAY_WORDS) return { key: nextWeekday(today, DAY_WORDS[w]), used: 1 };
  // "next fri" is the Friday of next week.
  if (w === 'next' && next) {
    const n = next.replace(/[.,;]+$/, '');
    if (n in DAY_WORDS) {
      const thisWeek = nextWeekday(today, DAY_WORDS[n]);
      const sundayAfterToday = addDays(today, (7 - weekday(today)) % 7);
      return { key: thisWeek <= sundayAfterToday ? addDays(thisWeek, 7) : thisWeek, used: 2 };
    }
    if (n === 'week' || n === 'wk') return { key: addDays(today, 7), used: 2 };
  }
  // 3/11, 3/11/26, 3/11/2026 (day first, as in Australia)
  const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(w);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    let year = slash[3] ? Number(slash[3]) : Number(today.slice(0, 4));
    if (year < 100) year += 2000;
    let key = dateKey(new Date(year, month - 1, day).getTime());
    // No year and already past: they mean next year.
    if (!slash[3] && key < today) key = dateKey(new Date(year + 1, month - 1, day).getTime());
    return { key, used: 1 };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return { key: w, used: 1 };
  return null;
}

/** The next time this weekday comes round, never today. */
function nextWeekday(today: string, day: number): string {
  const diff = (day - weekday(today) + 7) % 7 || 7;
  return addDays(today, diff);
}

/** "20m", "20min", "1h", "1.5h", "1h30", "1h30m", "90mins". */
function minutesWord(w: string): number {
  let m = /^(\d+)(?:m|min|mins)$/.exec(w);
  if (m) return clampMinutes(Number(m[1]));
  m = /^(\d+(?:\.\d+)?)(?:h|hr|hrs)(?:(\d+)m?)?$/.exec(w);
  if (m) return clampMinutes(Math.round(Number(m[1]) * 60 + Number(m[2] ?? 0)));
  return 0;
}

function clampMinutes(n: number): number {
  return Math.max(5, Math.min(600, n));
}

/** Works out a subject from a lesson's name, like "12 Chemistry" or "Maths Ext 1". */
export function subjectFromTitle(title: string | null): string {
  if (!title) return '';
  const t = title.toLowerCase();
  if (/ext(ension)?\.?\s*2|\bx2\b|\bme2\b|\bmx2\b/.test(t)) return 'Maths Extension 2';
  if (/ext(ension)?\.?\s*1|\bx1\b|\bme1\b|\bmx1\b/.test(t)) return 'Maths Extension 1';
  if (/chem/.test(t)) return 'Chemistry';
  if (/engineering|\bengin|\begs\b|\beng\s*stud/.test(t)) return 'Engineering Studies';
  if (/english|\beng\b|\benga?\b/.test(t)) return 'English Advanced';
  if (/business|\bbus\b|\bbst?\b/.test(t)) return 'Business Studies';
  if (/math|\bmaa\b|\badv/.test(t)) return 'Maths Advanced';
  return '';
}

/** "Maths Extension 1" -> "Ext 1", for tight spaces. */
export function shortSubject(subject: string): string {
  return subject.replace(/^Maths Extension /, 'Ext ').replace(/^Maths Advanced$/, 'Maths Adv');
}
