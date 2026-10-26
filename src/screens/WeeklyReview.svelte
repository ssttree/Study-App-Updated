<script lang="ts">
  import { go, href } from '../lib/router.svelte';
  import { saveWeeklyReview } from '../lib/db';
  import { baselineOf, forecast, loadProgress, markPct, upcoming, waitingForMarks, weakList, type ProgressData } from '../lib/progress/load';
  import { GRADE_COLOUR, GRADE_TEXT, gradeOf, groupRecall, pct, PROGRESS_SUBJECTS, type Grade3 } from '../lib/progress/recall';
  import { hoursText, periodRange, plannedMinutes, totals } from '../lib/progress/activity';
  import { isMonthEnd, reviewWeek } from '../lib/progress/review';
  import { shortSubject } from '../lib/practice/load';
  import { dateKey, dayLabel, keyToTime } from '../lib/planner/dates';
  import { plural } from '../lib/load';

  let data = $state.raw<ProgressData | null>(null);
  let step = $state(0);
  let picked = $state<string[]>([]);
  let note = $state('');
  let saving = $state(false);

  const STEPS = ['Look back', 'What moved', 'Focus skills', 'Coming up', 'Marks', 'Note'];

  loadProgress().then((d) => {
    data = d;
    const existing = d.reviews.find((r) => r.week === reviewWeek(d.today));
    const suggested = weakList(d).filter((w) => w.unit.kind === 'skill').slice(0, 5);
    picked = existing?.focusSkillIds ?? suggested.slice(0, 3).map((w) => w.unit.skill!.id);
    note = existing?.note ?? '';
  });

  const week = $derived(data ? reviewWeek(data.today) : '');
  const month = $derived(week ? isMonthEnd(week) : false);

  const look = $derived.by(() => {
    if (!data) return null;
    const period = month ? 'month' : 'week';
    const cur = periodRange(period, week, 0);
    const prev = periodRange(period, week, 1);
    return {
      period,
      label: month ? new Date(keyToTime(week)).toLocaleDateString('en-AU', { month: 'long' }) : 'this week',
      now: totals(data.activity, cur.start, cur.end),
      before: totals(data.activity, prev.start, prev.end),
      planned: plannedMinutes(data.dayPlans, cur.start, cur.end),
    };
  });

  const moved = $derived.by(() => {
    if (!data) return [];
    const then = keyToTime(week) - 7 * 86_400_000;
    const rank: Record<Grade3, number> = { none: 0, weak: 1, mid: 2, good: 3 };
    return data.topics
      .map((t) => {
        const exam = data!.examTopics.has(t.key);
        const before = gradeOf(groupRecall(t.units, then).recall, exam);
        const now = gradeOf(groupRecall(t.units, data!.now).recall, exam);
        return { topic: t, before, now, up: rank[now] > rank[before] };
      })
      .filter((m) => m.before !== m.now && m.before !== 'none');
  });

  const suggestions = $derived(data ? weakList(data).filter((w) => w.unit.kind === 'skill').slice(0, 5) : []);
  const exams = $derived(
    data
      ? upcoming(data)
          .filter((p) => (p.date - data!.now) / 86_400_000 <= 21)
          .map((p) => forecast(data!, p))
      : [],
  );
  const waiting = $derived(data ? waitingForMarks(data) : []);
  const earlier = $derived(data ? data.reviews.filter((r) => r.note && r.week !== week).sort((a, b) => b.week.localeCompare(a.week)).slice(0, 3) : []);

  function toggle(id: string) {
    picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
  }

  async function finish(status: 'done' | 'skipped', then: () => void = () => go('today')) {
    if (!data || saving) return;
    saving = true;
    await saveWeeklyReview({ week, status, focusSkillIds: status === 'done' ? [...picked] : [], note: status === 'done' ? note.trim() : '', at: Date.now() });
    then();
  }

  function change(now: number, before: number, unit = ''): string {
    const d = Math.round(now - before);
    if (d === 0) return 'the same as before';
    return `${d > 0 ? d : -d}${unit} ${d > 0 ? 'more' : 'fewer'} than before`;
  }
</script>

