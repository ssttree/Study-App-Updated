// Turns card text into HTML. Card text is Markdown with maths written the
// Obsidian way: $x^2$ for inline maths and $$...$$ for display maths.
// Maths is pulled out first so Markdown cannot mangle it (underscores and
// stars are common in LaTeX), then rendered with KaTeX and put back.

import katex from 'katex';
import 'katex/contrib/mhchem'; // \ce{...} for chemical equations
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export interface MathPiece {
  tex: string;
  display: boolean;
}

export interface RenderResult {
  html: string;
  /** KaTeX errors, so the editor can show what needs fixing. */
  errors: { tex: string; message: string }[];
}

const TOKEN = (i: number) => `KATEXSLOT${i}END`;
const TOKEN_RE = /KATEXSLOT(\d+)END/g;

/**
 * Finds the maths in a piece of text and swaps each for a placeholder.
 * Follows Obsidian's rules: an inline $ must not be followed by a space, the
 * closing $ must not follow a space or be followed by a digit (so "$5 and $10"
 * stays as money), \$ is a literal dollar sign, and nothing inside `code`
 * counts as maths.
 */
export function extractMath(src: string): { text: string; pieces: MathPiece[] } {
  const pieces: MathPiece[] = [];
  let out = '';
  let i = 0;
  const n = src.length;
  const atLineStart = (pos: number) => pos === 0 || src[pos - 1] === '\n';

  while (i < n) {
    const ch = src[i];

    // Fenced code block: copy through untouched.
    if (ch === '`' && src.startsWith('```', i) && atLineStart(i)) {
      const end = src.indexOf('\n```', i + 3);
      const lineEnd = end === -1 ? -1 : src.indexOf('\n', end + 4);
      const stop = lineEnd === -1 ? n : lineEnd;
      out += src.slice(i, stop);
      i = stop;
      continue;
    }

    // Inline code: copy through untouched.
    if (ch === '`') {
      let run = 1;
      while (src[i + run] === '`') run++;
      const fence = '`'.repeat(run);
      const end = src.indexOf(fence, i + run);
      if (end !== -1) {
        out += src.slice(i, end + run);
        i = end + run;
        continue;
      }
      out += src.slice(i, i + run);
      i += run;
      continue;
    }

    // Escaped dollar sign: leave for Markdown, which prints a plain $.
    if (ch === '\\' && src[i + 1] === '$') {
      out += '\\$';
      i += 2;
      continue;
    }

    if (ch === '$' && src[i + 1] === '$') {
      const end = findClosing(src, i + 2, '$$');
      if (end !== -1) {
        const tex = src.slice(i + 2, end).trim();
        if (tex) {
          out += TOKEN(pieces.length);
          pieces.push({ tex, display: true });
          i = end + 2;
          continue;
        }
      }
    } else if (ch === '$') {
      const next = src[i + 1];
      if (next !== undefined && !/\s/.test(next)) {
        let j = i + 1;
        let found = -1;
        while (j < n) {
          if (src[j] === '\\') {
            j += 2;
            continue;
          }
          if (src[j] === '\n' && src[j + 1] === '\n') break; // no maths across paragraphs
          if (src[j] === '$') {
            if (!/\s/.test(src[j - 1]) && !/\d/.test(src[j + 1] ?? '')) found = j;
            break;
          }
          j++;
        }
        if (found !== -1) {
          out += TOKEN(pieces.length);
          pieces.push({ tex: src.slice(i + 1, found), display: false });
          i = found + 1;
          continue;
        }
      }
    }

    out += ch;
    i++;
  }
  return { text: out, pieces };
}

function findClosing(src: string, from: number, marker: string): number {
  let j = from;
  while (j < src.length) {
    if (src[j] === '\\') {
      j += 2;
      continue;
    }
    if (src.startsWith(marker, j)) return j;
    j++;
  }
  return -1;
}

export function renderMath(piece: MathPiece): { html: string; error?: string } {
  try {
    const html = katex.renderToString(piece.tex, {
      displayMode: piece.display,
      throwOnError: true,
      strict: 'ignore',
      trust: false,
      output: 'htmlAndMathml',
    });
    return { html };
  } catch (e) {
    const message = e instanceof Error ? e.message.replace(/^KaTeX parse error: /, '') : String(e);
    const shown = piece.display ? `$$${piece.tex}$$` : `$${piece.tex}$`;
    const html = `<code class="math-error" title="${escapeHtml(message)}">${escapeHtml(shown)}</code>`;
    return { html, error: message };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function sanitize(html: string): string {
  // DOMPurify needs a browser. Tests run without one and only check structure.
  return DOMPurify.isSupported ? DOMPurify.sanitize(html) : html;
}

export function renderMarkdown(src: string): RenderResult {
  const { text, pieces } = extractMath(src ?? '');
  const raw = marked.parse(text, { gfm: true, breaks: true, async: false });
  const safe = sanitize(raw);
  const errors: RenderResult['errors'] = [];
  const html = safe.replace(TOKEN_RE, (_, idx: string) => {
    const piece = pieces[Number(idx)];
    if (!piece) return '';
    const r = renderMath(piece);
    if (r.error) errors.push({ tex: piece.tex, message: r.error });
    return r.html;
  });
  return { html, errors };
}

/** Plain text version of card text, for search and the card list. */
export function plainText(src: string): string {
  return (src ?? '')
    .replace(/\$\$([\s\S]*?)\$\$/g, ' $1 ')
    .replace(/[#*_>`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
