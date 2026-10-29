import { describe, expect, it } from 'vitest';
import { markFromRow, parseMarkText, parseMarksMarkdown, parseRankText, rankText } from '../src/lib/progress/marktext';

describe('mark and rank text', () => {
  it('reads marks', () => {
    expect(parseMarkText('58/60')).toEqual({ mark: 58, outOf: 60 });
    expect(parseMarkText(' 29.5 / 30 ')).toEqual({ mark: 29.5, outOf: 30 });
    expect(parseMarkText('41 out of 50')).toEqual({ mark: 41, outOf: 50 });
    expect(parseMarkText('87%')).toEqual({ mark: 87, outOf: 100 });
    expect(parseMarkText('58')).toBeNull();
  });

  it('reads ranks, tied or not', () => {
    expect(parseRankText('=5')).toEqual({ rank: 5, rankOf: undefined, tied: true });
    expect(parseRankText('5')).toEqual({ rank: 5, rankOf: undefined, tied: false });
    expect(parseRankText('3rd')).toMatchObject({ rank: 3, tied: false });
    expect(parseRankText('=2/24')).toEqual({ rank: 2, rankOf: 24, tied: true });
    expect(parseRankText('rank 4 of 30')).toEqual({ rank: 4, rankOf: 30, tied: false });
    expect(parseRankText('five')).toBeNull();
    expect(rankText({ rank: 5, rankTied: true })).toBe('=5');
    expect(rankText({ rank: 2, rankOf: 24 })).toBe('2/24');
  });
});

describe('Year 11 Markdown import', () => {
  it('reads headings with one task per line', () => {
    const rows = parseMarksMarkdown(
      [
        '# Year 11 marks',
        '',
        '## Chemistry',
        '- Module 1 test: 58/60, rank =5, 14/3/2025',
        '- Depth study - 27/30 - rank 2',
        '',
        '## Maths Extension 1',
        '* Term 2 test 41/50 =3',
      ].join('\n'),
      2025,
    );
    expect(rows.filter((r) => !r.ok)).toEqual([]);
    expect(rows).toMatchObject([
      { subject: 'Chemistry', name: 'Module 1 test', date: '2025-03-14', mark: { mark: 58, outOf: 60 }, rank: { rank: 5, tied: true } },
      { subject: 'Chemistry', name: 'Depth study', datePlaced: true, mark: { mark: 27, outOf: 30 }, rank: { rank: 2, tied: false } },
      { subject: 'Maths Extension 1', name: 'Term 2 test', date: '2025-06-15', rank: { rank: 3, tied: true } },
    ]);
  });

  it('reads a table', () => {
    const rows = parseMarksMarkdown(
      [
        '| Subject | Task | Date | Mark | Rank |',
        '|---|---|---|---|---|',
        '| Chemistry | Module 2 test | 2025-05-20 | 50/60 | =7 |',
        '| Ext 1 | Half yearly | | 70/80 | 4 |',
        '| Maths Adv | Yearly | 1/11/2025 | ninety | 2 |',
      ].join('\n'),
      2025,
    );
    expect(rows[0]).toMatchObject({ ok: true, subject: 'Chemistry', name: 'Module 2 test', date: '2025-05-20', rank: { rank: 7, tied: true } });
    expect(rows[1]).toMatchObject({ ok: true, subject: 'Maths Extension 1', name: 'Half yearly', mark: { mark: 70, outOf: 80 } });
    expect(rows[2]).toMatchObject({ ok: false, line: 5 });
  });

  it('flags lines it cannot place and updates tasks already saved', () => {
    const rows = parseMarksMarkdown('- Some test 10/20\n\n## Chemistry\n- Assignment, rank 4\nNotes about the year.', 2025);
    expect(rows).toMatchObject([{ ok: false, line: 1 }, { ok: false, line: 4, problem: 'No mark like 58/60.' }]);
    const [row] = parseMarksMarkdown('## Chemistry\n- Module 1 test 59/60 =4', 2025);
    if (!row.ok) throw new Error('should read');
    const old = { id: 'm1', subject: 'Chemistry', name: 'module 1 test', date: '2025-03-14', mark: 50, outOf: 60, year: 11 as const, topics: [], created: 1 };
    expect(markFromRow(row, [old], () => 'new')).toMatchObject({ id: 'm1', mark: 59, rank: 4, rankTied: true, created: 1 });
  });
});
