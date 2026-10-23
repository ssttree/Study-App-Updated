<script lang="ts">
  import MathText from '../components/MathText.svelte';
  import { deleteCard, getCard, listCards, listDecks, saveCard } from '../lib/db';
  import { blankCard, effectiveTyping, parseTags } from '../lib/cards';
  import { prettyChem } from '../lib/answers';
  import { imageToDataUrl } from '../lib/images';
  import { renderMarkdown } from '../lib/markdown';
  import { go, href } from '../lib/router.svelte';
  import type { Card, Deck } from '../lib/types';

  let { cardId, deckId }: { cardId?: string; deckId?: string } = $props();

  let decks = $state<Deck[]>([]);
  let card = $state<Card | null | undefined>(undefined);
  let tagText = $state('');
  let topicsInDeck = $state<string[]>([]);
  let savedNote = $state('');
  let frontInput = $state<HTMLTextAreaElement | null>(null);

  const isNew = $derived(!cardId);

  async function init() {
    decks = await listDecks();
    if (cardId) {
      const found = await getCard(cardId);
      card = found ?? null;
      tagText = found ? found.tags.map((t) => `#${t}`).join(' ') : '';
    } else {
      const target = decks.find((d) => d.id === deckId) ?? decks[0];
      card = target ? blankCard(target.id) : null;
    }
    await loadTopics();
  }
  init();

  async function loadTopics() {
    if (!card) return;
    const cards = await listCards(card.deckId);
    topicsInDeck = [...new Set(cards.map((c) => c.topic).filter(Boolean))].sort();
  }

  const frontErrors = $derived(card ? renderMarkdown(card.front).errors : []);
  const backErrors = $derived(card ? renderMarkdown(card.back).errors : []);
  const deck = $derived(card ? decks.find((d) => d.id === card!.deckId) : undefined);
  const canSave = $derived(!!card && (card.front.trim() !== '' || !!card.image) && card.back.trim() !== '');

  async function save(addAnother: boolean) {
    if (!card || !canSave) return;
    const toSave: Card = {
      ...$state.snapshot(card),
      tags: parseTags(tagText),
      topic: card.topic.trim(),
      answer: card.answer?.trim() || undefined,
    };
    await saveCard(toSave);
    if (addAnother) {
      // Keep deck, topic, tags and settings for the next card, clear the text.
      const next = blankCard(toSave.deckId);
      card = { ...next, topic: toSave.topic, tags: toSave.tags, type: toSave.type, typing: toSave.typing };
      savedNote = 'Saved. Next card:';
      await loadTopics();
      frontInput?.focus();
    } else {
      go('decks', toSave.deckId);
    }
  }

  async function remove() {
    if (!card || isNew) return;
    if (!confirm('Delete this card and its review history?')) return;
    await deleteCard(card.id);
    go('decks', card.deckId);
  }

  async function pickImage(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !card) return;
    card.image = await imageToDataUrl(file);
    input.value = '';
  }

  function onkeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      save(isNew);
    }
  }
</script>

<svelte:window {onkeydown} />

