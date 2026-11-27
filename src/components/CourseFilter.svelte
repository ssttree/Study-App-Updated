<script lang="ts">
  // In the Extension subjects: practise only the Extension questions, only
  // the Advanced ones the textbook mixes in, or both. Saved in settings, so
  // the skill lists, single skills, the daily mix and test prep all follow it.
  import { getSettings, saveSettings } from '../lib/db';
  import type { CourseChoice } from '../lib/types';

  let {
    choice,
    extension,
    advanced,
    lower = 'Advanced',
    onchange,
  }: {
    choice: CourseChoice | undefined;
    /** Question counts either side, shown on the buttons. */
    extension: number;
    advanced: number;
    /** The course below, as named on the button. */
    lower?: string;
    onchange?: (choice: CourseChoice | undefined) => void;
  } = $props();

  const OPTIONS: { value: CourseChoice | undefined; label: () => string; n: () => number }[] = [
    { value: undefined, label: () => 'Both', n: () => extension + advanced },
    { value: 'extension', label: () => 'Extension only', n: () => extension },
    { value: 'advanced', label: () => `${lower} only`, n: () => advanced },
  ];

  async function pick(value: CourseChoice | undefined) {
    const settings = await getSettings();
    const next = { ...settings };
    if (value) next.courseChoice = value;
    else delete next.courseChoice;
    await saveSettings(next);
    onchange?.(value);
  }
</script>

<div class="courses" role="group" aria-label="Which course's questions to practise">
  <span class="muted small">Questions</span>
  {#each OPTIONS as o (o.value ?? 'both')}
    <button type="button" class="chip" class:on={choice === o.value} aria-pressed={choice === o.value} onclick={() => pick(o.value)}>
      {o.label()} <span class="mono">{o.n()}</span>
    </button>
  {/each}
</div>

<style>
  .courses {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .courses > span {
    margin-right: 4px;
    font-size: 13px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 0 12px;
    border-radius: 18px;
    border: 1px solid var(--line-strong);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 14px;
    cursor: pointer;
  }
  .chip.on {
    color: var(--text);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .chip .mono {
    font-size: 12px;
    color: var(--dim);
  }
</style>
