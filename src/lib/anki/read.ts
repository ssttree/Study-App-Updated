// Reads an Anki .apkg file. An .apkg is a zip holding an SQLite database
// (the deck's notes and cards) plus the deck's pictures and sounds. Anki has
// used three versions of the inside over the years, all handled here:
//   collection.anki21b  newest (Anki 2.1.50+), database squashed with zstd
//   collection.anki21   Anki 2.1 with "support older Anki versions" ticked
//   collection.anki2    oldest
// Nothing here touches the page or IndexedDB, so it runs in tests too.

import { unzipSync } from 'fflate';
import { decompress } from 'fzstd';
import type { Database, SqlJsStatic, SqlValue } from 'sql.js';

export interface AnkiNoteType {
  id: number;
  name: string;
  cloze: boolean;
  fields: string[];
  templates: { name: string; qfmt: string; afmt: string }[];
}

export interface AnkiNote {
  id: number;
  guid: string;
  noteTypeId: number;
  fields: string[];
  tags: string[];
}

export interface AnkiCard {
  noteId: number;
  deckId: number;
  /** Which template made this card (for cloze notes, the cloze number minus 1). */
  ord: number;
}

export interface AnkiCollection {
  noteTypes: Map<number, AnkiNoteType>;
  /** Deck id to full name, with "::" between levels like Anki shows it. */
  decks: Map<number, string>;
  notes: AnkiNote[];
  cards: AnkiCard[];
  /** File name (as used in <img src>) to its bytes. */
  media: Map<string, Uint8Array>;
}

export class AnkiReadError extends Error {}

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

function isZstd(bytes: Uint8Array): boolean {
  return ZSTD_MAGIC.every((b, i) => bytes[i] === b);
}

function unzstd(bytes: Uint8Array): Uint8Array {
  return isZstd(bytes) ? decompress(bytes) : bytes;
}

export function readApkg(bytes: Uint8Array, SQL: SqlJsStatic): AnkiCollection {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new AnkiReadError('That file is not an Anki deck. Export it from Anki as an .apkg file and try again.');
  }

  const newest = files['collection.anki21b'];
  const middle = files['collection.anki21'];
  const oldest = files['collection.anki2'];
  const raw = newest ? unzstd(newest) : (middle ?? oldest);
  if (!raw) throw new AnkiReadError('That file has no Anki cards inside it.');

  let database = new SQL.Database(raw);
  try {
    const isNewSchema = tableExists(database, 'notetypes');
    if (isNewSchema) database = withoutUnicase(SQL, database);
    const noteTypes = isNewSchema ? readNoteTypesNew(database) : readNoteTypesOld(database);
    const decks = isNewSchema ? readDecksNew(database) : readDecksOld(database);
    const notes = rows(database, 'SELECT id, guid, mid, flds, tags FROM notes ORDER BY id').map(
      ([id, guid, mid, flds, tags]) => ({
        id: Number(id),
        guid: String(guid),
        noteTypeId: Number(mid),
        fields: String(flds).split('\x1f'),
        tags: String(tags).split(/\s+/).filter(Boolean),
      }),
    );
    const cards = rows(database, 'SELECT nid, did, ord FROM cards ORDER BY nid, ord').map(([nid, did, ord]) => ({
      noteId: Number(nid),
      deckId: Number(did),
      ord: Number(ord),
    }));
    return { noteTypes, decks, notes, cards, media: readMedia(files) };
  } finally {
    database.close();
  }
}

function rows(database: Database, sql: string): SqlValue[][] {
  return database.exec(sql)[0]?.values ?? [];
}

function tableExists(database: Database, name: string): boolean {
  const stmt = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
  try {
    stmt.bind([name]);
    return stmt.step();
  } finally {
    stmt.free();
  }
}

/**
 * Newer Anki databases sort names with "unicase", a sorting rule built into
 * Anki itself. SQLite refuses to read those tables without it, so the rule
 * is removed from the table definitions (this copy only, nothing is saved).
 */
function withoutUnicase(SQL: SqlJsStatic, database: Database): Database {
  database.exec(`
    PRAGMA writable_schema = ON;
    UPDATE sqlite_master SET sql = replace(sql, ' COLLATE unicase', '') WHERE sql LIKE '%unicase%';
    PRAGMA writable_schema = OFF;
  `);
  const copy = new SQL.Database(database.export());
  database.close();
  return copy;
}

// Old layout: note types and decks are JSON inside the single "col" row.

