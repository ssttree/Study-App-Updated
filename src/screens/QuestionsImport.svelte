<script lang="ts">
  // Imports a questions file: typed questions and answers that Claude pulled
  // out of documents you uploaded in chat. See lib/practice/qfile.ts for the format.
  import MathText from '../components/MathText.svelte';
  import { listSkills } from '../lib/db';
  import { plural } from '../lib/load';
  import { href } from '../lib/router.svelte';
  import { parseQuestionsFile, type QFile } from '../lib/practice/qfile';
  import { findSkill, saveProblems, type SaveResult } from '../lib/practice/save';
  import { SUBJECTS, type Skill } from '../lib/types';

  let text = $state('');
  let fileName = $state('');
  let skills = $state.raw<Skill[]>([]);
  let parsed = $state<QFile | null>(null);
  let saving = $state(false);
  let error = $state('');
  let results = $state.raw<SaveResult[]>([]);

  listSkills().then((s) => (skills = s));

  function read() {
    results = [];
    error = '';
    parsed = text.trim() ? parseQuestionsFile(text) : null;
  }

  async function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    fileName = file.name.replace(/\.(md|markdown|txt)$/i, '');
    text = await file.text();
    read();
  }

  const total = $derived(parsed ? parsed.skills.reduce((n, s) => n + s.questions.length, 0) : 0);
  const ready = $derived(!!parsed && parsed.skills.length > 0 && parsed.skills.every((s) => s.subject && s.name.trim()));

  async function importAll() {
    if (!parsed || !ready || saving) return;
    saving = true;
    error = '';
    const done: SaveResult[] = [];
    try {
      const from = parsed.from || fileName || 'Questions file';
      for (const s of parsed.skills) {
        const existing = findSkill(skills, s.subject, s.name);
        const choice = existing ? ({ kind: 'existing', id: existing.id } as const) : ({ kind: 'new', subject: s.subject, name: s.name.trim(), topic: s.topic } as const);
        done.push(await saveProblems(choice, $state.snapshot(s.questions), 'typed', from));
        skills = await listSkills();
      }
      results = done;
      parsed = null;
      text = '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      results = done;
    } finally {
      saving = false;
    }
  }
</script>

<main class="page">
  <section class="hero">
    <div class="eyebrow"><a href={href('practice')}>Practice</a> / Questions file</div>
    <h1>Import a questions file</h1>
    <p class="lead muted">
      Upload past papers, worksheets or handouts to Claude in chat and ask for a questions file. Claude sorts them into
      skills with each question and its answer. Pick the file here and every question joins problem practice as a typed
      question. Questions already in the app are skipped.
    </p>
  </section>

  <section class="panel pick">
    <label class="btn primary file">
      Choose file
      <input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" onchange={pick} />
    </label>
    <span class="muted small">{fileName ? `${fileName} loaded` : 'or paste it below'}</span>
    <label class="sr-only" for="qfile-text">Questions file</label>
    <textarea id="qfile-text" rows="6" bind:value={text} oninput={read} placeholder={'## Skill name\nsubject: Chemistry\n\n### Q1 · 3 marks\nQuestion\n\n#### Answer\nAnswer'}></textarea>
  </section>

  {#if results.length}
    <div class="notice">
      Added {plural(results.reduce((n, r) => n + r.added, 0), 'question')}
      {#if results.some((r) => r.skipped)}(skipped {results.reduce((n, r) => n + r.skipped, 0)} already in the app){/if}.
      {#each results as r (r.skill.id)}
        <a href={href('practice', 'skill', r.skill.id)}>{r.skill.name}</a>{' '}
      {/each}
    </div>
  {/if}
  {#if error}<div class="notice warn">{error}</div>{/if}

  {#if parsed}
    {#each parsed.problems as p (p)}<div class="notice warn">{p}</div>{/each}
    {#if parsed.skills.length}
      <section>
        <div class="section-head">
          <h2>{plural(total, 'question')} in {plural(parsed.skills.length, 'skill')}</h2>
          {#if parsed.from}<span class="muted small">from {parsed.from}</span>{/if}
        </div>
        {#each parsed.skills as s, i (i)}
          {@const existing = s.subject ? findSkill(skills, s.subject, s.name) : undefined}
          <div class="skill">
            <div class="skill-head">
              <input type="text" bind:value={s.name} aria-label="Skill name" />
              <select bind:value={s.subject} aria-label="Subject">
                <option value="">Pick a subject</option>
                {#each SUBJECTS as sub (sub)}<option value={sub}>{sub}</option>{/each}
              </select>
            </div>
            <p class="muted small">
              {plural(s.questions.length, 'question')} · {existing ? 'adds to your existing skill' : 'new skill'}{s.topic ? ` · ${s.topic}` : ''}
            </p>
            <details>
              <summary class="small">Check the questions</summary>
              {#each s.questions as q, n (n)}
                <div class="q">
                  <div class="mono small muted">{q.label || `Question ${n + 1}`} · {plural(q.marks, 'mark')}{q.mc ? ' · MC' : ''}</div>
                  <MathText text={q.questionText ?? ''} />
                  {#if q.solutionText}
                    <div class="answer"><MathText text={q.solutionText} /></div>
                  {/if}
                </div>
              {/each}
            </details>
          </div>
        {/each}
        <div class="actions">
          <button class="btn primary" onclick={importAll} disabled={!ready || saving}>
            {saving ? 'Importing' : `Import ${plural(total, 'question')}`}
          </button>
          {#if !ready}<span class="muted small">Every skill needs a name and a subject.</span>{/if}
        </div>
      </section>
    {/if}
  {/if}
</main>

<style>
  .hero {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .lead {
    margin: 0;
    font-size: 17px;
  }
  .pick {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    padding: 16px;
  }
  .pick textarea {
    width: 100%;
  }
  .file input {
    display: none;
  }
  .section-head {
    display: flex;
    gap: 12px;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  h2 {
    font-size: 15px;
    font-weight: 700;
  }
  .skill {
    border-top: 1px solid var(--line);
    padding: 14px 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .skill p {
    margin: 0;
  }
  .skill-head {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .skill-head input {
    flex: 1 1 240px;
  }
  .skill-head select {
    flex: 0 1 220px;
  }
  details summary {
    cursor: pointer;
    color: var(--muted);
  }
  .q {
    border-left: 2px solid var(--line-strong);
    padding: 8px 0 8px 14px;
    margin: 10px 0;
  }
  .answer {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed var(--line);
    color: var(--muted);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    margin-top: 12px;
  }
  .small {
    font-size: 13px;
  }
</style>
