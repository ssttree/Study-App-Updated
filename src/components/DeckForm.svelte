<script lang="ts">
  import { untrack } from 'svelte';
  import { SUBJECTS, type Deck, type TypingMode } from '../lib/types';

  let {
    deck,
    submitLabel,
    onsubmit,
    oncancel,
  }: {
    deck?: Deck;
    submitLabel: string;
    onsubmit: (values: { name: string; subject: string; module: string; typingDefault: TypingMode }) => void;
    oncancel?: () => void;
  } = $props();

  // The form starts from the deck's current values and then edits its own copy.
  const initial = untrack(() => deck);
  let name = $state(initial?.name ?? '');
  let subject = $state<string>(initial?.subject ?? SUBJECTS[0]);
  let module = $state(initial?.module ?? '');
  let typingDefault = $state<TypingMode>(initial?.typingDefault ?? 'off');

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onsubmit({ name: name.trim(), subject: subject.trim() || 'Other', module: module.trim(), typingDefault });
  }
</script>

<form class="deck-form" onsubmit={submit}>
  <label class="field">
    Deck name
    <input type="text" bind:value={name} placeholder="e.g. Equilibrium" required />
  </label>
  <label class="field">
    Subject
    <input type="text" bind:value={subject} list="subject-list" />
    <datalist id="subject-list">
      {#each SUBJECTS as s (s)}<option value={s}></option>{/each}
    </datalist>
  </label>
  <label class="field">
    Module (optional)
    <input type="text" bind:value={module} placeholder="e.g. Module 5" />
  </label>
  <label class="field">
    Typing the answer
    <select bind:value={typingDefault}>
      <option value="off">Off: flip cards, answer in your head</option>
      <option value="always">Always: type before the answer shows</option>
      <option value="optional">Optional: switch typing on or off while reviewing</option>
    </select>
  </label>
  <div class="buttons">
    <button class="btn primary" type="submit">{submitLabel}</button>
    {#if oncancel}<button class="btn" type="button" onclick={oncancel}>Cancel</button>{/if}
  </div>
</form>

<style>
  .deck-form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px;
  }
  .buttons {
    grid-column: 1 / -1;
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
</style>
