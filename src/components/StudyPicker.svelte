<script lang="ts">
  // Choose what a calendar item is for: practice skills, flashcard decks, or
  // both. Used by the event window and the block editor.
  import { shortSubject } from '../lib/practice/load';
  import type { Deck, Skill, StudyPick } from '../lib/types';

  let {
    skills,
    decks,
    value,
    onchange,
    subjectHint = '',
  }: {
    skills: Skill[];
    decks: Deck[];
    value: StudyPick | undefined;
    onchange: (value: StudyPick) => void;
    /** Subject to open the skill list on, when nothing is picked yet. */
    subjectHint?: string;
  } = $props();

  const skillIds = $derived(value?.skillIds ?? []);
  const deckIds = $derived(value?.deckIds ?? []);
  const skillById = $derived(new Map(skills.map((s) => [s.id, s])));
  const deckById = $derived(new Map(decks.map((d) => [d.id, d])));

  const subjects = $derived([...new Set([...skills.map((s) => s.subject), ...decks.map((d) => d.subject)])].filter(Boolean).sort());
  // Open on the subject of what's already picked, or the hint, or the first one.
  let subject = $state('');
  $effect.pre(() => {
    if (subject && subjects.includes(subject)) return;
    const first = skillById.get(skillIds[0] ?? '')?.subject ?? deckById.get(deckIds[0] ?? '')?.subject;
    subject = first ?? (subjects.includes(subjectHint) ? subjectHint : (subjects[0] ?? ''));
  });
  let search = $state('');

  /** Skills in the subject, by topic, filtered by the search. */
  const topics = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const list = skills
      .filter((s) => s.subject === subject)
      .filter((s) => !q || `${s.name} ${s.topic} ${s.code}`.toLowerCase().includes(q))
      .sort((a, b) => a.topic.localeCompare(b.topic) || a.name.localeCompare(b.name));
    const out = new Map<string, Skill[]>();
    for (const s of list) out.set(s.topic || 'Other', [...(out.get(s.topic || 'Other') ?? []), s]);
    return [...out];
  });
  const subjectDecks = $derived(decks.filter((d) => d.subject === subject).sort((a, b) => a.name.localeCompare(b.name)));

  function toggle(list: 'skillIds' | 'deckIds', id: string) {
    const now = list === 'skillIds' ? skillIds : deckIds;
    const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
    onchange({ skillIds, deckIds, [list]: next });
  }
</script>

<div class="picker">
  {#if skillIds.length || deckIds.length}
    <div class="picked" aria-label="Picked">
      {#each skillIds as id (id)}
        <button type="button" class="pill skill" onclick={() => toggle('skillIds', id)} title="Take it out">
          {skillById.get(id)?.name ?? 'Missing skill'} <span aria-hidden="true">×</span>
        </button>
      {/each}
      {#each deckIds as id (id)}
        <button type="button" class="pill deck" onclick={() => toggle('deckIds', id)} title="Take it out">
          {deckById.get(id)?.name ?? 'Missing deck'} cards <span aria-hidden="true">×</span>
        </button>
      {/each}
    </div>
  {:else}
    <p class="muted small none">Nothing picked yet. Pick skills to practise, flashcard decks, or both.</p>
  {/if}

  {#if subjects.length}
    <div class="bar">
      <label class="sr-only" for="pick-subject">Subject</label>
      <select id="pick-subject" bind:value={subject}>
        {#each subjects as s (s)}<option value={s}>{shortSubject(s)}</option>{/each}
      </select>
      <input type="search" placeholder="Find a skill" aria-label="Find a skill" bind:value={search} />
    </div>

    <div class="lists">
      <fieldset>
        <legend>Practice skills</legend>
        <div class="scroll">
          {#each topics as [topic, list] (topic)}
            <div class="topic dim small">{topic}</div>
            {#each list as s (s.id)}
              <label class="row">
                <input type="checkbox" checked={skillIds.includes(s.id)} onchange={() => toggle('skillIds', s.id)} />
                <span>{s.name}{#if !s.on}<span class="dim small">&nbsp;· not taught yet</span>{/if}</span>
              </label>
            {/each}
          {:else}
            <p class="muted small">{search ? 'No skills match.' : 'No skills in this subject yet.'}</p>
          {/each}
        </div>
      </fieldset>
      <fieldset>
        <legend>Flashcard decks</legend>
        <div class="scroll">
          {#each subjectDecks as d (d.id)}
            <label class="row">
              <input type="checkbox" checked={deckIds.includes(d.id)} onchange={() => toggle('deckIds', d.id)} />
              <span>{d.name}{#if d.module}<span class="dim small">&nbsp;· {d.module}</span>{/if}</span>
            </label>
          {:else}
            <p class="muted small">No decks in this subject.</p>
          {/each}
        </div>
      </fieldset>
    </div>
  {:else}
    <p class="muted small">No skills or decks yet. Add some in Practice or Flashcards first.</p>
  {/if}
</div>

<style>
  .small {
    font-size: 13px;
  }
  .dim {
    color: var(--dim);
  }
  .picker {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .picked {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .pill {
    border: 1px solid var(--line-strong);
    background: var(--surface-2);
    color: var(--text);
    border-radius: 999px;
    padding: 4px 10px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .pill.skill {
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  }
  .pill.deck {
    border-color: color-mix(in srgb, var(--info) 55%, transparent);
  }
  .none {
    margin: 0;
  }
  .bar {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .bar input {
    flex: 1;
    min-width: 140px;
  }
  .lists {
    display: grid;
    grid-template-columns: 3fr 2fr;
    gap: 10px;
  }
  @media (max-width: 640px) {
    .lists {
      grid-template-columns: 1fr;
    }
  }
  fieldset {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 6px 10px 8px;
    margin: 0;
    min-width: 0;
  }
  legend {
    font-size: 13px;
    color: var(--muted);
    padding: 0 4px;
  }
  .scroll {
    max-height: 220px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .topic {
    margin-top: 6px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 11px;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 3px 0;
    font-size: 14px;
    cursor: pointer;
  }
  .row input {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
    flex: none;
  }
</style>