<main class="focus">
  <header class="bar">
    <a class="mono small" href={href('today')}>Close</a>
    <span class="mono small muted">{month ? 'Monthly' : 'Weekly'} review · step {step + 1} of {STEPS.length}</span>
    <button class="btn small" onclick={() => finish('skipped')} disabled={saving}>Skip this week</button>
  </header>

  {#if data && look}
    <ol class="steps" aria-label="Steps">
      {#each STEPS as s, i (s)}<li class:on={i === step} class:done={i < step}><button onclick={() => (step = i)}>{s}</button></li>{/each}
    </ol>

    <section class="body">
      {#if step === 0}
        <h1>Look back over {look.label}</h1>
        <div class="stats">
          <div>
            <div class="big mono">{hoursText(look.now.minutes)}</div>
            <div class="muted small">studied · last {look.period} {hoursText(look.before.minutes)}</div>
          </div>
          <div>
            <div class="big mono">{look.now.cards}</div>
            <div class="muted small">cards · {change(look.now.cards, look.before.cards)}</div>
          </div>
          <div>
            <div class="big mono">{look.now.questions}</div>
            <div class="muted small">questions · {change(look.now.questions, look.before.questions)}</div>
          </div>
          <div>
            <div class="big mono">{look.planned === null ? '–' : hoursText(look.planned)}</div>
            <div class="muted small">the planner had planned</div>
          </div>
        </div>
        {#if look.planned !== null && look.planned > 0}
          <p class="muted">
            You did {Math.round((look.now.minutes / look.planned) * 100)}% of the planned time.
            {look.now.minutes < look.planned * 0.7 ? 'If the plan keeps running over, trim the study windows rather than pushing harder.' : ''}
          </p>
        {/if}
      {:else if step === 1}
        <h1>What moved</h1>
        <p class="muted">Topics that changed colour since last Sunday.</p>
        {#each moved as m (m.topic.key)}
          <div class="row">
            <span class="name">{m.topic.name} <span class="muted small">{shortSubject(m.topic.subject)}</span></span>
            <span class="mono small" style:color={GRADE_COLOUR[m.before]}>{GRADE_TEXT[m.before]}</span>
            <span class="muted" aria-hidden="true">{m.up ? '↑' : '↓'}</span>
            <span class="mono small" style:color={GRADE_COLOUR[m.now]}>{GRADE_TEXT[m.now]}</span>
          </div>
        {:else}
          <p>No topic changed colour this week.</p>
        {/each}
      {:else if step === 2}
        <h1>Pick focus skills</h1>
        <p class="muted">The weakest problem skills right now. Keep 2 or 3: they come up first in next week's daily mix.</p>
        {#each suggestions as w (w.unit.key)}
          {@const id = w.unit.skill!.id}
          <label class="row pick">
            <input type="checkbox" checked={picked.includes(id)} onchange={() => toggle(id)} />
            <span class="name">{w.unit.name} <span class="muted small">{shortSubject(w.unit.subject)} · {w.unit.topic}</span></span>
            <span class="mono" style:color={GRADE_COLOUR[gradeOf(w.recall, w.onExam)]}>{pct(w.recall)}</span>
          </label>
        {:else}
          <p>No problem skills practised yet, so nothing to pick this week.</p>
        {/each}
        {#if picked.length > 3}<p class="notice warn">More than 3 focus skills spreads the extra time thin.</p>{/if}
      {:else if step === 3}
        <h1>Coming up</h1>
        <p class="muted">Tests and exams in the next 3 weeks, with recall on the day if you did nothing more.</p>
        {#each exams as e (e.plan.id)}
          <div class="row">
            <span class="name">{e.plan.name} <span class="muted small">{shortSubject(e.plan.subject)} · in {plural(e.days, 'day')}</span></span>
            <span class="mono" style:color={GRADE_COLOUR[e.grade]}>{pct(e.recall)}</span>
          </div>
          {#if e.redTopics.length}<p class="red small">Red on the day: {e.redTopics.join(', ')}</p>{/if}
        {:else}
          <p>Nothing in the next 3 weeks.</p>
        {/each}
      {:else if step === 4}
        <h1>Marks</h1>
        {#if waiting.length}
          <p class="muted">These have happened and have no mark yet. Finish the review, then enter any you got back.</p>
          {#each waiting as a (a.id)}
            <div class="row"><span class="name">{a.name}</span><span class="muted small">{shortSubject(a.subject)} · {dayLabel(dateKey(a.date), data.today)}</span></div>
          {/each}
        {:else}
          <p>No results waiting to be entered.</p>
        {/if}
        {#if month}
          <h2>This month against Year 11</h2>
          {#each PROGRESS_SUBJECTS as s (s)}
            {@const base = baselineOf(data.marks, s)}
            {@const mine = data.marks.filter((m) => m.subject === s && m.year === 12)}
            {#if mine.length}
              <div class="row">
                <span class="name">{shortSubject(s)}</span>
                <span class="mono small">{mine.map((m) => Math.round(markPct(m)) + '%').join(' → ')}</span>
                {#if base.pct !== null}<span class="mono small muted">Year 11 {Math.round(base.pct)}%</span>{/if}
              </div>
            {/if}
          {/each}
        {/if}
      {:else}
        <h1>One line note</h1>
        <p class="muted">Optional: what went well, or what to change. You can read these back over the term.</p>
        <textarea rows="3" bind:value={note} placeholder="Chem flashcards on the bus worked. Start Ext 1 homework earlier."></textarea>
        {#if earlier.length}
          <h2>Earlier notes</h2>
          {#each earlier as r (r.week)}<p class="small"><span class="mono muted">{dayLabel(r.week, data.today)}</span> {r.note}</p>{/each}
        {/if}
      {/if}
    </section>

    <footer class="nav">
      {#if step > 0}<button class="btn" onclick={() => step--}>Back</button>{/if}
      {#if step < STEPS.length - 1}
        <button class="btn primary" onclick={() => step++}>Next</button>
      {:else}
        <button class="btn primary" onclick={() => finish('done')} disabled={saving}>Finish</button>
        {#if waiting.length}
          <button class="btn" onclick={() => finish('done', () => go('progress', 'marks'))} disabled={saving}>Finish and enter marks</button>
        {/if}
      {/if}
    </footer>
  {/if}
</main>

<style>
  .focus {
    max-width: 720px;
    margin: 0 auto;
    padding: 20px 24px 48px;
    display: flex;
    flex-direction: column;
    gap: 28px;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
  }
  .bar a {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    text-decoration: none;
  }
  .small {
    font-size: 13px;
  }
  .steps {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .steps button {
    min-height: 36px;
    padding: 0 12px;
    border-radius: 18px;
    border: 0;
    background: transparent;
    color: var(--dim);
    font: 400 13px var(--font);
    cursor: pointer;
  }
  .steps .done button {
    color: var(--muted);
  }
  .steps .on button {
    background: var(--line);
    color: var(--text);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 320px;
  }
  h1 {
    font-size: 34px;
  }
  h2 {
    font-size: 18px;
    margin-top: 16px;
  }
  .body p {
    margin: 0;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 20px;
    margin: 12px 0;
  }
  .big {
    font-size: 28px;
  }
  .name {
    flex: 1 1 240px;
  }
  .pick {
    cursor: pointer;
    min-height: 56px;
  }
  .pick input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }
  .red {
    color: var(--warn);
  }
  .nav {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
</style>
