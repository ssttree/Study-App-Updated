// Finds practice questions that are in the app twice: the same question
// typed or imported again with slightly different formatting (spaces, capitals,
// Markdown, $...$ maths, \ce{} chemistry, H₂O vs H_2O), or the same picture
// cut a little differently.
//
// A question you put into several skills on purpose (each skill gets its own
// copy) is not a duplicate: those copies share the same import key.

import type { Problem, Skill } from '../types';

const SUBSCRIPTS: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-', '₊': '+', '₋': '-',
};

const SYMBOLS: [RegExp, string][] = [
  [/×|\\times\b|\\cdot\b|·/g, '*'],
  [/÷|\\div\b/g, '/'],
  [/[−–—]/g, '-'],
  [/→|⟶|\\rightarrow\b|\\longrightarrow\b|\\to\b|->/g, '>'],
  [/⇌|<=>|\\rightleftharpoons\b|\\leftrightharpoons\b/g, '='],
  [/≤|\\leq?\b/g, '<='],
  [/≥|\\geq?\b/g, '>='],
  [/π|\\pi\b/g, 'pi'],
  [/θ|\\theta\b/g, 'theta'],
  [/Δ|\\Delta\b/g, 'delta'],
  [/°|\\circ\b|\\degree\b/g, 'deg'],
];

/** LaTeX commands that only change how something looks. Their braces are dropped too. */
const LOOKS =
  /\\(?:text|textrm|mathrm|textbf|mathbf|textit|mathit|emph|operatorname|ce|pu|mbox|boldsymbol|displaystyle|textstyle|left|right|big|Big|bigg|Bigg|quad|qquad|rm|bf|it|limits)\b/g;

/**
 * The words and maths of a question with the formatting taken out, so two
 * copies typed a bit differently come out the same.
 */
