// Loads what the practice screens need in one go.

import { getSettings, listAttempts, listProblems, listSkills, listTestPlans } from '../db';
import { studyDayEnd } from '../queue';
import type { Settings } from '../types';
import type { PracticeData } from './mix';

export interface PracticeCollection extends PracticeData {
  settings: Settings;
  dayEnd: number;
}

export async function loadPractice(now = Date.now()): Promise<PracticeCollection> {
  const [settings, skills, problems, attempts, plans] = await Promise.all([
    getSettings(),
    listSkills(),
    listProblems(),
    listAttempts(),
    listTestPlans(),
  ]);
  return { settings, skills, problems, attempts, plans, dayEnd: studyDayEnd(now, settings.dayStartHour) };
}

/** "Maths Extension 1" -> "Ext 1", for tight spaces. */
export function shortSubject(subject: string): string {
  return subject.replace(/^Maths Extension /, 'Ext ').replace(/^Maths Advanced$/, 'Maths Adv');
}

const DAY = 86_400_000;

/** "today", "tomorrow", "in 5 days", "3 days ago". */
export function relativeDay(ts: number, dayEnd: number): string {
  const days = Math.ceil((ts - dayEnd) / DAY);
  if (days <= 0 && ts > dayEnd - DAY) return 'today';
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} ago`;
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}
