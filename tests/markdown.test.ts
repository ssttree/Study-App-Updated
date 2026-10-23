import { describe, expect, it } from 'vitest';
import { extractMath, plainText, renderMarkdown } from '../src/lib/markdown';

describe('extractMath', () => {
  it('finds inline and display maths', () => {
    const { pieces } = extractMath('Area is $\\pi r^2$ and\n$$\\int_0^1 x\\,dx$$');
    expect(pieces).toEqual([
      { tex: '\\pi r^2', display: false },
      { tex: '\\int_0^1 x\\,dx', display: true },
    ]);
  });

  it('leaves money amounts alone', () => {
    expect(extractMath('It costs $5 and $10 each').pieces).toEqual([]);
    expect(extractMath('Between $ 3 and 4$').pieces).toEqual([]);
  });

  it('treats \\$ as a plain dollar sign', () => {
    expect(extractMath('Price: \\$20, value $x$').pieces).toEqual([{ tex: 'x', display: false }]);
  });

  it('ignores dollar signs inside code', () => {
    expect(extractMath('Run `echo $HOME$` now').pieces).toEqual([]);
    expect(extractMath('```\n$a$\n```\nthen $b$').pieces).toEqual([{ tex: 'b', display: false }]);
  });

  it('keeps underscores and stars in maths away from Markdown', () => {
    const { html } = renderMarkdown('$a_1 * b_2 * c_3$');
    expect(html).not.toContain('<em>');
    expect(html).toContain('katex');
  });

  it('does not let inline maths cross a blank line', () => {
    expect(extractMath('$a\n\nb$').pieces).toEqual([]);
  });

  it('handles display maths spanning lines', () => {
    const { pieces } = extractMath('$$\n\\begin{aligned} x &= 1 \\\\ y &= 2 \\end{aligned}\n$$');
    expect(pieces).toHaveLength(1);
    expect(pieces[0].display).toBe(true);
  });
});

describe('renderMarkdown', () => {
  it('renders Markdown and maths together', () => {
    const { html, errors } = renderMarkdown('**Chain rule:** $\\frac{dy}{dx}$');
    expect(errors).toEqual([]);
    expect(html).toContain('<strong>Chain rule:</strong>');
    expect(html).toContain('class="katex"');
  });

  it('renders chemistry with \\ce', () => {
    const { errors } = renderMarkdown('$\\ce{N2 + 3H2 <=> 2NH3}$');
    expect(errors).toEqual([]);
  });

  it('reports maths errors instead of crashing', () => {
    const { html, errors } = renderMarkdown('Broken: $\\frac{1}{$ here');
    expect(errors).toHaveLength(1);
    expect(html).toContain('math-error');
  });

  it('makes single line breaks into breaks, like Obsidian', () => {
    expect(renderMarkdown('one\ntwo').html).toContain('<br');
  });
});

describe('plainText', () => {
  it('strips formatting for lists and search', () => {
    expect(plainText('**Bold** _it_\n\n$$x$$')).toBe('Bold it x');
  });
});
