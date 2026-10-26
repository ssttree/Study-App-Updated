<script lang="ts">
  import { href } from '../lib/router.svelte';
  import { loadProgress, subjectSummaries, weakList, upcoming, forecast, practiseHref, type ProgressData } from '../lib/progress/load';
  import { GRADE_COLOUR, GRADE_TEXT, gradeOf, pct } from '../lib/progress/recall';
  import { reviewWaiting } from '../lib/progress/review';
  import { shortSubject } from '../lib/practice/load';
  import { plural } from '../lib/load';
  import ProgressTabs from '../components/ProgressTabs.svelte';
  import Sparkline from '../components/Sparkline.svelte';

  let data = $state.raw<ProgressData | null>(null);
  loadProgress().then((d) => (data = d));

  let subject = $state('');
  let examOnly = $state(false);

  const subjects = $derived(data ? subjectSummaries(data) : []);
  const weak = $derived(data ? weakList(data) : []);
  const shown = $derived(weak.filter((w) => (!subject || w.unit.subject === subject) && (!examOnly || w.onExam)).slice(0, 10));
  const exams = $derived(data ? upcoming(data).slice(0, 4).map((p) => forecast(data!, p)) : []);
  const waiting = $derived(data ? reviewWaiting(data.reviews, data.today) && data.activity.length > 0 : false);
</script>

<main class="page wide">
  <section class="head">
    <div>
      <div class="eyebrow accent">Progress</div>
      <h1>How on top of it you are</h1>
    </div>
    <ProgressTabs on="subjects" />
  </section>

  {#if data}
    {#if waiting}
      <a class="notice review" href={href('progress', 'review')}>
        <strong>Weekly review</strong> · ten minutes to look back, pick focus skills and set up the week.
        <span class="go">Start</span>
      </a>
    {/if}

    <section class="tiles" aria-label="Subjects">
      {#each subjects as s (s.subject)}
        {#if s.empty}
          <div class="tile empty">
            <span class="muted">{shortSubject(s.subject)}</span>
            <span class="big mono muted">–</span>
            <span class="muted small">not set up yet</span>
          </div>
        {:else}
          <a class="tile" href={href('progress', 'subject', s.subject)}>
            <span class="muted">{shortSubject(s.subject)}</span>
            <span class="big mono" style:color={GRADE_COLOUR[s.grade]}>{pct(s.recall.recall)}</span>
            <span class="muted small">{GRADE_TEXT[s.grade]} · {s.recall.started} of {s.recall.total} started</span>
            <Sparkline values={s.trend} colour={GRADE_COLOUR[s.grade]} label="{s.subject} mastery over the last 8 weeks" />
          </a>
        {/if}
      {/each}
    </section>
    <p class="muted small note">
      Mastery is the chance you could do each skill or card today without notes, averaged over every topic. Skills you
      have not started count as 0%, and skills switched off (not taught yet) are left out. Green is 90%, or 95% when an
      exam is coming up.
    </p>

    <div class="cols">
      <section class="weak">
        <div class="section-head">
          <h2>Weak skills</h2>
          <div class="filters">
            <select bind:value={subject} aria-label="Subject">
              <option value="">All subjects</option>
              {#each subjects.filter((s) => !s.empty) as s (s.subject)}<option value={s.subject}>{shortSubject(s.subject)}</option>{/each}
            </select>
            <label class="check"><input type="checkbox" bind:checked={examOnly} /> On an upcoming exam</label>
          </div>
        </div>
        {#each shown as w (w.unit.key)}
          <div class="row">
            <span class="name">
              <a class="plain" href={href('progress', 'topic', w.unit.subject, w.unit.topic)}>{w.unit.name}</a>
              <span class="muted small">
                {[shortSubject(w.unit.subject), w.unit.topic, w.wrongMethod ? plural(Math.ceil(w.wrongMethod), 'wrong method') : '', w.onExam ? 'on an exam' : '']
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            <span class="mono" style:color={GRADE_COLOUR[gradeOf(w.recall, w.onExam)]}>{pct(w.recall)}</span>
            <a class="btn small" href={practiseHref(data, w.unit)}>Practise</a>
          </div>
        {:else}
          <p class="muted">
            {weak.length ? 'Nothing matches these filters.' : 'Weak skills show up here once you have reviewed some cards or practised some problems.'}
          </p>
        {/each}
      </section>

      <section class="exams">
        <div class="section-head">
          <h2>Coming up</h2>
          <a class="mono small" href={href('planner', 'exams')}>Exams</a>
        </div>
        {#each exams as e (e.plan.id)}
          <div class="row exam">
            <span class="name">
              {e.plan.name}
              <span class="muted small">{shortSubject(e.plan.subject)} · {e.days === 0 ? 'today' : `in ${plural(e.days, 'day')}`}</span>
            </span>
            <span class="mono" style:color={GRADE_COLOUR[e.grade]} title="Recall on the day if you do nothing more">{pct(e.recall)}</span>
          </div>
          {#if e.redTopics.length}<div class="muted small red">Red on the day: {e.redTopics.join(', ')}</div>{/if}
        {:else}
          <p class="muted">No tests or exams set. Add them in the planner to see recall on the day.</p>
        {/each}
        {#if exams.length}<p class="muted small">Recall on the test day if you did nothing more from now. It is not a predicted mark.</p>{/if}
      </section>
    </div>
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
  }
  .small {
    font-size: 13px;
  }
  .note {
    margin: -24px 0 0;
    max-width: 720px;
  }
  .review {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    color: var(--text);
    text-decoration: none;
    min-height: 56px;
  }
  .review .go {
    margin-left: auto;
    color: var(--accent);
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 12px;
  }
  .tile {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: var(--text);
    text-decoration: none;
  }
  a.tile:hover {
    border-color: var(--line-strong);
  }
  .tile.empty {
    background: transparent;
    border-style: dashed;
  }
  .big {
    font-size: 30px;
    line-height: 1.1;
  }
  .cols {
    display: flex;
    flex-wrap: wrap;
    gap: 40px;
    align-items: flex-start;
  }
  .weak {
    flex: 3 1 440px;
    min-width: 0;
  }
  .exams {
    flex: 2 1 280px;
    min-width: 0;
  }
  .section-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .filters select {
    width: auto;
    min-height: 40px;
  }
  .check {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    font-size: 14px;
    color: var(--muted);
    min-height: 40px;
  }
  .name {
    flex: 1 1 220px;
    display: flex;
    flex-direction: column;
  }
  .plain {
    color: var(--text);
    text-decoration: none;
  }
  .plain:hover {
    color: var(--accent);
  }
  .red {
    margin: -8px 0 12px 0;
    color: var(--warn);
  }
  @media (max-width: 640px) {
    h1 {
      font-size: 28px;
    }
  }
</style>
