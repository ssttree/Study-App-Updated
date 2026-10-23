// Backup and restore. A backup is one JSON file holding every deck, card,
// review and setting. Browser storage can be wiped (clearing site data, a
// new laptop), so this file is the safety net.

import { getSettings, listCards, listDecks, listReviewLogs, replaceAll, saveSettings } from './db';
import type { Card, Deck, ReviewLog, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';

export const BACKUP_FORMAT = 'study-app-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_REMINDER_DAYS = 7;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  decks: Deck[];
  cards: Card[];
  reviewLogs: ReviewLog[];
  settings: Settings;
}

export async function createBackup(now = Date.now()): Promise<Backup> {
  const [decks, cards, reviewLogs, settings] = await Promise.all([
    listDecks(),
    listCards(),
    listReviewLogs(),
    getSettings(),
  ]);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date(now).toISOString(),
    decks,
    cards,
    reviewLogs,
    settings: { ...settings, lastBackupAt: now },
  };
}

export function backupFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `study-app-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/** Builds a backup, saves it as a download and remembers when it happened. */
export async function downloadBackup(): Promise<void> {
  const now = Date.now();
  const backup = await createBackup(now);
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName(new Date(now));
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  await saveSettings(backup.settings);
}

/** Checks a parsed file really is a backup before anything is replaced. */
export function parseBackup(data: unknown): Backup {
  if (!data || typeof data !== 'object') throw new Error('This file is not a Study App backup.');
  const b = data as Partial<Backup>;
  if (b.format !== BACKUP_FORMAT) throw new Error('This file is not a Study App backup.');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of the app. Update the app first.');
  }
  if (!Array.isArray(b.decks) || !Array.isArray(b.cards) || !Array.isArray(b.reviewLogs)) {
    throw new Error('This backup is missing decks, cards or reviews, so it may be damaged.');
  }
  const deckIds = new Set(b.decks.map((d) => d.id));
  const orphan = b.cards.find((c) => !deckIds.has(c.deckId));
  if (orphan) throw new Error('This backup has cards that belong to a missing deck, so it may be damaged.');
  return {
    format: BACKUP_FORMAT,
    version: b.version,
    exportedAt: String(b.exportedAt ?? ''),
    decks: b.decks,
    cards: b.cards,
    reviewLogs: b.reviewLogs,
    settings: { ...DEFAULT_SETTINGS, ...b.settings },
  };
}

/** Replaces everything in the app with the backup's contents. */
export async function restoreBackup(backup: Backup): Promise<void> {
  await replaceAll(backup);
}

export function backupOverdue(settings: Settings, now = Date.now()): boolean {
  if (!settings.lastBackupAt) return true;
  return now - settings.lastBackupAt > BACKUP_REMINDER_DAYS * 86_400_000;
}
