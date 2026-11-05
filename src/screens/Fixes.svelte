<script lang="ts">
  import { deleteFix, listFixes, newId, saveFix } from '../lib/db';
  import { fixListText } from '../lib/fixes';
  import { plural } from '../lib/load';
  import { FIX_AREAS, type Fix, type FixArea } from '../lib/types';

  let fixes = $state.raw<Fix[]>([]);
  let loaded = $state(false);
  let filter = $state<FixArea | 'All'>('All');
  let text = $state('');
  let kind = $state<Fix['kind']>('bug');
  let area = $state<FixArea>('Other');
  let editing = $state<string | null>(null);
  let editText = $state('');
  let copied = $state(false);
  let copyText = $state('');

  async function load() {
    fixes = await listFixes();
    loaded = true;
  }
  load();

  const open = $derived(fixes.filter((f) => !f.done));
  const shown = $derived(filter === 'All' ? open : open.filter((f) => f.area === filter));
  const done = $derived(fixes.filter((f) => f.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)));
  const counts = $derived(new Map(FIX_AREAS.map((a) => [a, open.filter((f) => f.area === a).length])));

  async function add(e: SubmitEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    const now = Date.now();
    await saveFix({ id: newId(), text: t, kind, area, done: false, created: now, updated: now });
    text = '';
    await load();
  }

  async function toggle(f: Fix) {
    await saveFix(f.done ? { ...f, done: false, doneAt: undefined } : { ...f, done: true, doneAt: Date.now() });
    await load();
  }

  async function saveEdit(f: Fix) {
    const t = editText.trim();
    editing = null;
    if (t && t !== f.text) {
      await saveFix({ ...f, text: t });
      await load();
    }
  }

  async function remove(f: Fix) {
    if (!confirm(`Delete "${f.text}"?`)) return;
    await deleteFix(f.id);
    await load();
  }

  async function copy() {
    const list = fixListText(filter === 'All' ? fixes : fixes.filter((f) => f.area === filter));
    copyText = '';
    try {
      await navigator.clipboard.writeText(list);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // Some browsers refuse; show the text so it can be copied by hand.
      copyText = list;
    }
  }

  const when = (ms: number) => new Date(ms).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
</script>

<main class="page">
  <section class="head">
    <div class="eyebrow accent">Fix list</div>
    <h1>App fixes</h1>
    <p class="muted">
      Bugs and improvements you've noticed, saved to fix in one go. Add one from any screen with <strong>+ Fix</strong> at the
      top. When you're ready, copy the open ones and paste them to Claude.
    </p>
  </section>

  <form class="panel add" onsubmit={add}>
    <label class="sr-only" for="fix-new">What needs fixing or adding?</label>
    <textarea id="fix-new" rows="2" bind:value={text} placeholder="What's wrong, or what would make it better?"></textarea>
    <div class="chip-row" role="group" aria-label="Type">
      <button type="button" class="chip" class:on={kind === 'bug'} aria-pressed={kind === 'bug'} onclick={() => (kind = 'bug')}>Bug</button>
      <button type="button" class="chip" class:on={kind === 'idea'} aria-pressed={kind === 'idea'} onclick={() => (kind = 'idea')}>Improvement</button>
    </div>
    <div class="chip-row" role="group" aria-label="Part of the app">
      {#each FIX_AREAS as a (a)}
        <button type="button" class="chip" class:on={area === a} aria-pressed={area === a} onclick={() => (area = a)}>{a}</button>
      {/each}
    </div>
    <div><button class="btn primary" type="submit" disabled={!text.trim()}>Add to list</button></div>
  </form>

  {#if loaded}
    <section>
      <div class="toolbar">
        <div class="chip-row" role="group" aria-label="Show">
          <button class="chip" class:on={filter === 'All'} aria-pressed={filter === 'All'} onclick={() => (filter = 'All')}>All {open.length}</button>
          {#each FIX_AREAS.filter((a) => counts.get(a)) as a (a)}
            <button class="chip" class:on={filter === a} aria-pressed={filter === a} onclick={() => (filter = a)}>{a} {counts.get(a)}</button>
          {/each}
        </div>
        <button class="btn" onclick={copy} disabled={!shown.length}>{copied ? 'Copied' : 'Copy open fixes for Claude'}</button>
      </div>
      {#if copyText}
        <textarea class="copy" rows="6" readonly value={copyText} aria-label="Open fixes as text"></textarea>
        <p class="muted small">Copying didn't work in this browser, so select the text above and copy it.</p>
      {/if}

      {#each shown as f (f.id)}
        {@render item(f)}
      {:else}
        <p class="muted empty">Nothing open. Tap <strong>+ Fix</strong> at the top of any screen when you spot something.</p>
      {/each}
    </section>

    {#if done.length}
      <details>
        <summary class="muted">Done ({done.length})</summary>
        {#each done as f (f.id)}{@render item(f)}{/each}
      </details>
    {/if}
    <p class="muted small">{plural(open.length, 'fix', 'fixes')} open. The list syncs to your other devices like the rest of your data.</p>
  {/if}
</main>

{#snippet item(f: Fix)}
  <div class="item" class:done={f.done}>
    <input type="checkbox" class="tick" checked={f.done} aria-label={f.done ? `Reopen: ${f.text}` : `Done: ${f.text}`} onchange={() => toggle(f)} />
    <div class="body">
      {#if editing === f.id}
        <textarea rows="2" bind:value={editText} aria-label="Edit fix"></textarea>
        <div class="chip-row">
          <button class="btn small primary" onclick={() => saveEdit(f)}>Save</button>
          <button class="btn small" onclick={() => (editing = null)}>Cancel</button>
        </div>
      {:else}
        <button class="text" onclick={() => ((editing = f.id), (editText = f.text))} title="Edit">{f.text}</button>
      {/if}
      <div class="meta mono small">
        <span class={f.kind}>{f.kind === 'idea' ? 'Improvement' : 'Bug'}</span>
        <span>{f.area}</span>
        <span>{when(f.created)}</span>
        {#if f.where}<a href={f.where}>{f.where.replace(/^#\//, '') || 'today'}</a>{/if}
      </div>
    </div>
    <button class="btn small" onclick={() => remove(f)}>Delete</button>
  </div>
{/snippet}

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .head p {
    margin: 0;
  }
  h1 {
    font-size: 36px;
  }
  .add {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
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
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .copy {
    font-family: var(--mono);
    font-size: 13px;
    margin-bottom: 4px;
  }
  .item {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 12px;
    align-items: start;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }
  .tick {
    width: 20px;
    height: 20px;
    margin-top: 2px;
    accent-color: var(--accent);
  }
  .body {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .text {
    background: none;
    border: 0;
    padding: 0;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: text;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .done .text {
    color: var(--muted);
    text-decoration: line-through;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    color: var(--dim);
  }
  .meta a {
    color: inherit;
  }
  .bug {
    color: var(--warn);
  }
  .idea {
    color: var(--info);
  }
  .empty {
    padding: 12px 0;
  }
  details summary {
    cursor: pointer;
    padding: 6px 0;
  }
  .small {
    font-size: 13px;
  }
</style>
