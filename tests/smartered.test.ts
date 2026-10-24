import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { findEntries, pairEntries, parseHeader, type PageText } from '../src/lib/practice/smartered';

// Layout text only (headers, marks, titles) taken from real SmarterEd worksheets.
const load = (name: string): PageText[] =>
  JSON.parse(readFileSync(new URL(`./fixtures/smartered/${name}.json`, import.meta.url), 'utf8'));

describe('SmarterEd headers', () => {
  it('reads maths headers', () => {
    expect(parseHeader('1. Functions, EXT1 F2 2016 HSC 2 MC')).toEqual({
      number: 1,
      text: 'Functions, EXT1 F2 2016 HSC 2 MC',
      course: 'EXT1',
      code: 'F2',
      label: '2016 HSC Q2',
      mc: true,
    });
    const h = parseHeader('25. Functions, EXT1* F1 2019 HSC 11g')!;
    expect([h.course, h.code, h.label, h.mc]).toEqual(['EXT1', 'F1', '2019 HSC Q11g', false]);
    expect(parseHeader('14. Functions, EXT1 F1 SM-Bank 1')!.label).toBe('SM-Bank 1');
    expect(parseHeader('4. Functions, EXT1 F2 2019 MET2-N 3 MC')!.label).toBe('2019 MET2-N Q3');
  });

  it('reads chemistry headers', () => {
    const h = parseHeader('3. CHEMISTRY, M3 EQ-Bank 11157')!;
    expect([h.number, h.course, h.code, h.label, h.mc]).toEqual([3, '', 'M3', 'EQ-Bank 11157', false]);
  });

  it('ignores ordinary text', () => {
    expect(parseHeader('Questions')).toBeNull();
    expect(parseHeader('i. Find the values of')).toBeNull();
  });
});

describe('SmarterEd worksheets', () => {
  it('splits a two column maths worksheet into question and solution boxes', () => {
    const sheet = findEntries(load('rft'));
    expect(sheet.title).toBe('Remainder and Factor Theorems');
    expect(sheet.subject).toBe('Maths Extension 1');
    expect(sheet.topic).toBe('F2 Polynomials');
    expect(sheet.questions.map((q) => q.header.number)).toEqual([...Array(17).keys()].map((i) => i + 1));
    expect(sheet.solutions).toHaveLength(17);
    expect(sheet.questions[0].marks).toBe(1);
    expect(sheet.questions[9].marks).toBe(3); // Q10: 1 + 2 marks
    const pairs = pairEntries(sheet);
    expect(pairs.every((p) => p.solution)).toBe(true);
    // Q17 sits in the left column of page 3 and stops at the copyright line.
    const q17 = sheet.questions[16].regions;
    expect(q17).toHaveLength(1);
    expect(q17[0].page).toBe(2);
    expect(q17[0].bottom).toBeLessThan(160);
  });

  it('handles chemistry worksheets', () => {
    const sheet = findEntries(load('chem'));
    expect(sheet.title).toBe('Chemical Reactions');
    expect(sheet.subject).toBe('Chemistry');
    expect(sheet.code).toBe('M3');
    expect(sheet.questions).toHaveLength(11);
    expect(sheet.questions[0].marks).toBe(3);
    expect(pairEntries(sheet).filter((p) => p.solution)).toHaveLength(11);
  });

  it('follows long solutions into the next column', () => {
    const sheet = findEntries(load('ineq'));
    expect(sheet.questions).toHaveLength(31);
    expect(sheet.solutions).toHaveLength(31);
    const nine = sheet.solutions.find((s) => s.header.number === 9)!;
    expect(nine.regions.length).toBeGreaterThan(1);
    expect(nine.regions[1].continued).toBe(true);
  });
});

describe('other PDFs', () => {
  it('does not mistake numbered notes for SmarterEd headers', () => {
    expect(parseHeader('3. and iodides are, insoluble')).toBeNull();
    expect(parseHeader('2. Sodium, chloride is formed')).toBeNull();
  });
});
