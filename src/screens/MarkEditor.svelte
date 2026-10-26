<script lang="ts">
  import { go, href } from '../lib/router.svelte';
  import { deleteMark, newId, saveMark, saveTestPlan } from '../lib/db';
  import { loadProgress, subjectTopics, type ProgressData } from '../lib/progress/load';
  import { PROGRESS_SUBJECTS, scopeOf, topicsOf } from '../lib/progress/recall';
  import { dateKey } from '../lib/planner/dates';
  import type { Mark } from '../lib/types';

  let { id, assessmentId, year: startYear }: { id: string; assessmentId?: string; year?: 11 } = $props();

  let data = $state.raw<ProgressData | null>(null);
  let existing = $state.raw<Mark | undefined>(undefined);

  let subject = $state<string>(PROGRESS_SUBJECTS[0]);
  let name = $state('');
  let date = $state('');
  let mark = $state<number | ''>('');
  let outOf = $state<number | ''>('');
  let rank = $state<number | ''>('');
  let rankOf = $state<number | ''>('');
  let year = $state<11 | 12>(12);
  let topics = $state<string[]>([]);
  let linked = $state<string | undefined>(undefined);
  let error = $state('');

  async function load() {
    const d = await loadProgress();
    data = d;
    date = d.today;
    year = startYear ?? 12;
    existing = id === 'new' ? undefined : d.marks.find((m) => m.id === id);
    if (existing) {
      ({ subject, name, date, year } = existing);
      mark = existing.mark;
      outOf = existing.outOf;
      rank = existing.rank ?? '';
      rankOf = existing.rankOf ?? '';
      topics = [...existing.topics];
      linked = existing.assessmentId;
      return;
    }
    const plan = assessmentId ? d.assessments.find((a) => a.id === assessmentId) : undefined;
    if (plan) {
      // Pre-filled from the planner, so only the mark needs typing.
      linked = plan.id;
      subject = plan.subject;
      name = plan.name;
      date = dateKey(plan.date);
      mark = plan.mark ?? '';
      outOf = plan.outOf ?? '';
      const scope = scopeOf(plan, d.units, d.skills).filter((u) => u.subject === plan.subject);
      topics = plan.skillIds.length || plan.deckIds?.length ? topicsOf(scope).map((t) => t.name) : [];
    }
  }
  load();

  const options = $derived(data ? subjectTopics(data, subject) : []);

  function toggle(t: string) {
    topics = topics.includes(t) ? topics.filter((x) => x !== t) : [...topics, t];
  }

  const num = (v: number | '') => (v === '' || v === null || !Number.isFinite(Number(v)) ? undefined : Number(v));

  async function save() {
    error = '';
    const m = num(mark);
    const o = num(outOf);
    if (!name.trim()) return (error = 'Give the task a name, like "Term 1 test".');
    if (m === undefined || !o || o <= 0) return (error = 'Enter the mark and what it was out of.');
    if (m > o) return (error = 'The mark is more than the total.');
    if (!date) return (error = 'Pick the date.');
    const record: Mark = {
      id: existing?.id ?? newId(),
      subject,
      name: name.trim(),
      date,
      mark: m,
      outOf: o,
      rank: num(rank),
      rankOf: num(rankOf),
      year,
      topics: topics.filter((t) => options.includes(t)),
      assessmentId: linked,
      created: existing?.created ?? Date.now(),
    };
    await saveMark(record);
    // Keep the planner's copy of the result in step.
    const plan = linked ? data?.assessments.find((a) => a.id === linked) : undefined;
    if (plan && (plan.mark !== m || plan.outOf !== o)) await saveTestPlan({ ...plan, mark: m, outOf: o });
    go('progress', 'marks');
  }

  async function remove() {
    if (!existing || !confirm(`Delete the mark for "${existing.name}"?`)) return;
    await deleteMark(existing.id);
    go('progress', 'marks');
  }
</script>

<main class="page">
  <section class="head">
    <a class="mono small back" href={href('progress', 'marks')}>Marks</a>
    <h1>{existing ? 'Edit mark' : year === 11 ? 'Add a Year 11 task' : 'Add a mark'}</h1>
    {#if year === 11}
      <p class="muted">Year 11 tasks set your baseline for each subject. Their topics differ from Year 12, so no topics are needed.</p>
    {/if}
  </section>

  {#if data}
    <form class="form" onsubmit={(e) => (e.preventDefault(), save())}>
      <div class="grid">
        <label class="field">
          Subject
          <select bind:value={subject} disabled={!!linked}>
            {#each PROGRESS_SUBJECTS as s (s)}<option value={s}>{s}</option>{/each}
          </select>
        </label>
        <label class="field">
          Year
          <select bind:value={year}>
            <option value={12}>Year 12</option>
            <option value={11}>Year 11 (baseline)</option>
          </select>
        </label>
        <label class="field wide">Task<input type="text" bind:value={name} placeholder="Term 1 test" /></label>
        <label class="field">Date<input type="date" bind:value={date} /></label>
        <div></div>
        <label class="field">Mark<input type="number" min="0" step="any" bind:value={mark} /></label>
        <label class="field">Out of<input type="number" min="0" step="any" bind:value={outOf} /></label>
        <label class="field">Rank (optional)<input type="number" min="1" bind:value={rank} /></label>
        <label class="field">Out of how many (optional)<input type="number" min="1" bind:value={rankOf} /></label>
      </div>

      {#if year === 12}
        <fieldset>
          <legend>Topics it covered</legend>
          <p class="muted small">Used to show your recall on the day next to the mark.</p>
          <div class="chips">
            {#each options as t (t)}
              <button type="button" class="chip" class:on={topics.includes(t)} aria-pressed={topics.includes(t)} onclick={() => toggle(t)}>{t}</button>
            {:else}
              <span class="muted small">No topics in this subject yet.</span>
            {/each}
          </div>
        </fieldset>
      {/if}

      {#if error}<div class="notice warn">{error}</div>{/if}
      <div class="actions">
        <button class="btn primary" type="submit">Save</button>
        <a class="btn" href={href('progress', 'marks')}>Cancel</a>
        {#if existing}<button class="btn danger" type="button" onclick={remove}>Delete</button>{/if}
      </div>
    </form>
  {/if}
</main>

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .back {
    text-decoration: none;
  }
  h1 {
    font-size: 36px;
  }
  .head p {
    margin: 0;
  }
  .small {
    font-size: 13px;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
  }
  .wide {
    grid-column: 1 / -1;
  }
  input[type='date'] {
    min-height: 44px;
    padding: 8px 12px;
    border-radius: 10px;
    border: 1px solid var(--line-strong);
    background: var(--surface);
    color: var(--text);
    font: 400 16px var(--font);
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
  }
  legend {
    font-weight: 700;
    padding: 0;
  }
  fieldset p {
    margin: 4px 0 10px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    min-height: 40px;
    padding: 0 14px;
    border-radius: 20px;
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
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
</style>
