// Finds the questions and worked solutions in a SmarterEd (SmarterMaths)
// worksheet PDF. The maths in these PDFs is drawn as pictures, so the text
// is only used to find where each question starts; the questions themselves
// are cropped out of the page as images (see crop.ts).
//
// Each question starts with a header like "1. Functions, EXT1 F2 2016 HSC 2 MC"
// or "3. CHEMISTRY, M3 EQ-Bank 11157". Pages have two columns. A "Worked
// Solutions" heading starts the second half, which repeats the same headers.

/** One piece of text on a page, in PDF units with y measured from the bottom. */
export interface TextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotated?: boolean;
}

export interface PageText {
  width: number;
  height: number;
  items: TextItem[];
}

/** A box on one page, in PDF units with y measured from the top. */
export interface Region {
  page: number;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  /** Carries on from the previous column or page. */
  continued?: boolean;
}

export interface Header {
  number: number;
  /** The header without its number, e.g. "Functions, EXT1 F2 2016 HSC 2 MC". */
  text: string;
  /** e.g. "EXT1", empty for chemistry. */
  course: string;
  /** e.g. "F2" or "M3". */
  code: string;
  /** Tidy source label, e.g. "2016 HSC Q2" or "EQ-Bank 11513". */
  label: string;
  mc: boolean;
}

export interface Entry {
  header: Header;
  /** Where the content is. Usually one box; more if it runs into the next column or page. */
  regions: Region[];
  /** Marks found in the text, e.g. "(2 marks)". 0 if none were found. */
  marks: number;
}

export interface Worksheet {
  /** Worksheet title, which becomes the skill name, e.g. "Remainder and Factor Theorems". */
  title: string;
  /** The line above the title, e.g. "EXT 1: Functions (Ext1), F2 Polynomials (Y11)". */
  courseLine: string;
  subject: string;
  topic: string;
  code: string;
  questions: Entry[];
  solutions: Entry[];
}

export interface Pair {
  question: Entry;
  solution?: Entry;
}

// "12. Functions, EXT1 F2 2007 HSC 2c": a capitalised topic, a comma, then an upper case code.
const HEADER = /^(\d{1,3})\.\s+([A-Z][A-Za-z &]*),\s+([A-Z][A-Z0-9-]*\*?\s.*)$/;
const MARKS = /\((\d+)\s*marks?\)/i;
const COURSE = /^(ADV|EXT1|EXT2|STD1|STD2|MA|ME|MX)\*?$/i;

export function parseHeader(str: string): Header | null {
  const m = HEADER.exec(str.trim());
  if (!m) return null;
  const number = Number(m[1]);
  const rest = m[3].trim();
  const tokens = rest.split(/\s+/);
  const mc = tokens[tokens.length - 1] === 'MC';
  if (mc) tokens.pop();
  let course = '';
  if (COURSE.test(tokens[0])) course = tokens.shift()!.replace('*', '').toUpperCase();
  const code = tokens.length > 1 ? tokens.shift()! : '';
  let label = tokens.join(' ');
  // "2016 HSC 2" -> "2016 HSC Q2"; "2019 MET2-N 3" -> "2019 MET2-N Q3".
  const exam = /^(\d{4})\s+(\S+)\s+(\w+)$/.exec(label);
  if (exam) label = `${exam[1]} ${exam[2]} Q${exam[3]}`;
  return { number, text: `${m[2]}, ${rest}`, course, code, label, mc };
}

/** Guesses the subject from the worksheet's course line and headers. */
export function guessSubject(courseLine: string, headers: Header[]): string {
  const line = courseLine.toUpperCase();
  const first = headers[0];
  if (/CHEM/.test(line) || headers.some((h) => /^CHEMISTRY/i.test(h.text))) return 'Chemistry';
  if (/EXT\s*2/.test(line) || first?.course === 'EXT2') return 'Maths Extension 2';
  if (/EXT\s*1/.test(line) || first?.course === 'EXT1') return 'Maths Extension 1';
  if (/ADV|MATHEMATICS/.test(line) || first?.course === 'ADV') return 'Maths Advanced';
  return '';
}

/** Reads the title, course line and topic from the first page. */
function readTitle(page: PageText): { title: string; courseLine: string } {
  const lines = toLines(page);
  const teacher = lines.findIndex((l) => /^Teacher:/.test(l.text));
  if (teacher >= 1) {
    const title = lines[teacher - 1].text;
    const courseLine = teacher >= 2 ? lines[teacher - 2].text : '';
    return { title, courseLine };
  }
  return { title: '', courseLine: '' };
}

/** Joins the items on page one into lines, top to bottom, left column only. */
function toLines(page: PageText): { text: string; top: number }[] {
  const items = page.items
    .filter((i) => !i.rotated && i.str.trim() && i.x < page.width / 2 && !HEADER.test(i.str.trim()))
    .map((i) => ({ ...i, top: page.height - i.y - i.h }))
    .sort((a, b) => a.top - b.top || a.x - b.x);
  const lines: { text: string; top: number }[] = [];
  for (const it of items) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.top - it.top) < 3) last.text += ' ' + it.str.trim();
    else lines.push({ text: it.str.trim(), top: it.top });
  }
  return lines;
}

/** "Remainder and Factor Theorems (Ext1)" -> "Remainder and Factor Theorems". */
export function tidyTitle(title: string): string {
  return title.replace(/\s*\((Ext ?1|Ext ?2|Adv|Y1[12])\)\s*$/i, '').trim();
}

