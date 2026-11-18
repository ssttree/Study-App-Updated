// Reads Rhys's Obsidian notes from their GitHub repo, to list the lessons that
// still need flashcards. Each lesson note has `cards-made: true/false` in its
// front matter, and the "Overview - <topic>.md" note in a folder marks the
// lessons under it as one topic (the same rule the Overview notes' Dataview
// lists use). The repo is private, so the server holds a read-only token:
// NOTES_TOKEN (and optionally NOTES_REPO, default ssttree/Obsidian) in Railway.

const API = 'https://api.github.com';
const MAX_FILES = 600;

export function notesConfigured() {
  return !!process.env.NOTES_TOKEN;
}

const OVERVIEW = /^Overview - (.+)\.md$/i;
const SKIP = /^(Overview|Syllabus) - /i;

function folderOf(path) {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}
function nameOf(path) {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '');
}

/**
 * Which notes to read: notes inside a folder, grouped under the nearest
 * Overview note above them (as for the maths chapters), else their folder.
 */
export function lessonPaths(paths) {
  const overviews = new Map();
  for (const p of paths) {
    const m = OVERVIEW.exec(p.slice(p.lastIndexOf('/') + 1));
    if (m && folderOf(p)) overviews.set(folderOf(p), m[1]);
  }
  const out = [];
  for (const p of paths) {
    if (!p.toLowerCase().endsWith('.md') || SKIP.test(nameOf(p)) || p.startsWith('Templates/')) continue;
    // The nearest folder up the tree with an Overview note.
    let folder = folderOf(p);
    while (folder && !overviews.has(folder)) folder = folderOf(folder);
    // A note with no Overview above it (a new topic) still counts if it has cards-made: its folder is the topic.
    if (!folder) {
      const own = folderOf(p);
      if (!own) continue;
      out.push({ path: p, topic: nameOf(own + '.md'), topicFolder: own });
      continue;
    }
    out.push({ path: p, topic: overviews.get(folder), topicFolder: folder });
  }
  return out;
}

/** cards-made from the front matter: true, false, or null when the note has no such line. */
export function cardsMade(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const line = /^cards-made:\s*(.*)$/m.exec(m[1]);
  if (!line) return null;
  return /^(true|yes)\b/i.test(line[1].trim());
}

/** The unticked items under a "Cards to Make" heading. */
export function cardsToMake(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}\s+cards to make\s*$/i.test(l.trim()));
  if (start === -1) return [];
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(l)) break;
    const m = /^\s*[-*]\s+\[ \]\s+(.+)$/.exec(l);
    if (m && m[1].trim()) out.push(m[1].trim());
  }
  return out;
}

/** Lessons from the notes' text. Only notes with a cards-made line count. */
export function lessonsFrom(files) {
  const out = [];
  for (const f of files) {
    const made = cardsMade(f.text);
    if (made === null) continue;
    out.push({
      path: f.path,
      name: nameOf(f.path),
      subject: f.path.split('/')[0],
      topic: f.topic,
      topicFolder: f.topicFolder,
      cardsMade: made,
      toMake: made ? [] : cardsToMake(f.text),
    });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function createNotesReader(fetchImpl = fetch) {
  /** Note text by blob sha, so only changed notes are downloaded again. */
  const cache = new Map();

  async function gh(path, token) {
    const res = await fetchImpl(API + path, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'study-app' },
    });
    if (!res.ok) {
      const why =
        res.status === 401
          ? 'GitHub turned down the notes token. Make a new one and update NOTES_TOKEN in Railway.'
          : res.status === 404
            ? "GitHub can't find the notes repo with that token. Check the token can read it."
            : `GitHub said ${res.status}.`;
      const err = new Error(why);
      err.status = 502;
      throw err;
    }
    return res.json();
  }

  async function read() {
    const token = process.env.NOTES_TOKEN;
    const repo = process.env.NOTES_REPO || 'ssttree/Obsidian';
    const tree = await gh(`/repos/${repo}/git/trees/HEAD?recursive=1`, token);
    const blobs = new Map((tree.tree ?? []).filter((t) => t.type === 'blob').map((t) => [t.path, t.sha]));
    const wanted = lessonPaths([...blobs.keys()]).slice(0, MAX_FILES);
    const files = [];
    for (const w of wanted) {
      const sha = blobs.get(w.path);
      let text = cache.get(sha);
      if (text === undefined) {
        const blob = await gh(`/repos/${repo}/git/blobs/${sha}`, token);
        text = Buffer.from(blob.content ?? '', blob.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
        cache.set(sha, text);
      }
      files.push({ ...w, text });
    }
    return { repo, lessons: lessonsFrom(files), read: Date.now() };
  }

  return { read };
}
