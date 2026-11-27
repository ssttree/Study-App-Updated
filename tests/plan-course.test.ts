import { describe, expect, it } from 'vitest';
import { extensionSplit, planCourseChoice } from '../src/lib/practice/course';
import type { Problem } from '../src/lib/types';

const BOOK = 'Maths in Focus: Year 12 Mathematics Extension 1';
const EXT1 = 'Mathematics Extension 1';
const prob = (skillId: string, section: string, n: number): Problem => ({
  id: `${section}-${n}`,
  skillId,
  source: 'textbook',
  label: '',
  from: '',
  key: `book:${BOOK}:${section}:${n}`,
  marks: 2,
  mc: false,
  questionImage: '',
  order: 0,
  created: 0,
});

describe('test plan course', () => {
  it('Extension tests practise the Extension questions unless told otherwise', () => {
    expect(planCourseChoice({ subject: EXT1 }, undefined)).toBe('extension');
    expect(planCourseChoice({ subject: EXT1 }, 'advanced')).toBe('extension');
    expect(planCourseChoice({ subject: EXT1, course: 'both' }, 'extension')).toBeUndefined();
    expect(planCourseChoice({ subject: EXT1, course: 'advanced' }, undefined)).toBe('advanced');
  });

  it('other subjects keep the usual setting', () => {
    expect(planCourseChoice({ subject: 'Chemistry' }, undefined)).toBeUndefined();
    expect(planCourseChoice({ subject: 'Chemistry', course: 'advanced' }, 'extension')).toBe('extension');
  });
});

describe('Extension split per skill', () => {
  const problems = [
    prob('a', '3.01', 1),
    prob('a', '3.01', 2),
    prob('b', '3.02', 7),
    prob('b', '3.02', 8), // marked EXT1 in the book
    prob('c', '3.06', 1),
    prob('c', '3.06', 2),
    prob('kid', '3.06', 3),
    prob('d', 'challenge3', 2),
    prob('d', 'challenge3', 3),
  ];
  const split = (ids: string[]) => extensionSplit(new Set(ids), problems, EXT1);

  it('counts Extension and Advanced questions', () => {
    expect(split(['a'])).toEqual({ ext: 0, lower: 2 });
    expect(split(['b'])).toEqual({ ext: 1, lower: 1 });
    expect(split(['d'])).toEqual({ ext: 1, lower: 1 });
  });

  it('includes sub-skills when given', () => {
    expect(split(['c', 'kid'])).toEqual({ ext: 3, lower: 0 });
  });
});