<main class="page wide">
  {#if card === null}
    {#if decks.length === 0}
      <h1>Make a deck first</h1>
      <p><a href={href('decks')}>Go to decks</a></p>
    {:else}
      <h1>Card not found</h1>
      <p><a href={href('decks')}>Back to decks</a></p>
    {/if}
  {:else if card}
    <section class="head">
      <div>
        <a class="back" href={href('decks', card.deckId)}>← {deck?.name ?? 'Deck'}</a>
        <h1>{isNew ? 'New card' : 'Edit card'}</h1>
        {#if savedNote && isNew}<p class="saved mono">{savedNote}</p>{/if}
      </div>
    </section>

    <section class="meta-grid">
      <label class="field">
        Deck
        <select bind:value={card.deckId} onchange={loadTopics}>
          {#each decks as d (d.id)}<option value={d.id}>{d.subject} · {d.name}</option>{/each}
        </select>
      </label>
      <label class="field">
        Topic
        <input type="text" bind:value={card.topic} list="topic-list" placeholder="e.g. Equilibrium constant" />
        <datalist id="topic-list">
          {#each topicsInDeck as t (t)}<option value={t}></option>{/each}
        </datalist>
      </label>
      <label class="field">
        Tags
        <input type="text" bind:value={tagText} placeholder="#exam #formula" />
      </label>
      <label class="field">
        Card type
        <select bind:value={card.type}>
          <option value="basic">Basic (front to back)</option>
          <option value="reversed">Both ways</option>
        </select>
      </label>
      <label class="field">
        Typing the answer
        <select bind:value={card.typing}>
          <option value="deck">Use deck setting ({deck?.typingDefault ?? 'off'})</option>
          <option value="off">Off: flip and answer in your head</option>
          <option value="always">Always: type before the answer shows</option>
          <option value="optional">Optional: switch on or off while reviewing</option>
        </select>
      </label>
    </section>

    <section class="sides">
      <div class="side">
        <label class="field">
          Front (question)
          <textarea bind:this={frontInput} bind:value={card.front} rows="6" placeholder={'What is $\\frac{d}{dx} \\sin x$?'}></textarea>
        </label>
        <div class="preview panel">
          <div class="eyebrow">Preview</div>
          {#if card.image}<img class="card-image" src={card.image} alt="" />{/if}
          <MathText text={card.front || '*Nothing yet*'} />
          {#each frontErrors as err (err.tex)}
            <p class="err">Maths error in <code>{err.tex}</code>: {err.message}</p>
          {/each}
        </div>
        <div class="image-row">
          <label class="btn small">
            {card.image ? 'Change picture' : 'Add picture'}
            <input class="sr-only" type="file" accept="image/*" onchange={pickImage} />
          </label>
          {#if card.image}
            <button class="btn small" onclick={() => card && (card.image = undefined)}>Remove picture</button>
          {/if}
        </div>
      </div>
      <div class="side">
        <label class="field">
          Back (answer)
          <textarea bind:value={card.back} rows="6" placeholder={'$$\\cos x$$'}></textarea>
        </label>
        <div class="preview panel">
          <div class="eyebrow">Preview</div>
          <div class="answer"><MathText text={card.back || '*Nothing yet*'} /></div>
          {#each backErrors as err (err.tex)}
            <p class="err">Maths error in <code>{err.tex}</code>: {err.message}</p>
          {/each}
        </div>
      </div>
    </section>

    {#if effectiveTyping(card, deck) !== 'off'}
      <section class="answer-field">
        <label class="field">
          Answer to check when typing (optional)
          <input type="text" bind:value={card.answer} placeholder="e.g. barium, calcium   or   N2 + 3H2 <=> 2NH3" />
        </label>
        <p class="help muted">
          Write it the way you would type it. Lists are marked right in any order, chemistry can be plain (N2, H2O,
          &lt;=&gt;, -&gt;), capitals only matter in formulas. Put <code>|</code> between other answers you would
          accept. Leave it empty to check against the first line of the back.
        </p>
        {#if card.answer?.trim()}
          <p class="answer-preview">Shows as <span>{@html prettyChem(card.answer.split('|')[0])}</span></p>
        {/if}
      </section>
    {/if}

    <p class="help muted">
      Write maths like Obsidian: <code>$x^2$</code> inside a sentence, <code>$$\int_0^1 x\,dx$$</code> on its own
      line. Chemistry works with <code>$\ce{'{'}2H2 + O2 -> 2H2O{'}'}$</code>. Use <code>\$</code> for a dollar
      sign. Ctrl+Enter saves.
    </p>

    <section class="buttons">
      {#if isNew}
        <button class="btn primary" onclick={() => save(true)} disabled={!canSave}>Save and add another</button>
        <button class="btn" onclick={() => save(false)} disabled={!canSave}>Save and close</button>
      {:else}
        <button class="btn primary" onclick={() => save(false)} disabled={!canSave}>Save</button>
        <a class="btn" href={href('decks', card.deckId)}>Cancel</a>
        <button class="btn danger" onclick={remove}>Delete card</button>
      {/if}
    </section>
  {/if}
</main>

<style>
  .back {
    display: inline-flex;
    min-height: 36px;
    align-items: center;
    text-decoration: none;
    font-size: 15px;
    margin-bottom: 8px;
  }
  h1 {
    font-size: 36px;
  }
  .saved {
    color: var(--good);
    font-size: 13px;
    margin: 8px 0 0;
  }
  .meta-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
  }
  .sides {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 24px;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .preview {
    padding: 20px 24px;
    min-height: 140px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    text-align: center;
  }
  .preview .eyebrow {
    font-size: 11px;
    text-align: left;
  }
  .answer {
    color: var(--answer);
  }
  .card-image {
    max-width: 100%;
    max-height: 260px;
    object-fit: contain;
    border-radius: 8px;
    align-self: center;
  }
  .image-row {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .err {
    margin: 0;
    color: var(--warn);
    font-size: 14px;
    text-align: left;
  }
  .help {
    font-size: 14px;
    margin: 0;
  }
  .help code {
    font-family: var(--mono);
    background: var(--surface-2);
    padding: 1px 5px;
    border-radius: 4px;
    color: var(--text);
  }
  .answer-field {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .answer-preview {
    margin: 0;
    font-size: 14px;
    color: var(--muted);
  }
  .answer-preview span {
    color: var(--answer);
    font-size: 17px;
  }
  .buttons {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .page {
    gap: 28px;
  }
</style>
