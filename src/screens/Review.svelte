<script lang="ts">
  import MathText from '../components/MathText.svelte';
  import { recordReview } from '../lib/db';
  import { effectiveTyping } from '../lib/cards';
  import { answerKey, checkAnswer, prettyChem } from '../lib/answers';
  import { filterFromParts } from '../lib/filters';
  import { loadCollection, plural, estimateMinutes } from '../lib/load';
  import { buildQueue, pickNext, summarise, LEARN_AHEAD_MS, type QueueItem } from '../lib/queue';
  import { formatInterval, makeScheduler, previewIntervals, rate, RATINGS, stateFor, type RatingValue } from '../lib/scheduler';
  import { href } from '../lib/router.svelte';
  import type { Deck, Settings } from '../lib/types';
  import type { FSRS } from 'ts-fsrs';

  let { filterParts }: { filterParts: string[] } = $props();

  const TYPING_PREF_KEY = 'study-app:typing-optional-on';

  let loading = $state(true);
  let decks = $state.raw<Deck[]>([]);
  let settings = $state<Settings | null>(null);
  let scheduler: FSRS | null = null;
  let queue = $state.raw<QueueItem[]>([]);
  let current = $state.raw<QueueItem | null>(null);
  let revealed = $state(false);
  let typed = $state('');
  let optionalTypingOn = $state(readTypingPref());
  let shownAt = 0;
  let done = $state(0);
  let saving = $state(false);
  let waitUntil = $state<number | null>(null);
  let filterLabel = $state('All subjects');
  let typeInput = $state<HTMLInputElement | null>(null);

  function readTypingPref(): boolean {
    try {
      return localStorage.getItem(TYPING_PREF_KEY) === '1';
    } catch {
      return false;
    }
  }

  async function start() {
    const data = await loadCollection();
    const filter = filterFromParts(filterParts);
    decks = data.decks;
    settings = data.settings;
    scheduler = makeScheduler(data.settings);
    const summary = summarise(data.cards, data.decks, data.logsToday, data.settings, filter);
    queue = buildQueue(summary);
    if (filter.kind === 'subject') filterLabel = filter.subject;
    else if (filter.kind === 'deck') filterLabel = data.decks.find((d) => d.id === filter.deckId)?.name ?? 'Deck';
    else if (filter.kind === 'topic') filterLabel = filter.topic;
    loading = false;
    advance();
  }
  start();

  function advance() {
    const now = Date.now();
    const idx = pickNext(queue, now);
    revealed = false;
    typed = '';
    if (idx === -1) {
      current = null;
      // Learning cards due later than the look-ahead window: offer to wait.
      const soonest = queue.length ? Math.min(...queue.map((q) => q.due)) : null;
      waitUntil = soonest;
      return;
    }
    waitUntil = null;
    current = queue[idx];
    shownAt = now;
    if (typingActive) queueMicrotask(() => typeInput?.focus());
  }

  const deck = $derived(current ? decks.find((d) => d.id === current!.card.deckId) : undefined);
  const typingMode = $derived(current ? effectiveTyping(current.card, deck) : 'off');
  const typingActive = $derived(typingMode === 'always' || (typingMode === 'optional' && optionalTypingOn));
  const question = $derived(current ? (current.direction === 'forward' ? current.card.front : current.card.back) : '');
  const answer = $derived(current ? (current.direction === 'forward' ? current.card.back : current.card.front) : '');
  const intervals = $derived(
    current && scheduler && settings ? previewIntervals(scheduler, stateFor(current.card, current.direction)) : null,
  );
  const check = $derived(
    revealed && typingActive && current ? checkAnswer(typed, answerKey(current.card, current.direction)) : null,
  );
  const verdictLabel = { correct: 'Right', close: 'Close', wrong: 'Not quite', empty: 'Nothing typed' } as const;
  const remaining = $derived(queue.length);
  const total = $derived(done + remaining);

  function reveal() {
    if (!current || revealed) return;
    revealed = true;
  }

  async function choose(rating: RatingValue) {
    if (!current || !revealed || !scheduler || saving) return;
    saving = true;
    const item = current;
    const now = Date.now();
    const result = rate(scheduler, item.card, item.direction, rating, {
      now,
      durationMs: Math.min(now - shownAt, 5 * 60_000),
      typedAnswer: typingActive ? typed : undefined,
    });
    try {
      await recordReview(result.card, result.log);
    } finally {
      saving = false;
    }
    const after = stateFor(result.card, item.direction);
    // Update other queue entries for the same card (its other direction).
    queue = queue
      .filter((q) => q !== item)
      .map((q) => (q.card.id === result.card.id ? { ...q, card: result.card } : q));
    // Cards still in short learning steps come back later this session.
    if (after.state !== 2 && after.due - now <= 60 * 60_000) {
      queue = [...queue, { card: result.card, direction: item.direction, due: after.due, isNew: false, requeued: true }];
    }
    done += 1;
    advance();
  }

  function toggleTyping() {
    optionalTypingOn = !optionalTypingOn;
    try {
      localStorage.setItem(TYPING_PREF_KEY, optionalTypingOn ? '1' : '0');
    } catch {
      /* private window: the choice just is not remembered */
    }
    if (optionalTypingOn && !revealed) queueMicrotask(() => typeInput?.focus());
  }

  function onkeydown(e: KeyboardEvent) {
    if (!current || e.ctrlKey || e.metaKey || e.altKey) return;
    const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (!revealed) {
      if (inField) {
        if (e.key === 'Enter') {
          e.preventDefault();
          reveal();
        }
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        reveal();
      }
      return;
    }
    if (['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      choose(Number(e.key) as RatingValue);
    } else if (e.key === ' ') {
      // Space on the answer side means Good, like Anki.
      if (e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      choose(3);
    }
  }

  let tick = $state(Date.now());
  $effect(() => {
    if (waitUntil === null) return;
    const t = setInterval(() => {
      tick = Date.now();
      if (waitUntil !== null && waitUntil - tick <= LEARN_AHEAD_MS) advance();
    }, 15_000);
    return () => clearInterval(t);
  });
</script>

<svelte:window {onkeydown} />

<div class="review">
  <header>
    <a class="leave" href={href('today')}>← Done for now</a>
    <div class="bar" role="progressbar" aria-label="Cards reviewed" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      <div class="fill" style:flex={done}></div>
      <div class="rest" style:flex={Math.max(remaining, total === 0 ? 1 : 0)}></div>
    </div>
    <span class="mono muted small">
      {#if remaining > 0}{remaining} left · ~{estimateMinutes(remaining, 0)} min{:else}{filterLabel}{/if}
    </span>
  </header>

  <main>
    {#if loading}
      <p class="muted center">Loading cards...</p>
    {:else if current}
      <article class="card">
        <div class="card-top">
          <span class="eyebrow">
            {deck?.subject ?? ''}{deck ? ` · ${deck.name}` : ''}{current.card.topic ? ` · ${current.card.topic}` : ''}
          </span>
          <span class="badges">
            {#if current.isNew}<span class="badge new">new</span>{/if}
            {#if current.direction === 'reverse'}<span class="badge">reverse</span>{/if}
            <a class="edit" href={href('card', current.card.id)} title="Edit this card">edit</a>
          </span>
        </div>

        {#if current.card.image && current.direction === 'forward'}
          <img class="card-image" src={current.card.image} alt="" />
        {/if}
        <MathText text={question} />

        {#if typingActive && !revealed}
          <label class="type-box">
            <span class="sr-only">Type your answer</span>
            <input
              bind:this={typeInput}
              bind:value={typed}
              type="text"
              autocomplete="off"
              spellcheck="false"
              placeholder="Type your answer, then press Enter"
            />
          </label>
          {#if typed.trim()}
            <p class="shows-as muted">Shows as <span class="chem">{@html prettyChem(typed)}</span></p>
          {/if}
          <p class="type-tip muted">Lists can go in any order. Chemistry can be typed plainly: N2 + 3H2 &lt;=&gt; 2NH3</p>
        {/if}

        {#if revealed}
          <div class="divider"></div>
          {#if typingActive}
            <div class="compare">
              <div class="yours {check?.verdict ?? ''}">
                <span class="eyebrow">
                  Your answer · {check ? verdictLabel[check.verdict] : ''}{check?.note ? ` · ${check.note}` : ''}
                </span>
                {#if typed.trim()}<p class="chem typed">{@html prettyChem(typed)}</p>{/if}
              </div>
            </div>
          {/if}
          {#if current.card.image && current.direction === 'reverse'}
            <img class="card-image" src={current.card.image} alt="" />
          {/if}
          <div class="answer"><MathText text={answer} /></div>
        {/if}
      </article>

      <div class="controls">
        {#if !revealed}
          <div class="reveal-row">
            <button class="btn primary show" onclick={reveal}>Show answer <span class="key">space</span></button>
            {#if typingMode === 'optional'}
              <button class="btn" aria-pressed={optionalTypingOn} onclick={toggleTyping}>
                Typing {optionalTypingOn ? 'on' : 'off'}
              </button>
            {/if}
          </div>
        {:else}
          <div class="ratings">
            {#each RATINGS as r (r.value)}
              <button class="rate" class:good={r.value === 3} onclick={() => choose(r.value)} disabled={saving}>
                {r.label}
                <span>{intervals ? formatInterval(intervals[r.value]) : ''} · {r.value}</span>
              </button>
            {/each}
          </div>
          <p class="hint muted">How well did you remember? Again if you got it wrong, Hard if it was a struggle, Good if you got it, Easy if it was instant.</p>
        {/if}
      </div>
    {:else}
      <section class="finished">
        {#if waitUntil !== null}
          <div class="eyebrow accent">Short break</div>
          <h1>{plural(queue.length, 'card')} still learning</h1>
          <p class="muted">
            They come back in about {formatInterval(waitUntil - tick)}. Stay here and they will appear, or leave and
            catch them next time.
          </p>
        {:else if done > 0}
          <div class="eyebrow accent">Done for now</div>
          <h1>{plural(done, 'card')} reviewed</h1>
          <p class="muted">Nice work. FSRS has scheduled each card for just before you would forget it.</p>
        {:else}
          <div class="eyebrow accent">Nothing to review</div>
          <h1>No cards due in {filterLabel}</h1>
          <p class="muted">Add some cards, or come back when reviews are due.</p>
        {/if}
        <div class="actions">
          <a class="btn primary" href={href('today')}>Back to today</a>
          <a class="btn" href={href('decks')}>Decks</a>
        </div>
      </section>
    {/if}
  </main>
</div>

<style>
  .review {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 24px;
    padding: 18px 32px;
  }
  .leave {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    text-decoration: none;
    font-size: 15px;
  }
  .bar {
    flex: 1 1 200px;
    display: flex;
    gap: 3px;
    align-items: center;
  }
  .fill,
  .rest {
    height: 4px;
    border-radius: 2px;
  }
  .fill {
    background: var(--accent);
  }
  .rest {
    background: var(--line);
  }
  .small {
    font-size: 13px;
  }
  main {
    flex: 1;
    width: 100%;
    max-width: 820px;
    margin: 0 auto;
    padding: 32px 24px 56px;
    display: flex;
    flex-direction: column;
    gap: 24px;
    justify-content: center;
  }
  .center {
    text-align: center;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    padding: 40px 56px;
    display: flex;
    flex-direction: column;
    gap: 28px;
    text-align: center;
  }
  .card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    text-align: left;
  }
  .card-top .eyebrow {
    font-size: 12px;
    letter-spacing: 0.06em;
  }
  .badges {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    font-family: var(--mono);
    font-size: 12px;
  }
  .badge {
    padding: 2px 8px;
    border-radius: 10px;
    border: 1px solid var(--line-strong);
    color: var(--muted);
  }
  .badge.new {
    color: var(--info);
    border-color: color-mix(in srgb, var(--info) 50%, transparent);
  }
  .edit {
    color: var(--dim);
    text-decoration: none;
  }
  .edit:hover {
    color: var(--accent);
  }
  .card-image {
    max-width: 100%;
    max-height: 340px;
    object-fit: contain;
    align-self: center;
    border-radius: 10px;
  }
  .divider {
    height: 1px;
    background: var(--line);
  }
  .answer {
    color: var(--answer);
  }
  .type-box input {
    font-size: 18px;
    text-align: center;
    min-height: 52px;
  }
  .compare .yours {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px 18px;
    border-radius: var(--radius);
    border: 1px dashed var(--line-strong);
  }
  .yours.correct {
    border-style: solid;
    border-color: color-mix(in srgb, var(--good) 55%, transparent);
  }
  .yours.correct .eyebrow {
    color: var(--good);
  }
  .yours.close {
    border-style: solid;
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  }
  .yours.close .eyebrow {
    color: var(--accent);
  }
  .yours.wrong .eyebrow {
    color: var(--warn);
  }
  .typed {
    margin: 0;
    font-size: 20px;
  }
  .shows-as,
  .type-tip {
    margin: -16px 0 0;
    font-size: 14px;
  }
  .type-tip {
    font-size: 13px;
    color: var(--dim);
  }
  .shows-as .chem {
    color: var(--text);
    font-size: 17px;
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .reveal-row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    justify-content: center;
  }
  .show {
    min-height: 56px;
    padding: 0 32px;
    font-size: 16px;
  }
  .key {
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 400;
    opacity: 0.7;
  }
  .ratings {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .rate {
    flex: 1 1 120px;
    min-height: 60px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border: 1px solid var(--line-strong);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
    font: 700 16px var(--font);
    cursor: pointer;
  }
  .rate:hover {
    border-color: var(--muted);
  }
  .rate span {
    font: 400 12px var(--mono);
    color: var(--muted);
  }
  .rate.good {
    border-color: var(--accent);
    color: var(--accent);
  }
  .hint {
    font-size: 13px;
    text-align: center;
    margin: 0;
  }
  .finished {
    display: flex;
    flex-direction: column;
    gap: 14px;
    align-items: flex-start;
  }
  .finished h1 {
    font-size: 40px;
  }
  .finished p {
    margin: 0;
    font-size: 18px;
    max-width: 560px;
  }
  .actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 8px;
  }
  @media (max-width: 640px) {
    header {
      padding: 10px 16px;
    }
    main {
      padding: 16px 16px 40px;
    }
    .card {
      padding: 28px 22px;
    }
  }
</style>
