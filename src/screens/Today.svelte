<script lang="ts">
  import { loadCollection, estimateMinutes, plural, type Collection } from '../lib/load';
  import { summarise, studyDayEnd } from '../lib/queue';
  import { stateFor } from '../lib/scheduler';
  import { directionsOf } from '../lib/queue';
  import { backupOverdue, downloadBackup } from '../lib/backup';
  import { reviewHref } from '../lib/filters';
  import { href } from '../lib/router.svelte';

  let data = $state.raw<Collection | null>(null);
  let backingUp = $state(false);

  async function load() {
    data = await loadCollection();
  }
  load();

  const view = $derived.by(() => {
    if (!data) return null;
    const now = Date.now();
    const all = summarise(data.cards, data.decks, data.logsToday, data.settings, { kind: 'all' }, now);
    const subjects = [...new Set(data.decks.map((d) => d.subject))].sort();
    const bySubject = subjects.map((subject) => {
      const s = summarise(data!.cards, data!.decks, data!.logsToday, data!.settings, { kind: 'subject', subject }, now);
      const cards = data!.cards.filter((c) => data!.decks.find((d) => d.id === c.deckId)?.subject === subject).length;
      return { subject, due: s.due.length, fresh: s.newCards.length, cards };
    });
    // Reviews due tomorrow, to show what is coming.
    const tomorrowEnd = studyDayEnd(now, data.settings.dayStartHour) + 86_400_000;
    const todayEnd = studyDayEnd(now, data.settings.dayStartHour);
    let dueTomorrow = 0;
    for (const card of data.cards) {
      for (const dir of directionsOf(card)) {
        const st = stateFor(card, dir);
        if (st.state !== 0 && st.due > todayEnd && st.due <= tomorrowEnd) dueTomorrow++;
      }
    }
    const reviewedToday = data.logsToday.length;
    const minutesToday = Math.round(data.logsToday.reduce((sum, l) => sum + l.durationMs, 0) / 60_000);
    return { all, bySubject, dueTomorrow, reviewedToday, minutesToday };
  });

  async function backup() {
    backingUp = true;
    try {
      await downloadBackup();
      await load();
    } finally {
      backingUp = false;
    }
  }
</script>

<main class="page">
  {#if data && view}
    {@const due = view.all.due.length}
    {@const fresh = view.all.newCards.length}
    {#if data.decks.length === 0}
      <section class="hero">
        <div class="eyebrow accent">Getting started</div>
        <h1>Make your first deck</h1>
        <p class="lead muted">
          A deck holds the cards for one subject or module, like Chemistry Module 5. Add a few cards, and the
          app will tell you each day which ones to review so you remember them for the long run.
        </p>
        <div class="actions">
          <a class="btn primary" href={href('decks')}>Make a deck</a>
          <a class="btn" href={href('settings')}>Restore a backup</a>
        </div>
      </section>
    {:else if due + fresh > 0}
      <section class="hero">
        <div class="eyebrow accent">Next · about {estimateMinutes(due, fresh)} min</div>
        <h1>Flashcards</h1>
        <p class="lead muted">
          {#if due > 0}{plural(due, 'review')}{/if}{#if due > 0 && fresh > 0}&nbsp;and {/if}{#if fresh > 0}{plural(fresh, 'new card')}{/if}
          ready. Answer each one in your head (or type it) before you flip it.
        </p>
        <div class="actions">
          <a class="btn primary" href={reviewHref({ kind: 'all' })}>Start review</a>
          <a class="btn" href={href('decks')}>Add cards</a>
          <a class="btn" href={href('custom')}>Custom study</a>
        </div>
      </section>
    {:else}
      <section class="hero">
        <div class="eyebrow accent">All caught up</div>
        <h1>Nothing due right now</h1>
        <p class="lead muted">
          {#if view.dueTomorrow > 0}{plural(view.dueTomorrow, 'review')} {view.dueTomorrow === 1 ? 'comes' : 'come'} back tomorrow.{:else}No reviews are waiting.{/if}
          {#if view.all.newLeftToday === 0}You have used today's {data.settings.newPerDay} new cards.{:else}Add new cards to keep learning.{/if}
        </p>
        <div class="actions">
          <a class="btn primary" href={href('custom')}>Custom study</a>
          <a class="btn" href={href('decks')}>Add cards</a>
        </div>
      </section>
    {/if}

    {#if data.cards.length > 0 && backupOverdue(data.settings)}
      <div class="notice">
        {#if data.settings.lastBackupAt}
          Your last backup was {Math.floor((Date.now() - data.settings.lastBackupAt) / 86_400_000)} days ago.
        {:else}
          You have not made a backup yet.
        {/if}
        Your cards only live in this browser, so keep a copy somewhere safe (like Google Drive).
        <div class="notice-actions">
          <button class="btn small primary" onclick={backup} disabled={backingUp}>Back up now</button>
        </div>
      </div>
    {/if}

    {#if due > 300}
      <div class="notice warn">
        {due} reviews are waiting. Pause new cards (set new cards per day to 0 in Settings) until the pile is
        under control.
      </div>
    {/if}

    {#if view.bySubject.length > 0}
      <section>
        <div class="section-head">
          <h2>By subject</h2>
          <span class="mono muted small">{plural(data.cards.length, 'card')}</span>
        </div>
        {#each view.bySubject as s (s.subject)}
          <a class="row subject" href={reviewHref({ kind: 'subject', subject: s.subject })}>
            <span class="dot" style:background={s.due > 0 ? 'var(--accent)' : s.fresh > 0 ? 'var(--info)' : 'var(--dot)'}></span>
            <span class="name">{s.subject}</span>
            <span class="mono muted small">
              {#if s.due + s.fresh === 0}done · {plural(s.cards, 'card')}{:else}{s.due} due · {s.fresh} new{/if}
            </span>
          </a>
        {/each}
      </section>
    {/if}

    <section class="tiles">
      <div class="tile">
        <div class="eyebrow">Reviewed today</div>
        <div class="big">{view.reviewedToday}</div>
        <div class="muted small">{view.minutesToday} min of study</div>
      </div>
      <div class="tile">
        <div class="eyebrow">New left today</div>
        <div class="big">{view.all.newLeftToday}</div>
        <div class="muted small">of {data.settings.newPerDay} per day</div>
      </div>
      <div class="tile">
        <div class="eyebrow">Due tomorrow</div>
        <div class="big">{view.dueTomorrow}</div>
        <div class="muted small">reviews</div>
      </div>
    </section>
  {/if}
</main>

<style>
  .hero {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  h1 {
    font-size: 44px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .lead {
    margin: 0;
    font-size: 18px;
    max-width: 560px;
  }
  .actions,
  .notice-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 8px;
  }
  .section-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 4px;
  }
  h2 {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .small {
    font-size: 13px;
  }
  .subject {
    color: var(--text);
    text-decoration: none;
    min-height: 44px;
  }
  .subject:hover .name {
    color: var(--accent);
  }
  .name {
    flex: 1 1 260px;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1px;
    background: var(--line);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .tile {
    background: var(--surface);
    padding: 20px 22px;
  }
  .tile .eyebrow {
    font-size: 12px;
  }
  .big {
    font-size: 26px;
    font-weight: 700;
    margin-top: 6px;
  }
  @media (max-width: 640px) {
    h1 {
      font-size: 34px;
    }
  }
</style>
