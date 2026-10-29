<script lang="ts">
  import { untrack } from 'svelte';
  import { getSyncConfig, saveSyncConfig } from '../lib/db';
  import { clearForJoin, getDataSyncState, localRecordCount, syncData, type ServerSyncStatus } from '../lib/datasync';
  import { api, DATA_SYNCED, SyncError } from '../lib/sync';
  import { downloadBackup } from '../lib/backup';
  import { href } from '../lib/router.svelte';
  import { plural } from '../lib/load';

  /** From the link made on Settings, Sync. */
  let { key: linkKey }: { key?: string } = $props();
  const fromLink = untrack(() => linkKey);

  type Step = 'key' | 'checking' | 'choose' | 'syncing' | 'done' | 'error';
  let step = $state<Step>('checking');
  let key = $state(fromLink ?? '');
  let error = $state('');
  let server = $state<ServerSyncStatus | null>(null);
  let localCount = $state(0);
  let got = $state(0);

  // Don't leave the key sitting in the address bar or history.
  if (fromLink) history.replaceState(null, '', location.pathname + '#/join');

  async function start() {
    if (!key.trim()) {
      step = 'key';
      return;
    }
    key = key.trim();
    step = 'checking';
    error = '';
    try {
      server = await api<ServerSyncStatus>(key, '/api/sync/status');
    } catch (e) {
      error = e instanceof SyncError && e.status === 401 ? "That key doesn't match the APP_KEY on the server." : (e as Error).message;
      step = 'error';
      return;
    }
    const state = await getDataSyncState();
    localCount = await localRecordCount();
    if (state.serverId !== server.id && server.records > 0 && localCount > 0) step = 'choose';
    else await run(false);
  }
  start();

  async function run(replace: boolean) {
    step = 'syncing';
    got = 0;
    try {
      if (replace) await clearForJoin();
      // Saved only now, so the background sync can't merge before you choose.
      const config = await getSyncConfig();
      if (config.key !== key) {
        // A new device leaves Google Calendar to the one that already has it.
        await saveSyncConfig({ ...config, key, google: config.key ? config.google : false });
      }
      const result = await syncData(key, (n) => (got = n));
      if (result.got) window.dispatchEvent(new CustomEvent(DATA_SYNCED, { detail: result.got }));
      step = 'done';
    } catch (e) {
      error = (e as Error).message;
      step = 'error';
    }
  }
</script>

<main class="page">
  <section class="head">
    <div class="eyebrow accent">Sync</div>
    <h1>Set up this device</h1>
  </section>

  {#if step === 'key'}
    <section class="panel block">
      <p class="muted">Paste the APP_KEY you set in Railway.</p>
      <div class="line">
        <input type="password" bind:value={key} placeholder="Paste the app key" autocomplete="off" aria-label="App key" />
        <button class="btn primary" onclick={start}>Continue</button>
      </div>
    </section>
  {:else if step === 'checking'}
    <p class="muted">Checking the server...</p>
  {:else if step === 'choose' && server}
    <section class="block">
      <p>
        This browser already has some study data ({plural(localCount, 'record')}), and the server has your synced copy
        ({plural(server.records, 'record')}). Which do you want here?
      </p>
      <button class="option primary" onclick={() => run(true)}>
        <strong>Use the synced copy</strong>
        <span>Clears this browser's data and copies everything from your other devices. Best for a new Zen space or an old copy.</span>
      </button>
      <button class="option" onclick={() => run(false)}>
        <strong>Merge both</strong>
        <span>Keeps everything here and adds it to the synced copy, so your other devices get it too.</span>
      </button>
      <p class="muted small">
        Not sure what's in this browser? <button class="link" onclick={() => downloadBackup()}>Download a backup of it first</button>.
      </p>
    </section>
  {:else if step === 'syncing'}
    <section class="block">
      <p>Copying your data{got ? `: ${plural(got, 'record')} so far` : ''}...</p>
      <p class="muted small">Question pictures take the longest. Keep this page open.</p>
    </section>
  {:else if step === 'done'}
    <section class="block">
      <p class="good">This device is synced. It catches up by itself whenever it's online.</p>
      <div class="line">
        <a class="btn primary" href={href('today')}>Go to today</a>
        <a class="btn" href={href('settings', 'sync')}>Install the app</a>
      </div>
    </section>
  {:else if step === 'error'}
    <section class="block">
      <div class="notice warn">{error}</div>
      <div class="line">
        <button class="btn" onclick={start}>Try again</button>
        <button class="btn" onclick={() => (step = 'key')}>Enter the key by hand</button>
      </div>
    </section>
  {/if}
</main>

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  h1 {
    font-size: 36px;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .panel.block {
    padding: 18px;
  }
  .block p {
    margin: 0;
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
  .option {
    display: flex;
    flex-direction: column;
    gap: 4px;
    text-align: left;
    padding: 16px 18px;
    border-radius: var(--radius);
    border: 1px solid var(--line-strong);
    background: var(--surface);
    color: var(--text);
    font: 400 15px var(--font);
    cursor: pointer;
  }
  .option span {
    color: var(--muted);
    font-size: 14px;
  }
  .option.primary {
    border-color: var(--accent);
  }
  .option strong {
    color: var(--text);
  }
  .option.primary strong {
    color: var(--accent);
  }
  .option:hover {
    background: var(--surface-2);
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .small {
    font-size: 13px;
  }
  .good {
    color: var(--good);
  }
</style>