interface OldModel {
  id: number | string;
  name: string;
  type: number;
  flds: { name: string; ord: number }[];
  tmpls: { name: string; ord: number; qfmt: string; afmt: string }[];
}

function readNoteTypesOld(database: Database): Map<number, AnkiNoteType> {
  const [[json] = []] = rows(database, 'SELECT models FROM col');
  const models = JSON.parse(String(json ?? '{}')) as Record<string, OldModel>;
  const out = new Map<number, AnkiNoteType>();
  for (const [key, m] of Object.entries(models)) {
    const id = Number(m.id ?? key);
    out.set(id, {
      id,
      name: m.name,
      cloze: m.type === 1,
      fields: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name),
      templates: [...m.tmpls].sort((a, b) => a.ord - b.ord).map((t) => ({ name: t.name, qfmt: t.qfmt, afmt: t.afmt })),
    });
  }
  return out;
}

function readDecksOld(database: Database): Map<number, string> {
  const [[json] = []] = rows(database, 'SELECT decks FROM col');
  const decks = JSON.parse(String(json ?? '{}')) as Record<string, { id: number; name: string }>;
  return new Map(Object.entries(decks).map(([key, d]) => [Number(d.id ?? key), d.name]));
}

// New layout: separate tables, with settings stored as protobuf blobs.

function readNoteTypesNew(database: Database): Map<number, AnkiNoteType> {
  const out = new Map<number, AnkiNoteType>();
  for (const [id, name, config] of rows(database, 'SELECT id, name, config FROM notetypes')) {
    const kind = protoFields(config as Uint8Array).find((f) => f.no === 1);
    out.set(Number(id), { id: Number(id), name: String(name), cloze: kind?.int === 1, fields: [], templates: [] });
  }
  for (const [ntid, name] of rows(database, 'SELECT ntid, name FROM fields ORDER BY ntid, ord')) {
    out.get(Number(ntid))?.fields.push(String(name));
  }
  for (const [ntid, name, config] of rows(database, 'SELECT ntid, name, config FROM templates ORDER BY ntid, ord')) {
    const parts = protoFields(config as Uint8Array);
    out.get(Number(ntid))?.templates.push({
      name: String(name),
      qfmt: protoString(parts, 1),
      afmt: protoString(parts, 2),
    });
  }
  return out;
}

function readDecksNew(database: Database): Map<number, string> {
  return new Map(
    rows(database, 'SELECT id, name FROM decks').map(([id, name]) => [Number(id), String(name).replaceAll('\x1f', '::')]),
  );
}

// Media. Old: a JSON file {"0": "diagram.png"} and zip entries named 0, 1...
// New: the same numbered entries, each squashed with zstd, and the list of
// names as a zstd-squashed protobuf.

function readMedia(files: Record<string, Uint8Array>): Map<string, Uint8Array> {
  const media = new Map<string, Uint8Array>();
  const list = files['media'];
  if (!list || list.length === 0) return media;
  const bytes = unzstd(list);

  let names: string[];
  if (bytes[0] === 0x7b /* { */) {
    const json = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, string>;
    names = [];
    for (const [index, name] of Object.entries(json)) names[Number(index)] = name;
  } else {
    names = protoFields(bytes)
      .filter((f) => f.no === 1 && f.bytes)
      .map((entry) => protoString(protoFields(entry.bytes!), 1));
  }

  names.forEach((name, index) => {
    const data = name ? files[String(index)] : undefined;
    if (data) media.set(name, unzstd(data));
  });
  return media;
}

// Just enough protobuf reading for Anki's settings blobs.

interface ProtoField {
  no: number;
  int?: number;
  bytes?: Uint8Array;
}

function protoFields(buf: Uint8Array): ProtoField[] {
  const out: ProtoField[] = [];
  let pos = 0;
  const varint = (): number => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (pos >= buf.length) throw new AnkiReadError('A part of the Anki file is damaged.');
      const b = buf[pos++];
      result += (b & 0x7f) * 2 ** shift;
      if (b < 0x80) return result;
      shift += 7;
    }
  };
  while (pos < buf.length) {
    const key = varint();
    const no = Math.floor(key / 8);
    const wire = key % 8;
    if (wire === 0) out.push({ no, int: varint() });
    else if (wire === 2) {
      const len = varint();
      out.push({ no, bytes: buf.subarray(pos, pos + len) });
      pos += len;
    } else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else break; // groups are not used by Anki
  }
  return out;
}

function protoString(fields: ProtoField[], no: number): string {
  const f = fields.find((x) => x.no === no && x.bytes);
  return f ? new TextDecoder().decode(f.bytes) : '';
}