export function normaliseQuestion(text: string): string {
  let s = text.normalize('NFKC');
  s = s.replace(/[₀-₉⁰-⁹⁺⁻₊₋¹²³]/g, (c) => SUBSCRIPTS[c] ?? c);
  for (const [re, to] of SYMBOLS) s = s.replace(re, to);
  s = s
    .replace(LOOKS, '')
    .replace(/\\[,;:! ]/g, ' ')
    .replace(/\\\$/g, '$')
    .replace(/\\[()[\]]/g, ' ')
    // Markdown: headings, quotes, list markers, bold and italic, code.
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+/gm, ' ')
    .replace(/[*`~]/g, '')
    .toLowerCase();
  // Keep a decimal point between digits, drop other punctuation, braces, $ and _ ^.
  s = s.replace(/(\d)\.(\d)/g, '$1DOT$2');
  s = s.replace(/[^\p{L}\p{N}+\-=<>/*|]/gu, '');
  return s.replace(/DOT/g, '.');
}

/** How alike two normalised texts are, 0 to 1 (Dice score on letter pairs). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const p = a.slice(i, i + 2);
    pairs.set(p, (pairs.get(p) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const p = b.slice(i, i + 2);
    const n = pairs.get(p) ?? 0;
    if (n > 0) {
      shared++;
      pairs.set(p, n - 1);
    }
  }
  return (2 * shared) / (a.length - 1 + (b.length - 1));
}

/** A small picture fingerprint: the shape of the inked part and how much ink falls in each cell of a grid. */
export interface Fingerprint {
  /** width / height of the inked part */
  ratio: number;
  /** Ink in each grid cell (0 blank to 255 solid), row by row, GRID_W x GRID_H. */
  ink: number[];
}

/** Grid the fingerprint is taken on. Wide, because question pictures are mostly lines of text. */
export const GRID_W = 64;
export const GRID_H = 16;

/**
 * Builds a fingerprint from a picture's grey pixels (0 black to 255 white),
 * using only the inked box so extra white margin doesn't matter. Each grid
 * cell is the average of the pixels in it, which copes with a picture saved
 * at a different size.
 */
export function fingerprintFromPixels(grey: ArrayLike<number>, width: number, height: number, inkBelow = 200): Fingerprint {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grey[y * width + x] < inkBelow) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0) [x0, y0, x1, y1] = [0, 0, width - 1, height - 1];
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const sum = new Array(GRID_W * GRID_H).fill(0);
  const count = new Array(GRID_W * GRID_H).fill(0);
  for (let y = y0; y <= y1; y++) {
    const gy = Math.min(GRID_H - 1, Math.floor(((y - y0) * GRID_H) / bh));
    for (let x = x0; x <= x1; x++) {
      const gx = Math.min(GRID_W - 1, Math.floor(((x - x0) * GRID_W) / bw));
      sum[gy * GRID_W + gx] += 255 - grey[y * width + x];
      count[gy * GRID_W + gx]++;
    }
  }
  return { ratio: bw / bh, ink: sum.map((v, i) => Math.round(v / (count[i] || 1))) };
}

/** How alike two pictures are, 0 to 1 (correlation of their ink grids). Pictures of quite different shapes score 0. */
export function pictureSimilarity(a: Fingerprint, b: Fingerprint): number {
  if (Math.abs(a.ratio - b.ratio) / Math.max(a.ratio, b.ratio) > 0.06) return 0;
  const n = a.ink.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a.ink[i];
    mb += b.ink[i];
  }
  ma /= n;
  mb /= n;
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) {
    const x = a.ink[i] - ma;
    const y = b.ink[i] - mb;
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  return aa && bb ? Math.max(0, ab / Math.sqrt(aa * bb)) : 0;
}

/** Typed questions this alike (after formatting is taken out) count as the same. */
export const TEXT_MATCH = 0.92;
/** Pictures this alike count as the same. */
export const PICTURE_MATCH = 0.9;
/** Very short questions ("Simplify.") only match when exactly the same. */
const SHORT = 25;

export interface DuplicateGroup {
  /** Same subject for every question in the group. */
  subject: string;
  problems: Problem[];
  /** 'same' when the wording is identical once formatting is ignored. */
  kind: 'same' | 'close' | 'picture';
  /** Lowest likeness between linked questions, 0 to 1. */
  score: number;
}

/** "idA|idB" with the ids in order, for remembering pairs you said are different. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** The import key without the skill id in front, the same for every copy made by putting one question into several skills. */
function sourceKey(p: Problem): string {
  const bar = p.key.indexOf('|');
  return bar >= 0 ? p.key.slice(bar + 1) : p.key;
}

/**
 * A question put into several skills on purpose gives copies with the same
 * import key in different skills, saved in the same import (within a minute).
 */
export function isSkillCopy(a: Problem, b: Problem): boolean {
  return a.skillId !== b.skillId && sourceKey(a) === sourceKey(b) && Math.abs(a.created - b.created) < 60_000;
}

/** Both cut from the same PDF or worksheet in one import, so different questions. */
function sameSheet(a: Problem, b: Problem): boolean {
  return !!a.from && a.from === b.from && a.source === b.source;
}

/**
 * Groups the questions that look like the same question. Only compares
 * questions in the same subject. `fingerprints` holds picture fingerprints by
 * image id, for questions that are pictures.
 */
export function findDuplicates(
  problems: Problem[],
  skills: Skill[],
  fingerprints: Map<string, Fingerprint> = new Map(),
  notDuplicates: Iterable<string> = [],
): DuplicateGroup[] {
  const subjectOf = new Map(skills.map((s) => [s.id, s.subject]));
  const ignored = new Set(notDuplicates);
  const bySubject = new Map<string, Problem[]>();
  for (const p of problems) {
    const subject = subjectOf.get(p.skillId);
    if (subject === undefined) continue;
    bySubject.set(subject, [...(bySubject.get(subject) ?? []), p]);
  }

  const groups: DuplicateGroup[] = [];
  for (const [subject, list] of bySubject) {
    const links: { a: number; b: number; kind: DuplicateGroup['kind']; score: number }[] = [];
    const ok = (a: Problem, b: Problem) => !isSkillCopy(a, b) && !ignored.has(pairKey(a.id, b.id));

    // Typed questions: same wording straight away, close wording by comparing pairs.
    const typed = list.map((p, i) => ({ i, text: p.questionText ? normaliseQuestion(p.questionText) : '' })).filter((t) => t.text);
    const byText = new Map<string, number[]>();
    for (const t of typed) byText.set(t.text, [...(byText.get(t.text) ?? []), t.i]);
    for (const same of byText.values()) {
      for (let x = 1; x < same.length; x++) {
        for (let y = 0; y < x; y++) if (ok(list[same[y]], list[same[x]])) links.push({ a: same[y], b: same[x], kind: 'same', score: 1 });
      }
    }
    const uniq = [...byText.entries()].filter(([text]) => text.length >= SHORT);
    for (let x = 1; x < uniq.length; x++) {
      for (let y = 0; y < x; y++) {
        const [ta, ia] = uniq[y];
        const [tb, ib] = uniq[x];
        // Quick check on length first: Dice can't reach the bar if lengths are far apart.
        if (Math.min(ta.length, tb.length) / Math.max(ta.length, tb.length) < TEXT_MATCH - 0.1) continue;
        const score = similarity(ta, tb);
        if (score < TEXT_MATCH) continue;
        for (const a of ia) for (const b of ib) if (ok(list[a], list[b])) links.push({ a, b, kind: 'close', score });
      }
    }

    // Pictures.
    const pics = list
      .map((p, i) => ({ i, f: !p.questionText && p.questionImage ? fingerprints.get(p.questionImage) : undefined }))
      .filter((x): x is { i: number; f: Fingerprint } => !!x.f);
    for (let x = 1; x < pics.length; x++) {
      for (let y = 0; y < x; y++) {
        const pa = list[pics[y].i];
        const pb = list[pics[x].i];
        // Two questions cut from the same PDF are different questions: the import already tells them apart,
        // and textbook exercises often have questions that look almost alike (Q6 and Q7 with new numbers).
        if (sameSheet(pa, pb)) continue;
        const score = pictureSimilarity(pics[y].f, pics[x].f);
        if (score >= PICTURE_MATCH && ok(pa, pb)) links.push({ a: pics[y].i, b: pics[x].i, kind: 'picture', score });
      }
    }

    // Join linked questions into groups, closest matches first. Two questions that are known to be
    // different (from one sheet, copies for several skills, or marked as not the same) never end up
    // in one group through a third question that looks like both.
    const parent = list.map((_, i) => i);
    const members = list.map((_, i) => [i]);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const apart = (a: Problem, b: Problem) => !ok(a, b) || (!a.questionText && !b.questionText && sameSheet(a, b));
    const used: typeof links = [];
    for (const l of [...links].sort((x, y) => y.score - x.score)) {
      const ra = find(l.a);
      const rb = find(l.b);
      if (ra !== rb) {
        if (members[ra].some((i) => members[rb].some((j) => apart(list[i], list[j])))) continue;
        parent[ra] = rb;
        members[rb].push(...members[ra]);
      }
      used.push(l);
    }
    const byRoot = new Map<number, { members: Set<number>; kind: DuplicateGroup['kind']; score: number }>();
    for (const l of used) {
      const root = find(l.a);
      const g = byRoot.get(root) ?? { members: new Set<number>(), kind: l.kind, score: 1 };
      g.members.add(l.a).add(l.b);
      if (l.kind !== 'same' && g.kind === 'same') g.kind = l.kind;
      g.score = Math.min(g.score, l.score);
      byRoot.set(root, g);
    }
    for (const g of byRoot.values()) {
      const members = [...g.members].map((i) => list[i]).sort((a, b) => a.created - b.created || a.order - b.order);
      groups.push({ subject, problems: members, kind: g.kind, score: g.score });
    }
  }
  return groups.sort((a, b) => a.subject.localeCompare(b.subject) || b.score - a.score);
}
