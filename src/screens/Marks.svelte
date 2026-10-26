<script lang="ts">
  import { href } from '../lib/router.svelte';
  import { baselineOf, loadProgress, markPct, markRecall, waitingForMarks, type ProgressData } from '../lib/progress/load';
  import { PROGRESS_SUBJECTS, pct } from '../lib/progress/recall';
  import { shortSubject } from '../lib/practice/load';
  import { dateKey, dayLabel } from '../lib/planner/dates';
  import type { Mark } from '../lib/types';
  import ProgressTabs from '../components/ProgressTabs.svelte';

  let data = $state.raw<ProgressData | null>(null);
  loadProgress().then((d) => (data = d));

  const table = $derived(
    data
      ? PROGRESS_SUBJECTS.map((subject) => {
          const base = baselineOf(data!.marks, subject);
          const y12 = data!.marks.filter((m) => m.subject === subject && m.year === 12);
          const latest = y12[y12.length - 1];
          return { subject, base, latest };
        }).filter((r) => r.base.count || r.latest)
      : [],
  );
  const waiting = $derived(data ? waitingForMarks(data) : []);
  const y12 = $derived(data ? [...data.marks].filter((m) => m.year === 12).reverse() : []);
  const y11 = $derived(data ? [...data.marks].filter((m) => m.year === 11).reverse() : []);

  /** Day label, with the year for anything from another year (Year 11 tasks). */
  function when(date: string, today: string): string {
    const label = dayLabel(date, today);
    return date.slice(0, 4) === today.slice(0, 4) ? label : `${label} ${date.slice(0, 4)}`;
  }

  function rankText(m: Pick<Mark, 'rank' | 'rankOf'>): string {
    return m.rank ? ` · rank ${m.rank}${m.rankOf ? '/' + m.rankOf : ''}` : '';
  }
</script>

<main class="page wide">
  <section class="head">
    <div>
      <div class="eyebrow accent">Progress</div>
      <h1>Marks</h1>
    </div>
    <ProgressTabs on="marks" />
  </section>

  {#if data}
    <div class="actions">
      <a class="btn primary" href={href('progress', 'mark', 'new')}>Add a mark</a>
      <a class="btn" href={href('progress', 'mark', 'new', 'y11')}>Add a Year 11 task</a>
    </div>

    {#if waiting.length}
      <section>
        <h2>Waiting for a mark</h2>
        {#each waiting as a (a.id)}
          <a class="row link" href={href('progress', 'mark', 'new', a.id)}>
            <span class="name">{a.name} <span class="muted small">{shortSubject(a.subject)} · {dayLabel(dateKey(a.date), data.today)}</span></span>
            <span class="go">Enter mark</span>
          </a>
        {/each}
      </section>
    {/if}

    <section>
      <h2>Against Year 11</h2>
      {#if table.length}
        <div class="scroll">
          <table>
            <thead>
              <tr><th>Subject</th><th>Year 11 average</th><th>Latest task</th><th>Change</th></tr>
            </thead>
            <tbody>
              {#each table as r (r.subject)}
                {@const change = r.latest && r.base.pct !== null ? Math.round(markPct(r.latest) - r.base.pct) : null}
                <tr>
                  <td><a class="plain" href={href('progress', 'subject', r.subject)}>{shortSubject(r.subject)}</a></td>
                  <td class="mono">{r.base.pct === null ? '–' : `${Math.round(r.base.pct)}%`}{r.base.rank !== null ? ` · rank ${Math.round(r.base.rank)}` : ''}</td>
                  <td class="mono">{r.latest ? `${Math.round(markPct(r.latest))}%${rankText(r.latest)}` : '–'}</td>
                  <td class="mono" style:color={change !== null && change > 0 ? 'var(--good)' : change !== null && change < 0 ? 'var(--warn)' : 'var(--muted)'}>
                    {change === null ? '–' : change > 0 ? `+${change}` : change < 0 ? `−${-change}` : '0'}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="muted">Add your Year 11 tasks with their marks and ranks to set a baseline for each subject.</p>
      {/if}
    </section>

    <section>
      <h2>Year 12</h2>
      {#each y12 as m (m.id)}
        {@const r = markRecall(data, m)}
        <a class="row link" href={href('progress', 'mark', m.id)}>
          <span class="name">{m.name} <span class="muted small">{shortSubject(m.subject)} · {when(m.date, data.today)}</span></span>
          <span class="mono">mark {Math.round(markPct(m))}%{rankText(m)}</span>
          {#if r !== null}<span class="mono muted">recall {pct(r)}</span>{/if}
        </a>
      {:else}
        <p class="muted">No Year 12 marks yet.</p>
      {/each}
      {#if y12.length}
        <p class="muted small">
          Recall is how well you knew the topics on the day, not a predicted mark. High recall with a lower mark usually
          means the content is there but harder or unfamiliar questions cost marks, so more mixed past paper practice helps.
        </p>
      {/if}
    </section>

    {#if y11.length}
      <section>
        <h2>Year 11 baseline</h2>
        {#each y11 as m (m.id)}
          <a class="row link" href={href('progress', 'mark', m.id)}>
            <span class="name">{m.name} <span class="muted small">{shortSubject(m.subject)} · {when(m.date, data.today)}</span></span>
            <span class="mono">{Math.round(markPct(m))}%{rankText(m)}</span>
          </a>
        {/each}
      </section>
    {/if}
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
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: -16px;
  }
  .link {
    color: var(--text);
    text-decoration: none;
    min-height: 56px;
  }
  .link:hover .name {
    color: var(--accent);
  }
  .name {
    flex: 1 1 260px;
  }
  .go {
    color: var(--accent);
  }
  .plain {
    color: var(--text);
    text-decoration: none;
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    min-width: 520px;
    border-collapse: collapse;
    font-size: 15px;
  }
  th {
    text-align: left;
    font-weight: 400;
    font-size: 13px;
    color: var(--muted);
    padding: 10px 0;
  }
  td {
    padding: 12px 0;
    border-top: 1px solid var(--line);
  }
  section > p {
    margin: 8px 0 0;
  }
</style>
