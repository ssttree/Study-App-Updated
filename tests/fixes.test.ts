import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { areaFor, fixListText } from '../src/lib/fixes';
import { DB_NAME, deleteFix, listFixes, resetDbConnection, saveFix } from '../src/lib/db';
import { createBackup, parseBackup, restoreBackup } from '../src/lib/backup';
import { parseHash } from '../src/lib/router.svelte';
import type { Fix } from '../src/lib/types';

const fix = (id: string, fields: Partial<Fix> = {}): Fix => ({
  id,
  text: `Fix ${id}`,
  kind: 'bug',
  area: 'Planner',
  done: false,
  created: Number(id.replace(/\D/g, '')) || 1,
  updated: 0,
  ...fields,
});

beforeEach(async () => {
  await resetDbConnection();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe('fix list', () => {
  it('guesses the area from the screen', () => {
    expect(areaFor('deck')).toBe('Flashcards');
    expect(areaFor('practiceRun')).toBe('Practice');
    expect(areaFor('task')).toBe('Homework');
    expect(areaFor('windows')).toBe('Planner');
    expect(areaFor('mark')).toBe('Progress');
    expect(areaFor('settings')).toBe('Other');
    expect(parseHash('#/fixes')).toEqual({ name: 'fixes' });
  });

  it('copies open fixes oldest first', () => {
    const text = fixListText([
      fix('f2', { kind: 'idea', area: 'Homework', text: 'Add a PDF option' }),
      fix('f1', { text: 'Day view is blank', where: '#/planner' }),
      fix('f3', { done: true }),
    ]);
    expect(text).toBe(
      'Study App fix list (2 open):\n1. [Bug, Planner] Day view is blank (from #/planner)\n2. [Improvement, Homework] Add a PDF option',
    );
  });

  it('saves, lists newest first, deletes, and keeps fixes in a backup', async () => {
    await saveFix(fix('f1'));
    await saveFix(fix('f2'));
    const list = await listFixes();
    expect(list.map((f) => f.id)).toEqual(['f2', 'f1']);
    expect(list[0].updated).toBeGreaterThan(0);
    const backup = parseBackup(JSON.parse(JSON.stringify(await createBackup())));
    expect(backup.fixes).toHaveLength(2);
    await deleteFix('f1');
    expect((await listFixes()).map((f) => f.id)).toEqual(['f2']);
    await restoreBackup(backup);
    expect(await listFixes()).toHaveLength(2);
  });
});
