<script lang="ts">
  // The skills one question goes into. A question can go into several: each
  // gets its own copy, so it comes up in every skill's practice. '' stands for
  // the main skill picked for the whole sheet or test, and "new:Name" for a
  // skill made by this import.
  import { MAIN_SKILL, NEW_SKILL } from '../lib/practice/save';
  import type { Skill } from '../lib/types';

  let {
    skills,
    value: given,
    onchange,
    main,
    label = 'Skills',
  }: {
    /** Skills of this subject to choose from. */
    skills: Skill[];
    /** Missing or empty means just the main skill. */
    value?: string[];
    onchange: (value: string[]) => void;
    /** What the main skill is called, like "Equilibrium (new)". */
    main: string;
    label?: string;
  } = $props();

  const value = $derived(given?.length ? given : [MAIN_SKILL]);
  const set = (v: string[]) => onchange(v);
  let naming = $state(false);
  let newName = $state('');

  const nameOf = (t: string) =>
    t === MAIN_SKILL ? main : t.startsWith(NEW_SKILL) ? `${t.slice(NEW_SKILL.length)} (new)` : (skills.find((k) => k.id === t)?.name ?? 'Missing skill');
  const others = $derived(skills.filter((k) => !value.includes(k.id)));

  function add(e: Event) {
    const select = e.currentTarget as HTMLSelectElement;
    const v = select.value;
    select.value = '';
    if (v === '+new') naming = true;
    else if (v === '+main' && !value.includes(MAIN_SKILL)) set([...value, MAIN_SKILL]);
    else if (v && v !== '+main' && !value.includes(v)) set([...value, v]);
  }
  function addNew() {
    const name = newName.trim();
    if (name && !value.includes(NEW_SKILL + name)) set([...value, NEW_SKILL + name]);
    newName = '';
    naming = false;
  }
  function remove(t: string) {
    if (value.length > 1) set(value.filter((x) => x !== t));
  }
</script>

<div class="tags" role="group" aria-label={label}>
  <span class="muted small">{label}</span>
  {#each value as t (t)}
    <span class="tag small">
      {nameOf(t)}
      {#if value.length > 1}<button class="x" onclick={() => remove(t)} aria-label="Take out of {nameOf(t)}">×</button>{/if}
    </span>
  {/each}
  {#if naming}
    <input
      class="mini"
      type="text"
      placeholder="New skill name"
      bind:value={newName}
      onkeydown={(e) => {
        if (e.key === 'Enter') addNew();
        if (e.key === 'Escape') naming = false;
      }}
    />
    <button class="btn small" onclick={addNew} disabled={!newName.trim()}>Add</button>
  {:else}
    <select class="mini" onchange={add} aria-label="Also add to a skill">
      <option value="">+ Also add to</option>
      {#if !value.includes(MAIN_SKILL)}<option value="+main">{main}</option>{/if}
      {#each others as k (k.id)}<option value={k.id}>{k.name}</option>{/each}
      <option value="+new">New skill...</option>
    </select>
  {/if}
</div>

<style>
  .tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border: 1px solid var(--line-strong);
    border-radius: 14px;
    background: var(--surface);
  }
  .x {
    border: 0;
    background: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 15px;
    line-height: 1;
    padding: 0 0 0 2px;
  }
  .x:hover {
    color: var(--text);
  }
  .mini {
    min-height: 30px;
    padding: 2px 8px;
    border-radius: 8px;
    border: 1px solid var(--line-strong);
    background: var(--surface);
    color: var(--text);
    font: 400 13px var(--font);
    width: auto;
    max-width: 220px;
  }
  .small {
    font-size: 13px;
  }
</style>
