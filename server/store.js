// The server's own small store: the phone's homework inbox and the Google
// sign-in. One JSON file in DATA_DIR. On Railway, DATA_DIR should be a volume
// (like /data) so it survives redeploys; without one the inbox and the Google
// sign-in are lost on each deploy, and you just connect Google again.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const EMPTY = { inbox: [], google: null, timetableCalendarId: null };

export function createStore(dir = process.env.DATA_DIR || './data') {
  const file = join(dir, 'store.json');
  let cache = null;
  let writing = Promise.resolve();

  async function read() {
    if (cache) return cache;
    try {
      cache = { ...EMPTY, ...JSON.parse(await readFile(file, 'utf8')) };
    } catch {
      cache = structuredClone(EMPTY);
    }
    return cache;
  }

  /** Applies a change and writes the file. Writes go one at a time. */
  async function update(change) {
    const data = await read();
    const result = change(data);
    writing = writing.then(async () => {
      await mkdir(dir, { recursive: true });
      const tmp = file + '.tmp';
      await writeFile(tmp, JSON.stringify(cache));
      await rename(tmp, file);
    });
    await writing;
    return result;
  }

  return { read, update };
}
