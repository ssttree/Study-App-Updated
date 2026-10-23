/// <reference types="node" />
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { readApkg, AnkiReadError } from '../src/lib/anki/read';
import { planImport, type DraftCard } from '../src/lib/anki/convert';
import { htmlToMarkdown, renderCloze, renderTemplate } from '../src/lib/anki/html';
import { defaultChoice, draftToCard, fillPictures, guessSubject } from '../src/lib/anki/import';
import { renderMarkdown } from '../src/lib/markdown';

// Both fixtures were exported from real Anki (version 26.9, via the
// `anki` Python package): the same notes in the new and the legacy format.
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs();
});

describe.each(['sample-new.apkg', 'sample-legacy.apkg'])('reading %s', (file) => {
  const plan = () => planImport(readApkg(fixture(file), SQL));
  const find = (front: string): DraftCard => {
    const card = plan()
      .groups.flatMap((g) => g.cards)
      .find((c) => c.front.includes(front));
    if (!card) throw new Error(`no card with front ${front}`);
    return card;
  };

  it('reads decks, media and notes', () => {
    const col = readApkg(fixture(file), SQL);
    expect([...col.decks.values()]).toContain('Chemistry::Module 5 Equilibrium');
    expect(col.media.get('dot.png')?.[1]).toBe(0x50); // "P" of the PNG header
    expect(col.notes).toHaveLength(7);
  });

  it('groups cards by Anki deck', () => {
    const p = plan();
    expect(p.groups.map((g) => [g.path, g.cards.length])).toEqual([
      ['Chemistry::Module 5 Equilibrium', 4],
      ['Maths Ext 1::Calculus', 4],
    ]);
    expect(p.audioRemoved).toBe(1);
    expect(p.missingImages).toEqual([]);
  });

  it('turns HTML into Markdown and keeps tags', () => {
    const c = find('Le Chatelier');
    expect(c.front).toBe("What does Le Chatelier's principle say?");
    expect(c.back).toBe('A system at equilibrium **shifts** to oppose a change.\nCosts \\$5 to learn');
    expect(c.tags).toEqual(['equilibrium', 'Module5']);
    expect(c.type).toBe('basic');
  });

  it('makes "and reversed" notes into one reversed card', () => {
    expect(find('H<sub>2</sub>O').type).toBe('reversed');
    // Optional reverse with the field left empty: only one way.
    expect(find('pH of pure water').type).toBe('basic');
  });

  it('turns type-in-the-answer notes into typed cards', () => {
    const c = find('Symbol for sodium');
    expect(c.typing).toBe('always');
    expect(c.answer).toBe('Na');
    expect(c.back).toBe('Na');
  });

  it('converts maths, keeps pictures and drops sound', () => {
    const c = find('Derivative');
    expect(c.front).toBe('Derivative of $\\sin x$?');
    expect(c.back).toBe('$$\\frac{d}{dx}\\sin x = \\cos x$$\n![](anki-media:dot.png)');
    expect(c.images).toEqual(['dot.png']);
    expect(renderMarkdown(c.back).errors).toEqual([]);
  });

  it('makes one card per cloze', () => {
    const cards = plan().groups.flatMap((g) => g.cards).filter((c) => c.front.startsWith('The chain rule'));
    expect(cards.map((c) => c.front)).toEqual([
      'The chain rule: **[...]** and product rule is different',
      "The chain rule: $f'(g(x))g'(x)$ and **[name]** is different",
    ]);
    expect(cards[0].back).toBe("The chain rule: **$f'(g(x))g'(x)$** and product rule is different\nsee notes");
    expect(cards[1].answer).toBe('product rule');
    expect(cards.map((c) => c.source.endsWith(':c1') || c.source.endsWith(':c2'))).toEqual([true, true]);
  });

  it('skips cards that were imported before', () => {
    const first = plan();
    const sources = new Set(first.groups.flatMap((g) => g.cards.map((c) => c.source)));
    const again = planImport(readApkg(fixture(file), SQL), sources);
    expect(again.groups).toEqual([]);
    expect(again.alreadyImported).toBe(8);
  });
});

