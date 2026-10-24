<script lang="ts">
  import ProblemImage from '../components/ProblemImage.svelte';
  import { deleteProblem, deleteSkill, moveProblems, saveProblem, saveSkill } from '../lib/db';
  import { loadPractice, relativeDay, type PracticeCollection } from '../lib/practice/load';
  import { newSkill } from '../lib/practice/mix';
  import { plural } from '../lib/load';
  import { go, href } from '../lib/router.svelte';
  import type { Problem, Skill } from '../lib/types';

  let { id }: { id: string } = $props();

  let data = $state.raw<PracticeCollection | null>(null);
  let name = $state('');
  let dotPoint = $state('');
  let selected = $state<string[]>([]);
  let subName = $state('');
  let moveTo = $state('');
  let open = $state<string | null>(null);
  let saved = $state(false);

  async function load() {
    data = await loadPractice();
    const s = data.skills.find((x) => x.id === id);
    name = s?.name ?? '';
    dotPoint = s?.dotPoint ?? '';
  }
  load();

  const skill = $derived(data?.skills.find((s) => s.id === id));
  const parent = $derived(skill?.parentId ? data?.skills.find((s) => s.id === skill.parentId) : undefined);
  const children = $derived(data?.skills.filter((s) => s.parentId === id) ?? []);
  const problems = $derived(data?.problems.filter((p) => p.skillId === id) ?? []);
  // Same subject first, so the skill you want is near the top of the list.
  const targets = $derived(
    (data?.skills.filter((s) => s.id !== id) ?? []).sort(
      (a, b) =>
        Number(b.subject === skill?.subject) - Number(a.subject === skill?.subject) ||
        a.subject.localeCompare(b.subject) ||
        a.name.localeCompare(b.name),
    ),
  );
  const attempts = $derived(data?.attempts.filter((a) => a.skillId === id) ?? []);
  // Some questions easy and some forgotten suggests the worksheet covers more than one method.
  const mixedResults = $derived.by(() => {
    const recent = attempts.filter((a) => Date.now() - a.at < 60 * 86_400_000);
    const again = new Set(recent.filter((a) => a.rating === 1).map((a) => a.problemId));
    const good = new Set(recent.filter((a) => a.rating >= 3).map((a) => a.problemId));
    return recent.length >= 4 && again.size >= 2 && good.size >= 2;
  });

  function status(s: Skill): string {
    if (!s.on) return 'Not in the mix until you tick Taught.';
    if (s.fsrs.state === 0) return 'New: comes up in your next mix.';
    if (s.fsrs.due <= data!.dayEnd) return `Due ${relativeDay(s.fsrs.due, data!.dayEnd)}.`;
    return `Comes back ${relativeDay(s.fsrs.due, data!.dayEnd)}.`;
  }

  async function saveDetails() {
    if (!skill || !name.trim()) return;
    await saveSkill({ ...skill, name: name.trim(), dotPoint: dotPoint.trim() || undefined });
    saved = true;
    setTimeout(() => (saved = false), 1500);
    await load();
  }

  async function toggleOn() {
    if (!skill) return;
    await saveSkill({ ...skill, on: !skill.on });
    await load();
  }

  async function split() {
    if (!skill || !selected.length || !subName.trim()) return;
    const sub = newSkill({ subject: skill.subject, name: subName.trim(), topic: skill.topic, code: skill.code, parentId: skill.id, on: skill.on });
    await saveSkill(sub);
    await moveProblems(selected, sub.id);
    selected = [];
    subName = '';
    await load();
  }

  async function moveSelected() {
    const target = data?.skills.find((s) => s.id === moveTo);
    if (!target || !selected.length) return;
    await moveProblems(selected, target.id);
    selected = [];
    moveTo = '';
    await load();
  }

  function targetName(s: Skill): string {
    const parentSkill = s.parentId ? data?.skills.find((x) => x.id === s.parentId) : undefined;
    return parentSkill ? `${parentSkill.name} / ${s.name}` : s.name;
  }

  async function mergeBack() {
    if (!skill || !parent) return;
    if (!confirm(`Move these questions back into "${parent.name}" and remove this sub-skill?`)) return;
    await moveProblems(
      problems.map((p) => p.id),
      parent.id,
    );
    await deleteSkill(skill.id);
    go('practice', 'skill', parent.id);
  }

  async function removeSkill() {
    if (!skill) return;
    const extra = children.length ? ` and its ${plural(children.length, 'sub-skill')}` : '';
    if (!confirm(`Delete "${skill.name}"${extra}, with ${plural(problems.length, 'question')} and your attempts? This cannot be undone.`)) return;
    await deleteSkill(skill.id);
    go('practice', 'skills');
  }

  async function removeProblem(p: Problem) {
    if (!confirm(`Delete question ${p.label || ''}?`)) return;
    await deleteProblem(p.id);
    await load();
  }

  async function setMarks(p: Problem, value: string) {
    const marks = Math.max(1, Math.min(20, Math.round(Number(value) || 1)));
    await saveProblem({ ...p, marks });
    await load();
  }
</script>

