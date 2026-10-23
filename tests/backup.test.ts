import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBackup, parseBackup, restoreBackup, backupOverdue } from '../src/lib/backup';
import { listCards, listDecks, listReviewLogs, recordReview, resetDbConnection, saveCard, saveDeck, deleteDeck, DB_NAME } from '../src/lib/db';
import { blankCard } from '../src/lib/cards';
import { makeScheduler, rate } from '../src/lib/scheduler';
import { DEFAULT_SETTINGS } from '../src/lib/types';

beforeEach(async () => {
  await resetDbConnection();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});

async function seed() {
  await saveDeck({ id: 'd1', name: 'Calculus', subject: 'Maths Extension 1', module: '', typingDefault: 'off', created: 1, updated: 1 });
  const card = { ...blankCard('d1'), front: 'What is $\\frac{d}{dx}\\sin x$?', back: '$\\cos x$' };
  await saveCard(card);
  const { card: after, log } = rate(makeScheduler(DEFAULT_SETTINGS), card, 'forward', 3);
  await recordReview(after, log);
}

describe('backup', () => {
  it('round trips the whole collection through JSON', async () => {
    await seed();
    const backup = await createBackup();
    const json = JSON.parse(JSON.stringify(backup));

    await deleteDeck('d1');
    expect(await listCards()).toHaveLength(0);
    expect(await listReviewLogs()).toHaveLength(0);

    await restoreBackup(parseBackup(json));
    expect(await listDecks()).toHaveLength(1);
    const cards = await listCards();
    expect(cards).toHaveLength(1);
    expect(cards[0].back).toBe('$\\cos x$');
    expect(cards[0].fsrs.reps).toBe(1);
    expect(await listReviewLogs()).toHaveLength(1);
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup({ hello: 1 })).toThrow(/not a Study App backup/);
    expect(() => parseBackup({ format: 'study-app-backup', version: 99, decks: [], cards: [], reviewLogs: [] })).toThrow(/newer version/);
    expect(() =>
      parseBackup({ format: 'study-app-backup', version: 1, decks: [], cards: [{ deckId: 'missing' }], reviewLogs: [] }),
    ).toThrow(/missing deck/);
  });

  it('reminds after 7 days without a backup', () => {
    const now = Date.now();
    expect(backupOverdue({ ...DEFAULT_SETTINGS }, now)).toBe(true);
    expect(backupOverdue({ ...DEFAULT_SETTINGS, lastBackupAt: now - 86_400_000 }, now)).toBe(false);
    expect(backupOverdue({ ...DEFAULT_SETTINGS, lastBackupAt: now - 8 * 86_400_000 }, now)).toBe(true);
  });
});
