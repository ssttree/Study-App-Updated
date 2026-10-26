<script lang="ts">
  import { href } from '../lib/router.svelte';
  import { loadProgress, practiseHref, type ProgressData } from '../lib/progress/load';
  import { GRADE_COLOUR, gradeOf, pct, topicKey, unitRecall, type Unit } from '../lib/progress/recall';
  import { liveFocus, liveReview as latestReview } from '../lib/progress/review';
  import { relativeDay } from '../lib/practice/load';
  import { saveWeeklyReview } from '../lib/db';
  import { studyDayEnd } from '../lib/queue';
  import { directionsOf } from '../lib/queue';
  import { stateFor } from '../lib/scheduler';
  import { plural } from '../lib/load';
  import RecallBar from '../components/RecallBar.svelte';

  let { subject, topic }: { subject: string; topic: string } = $props();

  let data = $state.raw<ProgressData | null>(null);
  const load = () => loadProgress().then((d) => (data = d));
  load();

  const RATING = ['', 'Again', 'Hard', 'Good', 'Easy'];
  const RATING_COLOUR = ['', 'var(--warn)', 'var(--mid)', 'var(--good)', 'var(--info)'];

  interface Row {
    unit: Unit;
    recall: number | null;
    last: number | null;
    next: number | null;
    ratings: number[];
    attempts: number;
    rightMethod: number | null;
    extra: string;
  }

  const exam = $derived(data?.examTopics.has(topicKey(subject, topic)) ?? false);
  const focus = $derived(data ? new Set(liveFocus(data.reviews, data.today)) : new Set<string>());
  const liveReview = $derived(data ? latestReview(data.reviews, data.today) : undefined);

  const rows = $derived.by((): Row[] => {
    if (!data) return [];
    const d = data;
    const dayEnd = studyDayEnd(d.now, d.settings.dayStartHour);
    return d.units
      .filter((u) => u.subject === subject && u.topic === topic)
      .map((unit) => {
        const r = unitRecall(unit, d.now);
        const recall = r?.started ? r.recall : null;
        if (unit.skill) {
          const s = unit.skill;
          const mine = d.attempts.filter((a) => a.skillId === s.id).sort((a, b) => a.at - b.at);
          const yes = mine.filter((a) => a.method === 'yes').length;
          return {
            unit,
            recall,
            last: s.fsrs.lastReview ?? null,
            next: s.fsrs.state === 0 ? null : s.fsrs.due,
            ratings: mine.slice(-6).map((a) => a.rating),
            attempts: mine.length,
            rightMethod: mine.length ? yes / mine.length : null,
            extra: s.on ? '' : 'switched off',
          };
        }
        const ids = new Set(unit.cardIds);
        const logs = d.logs.filter((l) => ids.has(l.cardId)).sort((a, b) => a.reviewedAt - b.reviewedAt);
        let due = 0;
        let fresh = 0;
        for (const c of d.cards) {
          if (!ids.has(c.id)) continue;
          for (const dir of directionsOf(c)) {
            const st = stateFor(c, dir);
            if (st.state === 0) fresh++;
            else if (st.due <= dayEnd) due++;
          }
        }
        return {
          unit,
          recall,
          last: logs.length ? logs[logs.length - 1].reviewedAt : null,
          next: null,
          ratings: logs.slice(-6).map((l) => l.rating),
          attempts: logs.length,
          rightMethod: null,
          extra: `${plural(unit.cardIds!.length, 'card')} · ${due} due · ${fresh} new`,
        };
      })
      .sort((a, b) => (a.recall ?? -1) - (b.recall ?? -1));
  });

  async function toggleFocus(skillId: string) {
    if (!liveReview) return;
    const ids = liveReview.focusSkillIds.includes(skillId)
      ? liveReview.focusSkillIds.filter((id) => id !== skillId)
      : [...liveReview.focusSkillIds, skillId];
    await saveWeeklyReview({ ...liveReview, focusSkillIds: ids });
    await load();
  }

  function when(ts: number | null, dayEnd: number): string {
    return ts === null ? 'never' : relativeDay(ts, dayEnd);
  }
</script>

<main class="page wide">
  <section class="head">
    <div class="crumbs mono small">
      <a href={href('progress')}>Progress</a> / <a href={href('progress', 'subject', subject)}>{subject}</a>
    </div>
    <h1>{topic}</h1>
    {#if exam}<p class="muted">On an exam inside its prep ramp, so green needs 95% here.</p>{/if}
  </section>

  {#if data}
    {@const dayEnd = studyDayEnd(data.now, data.settings.dayStartHour)}
    <section>
      {#each rows as row (row.unit.key)}
        {@const grade = gradeOf(row.recall, exam)}
        <div class="row unit">
          <div class="top">
            <span class="uname">
              {row.unit.name}
              {#if row.unit.skill && focus.has(row.unit.skill.id)}<span class="tag">focus</span>{/if}
              <span class="muted small">{row.unit.kind === 'skill' ? 'Problems' : 'Flashcards'}{row.extra ? ' · ' + row.extra : ''}</span>
            </span>
            <RecallBar recall={row.recall} {grade} />
            <span class="mono pct" style:color={GRADE_COLOUR[grade]}>{pct(row.recall)}</span>
          </div>
          <div class="facts mono small muted">
            <span>last {when(row.last, dayEnd)}</span>
            {#if row.next !== null}<span>next {relativeDay(row.next, dayEnd)}</span>{/if}
            <span>{plural(row.attempts, row.unit.kind === 'skill' ? 'attempt' : 'review')}</span>
            {#if row.rightMethod !== null}<span>right method {Math.round(row.rightMethod * 100)}%</span>{/if}
            {#if row.ratings.length}
              <span class="ratings" aria-label="Recent ratings: {row.ratings.map((r) => RATING[r]).join(', ')}">
                {#each row.ratings as r, i (i)}<i style:background={RATING_COLOUR[r]} title={RATING[r]}></i>{/each}
              </span>
            {/if}
          </div>
          <div class="actions">
            <a class="btn small primary" href={practiseHref(data, row.unit)}>Practise now</a>
            {#if row.unit.skill}
              <a class="btn small" href={href('practice', 'skill', row.unit.skill.id)}>Questions and sub-skills</a>
              {#if liveReview}
                <button class="btn small" onclick={() => toggleFocus(row.unit.skill!.id)}>
                  {focus.has(row.unit.skill.id) ? 'Remove from focus' : 'Add to this week’s focus'}
                </button>
              {/if}
            {:else if row.unit.deckId}
              <a class="btn small" href={href('decks', row.unit.deckId)}>Open deck</a>
            {/if}
          </div>
        </div>
      {:else}
        <p class="muted">Nothing in this topic yet.</p>
      {/each}
      {#if !liveReview}
        <p class="muted small">Focus skills are picked in the Sunday <a href={href('progress', 'review')}>weekly review</a>.</p>
      {/if}
    </section>
  {/if}
</main>

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .crumbs a {
    text-decoration: none;
  }
  h1 {
    font-size: 36px;
  }
  .small {
    font-size: 13px;
  }
  .unit {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
  }
  .uname {
    flex: 1 1 260px;
    display: flex;
    flex-direction: column;
  }
  .tag {
    font: 11px var(--mono);
    text-transform: uppercase;
    color: var(--accent);
  }
  .pct {
    width: 48px;
    text-align: right;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    align-items: center;
  }
  .ratings {
    display: inline-flex;
    gap: 4px;
  }
  .ratings i {
    width: 10px;
    height: 10px;
    border-radius: 5px;
    display: inline-block;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
</style>
