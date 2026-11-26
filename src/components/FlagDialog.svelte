<script lang="ts">
  // Flags a question as not captured properly (cut off, extra bits, wrong
  // answer matched) so it can be found and fixed later from Practice >
  // Flagged questions. Opens over the page, so a practice block carries on.
  import { untrack } from 'svelte';
  import OriginalLink from './OriginalLink.svelte';
  import { flagProblem } from '../lib/db';
  import type { Problem } from '../lib/types';

  let { problem, onsaved, onclose }: { problem: Problem; onsaved: (p: Problem) => void; onclose: () => void } = $props();

  const QUICK = ['Question cut off', 'Answer cut off', 'Extra bits in the picture', 'Wrong answer matched', 'Hard to read'];
  let note = $state(untrack(() => problem.flag?.note ?? ''));
  let current = $state(untrack(() => problem));
  let saving = $state(false);
  let dialog = $state<HTMLDialogElement | null>(null);
  $effect(() => {
    dialog?.showModal();
  });

  function addQuick(q: string) {
    const parts = note.split(/,\s*/).filter(Boolean);
    note = parts.includes(q) ? parts.filter((p) => p !== q).join(', ') : [...parts, q].join(', ');
  }

  async function save(flagged: boolean) {
    if (saving) return;
    saving = true;
    try {
      const changed = await flagProblem(current.id, flagged ? note : null);
      if (changed) onsaved(changed);
      dialog?.close();
    } finally {
      saving = false;
    }
  }
</script>

<dialog bind:this={dialog} class="flag-dialog" aria-labelledby="flag-title" {onclose}>
  <form
    method="dialog"
    onsubmit={(e) => {
      e.preventDefault();
      save(true);
    }}
  >
    <div class="head">
      <h2 id="flag-title">{current.flag ? 'Flagged question' : 'Flag this question'}</h2>
      <button type="button" class="btn small" onclick={() => dialog?.close()}>Cancel</button>
    </div>
    <p class="muted small">
      Not captured properly? Flag it and carry on. You'll find it later under Practice, Flagged questions.
    </p>
    <div class="quick" role="group" aria-label="What's wrong">
      {#each QUICK as q (q)}
        <button type="button" class="chip" class:on={note.includes(q)} aria-pressed={note.includes(q)} onclick={() => addQuick(q)}>{q}</button>
      {/each}
    </div>
    <label class="field">
      What's wrong (optional)
      <textarea rows="2" bind:value={note} placeholder="e.g. part (b) is missing"></textarea>
    </label>
    <div class="from">
      <span class="small muted">From {current.from || 'an unknown source'}{current.label ? ` · ${current.label}` : ''}</span>
      <OriginalLink problem={current} onlinked={(p) => {
        current = p;
        onsaved(p);
      }} />
    </div>
    <div class="foot">
      <button type="submit" class="btn primary" disabled={saving}>{current.flag ? 'Save' : 'Flag it'}</button>
      {#if current.flag}
        <button type="button" class="btn" disabled={saving} onclick={() => save(false)}>Take the flag off</button>
      {/if}
    </div>
  </form>
</dialog>

<style>
  .flag-dialog {
    width: min(620px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    padding: 20px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
  }
  .flag-dialog::backdrop {
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
    align-items: center;
    gap: 12px;
  }
  h2 {
    font-size: 20px;
    margin: 0;
  }
  p {
    margin: 0;
  }
  .quick {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    padding: 6px 12px;
    border-radius: 99px;
    border: 1px solid var(--line-strong);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 14px;
    cursor: pointer;
  }
  .chip.on {
    color: var(--warn);
    border-color: var(--warn);
    background: color-mix(in srgb, var(--warn) 12%, transparent);
  }
  .from {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .foot {
    display: flex;
    gap: 10px;
  }
</style>
