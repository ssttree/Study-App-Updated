<script lang="ts">
  import { getSyncConfig, saveSyncConfig } from '../lib/db';
  import { api, sync, SyncError, type ServerStatus, type SyncResult } from '../lib/sync';
  import { href } from '../lib/router.svelte';
  import { plural } from '../lib/load';
  import type { SyncConfig } from '../lib/types';

  /** Set when Google sends you back: done, declined, expired or failed. */
  let { result }: { result?: string } = $props();

  const RESULT_TEXT: Record<string, { text: string; warn: boolean }> = {
    done: { text: 'Google Calendar is connected. Now pick your work and timetable calendars below.', warn: false },
    declined: { text: 'Google sign-in was cancelled, so nothing changed.', warn: true },
    expired: { text: 'That sign-in took too long. Press Connect Google Calendar again.', warn: true },
    failed: { text: "Google didn't accept the sign-in. Check the setup steps (client ID, secret and redirect address) and try again.", warn: true },
  };

  let config = $state<SyncConfig | null>(null);
  let status = $state<ServerStatus | null>(null);
  let statusError = $state('');
  let calendars = $state<{ id: string; name: string; primary: boolean }[]>([]);
  let busy = $state(false);
  let saved = $state(false);
  let copied = $state(false);
  let lastRun = $state<SyncResult | null>(null);

  async function load() {
    config = await getSyncConfig();
    if (config.key) await check();
  }
  load();

  async function check() {
    if (!config?.key) return;
    statusError = '';
    try {
      status = await api<ServerStatus>(config.key, '/api/status');
      if (status.connected) {
        calendars = (await api<{ calendars: typeof calendars }>(config.key, '/api/google/calendars')).calendars;
      }
    } catch (e) {
      status = null;
      statusError = e instanceof SyncError && e.status === 401 ? "That key doesn't match the APP_KEY on the server." : (e as Error).message;
    }
  }

  async function saveKey() {
    if (!config) return;
    config.key = config.key.trim();
    await saveSyncConfig($state.snapshot(config));
    await check();
  }

  async function saveChoices() {
    if (!config) return;
    busy = true;
    try {
      // Picking calendars here makes this the device that talks to Google.
      config.google = true;
      await saveSyncConfig($state.snapshot(config));
      // The server needs the timetable too, for the phone's subject guess.
      await api(config.key, '/api/google/settings', { method: 'POST', body: { timetableCalendarId: config.timetableCalendarId || null } });
      lastRun = await sync(true);
      config = await getSyncConfig();
      saved = true;
      setTimeout(() => (saved = false), 2500);
    } finally {
      busy = false;
    }
  }

  async function syncNow() {
    busy = true;
    try {
      lastRun = await sync(true);
      config = await getSyncConfig();
    } finally {
      busy = false;
    }
  }

  async function disconnect() {
    if (!config || !confirm('Disconnect Google Calendar? Events the app already made stay in Google until you delete its two calendars.')) return;
    await api(config.key, '/api/google/disconnect', { method: 'POST' });
    config.connected = false;
    await saveSyncConfig($state.snapshot(config));
    calendars = [];
    await check();
  }

  const phoneLink = $derived(config?.key ? `${location.origin}/add.html#k=${encodeURIComponent(config.key)}` : '');

  async function copyLink() {
    await navigator.clipboard?.writeText(phoneLink);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  const when = (ts?: number) => (ts ? new Date(ts).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : 'never');
</script>

<main class="page">
  <section class="head">
    <div class="eyebrow"><a href={href('planner')}>Planner</a> / Phone and Google</div>
    <h1>Phone and Google Calendar</h1>
    <p class="muted">
      Both go through your Railway server, so they only work when this laptop is online. Everything else keeps working
      offline and catches up next time.
    </p>
  </section>

  {#if result && RESULT_TEXT[result]}
    <div class="notice" class:warn={RESULT_TEXT[result].warn}>{RESULT_TEXT[result].text}</div>
  {/if}

  {#if config}
    <section class="panel block">
      <h2>1. App key</h2>
      <p class="muted small">The APP_KEY you set in Railway. It stops anyone else adding homework or reading your calendars.</p>
      <div class="line">
        <input type="password" bind:value={config.key} placeholder="Paste the app key" autocomplete="off" aria-label="App key" />
        <button class="btn" onclick={saveKey}>Save and check</button>
      </div>
      {#if statusError}<div class="notice warn">{statusError}</div>{/if}
      {#if status}<p class="good small">Connected to the server.{status.inbox ? ` ${plural(status.inbox, 'task')} waiting from your phone.` : ''}</p>{/if}
    </section>

    <section class="panel block" class:off={!status}>
      <h2>2. Your phone</h2>
      <p class="muted small">
        The whole app works on your phone now: see <a href={href('settings', 'sync')}>Sync and devices</a>. This
        link is still here for the tiny quick add page, if you only want to jot down homework at the end of the day.
      </p>
      {#if phoneLink && status}
        <div class="line">
          <input type="text" readonly value={phoneLink} aria-label="Phone link" onfocus={(e) => e.currentTarget.select()} />
          <button class="btn" onclick={copyLink}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <p class="muted small">The link has your key in it, so only send it to yourself.</p>
      {/if}
    </section>

    <section class="panel block" class:off={!status}>
      <h2>3. Google Calendar</h2>
      {#if status && !status.google}
        <p class="muted small">
          Google isn't set up on the server yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Railway (see the setup
          steps). The redirect address to give Google is <span class="mono">{status.redirect}</span>
        </p>
      {:else if status && !status.connected}
        <p class="muted small">
          The app makes two calendars of its own (Study App: Due dates, Study App: Study blocks) and only reads the
          calendars you pick. It can't change your other calendars.
        </p>
        <div><a class="btn primary" href="/auth/google/start?k={encodeURIComponent(config.key)}">Connect Google Calendar</a></div>
      {:else if status && config.google === false}
        <p class="muted small">Google is connected, and another of your devices reads and writes it. Its calendar copy reaches this one through sync.</p>
        <div><button class="btn" onclick={() => config && ((config.google = true), saveSyncConfig($state.snapshot(config)))}>Use this device for Google instead</button></div>
      {:else if status}
        <label class="field">
          Work calendar <span class="muted">(shifts take out study windows, with 30 min to get there)</span>
          <select bind:value={config.workCalendarId}>
            <option value="">None</option>
            {#each calendars as c (c.id)}<option value={c.id}>{c.name}{c.primary ? ' (main)' : ''}</option>{/each}
          </select>
        </label>
        <label class="field">
          School timetable calendar <span class="muted">(guesses the subject, and bus windows vanish in holidays)</span>
          <select bind:value={config.timetableCalendarId}>
            <option value="">None</option>
            {#each calendars as c (c.id)}<option value={c.id}>{c.name}{c.primary ? ' (main)' : ''}</option>{/each}
          </select>
        </label>
        <label class="check">
          <input type="checkbox" bind:checked={config.pushDue} />
          <span>Put due dates in <strong>Study App: Due dates</strong> <span class="muted">(homework, tests, exams, milestones)</span></span>
        </label>
        <label class="check">
          <input type="checkbox" bind:checked={config.pushBlocks} />
          <span>Put the plan in <strong>Study App: Study blocks</strong> <span class="muted">(untick that calendar in Google to hide it)</span></span>
        </label>
        <div class="line">
          <button class="btn primary" onclick={saveChoices} disabled={busy}>{busy ? 'Syncing...' : 'Save and sync'}</button>
          <button class="btn danger" onclick={disconnect}>Disconnect Google</button>
          {#if saved}<span class="good small">Saved.</span>{/if}
        </div>
      {/if}
    </section>

    {#if status}
      <section class="block">
        <h2>Sync</h2>
        <p class="muted small">
          Runs by itself every 10 minutes while the app is open and online. Last sync: {when(config.lastSync)}.
        </p>
        {#if config.lastError}<div class="notice warn">Last sync had a problem: {config.lastError}</div>{/if}
        {#if lastRun && !lastRun.error}
          <p class="good small">
            Done. {lastRun.collected ? `${plural(lastRun.collected, 'task')} collected from your phone. ` : ''}{lastRun.calendarsRead
              ? 'Calendars read. '
              : ''}{lastRun.pushed ? 'Google Calendar updated.' : ''}
          </p>
        {/if}
        <div><button class="btn" onclick={syncNow} disabled={busy}>Sync now</button></div>
      </section>
    {/if}
  {/if}
</main>

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .head p {
    margin: 0;
    max-width: 640px;
  }
  .eyebrow a {
    color: inherit;
  }
  h1 {
    font-size: 36px;
  }
  h2 {
    font-size: 15px;
    font-weight: 700;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .panel.block {
    padding: 18px;
  }
  .block p {
    margin: 0;
  }
  .off {
    opacity: 0.55;
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .line input {
    flex: 1 1 260px;
    min-height: 44px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--line-strong);
    background: var(--surface);
    color: var(--text);
    font: 400 15px var(--mono);
  }
  .check {
    display: flex;
    gap: 10px;
    align-items: center;
    cursor: pointer;
  }
  .check input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
    flex: none;
  }
  .small {
    font-size: 13px;
  }
  .good {
    color: var(--good);
  }
</style>
