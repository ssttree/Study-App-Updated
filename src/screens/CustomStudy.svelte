<script lang="ts">
  import { listCards, listDecks, logsSince, getSettings } from '../lib/db';
  import { customToParts, DEFAULT_CUSTOM, selectCustom, type CustomOptions, type CustomPick } from '../lib/custom';
  import { filterFromParts, filterToParts } from '../lib/filters';
  import { plural } from '../lib/load';
  import { go } from '../lib/router.svelte';
  import type { Card, Deck, ReviewLog, Settings } from '../lib/types';

  let { filterParts }: { filterParts: string[] } = $props();

  let decks = $state.raw<Deck[]>([]);
  let cards = $state.raw<Card[]>([]);
  let logs = $state.raw<ReviewLog[]>([]);
  let settings = $state.raw<Settings | null>(null);

  let pick = $state<CustomPick>(DEFAULT_CUSTOM.pick);
  let days = $state(DEFAULT_CUSTOM.days);
  let limit = $state(DEFAULT_CUSTOM.limit);
  let shuffle = $state(DEFAULT_CUSTOM.shuffle);
  // The scope is kept as its address parts joined by "/", so it fits a <select>.
  let scope = $state('');

  async function load() {
    settings = await getSettings();
    [decks, cards, logs] = await Promise.all([
      listDecks(),
      listCards(),
      // A month of history covers every "forgot in the last ..." choice.
      logsSince(Date.now() - 31 * 86_400_000),
    ]);
    scope = filterToParts(filterFromParts(filterParts)).join('/');
  }
  load();

  const subjects = $derived([...new Set(decks.map((d) => d.subject))].sort());
  const tags = $derived([...new Set(cards.flatMap((c) => c.tags))].sort());
  const topics = $derived(
    decks.flatMap((d) =>
      [...new Set(cards.filter((c) => c.deckId === d.id && c.topic).map((c) => c.topic))]
        .sort()
        .map((topic) => ({ deck: d, topic })),
    ),
  );

  const options = $derived<CustomOptions>({
    pick,
    days,
    limit: Math.max(1, Math.round(Number(limit) || 1)),
    shuffle,
    filter: filterFromParts(scope ? scope.split('/') : []),
  });

  const count = $derived(
    settings ? selectCustom(cards, decks, logs, { ...options, limit: 9999 }, Date.now(), settings.dayStartHour).length : 0,
  );

  function start(e: SubmitEvent) {
    e.preventDefault();
    if (count === 0) return;
    go('custom', 'run', ...customToParts(options));
  }

  const picks: { value: CustomPick; title: string; text: string }[] = [
    { value: 'today', title: 'Cards I studied today', text: 'Go over today’s cards again, good before bed or a test.' },
    { value: 'missed', title: 'Cards I forgot recently', text: 'Only cards you pressed Again on.' },
    { value: 'all', title: 'Every card', text: 'All cards in the deck, topic or tag you pick, due or not.' },
  ];
</script>

<main class="page">
  <section>
    <div class="eyebrow">Cards</div>
    <h1>Custom study</h1>
    <p class="lead muted">
      Extra practice whenever you want it. It never changes when cards are next due, so it can’t mess up your schedule.
    </p>
  </section>

  <form class="form" onsubmit={start}>
    <fieldset>
      <legend>Which cards</legend>
      {#each picks as p (p.value)}
        <label class="choice">
          <input type="radio" name="pick" value={p.value} bind:group={pick} />
          <span><strong>{p.title}</strong><br /><span class="muted">{p.text}</span></span>
        </label>
      {/each}
    </fieldset>

    {#if pick === 'missed'}
      <label class="field">
        Forgot in the last
        <select bind:value={days}>
          <option value={1}>day</option>
          <option value={3}>3 days</option>
          <option value={7}>week</option>
          <option value={14}>2 weeks</option>
          <option value={30}>month</option>
        </select>
      </label>
    {/if}

    <label class="field">
      From
      <select bind:value={scope}>
        <option value="">All subjects</option>
        {#if subjects.length}
          <optgroup label="Subjects">
            {#each subjects as s (s)}<option value={['subject', s].join('/')}>{s}</option>{/each}
          </optgroup>
        {/if}
        {#if decks.length}
          <optgroup label="Decks">
            {#each decks as d (d.id)}<option value={['deck', d.id].join('/')}>{d.subject} · {d.name}</option>{/each}
          </optgroup>
        {/if}
        {#if topics.length}
          <optgroup label="Topics">
            {#each topics as t (t.deck.id + t.topic)}
              <option value={['topic', t.deck.id, t.topic].join('/')}>{t.deck.name} · {t.topic}</option>
            {/each}
          </optgroup>
        {/if}
        {#if tags.length}
          <optgroup label="Tags">
            {#each tags as t (t)}<option value={['tag', t].join('/')}>#{t}</option>{/each}
          </optgroup>
        {/if}
      </select>
    </label>

    <div class="two">
      <label class="field">
        Most cards
        <input type="number" min="1" max="9999" bind:value={limit} />
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={shuffle} />
        Shuffle the order
      </label>
    </div>

    <div class="go">
      <button class="btn primary" type="submit" disabled={count === 0}>
        Start · {plural(Math.min(count, options.limit), 'card')}
      </button>
      {#if count === 0}<span class="muted small">No cards match. Try another choice.</span>{/if}
    </div>
  </form>
</main>

<style>
  h1 {
    font-size: 40px;
    margin-top: 8px;
  }
  .lead {
    margin: 12px 0 0;
    font-size: 18px;
    max-width: 560px;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  legend {
    font-size: 14px;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .choice {
    display: flex;
    gap: 14px;
    align-items: center;
    padding: 12px 16px;
    border: 1px solid var(--line-strong);
    border-radius: 10px;
    cursor: pointer;
    font-size: 15px;
  }
  .choice:has(input:checked) {
    border-color: var(--accent);
  }
  .choice input,
  .check input {
    accent-color: var(--accent);
    width: 18px;
    height: 18px;
    flex: none;
  }
  .two {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    align-items: end;
  }
  .check {
    display: flex;
    gap: 10px;
    align-items: center;
    min-height: 44px;
    font-size: 15px;
  }
  .go {
    display: flex;
    gap: 14px;
    align-items: center;
    flex-wrap: wrap;
  }
  .small {
    font-size: 14px;
  }
</style>
