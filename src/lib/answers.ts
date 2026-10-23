// Checks typed answers. The aim is to mark an answer right when it means the
// same thing, without making you type LaTeX:
// - lists count in any order: "barium, calcium" matches "calcium, barium"
// - chemistry can be typed plainly: "N2 + 3H2 <=> 2NH3", reactants in any order
// - words ignore capitals, but formulas keep them (Co is cobalt, CO is not)
// - "|" in an answer key separates other accepted answers

import type { Card, Direction } from './types';

export type Verdict = 'correct' | 'close' | 'wrong' | 'empty';

export interface CheckResult {
  verdict: Verdict;
  /** A short hint, e.g. "Check your capitals" or "2 of 3 right". */
  note?: string;
}

const SUBSCRIPTS: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-',
};

/** Turns the different ways of writing arrows and subscripts into one plain form. */
export function toPlain(text: string): string {
  let s = text ?? '';
  // LaTeX wrappers people might copy in: \ce{...}, \text{...}, \mathrm{...}
  for (let i = 0; i < 5; i++) s = s.replace(/\\(?:ce|text|mathrm|textrm|mathbf)\s*\{([^{}]*)\}/g, '$1');
  s = s
    .replace(/\$+/g, '')
    .replace(/\\(?:left|right)(?![a-z])|\\[,;:!]|\\quad/g, ' ')
    .replace(/\*\*|__|`/g, '')
    // LaTeX subscripts and braces: O_2 and O_{2} are typed as O2, x^{2} as x^2.
    .replace(/_\{([^{}]*)\}/g, '$1')
    .replace(/_([A-Za-z0-9+-])/g, '$1')
    .replace(/\^\{([^{}]*)\}/g, '^$1')
    .replace(/[₀-₉⁰-⁹¹²³⁺⁻]/g, (c) => SUBSCRIPTS[c] ?? c)
    .replace(/\\rightleftharpoons|\\leftrightharpoons|⇌|⇋|⇄|<-+>|<=+>/g, ' \u0001 ')
    .replace(/\\longrightarrow|\\rightarrow|\\to\b|→|-+>|=+>/g, ' \u0002 ')
    .replace(/\u0001/g, '<=>')
    .replace(/\u0002/g, '->')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

/** The text a typed answer is checked against for this card and direction. */
export function answerKey(card: Card, direction: Direction): string {
  if (direction === 'forward' && card.answer?.trim()) return card.answer.trim();
  const side = direction === 'forward' ? card.back : card.front;
  // Without a separate answer, use the first line: the rest is usually explanation.
  const first = (side ?? '').split('\n').find((l) => l.trim() !== '') ?? '';
  return first.replace(/^#+\s*|^[-*]\s+/, '').trim();
}

/** Looks like a chemical formula, so capitals matter: NaCl, CO2, SO4^2-, Fe(OH)3. */
export function isFormula(item: string): boolean {
  const core = item.replace(/^\d+/, '').replace(/\^?\d*[+-]$/, '').replace(/\((?:s|l|g|aq)\)$/, '');
  if (!/^(?:[A-Z][a-z]?\d*|\([A-Za-z0-9]+\)\d*)+$/.test(core)) return false;
  const capitals = (core.match(/[A-Z]/g) ?? []).length;
  return /\d/.test(core) || capitals >= 2 || /[+-]$/.test(item);
}

function squash(s: string): string {
  // State symbols like (g) or (aq) are optional when typing.
  return s.replace(/\((?:s|l|g|aq)\)/g, '').replace(/\s+/g, '').replace(/^[.,;:!?]+|[.,;:!?]+$/g, '');
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

type ItemVerdict = 'correct' | 'case' | 'typo' | 'wrong';

function compareItem(typed: string, expected: string): ItemVerdict {
  const t = squash(typed);
  const e = squash(expected);
  if (t === e) return 'correct';
  const tl = t.toLowerCase();
  const el = e.toLowerCase();
  if (tl === el) return isFormula(e) ? 'case' : 'correct';
  // One slip in a longer word is "close", never in a formula where one letter changes the substance.
  if (!/\d/.test(e) && !isFormula(e) && e.length >= 5 && editDistanceAtMostOne(tl, el)) return 'typo';
  return 'wrong';
}

/** Splits "a, b and c" or lines or "a; b" into items. One item if there is no list. */
export function splitList(text: string): string[] {
  return text
    .split(/\s*(?:,|;|\n|\s+and\s+|\s*&\s*)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Matches items in any order, pairing exact matches first. */
function compareSets(typed: string[], expected: string[]): { verdicts: ItemVerdict[]; extra: number } {
  const left = [...typed];
  const verdicts: ItemVerdict[] = [];
  const rank: ItemVerdict[] = ['correct', 'case', 'typo'];
  const results: (ItemVerdict | null)[] = expected.map(() => null);
  for (const level of rank) {
    expected.forEach((e, ei) => {
      if (results[ei]) return;
      const ti = left.findIndex((t) => compareItem(t, e) === level);
      if (ti !== -1) {
        results[ei] = level;
        left.splice(ti, 1);
      }
    });
  }
  for (const r of results) verdicts.push(r ?? 'wrong');
  return { verdicts, extra: left.length };
}

const ARROW = /\s(<=>|->)\s/;

function compareEquation(typed: string, expected: string): CheckResult | null {
  const te = typed.split(ARROW);
  const ee = expected.split(ARROW);
  if (ee.length !== 3) return null;
  if (te.length !== 3) return { verdict: 'wrong' };
  const sides = (s: string) => s.split(/\s\+\s/).map((x) => x.trim()).filter(Boolean);
  const out: ItemVerdict[] = [];
  for (const k of [0, 2]) {
    const r = compareSets(sides(te[k]), sides(ee[k]));
    out.push(...r.verdicts);
    if (r.extra > 0) out.push('wrong');
  }
  const result = summarise(out, 0, false);
  if (te[1] !== ee[1] && result.verdict !== 'wrong') {
    return { verdict: 'wrong', note: `Check the arrow: it should be ${ee[1] === '<=>' ? '⇌ (<=>)' : '→ (->)'}` };
  }
  return result;
}

function summarise(verdicts: ItemVerdict[], extra: number, isList: boolean): CheckResult {
  const right = verdicts.filter((v) => v !== 'wrong').length;
  if (right === verdicts.length && extra === 0) {
    if (verdicts.includes('case')) return { verdict: 'close', note: 'Right, but check your capitals' };
    if (verdicts.includes('typo')) return { verdict: 'close', note: 'Close, check your spelling' };
    return { verdict: 'correct' };
  }
  if (isList && right > 0) {
    const note = extra > 0 && right === verdicts.length ? 'All there, plus something extra' : `${right} of ${verdicts.length} right`;
    return { verdict: 'wrong', note };
  }
  return { verdict: 'wrong' };
}

function checkOne(typedRaw: string, keyRaw: string): CheckResult {
  const typed = toPlain(typedRaw);
  const key = toPlain(keyRaw);
  const eq = compareEquation(typed, key);
  if (eq) return eq;
  const expectedItems = splitList(key);
  if (expectedItems.length > 1) {
    const r = compareSets(splitList(typed), expectedItems);
    return summarise(r.verdicts, r.extra, true);
  }
  return summarise([compareItem(typed, key)], 0, false);
}

export function checkAnswer(typed: string, key: string): CheckResult {
  if (!typed.trim()) return { verdict: 'empty' };
  const options = key.split('|').map((k) => k.trim()).filter(Boolean);
  if (options.length === 0) return { verdict: 'wrong' };
  const order: Verdict[] = ['correct', 'close', 'wrong'];
  let best: CheckResult = { verdict: 'wrong' };
  for (const option of options) {
    const r = checkOne(typed, option);
    if (order.indexOf(r.verdict) < order.indexOf(best.verdict) || (r.verdict === best.verdict && !best.note && r.note)) best = r;
    if (r.verdict === 'correct') break;
  }
  return best;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Shows plainly typed chemistry nicely: N2 + 3H2 <=> 2NH3 becomes
 * N₂ + 3H₂ ⇌ 2NH₃ (as HTML with sub and sup tags). Other words are left alone.
 */
export function prettyChem(text: string): string {
  return toPlain(text)
    .split(' ')
    .map((token) => {
      if (token === '<=>') return '⇌';
      if (token === '->') return '→';
      const m = /^(\d*)(.*?)(\((?:s|l|g|aq)\))?$/.exec(token);
      if (!m || !isFormula(token.replace(/\((?:s|l|g|aq)\)$/, ''))) return escapeHtml(token);
      const [, coefficient, body, state = ''] = m;
      const charge = /\^?(\d*[+-])$/.exec(body);
      const formula = charge ? body.slice(0, charge.index) : body;
      const html = escapeHtml(formula).replace(/([A-Za-z)])(\d+)/g, '$1<sub>$2</sub>');
      return `${coefficient}${html}${charge ? `<sup>${charge[1]}</sup>` : ''}${escapeHtml(state)}`;
    })
    .join(' ');
}