<main class="page wide">
  {#if data && !skill}
    <p>That skill no longer exists. <a href={href('practice', 'skills')}>Back to skills</a></p>
  {:else if data && skill}
    <section class="head">
      <div class="eyebrow">
        <a href={href('practice')}>Practice</a> / <a href={href('practice', 'skills', skill.subject)}>{skill.subject}</a>
        {#if parent}/ <a href={href('practice', 'skill', parent.id)}>{parent.name}</a>{/if}
      </div>
      <h1>{skill.name}</h1>
      <p class="muted">{skill.topic}{skill.topic ? ' · ' : ''}{plural(problems.length, 'question')} · {plural(attempts.length, 'attempt')}. {status(skill)}</p>
      <div class="actions">
        {#if problems.length}
          <a class="btn primary" href={href('practice', 'run', 'skill', skill.id)}>Practise this skill now</a>
        {/if}
        <button class="btn" onclick={toggleOn}>{skill.on ? 'Mark as not taught yet' : 'Mark as taught'}</button>
      </div>
    </section>

    {#if mixedResults && !skill.parentId}
      <div class="notice">
        Some questions here feel easy and others keep catching you out. That usually means this worksheet covers more
        than one method. Tick the questions that use one method below and make them a sub-skill, so each method gets
        its own schedule.
      </div>
    {/if}

    <section class="panel details">
      <label class="field">Name<input type="text" bind:value={name} /></label>
      <label class="field">Syllabus dot point (optional)<input type="text" bind:value={dotPoint} placeholder="e.g. ME-F2.1" /></label>
      <div class="save">
        <button class="btn small" onclick={saveDetails}>Save</button>
        {#if saved}<span class="muted small">Saved</span>{/if}
      </div>
    </section>

    {#if children.length}
      <section>
        <h2>Sub-skills</h2>
        {#each children as c (c.id)}
          <div class="row">
            <a href={href('practice', 'skill', c.id)}>{c.name}</a>
            <span class="mono muted small">{plural(data.problems.filter((p) => p.skillId === c.id).length, 'question')}</span>
          </div>
        {/each}
      </section>
    {/if}

    <section>
      <div class="section-head">
        <h2>Questions</h2>
        <span class="muted small">
          Tick questions to move them to another skill{skill.parentId ? '' : ' or split them into a sub-skill'}.
        </span>
      </div>
      {#if selected.length}
        <div class="split panel">
          <span>{plural(selected.length, 'question')} ticked.</span>
          <button class="btn small" onclick={() => (selected = [])}>Clear</button>
          <div class="split-row">
            <label class="sr-only" for="move-to">Move to skill</label>
            <select id="move-to" bind:value={moveTo}>
              <option value="">Move to another skill...</option>
              {#each targets as t (t.id)}
                <option value={t.id}>{t.subject === skill.subject ? '' : `${t.subject}: `}{targetName(t)}</option>
              {/each}
            </select>
            <button class="btn small primary" onclick={moveSelected} disabled={!moveTo}>Move</button>
          </div>
          {#if !skill.parentId}
            <div class="split-row">
              <input type="text" bind:value={subName} placeholder="Or make a sub-skill, e.g. Absolute value graphs" />
              <button class="btn small primary" onclick={split} disabled={!subName.trim()}>Make sub-skill</button>
            </div>
          {/if}
        </div>
      {/if}
      <div class="grid">
        {#each problems as p (p.id)}
          <article class="q">
            <div class="q-head">
              <label class="tick">
                <input type="checkbox" value={p.id} bind:group={selected} />
                <span class="sr-only">Tick {p.label}</span>
              </label>
              <span class="mono small">{p.label || 'Question'}</span>
              <span class="mono muted small grow">
                {p.mc ? 'MC' : ''}{p.mc && p.answerLetter ? ' ' + p.answerLetter : ''}
              </span>
              <label class="marks mono small">
                <input type="number" min="1" max="20" value={p.marks} onchange={(e) => setMarks(p, e.currentTarget.value)} />
                marks
              </label>
            </div>
            <ProblemImage id={p.questionImage} alt="Question {p.label}" small />
            <div class="q-actions">
              {#if p.solutionImage}
                <button class="btn small" onclick={() => (open = open === p.id ? null : p.id)}>
                  {open === p.id ? 'Hide solution' : 'Show solution'}
                </button>
              {:else}
                <span class="muted small">No worked solution</span>
              {/if}
              <button class="btn small danger" onclick={() => removeProblem(p)}>Delete</button>
            </div>
            {#if open === p.id && p.solutionImage}
              <ProblemImage id={p.solutionImage} alt="Worked solution {p.label}" small />
            {/if}
          </article>
        {/each}
      </div>
    </section>

    <section class="danger-zone">
      {#if parent}
        <button class="btn" onclick={mergeBack}>Merge back into {parent.name}</button>
      {/if}
      <button class="btn danger" onclick={removeSkill}>Delete skill</button>
    </section>
  {/if}
</main>

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .head p {
    margin: 0;
  }
  .eyebrow a {
    color: inherit;
  }
  h1 {
    font-size: 36px;
  }
  h2 {
    font-size: 15px;
    font-weight: 700;
  }
  .actions,
  .danger-zone {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .details {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 14px;
    padding: 18px;
    align-items: end;
  }
  .save {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .section-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 12px;
  }
  .split {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    padding: 12px 14px;
    margin-bottom: 14px;
    position: sticky;
    top: 8px;
    z-index: 2;
  }
  .split-row {
    display: flex;
    flex: 1 1 100%;
    gap: 10px;
    align-items: center;
  }
  .split-row input,
  .split-row select {
    flex: 1 1 240px;
    width: auto;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 16px;
  }
  .q {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .q-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .grow {
    flex: 1;
  }
  .tick {
    display: inline-flex;
    min-width: 32px;
    min-height: 32px;
    align-items: center;
    justify-content: center;
  }
  .tick input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
  .marks {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    color: var(--muted);
  }
  .marks input {
    width: 64px;
    min-height: 36px;
    padding: 4px 8px;
  }
  .q-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  }
  .small {
    font-size: 13px;
  }
</style>
