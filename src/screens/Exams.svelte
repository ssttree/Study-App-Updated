<script lang="ts">
  import { getSettings, listTasks, listTestPlans } from '../lib/db';
  import { blocksOf, daysUntil, KIND_LABEL, kindOf, rampOf, stageOf, STAGE_LABEL, type Stage } from '../lib/planner/assessments';
  import { dateKey, dayLabel, todayKey } from '../lib/planner/dates';
  import { shortSubject } from '../lib/practice/load';
  import { plural } from '../lib/load';
  import { href } from '../lib/router.svelte';
  import type { Task, TestPlan } from '../lib/types';

  let list = $state.raw<TestPlan[]>([]);
  let tasks = $state.raw<Task[]>([]);
  let today = $state('');
  let loaded = $state(false);
  let showPast = $state(false);

  async function load() {
    const settings = await getSettings();
    today = todayKey(Date.now(), settings.dayStartHour);
    [list, tasks] = await Promise.all([listTestPlans(), listTasks()]);
    loaded = true;
  }
  load();

  const upcoming = $derived(list.filter((a) => stageOf(a, today) !== 'past'));
  const past = $derived(list.filter((a) => stageOf(a, today) === 'past').reverse());
  const blocks = $derived(blocksOf(upcoming));

  const STAGE_COLOUR: Record<Stage, string> = {
    none: 'var(--dot)',
    build: 'var(--info)',
    focus: 'var(--accent)',
    final: 'var(--warn)',
    past: 'var(--dot)',
  };

  function when(a: TestPlan): string {
    const d = daysUntil(a, today);
    const label = dayLabel(dateKey(a.date), today);
    return d > 1 ? `${label} · in ${d} days` : label;
  }

  function prepNote(a: TestPlan): string {
    const ramp = rampOf(a);
    if (!ramp) {
      const milestones = tasks.filter((t) => t.assessmentId === a.id);
      const late = milestones.filter((t) => t.status === 'open' && t.due < today).length;
      if (!milestones.length) return 'no milestones yet';
      return `${milestones.filter((t) => t.status !== 'open').length} of ${plural(milestones.length, 'milestone')} done${late ? ` · ${late} slipping` : ''}`;
    }
    const stage = stageOf(a, today);
    if (stage === 'none') return `prep starts ${dayLabel(dateKey(a.date - ramp.build * 86_400_000), today)}`;
    return `${plural(a.skillIds.length, 'skill')} in scope`;
  }
</script>

<main class="page">
  <section class="head">
    <div class="eyebrow"><a href={href('planner')}>Planner</a> / Exams</div>
    <h1>Exams and assessments</h1>
    <p class="muted">
      Every assessment you add changes the daily plan by itself. Class tests ramp up from 21 days out, trials and the
      HSC from 42, so prep starts weeks ahead instead of the night before.
    </p>
    <div class="actions"><a class="btn primary" href={href('planner', 'exam', 'new')}>Add an assessment</a></div>
  </section>

  {#if loaded}
    {#if !upcoming.length}
      <p class="muted">Nothing coming up. Add tests and exams as soon as you know the dates.</p>
    {/if}
    {#if upcoming.length}
      <section>
        <h2>Coming up</h2>
        {#each blocks as block (block[0].id)}
          <div class:block={block.length > 1}>
            {#if block.length > 1}
              <div class="block-head mono small">
                Exam block: {plural(block.length, 'assessment')} in
                {Math.round((block[block.length - 1].date - block[0].date) / 86_400_000) + 1} days. Prep is shared out by date and weighting.
              </div>
            {/if}
            {#each block as a (a.id)}
              {@const stage = stageOf(a, today)}
              <a class="row item" href={href('planner', 'exam', a.id)}>
                <span class="dot" style:background={STAGE_COLOUR[stage]}></span>
                <span class="what">
                  <span class="title">{a.name}</span>
                  <span class="muted small">
                    {KIND_LABEL[kindOf(a)]} · {shortSubject(a.subject)}{a.weighting ? ` · ${a.weighting}%` : ''} · {prepNote(a)}
                  </span>
                </span>
                {#if rampOf(a)}<span class="stage mono" style:border-color={STAGE_COLOUR[stage]}>{STAGE_LABEL[stage]}</span>{/if}
                <span class="mono small when">{when(a)}</span>
              </a>
            {/each}
          </div>
        {/each}
      </section>
    {/if}

    {#if past.length}
      <section>
        <button class="btn small" onclick={() => (showPast = !showPast)}>{showPast ? 'Hide' : 'Show'} past ({past.length})</button>
        {#if showPast}
          {#each past as a (a.id)}
            <a class="row item" href={href('planner', 'exam', a.id)}>
              <span class="dot"></span>
              <span class="what">
                <span class="title">{a.name}</span>
                <span class="muted small">{shortSubject(a.subject)} · {dayLabel(dateKey(a.date), today)}</span>
              </span>
              <span class="mono small">{a.mark !== undefined ? `${a.mark}${a.outOf ? ' / ' + a.outOf : ''}` : 'add your mark'}</span>
            </a>
          {/each}
        {/if}
      </section>
    {/if}
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
    margin-bottom: 4px;
  }
  .block {
    border-left: 2px solid var(--accent);
    padding-left: 14px;
    margin: 8px 0;
  }
  .block-head {
    color: var(--accent);
    padding: 10px 0 4px;
  }
  .actions {
    display: flex;
    gap: 12px;
  }
  .small {
    font-size: 13px;
  }
  .item {
    color: var(--text);
    text-decoration: none;
    min-height: 56px;
  }
  .item:hover .title {
    color: var(--accent);
  }
  .what {
    flex: 1 1 260px;
    display: flex;
    flex-direction: column;
  }
  .stage {
    font-size: 11px;
    padding: 2px 9px;
    border-radius: 10px;
    border: 1px solid;
  }
  .when {
    min-width: 150px;
    text-align: right;
  }
</style>
