// Anki cards are HTML and Anki's own template language. This file turns them
// into the Markdown this app uses, with maths moved from Anki's \( \) and
// \[ \] style to Obsidian's $ and $$ style.

/** Marks where a picture goes until the picture itself has been read. */
export const MEDIA_PREFIX = 'anki-media:';

export interface Converted {
  markdown: string;
  /** Picture file names, in the order they appear. */
  images: string[];
  /** True if [sound:...] tags were dropped (the app has no audio yet). */
  hadAudio: boolean;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  deg: '°',
  times: '×',
  divide: '÷',
  plusmn: '±',
  minus: '−',
  rarr: '→',
  larr: '←',
  harr: '↔',
  rlarr: '⇌',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  micro: 'µ',
  sup2: '²',
  sup3: '³',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Plain text with no tags, e.g. for checking typed answers. */
export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>|<\/(div|p|li)>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

// Tags kept as they are, because Markdown has no way to write them and the
// card renderer lets them through (subscripts matter a lot in chemistry).
const KEEP_INLINE = new Set(['sub', 'sup', 'u', 'mark', 's', 'del', 'small']);
const BLOCK = new Set(['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'section', 'center', 'pre']);
const DROP_WITH_CONTENT = /<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi;

/** Turns one piece of Anki HTML into Markdown. */
export function htmlToMarkdown(html: string): Converted {
  const images: string[] = [];
  let hadAudio = false;

  let src = html.replace(DROP_WITH_CONTENT, '').replace(/<!--[\s\S]*?-->/g, '');
  src = src.replace(/\[sound:[^\]]*\]/g, () => {
    hadAudio = true;
    return '';
  });
  // Maths is taken out first so nothing below escapes or changes it.
  const maths: string[] = [];
  src = pullMath(src, (tex, display) => {
    const clean = decodeEntities(tex.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '')).replace(/\u00a0/g, ' ').trim();
    if (!clean) return '';
    maths.push(display ? `$$${clean}$$` : `$${clean}$`);
    return `ANKIMATH${maths.length - 1}END`;
  });

  let out = '';
  // An opening ** or * waits here until real text arrives, so "<b> word</b>"
  // becomes " **word**" (Markdown ignores "** word**").
  let pendingOpen = '';
  const lists: { ordered: boolean; n: number }[] = [];

  const newline = () => {
    out = out.replace(/[ \t]+$/, '');
    if (out !== '' && !out.endsWith('\n')) out += '\n';
  };
  const emitText = (text: string) => {
    if (!text) return;
    if (pendingOpen) {
      const lead = text.match(/^\s*/)![0];
      const rest = text.slice(lead.length);
      if (!rest) {
        out += lead;
        return;
      }
      out += lead + pendingOpen + rest;
      pendingOpen = '';
      return;
    }
    out += text;
  };
  const closeMark = (mark: string) => {
    if (pendingOpen) {
      pendingOpen = '';
      return;
    }
    const trail = out.match(/\s*$/)![0];
    out = out.slice(0, out.length - trail.length) + mark + trail;
  };

  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(src))) {
    emitText(textToMarkdown(src.slice(last, m.index), out));
    last = tagRe.lastIndex;
    const whole = m[0];
    const name = m[1].toLowerCase();
    const closing = whole[1] === '/';
    const attrs = m[2];

    if (name === 'table' && !closing) {
      // Tables stay as HTML, squeezed onto one line so Markdown keeps them whole.
      const end = src.toLowerCase().indexOf('</table>', m.index);
      const stop = end === -1 ? src.length : end + '</table>'.length;
      const table = src
        .slice(m.index, stop)
        .replace(/\s*\n\s*/g, ' ')
        .replace(/\s(style|class|id|width|height|bgcolor)="[^"]*"/gi, '');
      newline();
      out += '\n' + table + '\n\n';
      tagRe.lastIndex = last = stop;
      continue;
    }

    if (name === 'br') newline();
    else if (name === 'hr') {
      newline();
      out += '\n---\n\n';
    } else if (BLOCK.has(name)) newline();
    else if (name === 'b' || name === 'strong') closing ? closeMark('**') : (pendingOpen += '**');
    else if (name === 'i' || name === 'em') closing ? closeMark('*') : (pendingOpen += '*');
    else if (KEEP_INLINE.has(name)) emitText(closing ? `</${name}>` : `<${name}>`);
    else if (name === 'ul' || name === 'ol') {
      if (closing) lists.pop();
      else lists.push({ ordered: name === 'ol', n: 0 });
      newline();
    } else if (name === 'li') {
      newline();
      if (!closing) {
        const list = lists[lists.length - 1] ?? { ordered: false, n: 0 };
        list.n++;
        out += '  '.repeat(Math.max(0, lists.length - 1)) + (list.ordered ? `${list.n}. ` : '- ');
      }
    } else if (name === 'img' && !closing) {
      const srcAttr = attrs.match(/\ssrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const file = srcAttr ? decodeEntities(srcAttr[2] ?? srcAttr[3] ?? srcAttr[4] ?? '') : '';
      if (file && !/^(https?:|data:)/i.test(file)) {
        images.push(file);
        emitText(`![](${MEDIA_PREFIX}${encodeURIComponent(file)})`);
      } else if (file) emitText(`![](${file})`);
    }
    // Every other tag (span, font, a, ...) is dropped and its text kept.
  }
  emitText(textToMarkdown(src.slice(last), out));

  const markdown = out
    .replace(/ANKIMATH(\d+)END/g, (_, i: string) => maths[Number(i)] ?? '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { markdown, images, hadAudio };
}

/** HTML text between tags: decode entities and stop it being read as Markdown or maths. */
function textToMarkdown(raw: string, before: string): string {
  if (!raw) return '';
  let text = decodeEntities(raw.replace(/\s+/g, ' ')).replace(/ /g, ' ');
  // Leading spaces at the start of a line mean nothing in HTML.
  if (before === '' || before.endsWith('\n')) text = text.replace(/^ +/, '');
  text = text
    .replace(/\$/g, '\\$') // a lone $ is money, not maths
    .replace(/\*/g, '\\*')
    .replace(/<(?=[a-zA-Z/!])/g, '&lt;');
  if (before === '' || before.endsWith('\n')) text = text.replace(/^(#|>|\d+\.\s|[-+]\s)/, '\\$1');
  return text;
}

/** Finds Anki maths: \( \) and [$] [/$] are inline; \[ \], [$$] [/$$] and [latex] are display. */
function pullMath(text: string, swap: (tex: string, display: boolean) => string): string {
  return text
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, tex: string) => swap(tex, false))
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, tex: string) => swap(tex, true))
    .replace(/\[\$\$\]([\s\S]*?)\[\/\$\$\]/g, (_, tex: string) => swap(tex, true))
    .replace(/\[\$\]([\s\S]*?)\[\/\$\]/g, (_, tex: string) => swap(tex, false))
    .replace(/\[latex\]([\s\S]*?)\[\/latex\]/gi, (_, tex: string) => swap(tex, true));
}

