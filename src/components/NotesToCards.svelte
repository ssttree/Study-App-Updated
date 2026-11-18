<script lang="ts">
  // Lessons in your Obsidian notes that still need flashcards, read from the
  // notes' GitHub repo by the server. A lesson counts as done once its note
  // says cards-made: true, the same as the Overview notes in Obsidian.
  import { getSyncConfig } from '../lib/db';
  import { plural } from '../lib/load';
  import { href } from '../lib/router.svelte';
  import { api } from '../lib/sync';
  import type { Deck } from '../lib/types';

  let { decks }: { decks: Deck[] } = $props();

  interface Lesson {
    path: string;
    name: string;
    subject: string;
    topic: string;
    cardsMade: boolean;
    toMake: string[];
  }
  interface Notes {
    repo: string;
    lessons: Lesson[];
    read: number;
  }

  const CACHE = 'obsidian-notes';
  let notes = $state.raw<Notes | null>(null);
  let error = $state('');
  let loading = $state(false);
  let noKey = $state(false);

  try {
    const saved = localStorage.getItem(CACHE);
    if (saved) notes = JSON.parse(saved);
  } catch {
    // Nothing saved, or storage is blocked: it loads from the server.
  }

  async function refresh() {
    loading = true;
    error = '';
    try {
      const config = await getSyncConfig();
      if (!config.key) {
        noKey = true;
        return;
      }
      notes = await api<Notes>(config.key, '/api/notes');
      try {
        localStorage.setItem(CACHE, JSON.stringify(notes));
      } catch {
        // Not kept for offline, which is fine.
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }
  refresh();

  const todo = $derived((notes?.lessons ?? []).filter((l) => !l.cardsMade));
  const done = $derived((notes?.lessons ?? []).filter((l) => l.cardsMade).length);
  /** Subject, then topic, keeping the notes' own order. */
  const groups = $derived.by(() => {
    const out: { subject: string; topics: { topic: string; lessons: Lesson[] }[] }[] = [];
    for (const l of todo) {
      let g = out.find((x) => x.subject === l.subject);
      if (!g) out.push((g = { subject: l.subject, topics: [] }));
      let t = g.topics.find((x) => x.topic === l.topic);
      if (!t) g.topics.push((t = { topic: l.topic, lessons: [] }));
      t.lessons.push(l);
    }
    return out;
  });

  /** A deck to add the cards to: one for the subject the notes folder is about. */
  function deckFor(folder: string): Deck | undefined {
    const f = folder.toLowerCase();
    const wants = (subject: string) => {
      const s = subject.toLowerCase();
      if (f.includes('ext 2') || f.includes('extension 2')) return s.includes('extension 2');
      if (f.startsWith('maths')) return s === 'maths advanced' || s.includes('extension 1');
      return s.startsWith(f.split(' ')[0]);
    };
    return decks.find((d) => wants(d.subject));
  }
  const when = (ms: number) => new Date(ms).toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
</script>

<section class="notes">
  <div class="head">
    <h2 class="group">Lessons that need flashcards</h2>
    <button class="btn small" onclick={refresh} disabled={loading}>{loading ? 'Reading notes' : 'Refresh'}</button>
  </div>

  {#if noKey}
    <p class="muted small">
      Connect this device to your server to read your Obsidian notes:
      <a href={href('planner', 'connect')}>Phone and Google</a>.
    </p>
  {/if}
  {#if error && !notes}
    <p class="muted small">{error}</p>
  {:else if notes}
    {#if error}<p class="muted small">Showing the last copy. {error}</p>{/if}
    {#each groups as g (g.subject)}
      <h3>{g.subject}</h3>
      {#each g.topics as t (t.topic)}
        <div class="topic">
          <div class="topic-name muted small">{t.topic}</div>
          {#each t.lessons as l (l.path)}
            {@const deck = deckFor(l.subject)}
            <div class="lesson">
              <span class="dot"></span>
              <span class="what">
                <span>{l.name}</span>
                {#if l.toMake.length}
                  <span class="muted small">To make: {l.toMake.join(' · ')}</span>
                {/if}
              </span>
              <a class="btn small" href={deck ? href('card', 'new', deck.id) : href('decks')}>Make cards</a>
            </div>
          {/each}
        </div>
      {/each}
    {:else}
      <p class="muted small">Every lesson in your notes has flashcards. Nice.</p>
    {/each}
    <p class="muted small foot">
      {plural(todo.length, 'lesson')} to go, {done} done. When a lesson's cards are made, set
      <code>cards-made: true</code> in its note. Read {when(notes.read)}.
    </p>
  {:else if loading && !noKey}
    <p class="muted small">Reading your notes...</p>
  {/if}
</section>

<style>
  .notes {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  h2 {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  h3 {
    font-size: 14px;
    margin: 10px 0 0;
  }
  .topic {
    padding: 6px 0 2px;
  }
  .topic-name {
    margin-bottom: 2px;
  }
  .lesson {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
  }
  .what {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .dot {
    background: var(--warn);
  }
  .small {
    font-size: 13px;
  }
  .foot {
    margin-top: 8px;
  }
</style>
