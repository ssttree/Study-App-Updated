<script lang="ts">
  import MathText from '../components/MathText.svelte';
  import { listDecks } from '../lib/db';
  import { plural } from '../lib/load';
  import { renderMarkdown } from '../lib/markdown';
  import { href } from '../lib/router.svelte';
  import { SUBJECTS, type Deck } from '../lib/types';
  import type { DraftCard } from '../lib/anki/convert';
  import type { DeckGroup } from '../lib/anki/convert';
  import type { Destination, GroupChoice, ImportResult, OpenedDeckFile } from '../lib/anki/import';

  type Step = 'pick' | 'reading' | 'preview' | 'saving' | 'done';

  let step = $state<Step>('pick');
  let error = $state('');
  let dragging = $state(false);
  let opened = $state.raw<OpenedDeckFile | null>(null);
  // What to do with each Anki deck. The cards themselves stay outside $state,
  // since a big deck would make every keystroke slow.
  let picks = $state<{ include: boolean; destination: Destination }[]>([]);
  let defaults: Destination[] = [];
  const groups = $derived<DeckGroup[]>(opened?.plan.groups ?? []);
  const choices = $derived(groups.map((group, i) => ({ group, include: picks[i]?.include ?? false })));
  let decks = $state.raw<Deck[]>([]);
  let progress = $state('');
  let result = $state.raw<ImportResult | null>(null);

  // The importer pulls in SQLite, so it only loads once a file is picked.
  const importer = () => import('../lib/anki/import');

  listDecks().then((d) => (decks = d));

  async function open(file: File | undefined) {
    if (!file) return;
    error = '';
    if (!/\.(apkg|colpkg)$/i.test(file.name)) {
      error = 'That is not an Anki deck file. In Anki, use File, Export, choose "Anki Deck Package (.apkg)", then pick that file here.';
      return;
    }
    step = 'reading';
    try {
      const lib = await importer();
      const o = await lib.openDeckFile(file);
      const start = o.plan.groups.map((g) => lib.defaultChoice(g));
      defaults = start.map((c) => c.destination);
      picks = start.map((c) => ({ include: c.include, destination: c.destination }));
      opened = o;
      step = 'preview';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      step = 'pick';
    }
  }

  function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    open(file);
  }

  function drop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    open(e.dataTransfer?.files[0]);
  }

  const included = $derived(choices.filter((c) => c.include));
  const cardCount = $derived(included.reduce((n, c) => n + c.group.cards.length, 0));
  const totalFound = $derived(choices.reduce((n, c) => n + c.group.cards.length, 0));

  // Cards whose maths KaTeX cannot draw, so they can be fixed after importing.
  const mathProblems = $derived.by(() => {
    const out: { card: DraftCard; deck: string; message: string }[] = [];
    for (const c of included) {
      for (const card of c.group.cards) {
        const errors = [...renderMarkdown(card.front).errors, ...renderMarkdown(card.back).errors];
        if (errors.length) out.push({ card, deck: c.group.path, message: errors[0].message });
      }
    }
    return out;
  });

  const samples = $derived(included.flatMap((c) => c.group.cards.slice(0, 2)).slice(0, 4));

  function previewText(text: string): string {
    // Pictures are shown as a small label in the preview; they are copied in when importing.
    return text.replace(/!\[\]\(anki-media:([^)]*)\)/g, (_, n: string) => `*(picture: ${decodeURIComponent(n)})*`);
  }

  function setDestination(i: number, value: string) {
    picks[i].destination = value === 'new' ? { ...defaults[i] } : { kind: 'existing', deckId: value };
  }

  async function runIt() {
    if (!opened || cardCount === 0) return;
    step = 'saving';
    error = '';
    try {
      const lib = await importer();
      const chosen: GroupChoice[] = groups.map((group, i) => ({ group, ...$state.snapshot(picks[i]) }));
      result = await lib.runImport(opened, chosen, decks, (t) => (progress = t));
      step = 'done';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      step = 'preview';
    }
  }

  function reset() {
    opened = null;
    picks = [];
    result = null;
    error = '';
    step = 'pick';
    listDecks().then((d) => (decks = d));
  }
</script>

