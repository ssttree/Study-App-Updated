<script lang="ts">
  // The "Fix" button in the top bar: jot down a bug or idea without leaving the screen you're on.
  import { newId, saveFix } from '../lib/db';
  import { areaFor } from '../lib/fixes';
  import { href, router } from '../lib/router.svelte';
  import { FIX_AREAS, type Fix, type FixArea } from '../lib/types';

  let dialog = $state<HTMLDialogElement | null>(null);
  let input = $state<HTMLTextAreaElement | null>(null);
  let text = $state('');
  let kind = $state<Fix['kind']>('bug');
  let area = $state<FixArea>('Other');
  let where = '';
  let added = $state(false);
  let error = $state('');

  function open() {
    area = areaFor(router.route.name);
    where = location.hash || '#/today';
    added = false;
    error = '';
    dialog?.showModal();
    input?.focus();
  }

  async function add(e: SubmitEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    try {
      const now = Date.now();
      await saveFix({ id: newId(), text: t, kind, area, where, done: false, created: now, updated: now });
      text = '';
      added = true;
      // Tells the fix list (in this tab or another) to show it.
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel('study-data');
        channel.postMessage('changed');
        channel.close();
      }
      setTimeout(() => dialog?.close(), 700);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<button class="fix-btn" type="button" onclick={open} title="Note a bug or improvement for later">+ Fix</button>

<dialog bind:this={dialog} class="fix-dialog" aria-labelledby="fix-title" onclose={() => (added = false)}>
  <form onsubmit={add}>
    <div class="head">
      <h2 id="fix-title">Note a fix</h2>
      <a class="small" href={href('fixes')} onclick={() => dialog?.close()}>See the list</a>
    </div>
    <label class="sr-only" for="fix-text">What needs fixing or adding?</label>
    <textarea id="fix-text" bind:this={input} bind:value={text} rows="3" placeholder="What's wrong, or what would make it better?"></textarea>
    <div class="chip-row" role="group" aria-label="Type">
      <button type="button" class="chip" class:on={kind === 'bug'} aria-pressed={kind === 'bug'} onclick={() => (kind = 'bug')}>Bug</button>
      <button type="button" class="chip" class:on={kind === 'idea'} aria-pressed={kind === 'idea'} onclick={() => (kind = 'idea')}>Improvement</button>
    </div>
    <div class="chip-row" role="group" aria-label="Part of the app">
      {#each FIX_AREAS as a (a)}
        <button type="button" class="chip" class:on={area === a} aria-pressed={area === a} onclick={() => (area = a)}>{a}</button>
      {/each}
    </div>
    {#if error}<div class="notice warn">{error}</div>{/if}
    <div class="foot">
      <span class="small muted" aria-live="polite">{added ? 'Added to your fix list.' : ''}</span>
      <button type="button" class="btn" onclick={() => dialog?.close()}>Cancel</button>
      <button type="submit" class="btn primary" disabled={!text.trim()}>Add</button>
    </div>
  </form>
</dialog>

<style>
  .fix-btn {
    min-height: 36px;
    padding: 0 12px;
    border-radius: 18px;
    border: 1px solid var(--line-strong);
    background: transparent;
    color: var(--muted);
    font: 400 14px var(--font);
    cursor: pointer;
    white-space: nowrap;
  }
  .fix-btn:hover {
    color: var(--text);
    border-color: var(--accent);
  }
  .fix-dialog {
    width: min(520px, calc(100vw - 32px));
    padding: 20px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
  }
  .fix-dialog::backdrop {
    background: rgb(0 0 0 / 55%);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }
  h2 {
    font-size: 20px;
    margin: 0;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
  }
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    min-height: 36px;
    padding: 0 12px;
    border-radius: 18px;
    border: 1px solid var(--line-strong);
    background: transparent;
    color: var(--muted);
    font: 400 14px var(--font);
    cursor: pointer;
  }
  .chip.on {
    border-color: var(--accent);
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    justify-content: flex-end;
  }
  .foot span {
    margin-right: auto;
  }
  .small {
    font-size: 13px;
  }
</style>
