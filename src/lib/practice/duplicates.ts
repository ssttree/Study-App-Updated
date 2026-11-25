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

/** A small picture fingerprint: shape of the picture and which way brightness changes across a grid. */
export interface Fingerprint {
  /** width / height */
  ratio: number;
  /** One bit per grid cell, packed into 32-bit numbers. */
  bits: number[];
}

/** Grid the fingerprint is taken on. Wide, because question pictures are mostly lines of text. */
export const GRID_W = 32;
export const GRID_H = 16;

/** Builds a fingerprint from grey values on a (GRID_W + 1) x GRID_H grid. */
export function fingerprintFromGrey(grey: ArrayLike<number>, ratio: number): Fingerprint {
  const bits: number[] = new Array(Math.ceil((GRID_W * GRID_H) / 32)).fill(0);
  let n = 0;
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const i = y * (GRID_W + 1) + x;
      if (grey[i] > grey[i + 1]) bits[n >> 5] |= 1 << (n & 31);
      n++;
    }
  }
  return { ratio, bits };
}

function bitCount(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** How alike two pictures are, 0 to 1. Pictures of quite different shapes score 0. */
export function pictureSimilarity(a: Fingerprint, b: Fingerprint): number {
  if (Math.abs(a.ratio - b.ratio) / Math.max(a.ratio, b.ratio) > 0.1) return 0;
  let diff = 0;
  for (let i = 0; i < a.bits.length; i++) diff += bitCount((a.bits[i] ^ b.bits[i]) >>> 0);
  return 1 - diff / (GRID_W * GRID_H);
}

/** Typed questions this alike (after formatting is taken out) count as the same. */
export const TEXT_MATCH = 0.92;
/** Pictures this alike count as the same. */
export const PICTURE_MATCH = 0.95;
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
        const score = pictureSimilarity(pics[y].f, pics[x].f);
        if (score >= PICTURE_MATCH && ok(list[pics[y].i], list[pics[x].i])) links.push({ a: pics[y].i, b: pics[x].i, kind: 'picture', score });
      }
    }

    // Join linked questions into groups.
    const parent = list.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const l of links) parent[find(l.a)] = find(l.b);
    const byRoot = new Map<number, { members: Set<number>; kind: DuplicateGroup['kind']; score: number }>();
    for (const l of links) {
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
