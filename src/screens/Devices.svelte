<script lang="ts">
  import { renderSVG } from 'uqr';
  import { getSyncConfig } from '../lib/db';
  import { getDataSyncState, type DataSyncState, type ServerSyncStatus } from '../lib/datasync';
  import { api, sync, SyncError } from '../lib/sync';
  import { detectPlatform, install } from '../lib/install.svelte';
  import { href } from '../lib/router.svelte';
  import { plural } from '../lib/load';
  import type { SyncConfig } from '../lib/types';

  let config = $state<SyncConfig | null>(null);
  let syncState = $state<DataSyncState | null>(null);
  let server = $state<ServerSyncStatus | null>(null);
  let keyError = $state('');
  let busy = $state(false);
  let copied = $state(false);
  let showQr = $state(false);
  const platform = detectPlatform(navigator.userAgent);

  async function load() {
    config = await getSyncConfig();
    syncState = await getDataSyncState();
    if (config.key) await check();
  }
  load();

  async function check() {
    if (!config?.key) return;
    keyError = '';
    try {
      server = await api<ServerSyncStatus>(config.key, '/api/sync/status');
    } catch (e) {
      server = null;
      keyError = e instanceof SyncError && e.status === 401 ? "That key doesn't match the APP_KEY on the server." : (e as Error).message;
    }
  }

  // The join screen checks the key and asks what to do if this browser already has data.
  let newKey = $state('');

  async function syncNow() {
    busy = true;
    try {
      await sync(true);
      syncState = await getDataSyncState();
      await check();
    } finally {
      busy = false;
    }
  }

  const joinLink = $derived(config?.key ? `${location.origin}/#/join/${encodeURIComponent(config.key)}` : '');
  const qr = $derived(joinLink ? renderSVG(joinLink, { border: 2, whiteColor: '#f4f1ea', blackColor: '#1c1c1c' }) : '');

  async function copyLink() {
    await navigator.clipboard?.writeText(joinLink);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  function ago(ts?: number): string {
    if (!ts) return 'never';
    const min = Math.round((Date.now() - ts) / 60_000);
    if (min < 1) return 'just now';
    if (min < 60) return `${plural(min, 'minute')} ago`;
    return new Date(ts).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
  }

  const mb = (bytes: number) => (bytes / 1_048_576).toFixed(1);
</script>

<main class="page">
  <section class="head">
    <div class="eyebrow"><a href={href('settings')}>Settings</a> / Sync</div>
    <h1>Sync and devices</h1>
    <p class="muted">
      Your laptop, your phone and each Zen space keep their own full copy, so they all work offline. Whenever one is
      online it sends what you did and collects what you did elsewhere, through your Railway server.
    </p>
  </section>

  {#if config && syncState}
    <section class="panel block">
      <h2>This device</h2>
      {#if !config.key}
        <p class="muted small">Paste the APP_KEY you set in Railway to start syncing this device.</p>
        <div class="line">
          <input type="password" bind:value={newKey} placeholder="Paste the app key" autocomplete="off" aria-label="App key" />
          <a class="btn primary" href={href('join', newKey.trim())}>Start syncing</a>
        </div>
      {:else}
        <div class="stat">
          <span class="dot" class:ok={!syncState.lastError && syncState.lastSync} aria-hidden="true"></span>
          <div>
            <div>{syncState.lastError ? 'Last sync had a problem' : syncState.lastSync ? 'Synced' : 'Not synced yet'}</div>
            <div class="muted small mono">
              {ago(syncState.lastSync)}{#if syncState.lastSync && !syncState.lastError}{' · '}{plural(syncState.lastSent ?? 0, 'change')} sent, {syncState.lastGot ?? 0} collected{/if}
            </div>
          </div>
          <button class="btn" onclick={syncNow} disabled={busy}>{busy ? 'Syncing...' : 'Sync now'}</button>
        </div>
        {#if syncState.lastError}<div class="notice warn">{syncState.lastError}</div>{/if}
        {#if keyError}<div class="notice warn">{keyError}</div>{/if}
        {#if server}
          <p class="muted small">
            The server holds {plural(server.records, 'record')} ({mb(server.bytes)} MB). It syncs every minute while the app is
            open, and when you leave it.
          </p>
        {/if}
      {/if}
    </section>

    <section class="panel block" class:off={!server}>
      <h2>Add a device</h2>
      <p class="muted small">
        Open this link once on your phone and in each Zen space. It saves the key there and copies your data across.
        The link has your key in it, so only send it to yourself.
      </p>
      {#if joinLink && server}
        <div class="line">
          <input type="text" readonly value={joinLink} aria-label="Link for another device" onfocus={(e) => e.currentTarget.select()} />
          <button class="btn" onclick={copyLink}>{copied ? 'Copied' : 'Copy'}</button>
          <button class="btn" onclick={() => (showQr = !showQr)}>{showQr ? 'Hide QR code' : 'Show QR code'}</button>
        </div>
        {#if showQr}
          <div class="qr">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -- made here from the link, not user content -->
            {@html qr}
            <p class="small">Point your phone's camera at this.</p>
          </div>
        {/if}
      {/if}
    </section>

    <section class="panel block">
      <h2>Install</h2>
      {#if install.standalone}
        <p class="good small">This is the installed app.</p>
      {:else if install.prompt}
        <p class="muted small">Puts the app on your home screen or dock. It opens in its own window and works offline.</p>
        <div><button class="btn primary" onclick={() => install.install()}>Install the app</button></div>
      {:else if platform === 'ios'}
        <p class="muted small">
          In Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. On iPhone the home screen app
          keeps its own data apart from Safari, so open it, go to Settings, Sync, and paste your app key there once.
        </p>
      {:else if platform === 'android'}
        <p class="muted small">In Chrome, open the <strong>⋮</strong> menu and tap <strong>Add to Home screen</strong> or <strong>Install app</strong>.</p>
      {:else if platform === 'firefox'}
        <p class="muted small">
          Zen and Firefox can't install web apps, but that's fine: the app still opens and works offline in a normal tab.
          Pin it so it's always there.
        </p>
      {:else}
        <p class="muted small">Use the install button at the right of the address bar, or the browser menu, to install the app.</p>
      {/if}
    </section>

    <section class="block">
      <h2>Good to know</h2>
      <ul class="muted small">
        <li>If the same card is reviewed on two devices before they sync, the later review wins. Both reviews stay in your history.</li>
        <li>Google Calendar is handled by one device only. <a href={href('planner', 'connect')}>Phone and Google</a></li>
        <li>Backups still work and are still worth keeping. Restoring one on any device sends it to the others.</li>
      </ul>
    </section>
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
  .stat {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .stat > div {
    flex: 1;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--warn);
    flex: none;
  }
  .dot.ok {
    background: var(--good);
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .line input {
    flex: 1 1 260px;
    min-width: 0;
    min-height: 44px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--line-strong);
    background: var(--surface);
    color: var(--text);
    font: 400 15px var(--mono);
  }
  .qr {
    align-self: flex-start;
    background: var(--paper);
    color: var(--paper-ink);
    border-radius: var(--radius);
    padding: 16px;
    text-align: center;
  }
  .qr :global(svg) {
    width: 220px;
    height: 220px;
    display: block;
  }
  .qr p {
    margin: 8px 0 0;
  }
  ul {
    margin: 0;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .small {
    font-size: 13px;
  }
  .good {
    color: var(--good);
  }
</style>
