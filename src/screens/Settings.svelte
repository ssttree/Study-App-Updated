<script lang="ts">
  import { getSettings, saveSettings, listCards, listReviewLogs, listProblems } from '../lib/db';
  import { downloadBackup, parseBackup, restoreBackup, type Backup } from '../lib/backup';
  import { plural } from '../lib/load';
  import type { Settings } from '../lib/types';

  let settings = $state<Settings | null>(null);
  let saved = $state(false);
  let counts = $state({ cards: 0, reviews: 0, problems: 0 });
  let pending = $state.raw<Backup | null>(null);
  let restoreError = $state('');
  let restoreDone = $state('');
  let storageNote = $state('');

  async function load() {
    settings = await getSettings();
    const [cards, logs, problems] = await Promise.all([listCards(), listReviewLogs(), listProblems()]);
    counts = { cards: cards.length, reviews: logs.length, problems: problems.length };
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    if (est?.usage !== undefined) {
      storageNote = `Using ${(est.usage / 1_048_576).toFixed(1)} MB of browser storage.${persisted ? ' The browser has agreed to keep it.' : ''}`;
    }
  }
  load();

  async function save() {
    if (!settings) return;
    const clean: Settings = {
      ...$state.snapshot(settings),
      newPerDay: Math.max(0, Math.min(999, Math.round(Number(settings.newPerDay) || 0))),
      dayStartHour: Math.max(0, Math.min(23, Math.round(Number(settings.dayStartHour) || 0))),
      problemMinutes: Number(settings.problemMinutes) || 35,
    };
    await saveSettings(clean);
    settings = clean;
    saved = true;
    setTimeout(() => (saved = false), 2000);
  }

  async function backup() {
    await downloadBackup();
    settings = await getSettings();
  }

  async function pickFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    restoreError = '';
    restoreDone = '';
    pending = null;
    if (!file) return;
    try {
      pending = parseBackup(JSON.parse(await file.text()));
    } catch (err) {
      restoreError = err instanceof SyntaxError ? 'That file could not be read as a backup.' : (err as Error).message;
    }
  }

  async function confirmRestore() {
    if (!pending) return;
    await restoreBackup(pending);
    restoreDone = `Restored ${plural(pending.cards.length, 'card')} from the backup.`;
    pending = null;
    await load();
  }

  function lastBackupText(s: Settings): string {
    if (!s.lastBackupAt) return 'No backup made yet.';
    return `Last backup: ${new Date(s.lastBackupAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}.`;
  }
</script>

<main class="page">
  <section>
    <div class="eyebrow">Settings</div>
    <h1>Settings</h1>
  </section>

  {#if settings}
    <section class="block">
      <h2>Flashcards and problems</h2>
      <fieldset>
        <legend>Target retention</legend>
        <p class="muted hint">
          How sure you want to be of remembering each card when it comes up. Higher means more reviews.
        </p>
        <label class="choice">
          <input type="radio" name="retention" value={0.9} bind:group={settings.retention} />
          <span><strong>90%</strong> <span class="muted">normal, about the right balance for most of the year</span></span>
        </label>
        <label class="choice">
          <input type="radio" name="retention" value={0.95} bind:group={settings.retention} />
          <span><strong>95%</strong> <span class="muted">exam weeks, more reviews but fewer gaps</span></span>
        </label>
      </fieldset>
      <div class="two">
        <label class="field">
          New cards per day
          <input type="number" min="0" max="999" bind:value={settings.newPerDay} />
        </label>
        <label class="field">
          New day starts at (hour, 0 to 23)
          <input type="number" min="0" max="23" bind:value={settings.dayStartHour} />
        </label>
      </div>
      <p class="muted hint">
        20 new cards a day settles at roughly 200 reviews a day, about 20 to 30 minutes. The day starts at 4am by
        default so late night study still counts for that day.
      </p>
      <label class="field">
        Problem block length
        <select bind:value={settings.problemMinutes}>
          {#each [15, 25, 35, 45, 60] as m (m)}<option value={m}>{m} minutes</option>{/each}
        </select>
      </label>
      <p class="muted hint">
        How long the evening problem block on paper is. The daily mix fills it using about 1.5 minutes per mark, the
        same guide SmarterEd uses.
      </p>
      <div class="row-actions">
        <button class="btn primary" onclick={save}>Save settings</button>
        {#if saved}<span class="ok mono">Saved</span>{/if}
      </div>
    </section>

    <section class="block">
      <h2>Backup and restore</h2>
      <p class="muted hint">
        Your {plural(counts.cards, 'card')}, {plural(counts.reviews, 'review')} and {plural(counts.problems, 'practice question')} live only in this browser. A backup
        is one file with everything in it. Keep it somewhere safe, like Google Drive. {lastBackupText(settings)}
      </p>
      <div class="row-actions">
        <button class="btn primary" onclick={backup}>Download backup</button>
        <label class="btn">
          Restore from a backup
          <input class="sr-only" type="file" accept="application/json,.json" onchange={pickFile} />
        </label>
      </div>
      {#if restoreError}<p class="notice warn">{restoreError}</p>{/if}
      {#if restoreDone}<p class="notice">{restoreDone}</p>{/if}
      {#if pending}
        <div class="notice warn">
          <p>
            This backup from {pending.exportedAt ? new Date(pending.exportedAt).toLocaleString('en-AU') : 'an unknown date'}
            has {plural(pending.decks.length, 'deck')}, {plural(pending.cards.length, 'card')}, {plural(pending.reviewLogs.length, 'review')} and {plural(pending.problems.length, 'practice question')}.
            Restoring replaces everything in the app now ({plural(counts.cards, 'card')}). Download a backup first if
            you might want the current cards.
          </p>
          <div class="row-actions">
            <button class="btn danger" onclick={confirmRestore}>Replace everything with this backup</button>
            <button class="btn" onclick={() => (pending = null)}>Cancel</button>
          </div>
        </div>
      {/if}
    </section>

    <section class="block">
      <h2>Offline</h2>
      <p class="muted hint">
        After the first visit the app saves its own files, so it opens and works with no internet, for example on the
        bus. Everything you do is saved straight away in this browser. {storageNote}
      </p>
    </section>
  {/if}
</main>

<style>
  h1 {
    font-size: 40px;
    margin-top: 8px;
  }
  h2 {
    font-size: 18px;
    font-weight: 700;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-top: 24px;
    border-top: 1px solid var(--line);
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  legend {
    font-size: 14px;
    color: var(--muted);
    margin-bottom: 4px;
  }
  .choice {
    display: flex;
    gap: 12px;
    align-items: center;
    min-height: 44px;
    padding: 0 14px;
    border: 1px solid var(--line-strong);
    border-radius: 10px;
    cursor: pointer;
  }
  .choice input {
    accent-color: var(--accent);
    width: 18px;
    height: 18px;
  }
  .two {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px;
  }
  .hint {
    margin: 0;
    font-size: 15px;
  }
  .row-actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    align-items: center;
  }
  .ok {
    color: var(--good);
    font-size: 13px;
  }
  .notice p {
    margin: 0 0 12px;
  }
</style>
