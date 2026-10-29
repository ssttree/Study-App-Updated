<script lang="ts">
  import { go, href } from '../lib/router.svelte';
  import { listMarks, newId, saveMark } from '../lib/db';
  import { shortSubject } from '../lib/practice/load';
  import { plural } from '../lib/load';
  import { markFromRow, parseMarksMarkdown, rankText, type ImportRow } from '../lib/progress/marktext';
  import type { Mark } from '../lib/types';

  const EXAMPLE = `## Chemistry
- Module 1 test, 58/60, rank =5, 14/3/2025
- Depth study, 27/30, rank 2, Term 3

## Maths Extension 1
- Half yearly, 70/80, rank =3`;

  let year = $state(new Date().getFullYear() - 1);
  let text = $state('');
  let fileName = $state('');
  let existing = $state.raw<Mark[]>([]);
  let saving = $state(false);
  let error = $state('');
  listMarks().then((m) => (existing = m));

  const rows = $derived<ImportRow[]>(text ? parseMarksMarkdown(text, Number(year) || new Date().getFullYear() - 1) : []);
  const good = $derived(rows.filter((r): r is Extract<ImportRow, { ok: true }> => r.ok));
  const bad = $derived(rows.filter((r): r is Extract<ImportRow, { ok: false }> => !r.ok));
  const updates = $derived(
    good.filter((r) => existing.some((m) => m.year === 11 && m.subject === r.subject && m.name.toLowerCase() === r.name.toLowerCase())).length,
  );

  async function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    error = '';
    fileName = file.name;
    text = await file.text();
    if (!parseMarksMarkdown(text, Number(year)).length) error = `No marks found in ${file.name}. Check it has marks written like 58/60.`;
  }

  async function save() {
    saving = true;
    try {
      const now = Date.now();
      for (const r of good) await saveMark(markFromRow(r, existing, newId, now));
      go('progress', 'marks');
    } finally {
      saving = false;
    }
  }
</script>

<main class="page">
  <section class="head">
    <a class="mono small back" href={href('progress', 'marks')}>Marks</a>
    <h1>Upload Year 11 marks</h1>
    <p class="muted">
      Put all your Year 11 tasks in one Markdown file: a heading for each subject, then one task per line with its mark
      and rank. A table with Subject, Task, Date, Mark and Rank columns works too. Dates are optional.
    </p>
  </section>

  <section class="panel example">
    <div class="label">Example</div>
    <pre class="mono">{EXAMPLE}</pre>
    <p class="muted small">Write the mark like 58/60. Write the rank like 5, or =5 if you tied.</p>
  </section>

  <div class="pick">
    <label class="btn primary">
      {fileName ? 'Choose another file' : 'Choose a .md file'}
      <input class="sr-only" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" onchange={pick} />
    </label>
    <label class="field year">
      Year 11 was in
      <input type="number" min="2000" max="2100" bind:value={year} />
    </label>
  </div>
  <details>
    <summary class="muted small">Or paste it here</summary>
    <textarea rows="8" bind:value={text} placeholder={EXAMPLE} aria-label="Marks as Markdown"></textarea>
  </details>

  {#if error}<div class="notice warn">{error}</div>{/if}

  {#if rows.length}
    <section>
      <h2>{plural(good.length, 'task')} found{fileName ? ` in ${fileName}` : ''}</h2>
      {#each good as r (r.line)}
        <div class="row">
          <span class="name">{r.name} <span class="muted small">{shortSubject(r.subject)}</span></span>
          <span class="mono small muted">{r.datePlaced ? 'no date' : r.date}</span>
          <span class="mono">{r.mark.mark}/{r.mark.outOf}{r.rank ? ` · rank ${rankText({ rank: r.rank.rank, rankOf: r.rank.rankOf, rankTied: r.rank.tied })}` : ''}</span>
        </div>
      {/each}
      {#if bad.length}
        <h2 class="warn-head">{plural(bad.length, 'line')} couldn't be read</h2>
        {#each bad as r (r.line)}
          <div class="row bad">
            <span class="name mono small">Line {r.line}: {r.text.trim()}</span>
            <span class="small">{r.problem}</span>
          </div>
        {/each}
        <p class="muted small">Fix those lines in the file and choose it again, or save the rest now and add them by hand.</p>
      {/if}
      {#if updates}<p class="muted small">{plural(updates, 'task')} already saved will be updated with these marks.</p>{/if}
      <div class="actions">
        <button class="btn primary" onclick={save} disabled={!good.length || saving}>
          {saving ? 'Saving...' : `Save ${plural(good.length, 'task')}`}
        </button>
        <a class="btn" href={href('progress', 'marks')}>Cancel</a>
      </div>
    </section>
  {/if}
</main>

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .head p {
    margin: 0;
  }
  .back {
    text-decoration: none;
  }
  h1 {
    font-size: 36px;
  }
  h2 {
    font-size: 15px;
    font-weight: 700;
    margin-bottom: 8px;
  }
  .warn-head {
    margin-top: 18px;
    color: var(--warn);
  }
  .example {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .example pre {
    margin: 0;
    font-size: 13px;
    white-space: pre-wrap;
    color: var(--text);
  }
  .example p {
    margin: 0;
  }
  .label {
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .pick {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-items: end;
  }
  .year input {
    width: 110px;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    margin-top: 8px;
    font-family: var(--mono);
    font-size: 13px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    align-items: baseline;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
  }
  .row .name {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .row.bad .small:last-child {
    color: var(--warn);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 16px;
  }
  .small {
    font-size: 13px;
  }
</style>
