<script lang="ts">
  import DeckForm from '../components/DeckForm.svelte';
  import { deleteDeck, getDeck, getSettings, listCards, logsSince, saveDeck } from '../lib/db';
  import { plainText } from '../lib/markdown';
  import { directionsOf, studyDayStart, summarise } from '../lib/queue';
  import { formatInterval, stateFor } from '../lib/scheduler';
  import { reviewHref } from '../lib/filters';
  import { go, href } from '../lib/router.svelte';
  import { plural } from '../lib/load';
  import type { Card, Deck, ReviewLog, Settings, TypingMode } from '../lib/types';

  let { id }: { id: string } = $props();

  let deck = $state.raw<Deck | null | undefined>(undefined);
  let cards = $state.raw<Card[]>([]);
  let settings = $state<Settings | null>(null);
  let logsToday = $state.raw<ReviewLog[]>([]);
  let editing = $state(false);
  let search = $state('');
  let topicFilter = $state('');
  let tagFilter = $state('');

  async function load() {
    deck = (await getDeck(id)) ?? null;
    cards = (await listCards(id)).sort((a, b) => b.created - a.created);
    settings = await getSettings();
    logsToday = await logsSince(studyDayStart(Date.now(), settings.dayStartHour));
  }
  load();

  const topics = $derived([...new Set(cards.map((c) => c.topic).filter(Boolean))].sort());
  const tags = $derived([...new Set(cards.flatMap((c) => c.tags))].sort());

  const topicStats = $derived.by(() => {
    if (!deck || !settings) return [];
    const now = Date.now();
    return topics.map((topic) => {
      const s = summarise(cards, [deck!], logsToday, settings!, { kind: 'topic', deckId: id, topic }, now);
      return { topic, count: cards.filter((c) => c.topic === topic).length, ready: s.due.length + s.newCards.length };
    });
  });

  const deckReady = $derived.by(() => {
    if (!deck || !settings) return 0;
    const s = summarise(cards, [deck], logsToday, settings, { kind: 'deck', deckId: id });
    return s.due.length + s.newCards.length;
  });

  const shown = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return cards.filter(
      (c) =>
        (!topicFilter || c.topic === topicFilter) &&
        (!tagFilter || c.tags.includes(tagFilter)) &&
        (!q || `${c.front} ${c.back} ${c.topic} ${c.tags.join(' ')}`.toLowerCase().includes(q)),
    );
  });

  function dueLabel(card: Card): string {
    const now = Date.now();
    const states = directionsOf(card).map((d) => stateFor(card, d));
    if (states.every((s) => s.state === 0)) return 'new';
    const next = Math.min(...states.filter((s) => s.state !== 0).map((s) => s.due));
    return next <= now ? 'due now' : `in ${formatInterval(next - now)}`;
  }

  async function update(values: { name: string; subject: string; module: string; typingDefault: TypingMode }) {
    if (!deck) return;
    await saveDeck({ ...deck, ...values });
    editing = false;
    await load();
  }

  async function remove() {
    if (!deck) return;
    const ok = confirm(
      `Delete "${deck.name}" and its ${plural(cards.length, 'card')}? Their review history goes too. This cannot be undone unless you have a backup.`,
    );
    if (!ok) return;
    await deleteDeck(deck.id);
    go('decks');
  }
</script>

<main class="page wide">
  {#if deck === null}
    <h1>Deck not found</h1>
    <p><a href={href('decks')}>Back to decks</a></p>
  {:else if deck}
    <section class="head">
      <div>
        <a class="back" href={href('decks')}>← Decks</a>
        <div class="eyebrow">{deck.subject}{deck.module ? ` · ${deck.module}` : ''}</div>
        <h1>{deck.name}</h1>
      </div>
      <div class="actions">
        {#if deckReady > 0}
          <a class="btn primary" href={reviewHref({ kind: 'deck', deckId: id })}>Study {deckReady}</a>
        {/if}
        <a class="btn" class:primary={deckReady === 0} href={href('card', 'new', id)}>Add card</a>
        {#if cards.length > 0}
          <a class="btn" href={href('custom', 'deck', id)}>Custom study</a>
        {/if}
        <button class="btn" onclick={() => (editing = !editing)}>Deck settings</button>
      </div>
    </section>

    {#if editing}
      <section class="panel pad">
        <DeckForm {deck} submitLabel="Save deck" onsubmit={update} oncancel={() => (editing = false)} />
        <div class="danger-zone">
          <button class="btn danger small" onclick={remove}>Delete this deck</button>
        </div>
      </section>
    {/if}

    {#if topicStats.length > 0}
      <section>
        <h2>Topics</h2>
        <div class="chips">
          {#each topicStats as t (t.topic)}
            <span class="chip">
              <span>{t.topic}</span>
              <span class="mono muted">{t.count}</span>
              {#if t.ready > 0}
                <a href={reviewHref({ kind: 'topic', deckId: id, topic: t.topic })}>study {t.ready}</a>
              {/if}
            </span>
          {/each}
        </div>
      </section>
    {/if}

    <section>
      <div class="filters">
        <label class="field grow">
          <span class="sr-only">Search cards</span>
          <input type="search" bind:value={search} placeholder="Search cards" />
        </label>
        {#if topics.length > 0}
          <label class="field">
            <span class="sr-only">Topic</span>
            <select bind:value={topicFilter}>
              <option value="">All topics</option>
              {#each topics as t (t)}<option value={t}>{t}</option>{/each}
            </select>
          </label>
        {/if}
        {#if tags.length > 0}
          <label class="field">
            <span class="sr-only">Tag</span>
            <select bind:value={tagFilter}>
              <option value="">All tags</option>
              {#each tags as t (t)}<option value={t}>#{t}</option>{/each}
            </select>
          </label>
        {/if}
      </div>

      <div class="list-head mono muted">{plural(shown.length, 'card')}{shown.length !== cards.length ? ` of ${cards.length}` : ''}</div>
      {#each shown as card (card.id)}
        <a class="row card-row" href={href('card', card.id)}>
          <span class="front">{plainText(card.front) || '(empty front)'}</span>
          <span class="meta mono muted">
            {#if card.topic}{card.topic} · {/if}{#if card.type === 'reversed'}both ways · {/if}{dueLabel(card)}
          </span>
        </a>
      {:else}
        {#if cards.length === 0}
          <p class="muted">No cards yet. <a href={href('card', 'new', id)}>Add the first one.</a></p>
        {:else}
          <p class="muted">No cards match.</p>
        {/if}
      {/each}
    </section>
  {/if}
</main>

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 16px;
    flex-wrap: wrap;
  }
  .back {
    display: inline-flex;
    min-height: 36px;
    align-items: center;
    text-decoration: none;
    font-size: 15px;
    margin-bottom: 8px;
  }
  h1 {
    font-size: 40px;
    margin-top: 8px;
  }
  h2 {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.02em;
    margin-bottom: 12px;
  }
  .actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .pad {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .danger-zone {
    border-top: 1px solid var(--line);
    padding-top: 16px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 6px 14px;
    border: 1px solid var(--line-strong);
    border-radius: 18px;
    font-size: 14px;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 12px;
  }
  .filters .field {
    min-width: 180px;
  }
  .grow {
    flex: 1 1 260px;
  }
  .list-head {
    font-size: 13px;
    margin-bottom: 4px;
  }
  .card-row {
    color: var(--text);
    text-decoration: none;
  }
  .card-row:hover .front {
    color: var(--accent);
  }
  .front {
    flex: 1 1 360px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: 13px;
  }
</style>