<main class="page">
  <section>
    <div class="eyebrow"><a class="crumb" href={href('decks')}>Cards</a> · Import</div>
    <h1>Import from Anki</h1>
  </section>

  {#if error}<p class="notice warn" role="alert">{error}</p>{/if}

  {#if step === 'pick' || step === 'reading'}
    <section
      class="drop panel"
      class:dragging
      aria-label="Choose an Anki deck file"
      ondragover={(e) => {
        e.preventDefault();
        dragging = true;
      }}
      ondragleave={() => (dragging = false)}
      ondrop={drop}
    >
      {#if step === 'reading'}
        <p class="big">Reading the deck...</p>
        <p class="muted">Big decks with lots of pictures can take a few seconds.</p>
      {:else}
        <p class="big">Drop an Anki deck here</p>
        <p class="muted">or</p>
        <label class="btn primary">
          Choose an .apkg file
          <input class="sr-only" type="file" accept=".apkg,.colpkg" onchange={pick} />
        </label>
      {/if}
    </section>

    <section class="how">
      <h2>Getting a deck out of Anki</h2>
      <ol class="muted">
        <li>In Anki, click the gear next to the deck and choose <strong>Export</strong>.</li>
        <li>Pick <strong>Anki Deck Package (.apkg)</strong>. Untick scheduling information, it is not used.</li>
        <li>Tick <strong>Include media</strong> so pictures come across, then save the file and choose it here.</li>
      </ol>
      <p class="muted">
        Imported cards start as new, and FSRS learns them from scratch as you review. Maths written as
        <code>\(...\)</code> and <code>\[...\]</code> is changed to <code>$...$</code> and <code>$$...$$</code>.
        Importing the same deck again skips cards that are already here.
      </p>
    </section>
  {:else if step === 'preview' && opened}
    <section class="summary">
      <p class="lead">
        <span class="mono muted">{opened.fileName}</span><br />
        {#if totalFound > 0}
          Found {plural(totalFound, 'card')} in {plural(choices.length, 'deck')}.
        {:else}
          There are no new cards to bring in from this file.
        {/if}
      </p>
      {#if opened.plan.alreadyImported || opened.plan.audioRemoved || opened.plan.skipped.length || opened.plan.missingImages.length}
        <ul class="notes muted">
          {#if opened.plan.alreadyImported}
            <li>{plural(opened.plan.alreadyImported, 'card')} already imported before, left out.</li>
          {/if}
          {#each opened.plan.skipped as s (s.reason)}
            <li>{s.reason}: {plural(s.count, 'note')} left out.</li>
          {/each}
          {#if opened.plan.audioRemoved}
            <li>{plural(opened.plan.audioRemoved, 'card')} had sound, which the app cannot play yet, so the sound was removed.</li>
          {/if}
          {#if opened.plan.missingImages.length}
            <li>
              {plural(opened.plan.missingImages.length, 'picture')} missing from the file. Export again with
              Include media ticked to bring them across.
            </li>
          {/if}
        </ul>
      {/if}
    </section>

    {#if choices.length > 0}
      <section class="groups">
        <h2>Where the cards go</h2>
        {#each picks as pick, i (groups[i].ankiDeckId)}
          <div class="group panel" class:off={!pick.include}>
            <label class="include">
              <input type="checkbox" bind:checked={pick.include} />
              <span class="path mono">{groups[i].path.replaceAll('::', ' › ')}</span>
              <span class="count mono muted">{plural(groups[i].cards.length, 'card')}</span>
            </label>
            {#if pick.include}
              <div class="dest">
                <label class="field">
                  Add to
                  <select
                    value={pick.destination.kind === 'new' ? 'new' : pick.destination.deckId}
                    onchange={(e) => setDestination(i, (e.currentTarget as HTMLSelectElement).value)}
                  >
                    <option value="new">A new deck</option>
                    {#each decks as d (d.id)}
                      <option value={d.id}>{d.subject} · {d.name}</option>
                    {/each}
                  </select>
                </label>
                {#if pick.destination.kind === 'new'}
                  <label class="field">
                    Deck name
                    <input type="text" bind:value={pick.destination.name} />
                  </label>
                  <label class="field">
                    Subject
                    <input type="text" bind:value={pick.destination.subject} list="import-subjects" />
                  </label>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
        <datalist id="import-subjects">
          {#each SUBJECTS as s (s)}<option value={s}></option>{/each}
        </datalist>
      </section>

      {#if samples.length}
        <section class="samples">
          <h2>A few cards, as they will look</h2>
          <div class="sample-grid">
            {#each samples as card (card.source)}
              <article class="sample panel">
                <div class="side">
                  <span class="eyebrow">Front{card.type === 'reversed' ? ' · both ways' : ''}{card.typing === 'always' ? ' · type answer' : ''}</span>
                  {#if card.frontImage}<p class="muted pic">(picture: {card.frontImage})</p>{/if}
                  <MathText text={previewText(card.front)} />
                </div>
                <div class="side back">
                  <span class="eyebrow">Back</span>
                  <MathText text={previewText(card.back)} />
                </div>
              </article>
            {/each}
          </div>
        </section>
      {/if}

      {#if mathProblems.length}
        <section class="notice warn">
          <p>
            {plural(mathProblems.length, 'card')} {mathProblems.length === 1 ? 'has' : 'have'} maths the app cannot draw.
            They will still import, with the problem underlined in orange so you can fix it in the card editor.
          </p>
          <ul class="problems">
            {#each mathProblems.slice(0, 5) as p (p.card.source)}
              <li><span class="mono">{p.card.front.slice(0, 60)}</span> <span class="muted">· {p.message}</span></li>
            {/each}
          </ul>
        </section>
      {/if}

      <section class="go">
        <button class="btn primary" disabled={cardCount === 0} onclick={runIt}>
          Import {plural(cardCount, 'card')}
        </button>
        <button class="btn" onclick={reset}>Choose a different file</button>
      </section>
    {:else}
      <section class="go"><button class="btn" onclick={reset}>Choose a different file</button></section>
    {/if}
  {:else if step === 'saving'}
    <section class="drop panel">
      <p class="big">Importing...</p>
      <p class="muted mono">{progress}</p>
    </section>
  {:else if step === 'done' && result}
    <section class="done">
      <p class="lead">Imported {plural(result.cards, 'card')}.</p>
      <p class="muted">They start as new cards, so they come up in your daily new cards a few at a time.</p>
      {#each result.decks as d (d.id)}
        <div class="row">
          <span class="dot" style:background="var(--info)"></span>
          <a class="deck-name" href={href('decks', d.id)}>{d.name}</a>
          <span class="mono muted small">{plural(d.added, 'card')} added</span>
        </div>
      {/each}
      <div class="go">
        <a class="btn primary" href={href('decks')}>Back to decks</a>
        <button class="btn" onclick={reset}>Import another deck</button>
      </div>
    </section>
  {/if}
</main>

<style>
  h1 {
    font-size: 40px;
    margin-top: 8px;
  }
  h2 {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .crumb {
    color: var(--muted);
    text-decoration: none;
  }
  .crumb:hover {
    color: var(--text);
  }
  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 56px 24px;
    border-style: dashed;
    border-color: var(--line-strong);
    text-align: center;
  }
  .drop.dragging {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, var(--surface));
  }
  .drop p {
    margin: 0;
  }
  .big {
    font-size: 22px;
  }
  .how {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .how ol {
    margin: 0;
    padding-left: 1.3em;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .how strong {
    color: var(--text);
  }
  .how p {
    margin: 0;
    font-size: 15px;
  }
  .summary {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .lead {
    font-size: 22px;
    margin: 0;
  }
  .lead .mono {
    font-size: 14px;
  }
  .notes {
    margin: 0;
    padding-left: 1.2em;
    font-size: 15px;
  }
  .groups,
  .samples {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .group {
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .group.off {
    opacity: 0.6;
  }
  .include {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    min-height: 36px;
    cursor: pointer;
  }
  .include input {
    accent-color: var(--accent);
    width: 18px;
    height: 18px;
  }
  .path {
    flex: 1 1 240px;
    font-size: 15px;
  }
  .count {
    font-size: 13px;
  }
  .dest {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
  }
  .sample-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 12px;
  }
  .sample {
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .side :global(.card-text) {
    font-size: 17px;
  }
  .back {
    border-top: 1px solid var(--line);
    padding-top: 12px;
  }
  .back :global(.card-text) {
    color: var(--answer);
  }
  .pic {
    margin: 0;
    font-size: 14px;
  }
  .problems {
    margin: 8px 0 0;
    padding-left: 1.2em;
    font-size: 14px;
  }
  .notice p {
    margin: 0;
  }
  .go {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .done {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .done p {
    margin: 0;
  }
  .deck-name {
    flex: 1 1 260px;
    color: var(--text);
    text-decoration: none;
    font-size: 17px;
  }
  .deck-name:hover {
    color: var(--accent);
  }
  .small {
    font-size: 13px;
  }
</style>
