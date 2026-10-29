<script lang="ts">
  import { href } from '../lib/router.svelte';
  import { baselineOf, loadProgress, markPct, markRecall, subjectSummaries, topicSummaries, type ProgressData } from '../lib/progress/load';
  import { GRADE_COLOUR, GRADE_TEXT, pct } from '../lib/progress/recall';
  import { shortSubject } from '../lib/practice/load';
  import { dayLabel } from '../lib/planner/dates';
  import RecallBar from '../components/RecallBar.svelte';
  import Sparkline from '../components/Sparkline.svelte';
  import MarksChart from '../components/MarksChart.svelte';

  let { subject }: { subject: string } = $props();

  let data = $state.raw<ProgressData | null>(null);
  loadProgress().then((d) => (data = d));

  const summary = $derived(data ? subjectSummaries(data).find((s) => s.subject === subject) : undefined);
  const topics = $derived(data ? topicSummaries(data, subject) : []);
  const marks = $derived(data ? data.marks.filter((m) => m.subject === subject) : []);
  const y12 = $derived(marks.filter((m) => m.year === 12));
  const baseline = $derived(baselineOf(marks, subject));
  const recalls = $derived(new Map(data ? y12.map((m) => [m.id, markRecall(data!, m)]) : []));
</script>

<main class="page wide">
  <section class="head">
    <a class="mono small back" href={href('progress')}>Progress</a>
    <h1>{subject}</h1>
    {#if summary}
      <p class="lead">
        <span class="mono" style:color={GRADE_COLOUR[summary.grade]}>{pct(summary.recall.recall)}</span>
        <span class="muted">{GRADE_TEXT[summary.grade]} · {summary.recall.started} of {summary.recall.total} skills and card topics started</span>
      </p>
    {/if}
  </section>

  {#if data}
    <section>
      <div class="section-head">
        <h2>Topics</h2>
        <span class="muted small">Weakest first · unstarted skills count as 0%</span>
      </div>
      {#each topics as t (t.topic.key)}
        <a class="row topic" href={href('progress', 'topic', subject, t.topic.name)}>
          <span class="tname">{t.topic.name}{#if t.exam}<span class="tag">exam</span>{/if}</span>
          <RecallBar recall={t.recall.recall} grade={t.grade} />
          <span class="mono pct">{t.recall.total ? pct(t.recall.recall ?? 0) : '–'}</span>
          <span class="mono muted small cov">{t.recall.started}/{t.recall.total}</span>
          <Sparkline values={t.trend} colour={GRADE_COLOUR[t.grade]} label="{t.topic.name} over the last 8 weeks" />
          {#if t.examRecall}
            <span class="muted small exam">
              {t.examRecall.plan.name}: {pct(t.examRecall.recall)} on the day
            </span>
          {/if}
        </a>
      {:else}
        <p class="muted">
          Nothing in {shortSubject(subject)} yet. Add flashcards or practice questions and it shows up here.
        </p>
      {/each}
    </section>

    <section>
      <div class="section-head">
        <h2>Marks</h2>
        <a class="mono small" href={href('progress', 'marks')}>All marks</a>
      </div>
      {#if baseline.count}
        <p class="muted">
          Year 11 baseline: <span class="mono text">{Math.round(baseline.pct ?? 0)}%</span>{#if baseline.rank !== null}, average rank <span class="mono text">{Math.round(baseline.rank)}</span>{/if}
          over {baseline.count} task{baseline.count === 1 ? '' : 's'}.
        </p>
      {/if}
      {#if y12.length >= 3}
        <MarksChart marks={y12} baseline={baseline.pct} {recalls} />
      {/if}
      {#each y12 as m (m.id)}
        {@const r = recalls.get(m.id)}
        <a class="row topic" href={href('progress', 'mark', m.id)}>
          <span class="tname">{m.name} <span class="muted small">{dayLabel(m.date, data.today)}</span></span>
          <span class="mono">{`mark ${Math.round(markPct(m))}%` + (m.rank ? ` · rank ${m.rank}${m.rankOf ? '/' + m.rankOf : ''}` : '')}</span>
          {#if r !== null && r !== undefined}<span class="mono muted">recall {pct(r)}</span>{/if}
        </a>
      {:else}
        <p class="muted">No Year 12 marks yet. <a href={href('progress', 'mark', 'new')}>Add a mark</a></p>
      {/each}
      {#if y12.length && y12.length < 3}<p class="muted small">A trend chart appears once there are 3 marks.</p>{/if}
    </section>
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
  h2 {
    font-size: 22px;
  }
  .lead {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
    align-items: baseline;
  }
  .lead .mono {
    font-size: 30px;
  }
  .small {
    font-size: 13px;
  }
  .text {
    color: var(--text);
  }
  .section-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 6px;
  }
  .topic {
    color: var(--text);
    text-decoration: none;
    min-height: 56px;
  }
  .topic:hover .tname {
    color: var(--accent);
  }
  .tname {
    flex: 0 1 240px;
    min-width: 160px;
  }
  .tag {
    margin-left: 8px;
    font: 11px var(--mono);
    text-transform: uppercase;
    color: var(--accent);
  }
  .pct {
    width: 48px;
    text-align: right;
  }
  .cov {
    width: 44px;
  }
  .exam {
    flex-basis: 100%;
  }
</style>
