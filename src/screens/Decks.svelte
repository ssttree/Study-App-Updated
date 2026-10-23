<script lang="ts">
  import DeckForm from '../components/DeckForm.svelte';
  import { newId, saveDeck } from '../lib/db';
  import { loadCollection, plural, type Collection } from '../lib/load';
  import { summarise } from '../lib/queue';
  import { reviewHref } from '../lib/filters';
  import { go, href } from '../lib/router.svelte';

  let data = $state.raw<Collection | null>(null);
  let creating = $state(false);

  loadCollection().then((c) => {
    data = c;
    creating = c.decks.length === 0;
  });

  const groups = $derived.by(() => {
    if (!data) return [];
    const now = Date.now();
    const subjects = [...new Set(data.decks.map((d) => d.subject))].sort();
    return subjects.map((subject) => ({
      subject,
      decks: data!.decks
        .filter((d) => d.subject === subject)
        .map((deck) => {
          const s = summarise(data!.cards, data!.decks, data!.logsToday, data!.settings, { kind: 'deck', deckId: deck.id }, now);
          return {
            deck,
            total: data!.cards.filter((c) => c.deckId === deck.id).length,
            due: s.due.length,
            fresh: s.newCards.length,
          };
        }),
    }));
  });

  async function create(values: { name: string; subject: string; module: string; typingDefault: 'off' | 'always' | 'optional' }) {
    const now = Date.now();
    const id = newId();
    await saveDeck({ id, ...values, created: now, updated: now });
    go('decks', id);
  }
</script>

<main class="page">
  <section class="head">
    <div>
      <div class="eyebrow">Cards</div>
      <h1>Decks</h1>
    </div>
    {#if !creating}
      <button class="btn primary" onclick={() => (creating = true)}>New deck</button>
    {/if}
  </section>

  {#if creating}
    <section class="panel pad">
      <h2>New deck</h2>
      <p class="muted hint">One deck per subject or module works well. Topics inside a deck can be set on each card.</p>
      <DeckForm submitLabel="Create deck" onsubmit={create} oncancel={data && data.decks.length > 0 ? () => (creating = false) : undefined} />
    </section>
  {/if}

  {#each groups as group (group.subject)}
    <section>
      <h2 class="group">{group.subject}</h2>
      {#each group.decks as d (d.deck.id)}
        <div class="row">
          <span class="dot" style:background={d.due > 0 ? 'var(--accent)' : d.fresh > 0 ? 'var(--info)' : 'var(--dot)'}></span>
          <a class="deck-name" href={href('decks', d.deck.id)}>
            {d.deck.name}{#if d.deck.module}<span class="muted"> · {d.deck.module}</span>{/if}
          </a>
          <span class="mono muted small">{plural(d.total, 'card')} · {d.due} due · {d.fresh} new</span>
          {#if d.due + d.fresh > 0}
            <a class="btn small" href={reviewHref({ kind: 'deck', deckId: d.deck.id })}>Study</a>
          {/if}
        </div>
      {/each}
    </section>
  {/each}
</main>

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 16px;
    flex-wrap: wrap;
  }
  h1 {
    font-size: 40px;
    margin-top: 8px;
  }
  h2 {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .group {
    margin-bottom: 4px;
  }
  .pad {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .hint {
    margin: 0;
    font-size: 15px;
  }
  .deck-name {
    flex: 1 1 260px;
    color: var(--text);
    text-decoration: none;
    font-size: 17px;
    min-height: 36px;
    display: inline-flex;
    align-items: center;
  }
  .deck-name:hover {
    color: var(--accent);
  }
  .small {
    font-size: 13px;
  }
</style>