describe('Anki HTML', () => {
  it('handles lists, entities and spacing', () => {
    expect(htmlToMarkdown('<ul><li>one</li><li>two &amp; three</li></ul>').markdown).toBe('- one\n- two & three');
    expect(htmlToMarkdown('<ol><li>a</li><li>b</li></ol>').markdown).toBe('1. a\n2. b');
    expect(htmlToMarkdown('a&nbsp;&lt; b').markdown).toBe('a < b');
    expect(htmlToMarkdown('<b> bold </b>word').markdown).toBe('**bold** word');
    expect(htmlToMarkdown('<div>line one</div><div>line two</div>').markdown).toBe('line one\nline two');
  });

  it('keeps maths exactly, even with < and *', () => {
    expect(htmlToMarkdown('\\(a &lt; b^*\\) and \\[x\\]').markdown).toBe('$a < b^*$ and $$x$$');
    expect(htmlToMarkdown('[$]x^2[/$]').markdown).toBe('$x^2$');
    expect(htmlToMarkdown('2 * 3 * 4').markdown).toBe('2 \\* 3 \\* 4');
  });

  it('keeps chemistry subscripts and tables', () => {
    expect(htmlToMarkdown('CO<sub>2</sub>').markdown).toBe('CO<sub>2</sub>');
    const t = htmlToMarkdown('<table style="x"><tr><td>a</td></tr>\n</table>after').markdown;
    expect(t).toBe('<table><tr><td>a</td></tr> </table>\n\nafter');
  });

  it('fills in templates and keeps only the answer part of the back', () => {
    const fields = { Front: 'Q', Back: 'A', Hint: '' };
    const q = renderTemplate('{{Front}}{{#Hint}}<i>{{Hint}}</i>{{/Hint}}', { fields, side: 'question' });
    expect(q.html).toBe('Q');
    const a = renderTemplate('{{FrontSide}}<hr id=answer>{{Back}}', { fields, side: 'answer', frontSide: q.html });
    expect(a.html).toBe('A');
  });

  it('does not put bold inside maths for a cloze', () => {
    expect(renderCloze('\\(x = {{c1::2}}\\)', 1, 'question')).toBe('\\(x = [...]\\)');
    expect(renderCloze('\\(x = {{c1::2}}\\)', 1, 'answer')).toBe('\\(x = 2\\)');
  });
});

describe('import choices', () => {
  it('guesses subjects from deck names', () => {
    expect(guessSubject('Maths Ext 1::Calculus')).toBe('Maths Extension 1');
    expect(guessSubject('HSC::Extension 2 Complex')).toBe('Maths Extension 2');
    expect(guessSubject('Chem::Mod 6')).toBe('Chemistry');
    expect(guessSubject('Random')).toBe('Other');
  });

  it('names a new deck after the Anki deck', () => {
    const c = defaultChoice({ ankiDeckId: 1, path: 'Chemistry::Module 5 Equilibrium', cards: [] });
    expect(c.destination).toEqual({ kind: 'new', name: 'Module 5 Equilibrium', subject: 'Chemistry', module: '' });
  });

  it('builds fresh FSRS cards with pictures filled in', () => {
    const urls = new Map([['dot.png', 'data:image/png;base64,AAAA']]);
    expect(fillPictures('x ![](anki-media:dot.png) ![](anki-media:gone.png)', urls)).toBe('x ![](data:image/png;base64,AAAA)');
    const card = draftToCard(
      { front: 'f', back: 'b', type: 'reversed', typing: 'deck', tags: [], source: 'anki:1', frontImage: 'dot.png', images: ['dot.png'] },
      'deck1',
      '',
      urls,
      1000,
    );
    expect(card.image).toBe('data:image/png;base64,AAAA');
    expect(card.fsrs.state).toBe(0);
    expect(card.fsrsReverse?.state).toBe(0);
    expect(card.source).toBe('anki:1');
  });
});

it('explains a file that is not an Anki deck', () => {
  expect(() => readApkg(new Uint8Array([1, 2, 3]), SQL)).toThrow(AnkiReadError);
});
