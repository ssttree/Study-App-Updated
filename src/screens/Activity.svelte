<script lang="ts">
  import { loadProgress, type ProgressData } from '../lib/progress/load';
  import { bySubject, hoursText, periodRange, PERIOD_LABEL, plannedMinutes, soFar, totals, type Period } from '../lib/progress/activity';
  import { shortSubject } from '../lib/practice/load';
  import { plural } from '../lib/load';
  import ProgressTabs from '../components/ProgressTabs.svelte';

  let data = $state.raw<ProgressData | null>(null);
  loadProgress().then((d) => (data = d));

  let period = $state<Period>('week');
  try {
    const saved = localStorage.getItem('progress-period');
    if (saved === 'week' || saved === 'fortnight' || saved === 'month') period = saved;
  } catch {
    // Storage can be blocked; the week view is fine.
  }
  function pick(p: Period) {
    period = p;
    try {
      localStorage.setItem('progress-period', p);
    } catch {
      // Not remembered, which is fine.
    }
  }

  const compare = $derived(data ? soFar(data.activity, period, data.today) : null);
  const current = $derived(data ? periodRange(period, data.today, 0) : null);
  const bars = $derived(
    data
      ? Array.from({ length: 8 }, (_, i) => {
          const r = periodRange(period, data!.today, 7 - i);
          return { range: r, totals: totals(data!.activity, r.start, r.end) };
        })
      : [],
  );
  const max = $derived(Math.max(30, ...bars.map((b) => b.totals.minutes)));
  const subjects = $derived(data && current ? bySubject(data.activity, current.start, current.end) : []);
  const planned = $derived(data && current ? plannedMinutes(data.dayPlans, current.start, data.today) : null);
  let hover = $state<number | null>(null);

  const H = 160;
  function delta(now: number, before: number): string {
    const d = Math.round(now - before);
    return d === 0 ? 'same as' : d > 0 ? `${d} more than` : `${-d} fewer than`;
  }
</script>

<main class="page wide">
  <section class="head">
    <div>
      <div class="eyebrow accent">Progress</div>
      <h1>Time studied</h1>
    </div>
    <ProgressTabs on="activity" />
  </section>

  {#if data && compare && current}
    <div class="seg" role="group" aria-label="Period">
      {#each ['week', 'fortnight', 'month'] as const as p (p)}
        <button class:on={period === p} onclick={() => pick(p)} aria-pressed={period === p}>{PERIOD_LABEL[p]}</button>
      {/each}
    </div>

    <section class="totals">
      <div>
        <div class="big mono">{hoursText(compare.now.minutes)}</div>
        <div class="muted small">study time · last {period} at this point: {hoursText(compare.before.minutes)}</div>
      </div>
      <div>
        <div class="big mono">{compare.now.cards}</div>
        <div class="muted small">cards · {delta(compare.now.cards, compare.before.cards)} last {period}</div>
      </div>
      <div>
        <div class="big mono">{compare.now.questions}</div>
        <div class="muted small">questions · {delta(compare.now.questions, compare.before.questions)} last {period}</div>
      </div>
      <div>
        <div class="big mono">{planned === null ? '–' : hoursText(planned)}</div>
        <div class="muted small">planned so far (planner, optional items left out)</div>
      </div>
    </section>

    <section>
      <div class="section-head">
        <h2>Minutes per {period}</h2>
        <div class="legend small muted">
          <span><i style:background="var(--info)"></i>Flashcards</span>
          <span><i style:background="var(--accent)"></i>Problems</span>
        </div>
      </div>
      <div class="chart" role="img" aria-label="Study minutes for the last 8 {period}s">
        {#each bars as b, i (b.range.start)}
          {@const cardH = (b.totals.cardMinutes / max) * H}
          {@const probH = (b.totals.problemMinutes / max) * H}
          <div
            class="col"
            class:now={i === bars.length - 1}
            role="presentation"
            onmouseenter={() => (hover = i)}
            onmouseleave={() => (hover = null)}
          >
            <div class="stack" style:height="{H}px">
              {#if probH > 0}<div class="seg-bar prob" style:height="{Math.max(2, probH)}px"></div>{/if}
              {#if cardH > 0}<div class="seg-bar card" style:height="{Math.max(2, cardH)}px"></div>{/if}
            </div>
            <div class="mono small muted label">{b.range.label}</div>
          </div>
        {/each}
      </div>
      <div class="tip small" aria-live="polite">
        {#if hover !== null}
          {@const b = bars[hover]}
          <strong>{b.range.label}</strong> · {hoursText(b.totals.minutes)} · {b.totals.cards} cards ({hoursText(b.totals.cardMinutes)}) ·
          {b.totals.questions} questions ({hoursText(b.totals.problemMinutes)})
        {:else}
          <span class="muted">Point at a bar for its numbers.</span>
        {/if}
      </div>
    </section>

    <section>
      <h2>This {period} by subject</h2>
      {#each subjects as s (s.subject)}
        <div class="row">
          <span class="name">{shortSubject(s.subject)}</span>
          <span class="mono">{hoursText(s.totals.minutes)}</span>
          <span class="mono muted small">{plural(s.totals.cards, 'card')} · {plural(s.totals.questions, 'question')}</span>
        </div>
      {:else}
        <p class="muted">Nothing studied yet this {period}.</p>
      {/each}
    </section>
  {/if}
</main>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: flex-end;
    gap: 16px;
  }
  h1 {
    font-size: 36px;
    margin-top: 6px;
  }
  h2 {
    font-size: 22px;
    margin-bottom: 8px;
  }
  .small {
    font-size: 13px;
  }
  .seg {
    display: flex;
    gap: 2px;
    margin-top: -16px;
  }
  .seg button {
    min-height: 40px;
    padding: 0 14px;
    border-radius: 20px;
    border: 0;
    background: transparent;
    color: var(--muted);
    font: 400 14px var(--font);
    cursor: pointer;
  }
  .seg button.on {
    background: var(--line);
    color: var(--text);
  }
  .totals {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 20px;
  }
  .big {
    font-size: 28px;
  }
  .section-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  .legend {
    display: flex;
    gap: 16px;
  }
  .legend i {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
    margin-right: 6px;
  }
  .chart {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 8px;
    border-bottom: 1px solid var(--line-strong);
    padding-top: 8px;
  }
  .col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    cursor: default;
  }
  .stack {
    width: 100%;
    max-width: 44px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 2px;
  }
  .seg-bar {
    width: 100%;
  }
  .seg-bar:first-child {
    border-radius: 4px 4px 0 0;
  }
  .card {
    background: var(--info);
  }
  .prob {
    background: var(--accent);
  }
  .label {
    padding-bottom: 6px;
    white-space: nowrap;
  }
  .tip {
    min-height: 24px;
    margin-top: 10px;
  }
  .name {
    flex: 1 1 200px;
  }
</style>