// Templates

export interface TemplateContext {
  fields: Record<string, string>;
  /** For cloze cards: which cloze number is being asked. */
  cloze?: number;
  side: 'question' | 'answer';
  /** The rendered question, for {{FrontSide}} on the answer side. */
  frontSide?: string;
  deckName?: string;
  tags?: string[];
}

export interface RenderedTemplate {
  html: string;
  /** Field named in {{type:Field}}, if the card asks you to type the answer. */
  typeField?: string;
}

const FRONT_SIDE_MARK = '\u0000FRONTSIDE\u0000';

/** Fills in an Anki card template like {{Front}} or {{#Hint}}...{{/Hint}}. */
export function renderTemplate(template: string, ctx: TemplateContext): RenderedTemplate {
  let typeField: string | undefined;
  const has = (name: string) => stripHtml(ctx.fields[name] ?? '').length > 0 || /<img\b/i.test(ctx.fields[name] ?? '');

  // Sections first, innermost out, so nested {{#A}}{{#B}}..{{/B}}{{/A}} work.
  let src = template;
  const section = /\{\{([#^])\s*([^}]+?)\s*\}\}((?:(?!\{\{[#^])[\s\S])*?)\{\{\/\s*\2\s*\}\}/;
  for (let guard = 0; guard < 200; guard++) {
    const m = section.exec(src);
    if (!m) break;
    const [whole, kind, name, inner] = m;
    const show = kind === '#' ? has(name) : !has(name);
    src = src.slice(0, m.index) + (show ? inner : '') + src.slice(m.index + whole.length);
  }

  const html = src.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, tag: string) => {
    const parts = tag.split(':');
    const field = parts.pop()!.trim();
    const filters = parts.map((p) => p.trim().toLowerCase());
    if (filters.length === 0) {
      if (field === 'FrontSide') return ctx.side === 'answer' ? FRONT_SIDE_MARK : '';
      if (field === 'Deck') return ctx.deckName ?? '';
      if (field === 'Subdeck') return ctx.deckName?.split('::').pop() ?? '';
      if (field === 'Tags') return '';
      if (field === 'Card' || field === 'Type' || field === 'CardFlag') return '';
    }
    if (filters.includes('type')) {
      // The question gets a typing box in this app; the answer shows the field.
      typeField ??= field;
      if (ctx.side === 'question') return '';
      const value = ctx.fields[field] ?? '';
      return filters.includes('cloze') ? clozeAnswer(value, ctx.cloze ?? 1) : value;
    }
    let value = ctx.fields[field] ?? '';
    if (filters.includes('cloze')) value = renderCloze(value, ctx.cloze ?? 1, ctx.side);
    if (filters.includes('text')) value = stripHtml(value);
    if (filters.includes('furigana') || filters.includes('kanji')) value = value.replace(/\[[^\]]*\]/g, '');
    return value;
  });

  return { html: ctx.side === 'answer' ? answerOnly(html, ctx.frontSide ?? '') : html, typeField };
}

/**
 * Anki's back template usually repeats the front, then <hr id=answer>, then
 * the answer. This app shows the question above the answer already, so only
 * the part after the line is kept.
 */
function answerOnly(html: string, frontSide: string): string {
  const hr = html.search(/<hr[^>]*id\s*=\s*["']?answer["']?[^>]*>/i);
  if (hr !== -1) {
    const after = html.slice(hr).replace(/^<hr[^>]*>/i, '');
    return after.replaceAll(FRONT_SIDE_MARK, '');
  }
  if (html.includes(FRONT_SIDE_MARK)) return html.replaceAll(FRONT_SIDE_MARK, '');
  // No marker: drop a copy of the question at the start if there is one.
  return frontSide && html.startsWith(frontSide) ? html.slice(frontSide.length) : html;
}

const CLOZE_RE = /\{\{c(\d+)::((?:(?!\{\{c\d+::)[\s\S])*?)(?:::((?:(?!\{\{c\d+::)[\s\S])*?))?\}\}/;

/** Cloze numbers used in a field, e.g. [1, 2] for "{{c1::a}} {{c2::b}}". */
export function clozeNumbers(field: string): number[] {
  return [...new Set([...field.matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}

/**
 * The question side hides cloze n as [...] (or [hint]); the answer side
 * shows it in bold. Other clozes show their text. Inside maths there is no
 * bold, since ** would show up as stars.
 */
export function renderCloze(field: string, n: number, side: 'question' | 'answer'): string {
  let src = field;
  for (let guard = 0; guard < 500; guard++) {
    const m = CLOZE_RE.exec(src);
    if (!m) break;
    const [whole, num, text, hint] = m;
    let replacement = text;
    if (Number(num) === n) {
      const inMath = insideMath(src, m.index);
      if (side === 'question') replacement = inMath ? `[${hint ?? '...'}]` : `<b>[${hint ?? '...'}]</b>`;
      else replacement = inMath ? text : `<b>${text}</b>`;
    }
    src = src.slice(0, m.index) + replacement + src.slice(m.index + whole.length);
  }
  return src;
}

function insideMath(src: string, index: number): boolean {
  const before = src.slice(0, index);
  const opens = (re: RegExp) => (before.match(re) ?? []).length;
  return opens(/\\\(/g) > opens(/\\\)/g) || opens(/\\\[/g) > opens(/\\\]/g);
}

/** The text of cloze n, for checking a typed answer. */
export function clozeAnswer(field: string, n: number): string {
  const answers: string[] = [];
  let src = field;
  for (let guard = 0; guard < 500; guard++) {
    const m = CLOZE_RE.exec(src);
    if (!m) break;
    if (Number(m[1]) === n) answers.push(m[2]);
    src = src.slice(0, m.index) + m[2] + src.slice(m.index + m[0].length);
  }
  return plainAnswer(answers.join(', '));
}

/** Plain text for typed-answer checking, with Anki maths written the $ way. */
export function plainAnswer(html: string): string {
  return stripHtml(html)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, tex: string) => `$${tex.trim()}$`)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, tex: string) => `$$${tex.trim()}$$`);
}