/** "EXT 1: Functions (Ext1), F2 Polynomials (Y11)" -> topic "F2 Polynomials", code "F2". */
function readTopic(courseLine: string, headers: Header[]): { topic: string; code: string } {
  const parts = courseLine.split(',').map((p) => p.trim());
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  const m = /^([A-Z]{1,3}\d+(?:\.\d+)?)\s+(.+?)(\s*\(Y1[12]\))?$/.exec(last);
  if (m) return { topic: `${m[1]} ${m[2]}`, code: m[1] };
  const mod = /Module\s+(\d+)[:\s]*(.*)$/i.exec(courseLine);
  if (mod) return { topic: courseLine.trim(), code: `M${mod[1]}` };
  const code = headers[0]?.code ?? '';
  return { topic: code, code };
}

interface Marker {
  kind: 'header' | 'solutions' | 'stop';
  page: number;
  col: number;
  top: number;
  bottom: number;
  header?: Header;
}

const PAGE_MARGIN = 6;

/** Works out every question and solution box in the worksheet. */
export function findEntries(pages: PageText[], fileName = ''): Worksheet {
  const markers: Marker[] = [];
  const allHeaders: Header[] = [];
  // Two columns if any header sits in the right half of a page.
  const twoColumns = pages.some((p) => p.items.some((i) => HEADER.test(i.str.trim()) && i.x > p.width / 2 - 20));
  const colOf = (p: PageText, x: number) => (twoColumns && x >= p.width / 2 ? 1 : 0);

  pages.forEach((p, page) => {
    for (const it of p.items) {
      if (it.rotated) continue;
      const str = it.str.trim();
      const top = p.height - it.y - it.h;
      const bottom = p.height - it.y + 2;
      const col = colOf(p, it.x);
      const header = parseHeader(str);
      if (header) {
        markers.push({ kind: 'header', page, col, top, bottom, header });
        allHeaders.push(header);
      } else if (/^Worked Solutions$/i.test(str)) {
        markers.push({ kind: 'solutions', page, col, top, bottom });
      } else if (/^Copyright ©/i.test(str)) {
        markers.push({ kind: 'stop', page, col, top, bottom });
      }
    }
  });
  markers.sort((a, b) => a.page - b.page || a.col - b.col || a.top - b.top);

  const questions: Entry[] = [];
  const solutions: Entry[] = [];
  let section: 'questions' | 'solutions' = 'questions';
  let current: Entry | null = null;

  const colBox = (page: number, col: number) => {
    const w = pages[page].width;
    if (!twoColumns) return { x0: PAGE_MARGIN, x1: w - PAGE_MARGIN };
    return col === 0 ? { x0: PAGE_MARGIN, x1: w / 2 } : { x0: w / 2, x1: w - PAGE_MARGIN };
  };

  const columns: { page: number; col: number }[] = [];
  pages.forEach((_, page) => {
    columns.push({ page, col: 0 });
    if (twoColumns) columns.push({ page, col: 1 });
  });

  for (const { page, col } of columns) {
    const here = markers.filter((m) => m.page === page && m.col === col);
    const box = colBox(page, col);
    const pageBottom = pages[page].height - PAGE_MARGIN;
    let cursor = PAGE_MARGIN;
    // Whatever is above the first marker continues the entry from the last column.
    const firstTop = here.length ? here[0].top : pageBottom;
    if (current && firstTop - cursor > 12) {
      current.regions.push({ page, ...box, top: cursor, bottom: firstTop - 2, continued: true });
    }
    for (let i = 0; i < here.length; i++) {
      const m = here[i];
      const nextTop = i + 1 < here.length ? here[i + 1].top : pageBottom;
      if (m.kind === 'header') {
        current = { header: m.header!, regions: [{ page, ...box, top: m.bottom, bottom: nextTop - 2 }], marks: 0 };
        (section === 'questions' ? questions : solutions).push(current);
      } else if (m.kind === 'solutions') {
        section = 'solutions';
        current = null;
      } else {
        current = null;
      }
      cursor = nextTop;
    }
  }

  // Marks come from the text inside each question's boxes.
  for (const q of questions) {
    let marks = 0;
    for (const r of q.regions) {
      for (const it of pages[r.page].items) {
        const m = MARKS.exec(it.str);
        if (!m) continue;
        const top = pages[r.page].height - it.y - it.h;
        if (it.x >= r.x0 && it.x < r.x1 && top >= r.top && top < r.bottom) marks += Number(m[1]);
      }
    }
    q.marks = marks || (q.header.mc ? 1 : 0);
  }

  const { title, courseLine } = pages.length ? readTitle(pages[0]) : { title: '', courseLine: '' };
  const { topic, code } = readTopic(courseLine, allHeaders);
  const fallback = fileName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
  return {
    title: tidyTitle(title) || fallback || 'Untitled worksheet',
    courseLine,
    subject: guessSubject(courseLine, allHeaders),
    topic,
    code,
    questions,
    solutions,
  };
}

/** Matches each question to its worked solution by number and header. */
export function pairEntries(sheet: Pick<Worksheet, 'questions' | 'solutions'>): Pair[] {
  const left = [...sheet.solutions];
  return sheet.questions.map((question) => {
    const i = left.findIndex((s) => s.header.number === question.header.number && s.header.text === question.header.text);
    const j = i >= 0 ? i : left.findIndex((s) => s.header.text === question.header.text);
    const solution = j >= 0 ? left.splice(j, 1)[0] : undefined;
    return { question, solution };
  });
}

/** True for PDFs that look like SmarterEd worksheets. */
export function looksLikeSmarterEd(pages: PageText[]): boolean {
  return pages.flatMap((p) => p.items).filter((i) => parseHeader(i.str) !== null).length >= 2;
}
