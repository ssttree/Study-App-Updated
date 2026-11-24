<script lang="ts">
  import ProblemImage from '../components/ProblemImage.svelte';
  import { getTask, listSkills, saveTask } from '../lib/db';
  import { imageToDataUrl } from '../lib/images';
  import { plural } from '../lib/load';
  import { href } from '../lib/router.svelte';
  import { choiceFor, groupBySkill, pairByOrder, saveProblems, type Picture, type SaveResult } from '../lib/practice/save';
  import SkillTags from '../components/SkillTags.svelte';
  import { SUBJECTS, taskSkillIds, type Skill, type Task } from '../lib/types';
  import { untrack } from 'svelte';

  interface Shot {
    id: number;
    picture: Picture;
  }
  interface QuestionShot extends Shot {
    marks: number;
    label: string;
    /** Skills this question goes into; empty means the test's skill. */
    skills: string[];
  }

  let skills = $state.raw<Skill[]>([]);
  let subject = $state<string>(SUBJECTS[4]);
  let skill = $state('new');
  let name = $state('');
  let testName = $state('');
  let phase = $state<'questions' | 'solutions'>('questions');
  let questions = $state<QuestionShot[]>([]);
  let solutions = $state<Shot[]>([]);
  let error = $state('');
  let saving = $state(false);
  let results = $state.raw<SaveResult[]>([]);
  /** Skills set for every question at once. */
  let allSkills = $state<string[]>([]);
  let nextId = 0;

  listSkills().then((s) => (skills = s));

  /** Homework these questions are for: they get linked to it, like a SmarterEd import. */
  let { taskId }: { taskId?: string } = $props();
  let task = $state.raw<Task | null>(null);
  const forTask = untrack(() => taskId);
  if (forTask)
    getTask(forTask).then((t) => {
      task = t ?? null;
      if (t?.subject) subject = t.subject;
    });

  const subjectSkills = $derived(skills.filter((k) => k.subject === subject));
  const pairs = $derived(pairByOrder(questions, solutions));
  const mainName = $derived(skill === 'new' ? `${name.trim() || 'New skill'} (new)` : (subjectSkills.find((k) => k.id === skill)?.name ?? 'Test skill'));

  async function toPicture(file: File): Promise<Picture> {
    const data = await imageToDataUrl(file);
    const img = new Image();
    img.src = data;
    await img.decode();
    return { data, width: img.naturalWidth, height: img.naturalHeight };
  }

  async function addFiles(files: File[]) {
    error = '';
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) {
      error = 'That was not a picture. Take a screenshot (Windows + Shift + S), then press Ctrl + V here.';
      return;
    }
    for (const file of images) {
      const picture = await toPicture(file);
      if (phase === 'questions') questions.push({ id: nextId++, picture, marks: 2, label: '', skills: [...allSkills] });
      else solutions.push({ id: nextId++, picture });
    }
  }

  $effect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Let text boxes paste text as normal.
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) && !e.clipboardData?.files.length) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      addFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    addFiles(files);
  }

  function move<T>(list: T[], i: number, by: number) {
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
  }

  const ready = $derived(questions.length > 0 && (skill !== 'new' || name.trim().length > 0));

  async function save() {
    if (!ready) return;
    saving = true;
    error = '';
    try {
      const from = testName.trim() || 'ATAR Notes topic test';
      const drafts = pairs.map((p, i) => ({
        skills: p.question.skills,
        question: { ...p.question.picture },
        solution: p.solution ? { ...p.solution.picture } : null,
        label: p.question.label.trim() || `${from} Q${i + 1}`,
        marks: Math.max(1, Math.round(Number(p.question.marks) || 1)),
        mc: false,
        key: `atar:${from}:${i + 1}:${p.question.picture.data.length}`,
      }));
      const choice = skill === 'new' ? ({ kind: 'new', subject, name } as const) : ({ kind: 'existing', id: skill } as const);
      const saved: SaveResult[] = [];
      for (const [target, group] of groupBySkill(drafts)) saved.push(await saveProblems(choiceFor(target, choice, subject), group, 'atarnotes', from));
      results = saved;
      // Homework: link it to the test's skills. An optional one just joins the skill pool.
      if (task) {
        const linked: Task = { ...task, skillIds: [...new Set([...taskSkillIds(task), ...saved.map((r) => r.skill.id)])], skillId: undefined };
        if (!task.required) Object.assign(linked, { status: 'done', finished: Date.now() });
        await saveTask(linked);
        task = linked;
      }
      questions = [];
      solutions = [];
      allSkills = [];
      phase = 'questions';
      skills = await listSkills();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }
</script>

<main class="page wide">
  <section class="head">
    <div class="eyebrow"><a href={href('practice')}>Practice</a> / ATAR Notes</div>
    <h1>Add an ATAR Notes topic test</h1>
    {#if task}<p class="accent">For the homework "{task.title}"</p>{/if}
    <p class="muted">
      Pick the test's skill once and every question you paste joins it. If it covers more than one skill, put each question into as many skills as it fits. Screenshot each
      question with <kbd>Windows</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> and press <kbd>Ctrl</kbd> + <kbd>V</kbd> here.
      Then scroll to the worked solutions and paste them in the same order. The app pairs them up by order.
    </p>
  </section>

  {#if results.length}
    <div class="notice">
      Saved
      {#each results as r, i (r.skill.id)}{i ? (i === results.length - 1 ? ' and ' : ', ') : ''}{plural(r.added, 'question')} to <a href={href('practice', 'skill', r.skill.id)}>{r.skill.name}</a>{/each}.
      {#if task}
        Linked to the homework "{task.title}".
        {#if task.required}<a href={href('practice', 'run', 'task', task.id)}>Do these questions now</a> or
          <a href={href('planner', 'task', task.id)}>go back to the homework</a>.{:else}<a href={href('planner', 'task', task.id)}>Back to the homework</a>.{/if}
      {:else}
        Paste the next test whenever you are ready.
      {/if}
    </div>
  {/if}
  {#if error}<div class="notice warn">{error}</div>{/if}

  <section class="panel fields">
    <label class="field">
      Subject
      <select
        bind:value={subject}
        onchange={() => {
          skill = 'new';
          allSkills = [];
          for (const q of questions) q.skills = [];
        }}
      >
        {#each SUBJECTS as s (s)}<option value={s}>{s}</option>{/each}
      </select>
    </label>
    <label class="field">
      Skill
      <select bind:value={skill}>
        <option value="new">New skill</option>
        {#each subjectSkills as k (k.id)}<option value={k.id}>{k.parentId ? '  ' : ''}{k.name}</option>{/each}
      </select>
    </label>
    {#if skill === 'new'}
      <label class="field">Skill name<input type="text" bind:value={name} placeholder="e.g. Static and dynamic equilibrium" /></label>
    {/if}
    <label class="field">Test name<input type="text" bind:value={testName} placeholder="e.g. Equilibrium Test 1" /></label>
    <div class="all-skills">
      <SkillTags
        skills={subjectSkills.filter((k) => k.id !== skill)}
        value={allSkills}
        onchange={(v) => {
          allSkills = v;
          for (const q of questions) q.skills = [...v];
        }}
        main={mainName}
        label="Every question into"
      />
      <span class="muted small">A test that covers more than one skill? Change each question's skills under it.</span>
    </div>
  </section>

  <div class="phases" role="tablist" aria-label="What you are pasting">
    <button role="tab" class="btn" class:primary={phase === 'questions'} aria-selected={phase === 'questions'} onclick={() => (phase = 'questions')}>
      1. Questions ({questions.length})
    </button>
    <button role="tab" class="btn" class:primary={phase === 'solutions'} aria-selected={phase === 'solutions'} onclick={() => (phase = 'solutions')} disabled={!questions.length}>
      2. Solutions ({solutions.length} of {questions.length})
    </button>
  </div>

  <label class="drop panel">
    <span class="big">Press Ctrl + V to paste {phase === 'questions' ? `question ${questions.length + 1}` : `the solution to question ${Math.min(solutions.length + 1, questions.length)}`}</span>
    <span class="muted">or click to choose screenshot files</span>
    <input class="sr-only" type="file" accept="image/*" multiple onchange={pick} />
  </label>
  {#if phase === 'solutions' && solutions.length > questions.length}
    <div class="notice warn">There are more solutions than questions. Remove the extra one below.</div>
  {/if}

  {#if questions.length}
    <section class="pairs">
      {#each pairs as p, i (p.question.id)}
        <div class="pair">
          <div class="side">
            <div class="side-head">
              <span class="mono small">Q{i + 1}</span>
              <label class="mono small marks"><input type="number" min="1" max="20" bind:value={questions[i].marks} /> marks</label>
              <input class="badge" type="text" bind:value={questions[i].label} placeholder="Source, e.g. NESA 2019 Sample Exam Q2" />
            </div>
            <SkillTags
              skills={subjectSkills.filter((k) => k.id !== skill)}
              value={questions[i].skills}
              onchange={(v) => (questions[i].skills = v)}
              main={mainName}
              label="Q{i + 1} into"
            />
            <ProblemImage src={p.question.picture.data} alt="Question {i + 1}" small />
            <div class="side-actions">
              <button class="btn small" onclick={() => move(questions, i, -1)} disabled={i === 0}>Up</button>
              <button class="btn small" onclick={() => move(questions, i, 1)} disabled={i === questions.length - 1}>Down</button>
              <button class="btn small danger" onclick={() => questions.splice(i, 1)}>Remove</button>
            </div>
          </div>
          <div class="side">
            <div class="side-head"><span class="mono small muted">Worked solution</span></div>
            {#if p.solution}
              {@const j = solutions.indexOf(p.solution)}
              <ProblemImage src={p.solution.picture.data} alt="Solution {i + 1}" small />
              <div class="side-actions">
                <button class="btn small" onclick={() => move(solutions, j, -1)} disabled={j === 0}>Up</button>
                <button class="btn small" onclick={() => move(solutions, j, 1)} disabled={j === solutions.length - 1}>Down</button>
                <button class="btn small danger" onclick={() => solutions.splice(j, 1)}>Remove</button>
              </div>
            {:else}
              <div class="missing">Not pasted yet</div>
            {/if}
          </div>
        </div>
      {/each}
      {#each solutions.slice(questions.length) as extra, k (extra.id)}
        <div class="pair">
          <div class="missing">No question for this solution</div>
          <div class="side">
            <ProblemImage src={extra.picture.data} alt="Extra solution" small />
            <button class="btn small danger" onclick={() => solutions.splice(questions.length + k, 1)}>Remove</button>
          </div>
        </div>
      {/each}
    </section>
  {/if}

  <div class="save-bar">
    <button class="btn primary" onclick={save} disabled={!ready || saving}>
      {saving ? 'Saving...' : `Save ${plural(questions.length, 'question')}`}
    </button>
    {#if questions.length && solutions.length < questions.length}
      <span class="muted small">Questions without a solution are saved without one.</span>
    {/if}
  </div>
</main>

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .head p {
    margin: 0;
    max-width: 700px;
  }
  .eyebrow a {
    color: inherit;
  }
  h1 {
    font-size: 36px;
  }
  kbd {
    font-family: var(--mono);
    font-size: 13px;
    padding: 1px 6px;
    border: 1px solid var(--line-strong);
    border-radius: 6px;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
    padding: 18px;
  }
  .phases {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 40px 24px;
    border-style: dashed;
    border-color: var(--line-strong);
    text-align: center;
    cursor: pointer;
  }
  .big {
    font-size: 20px;
  }
  .small {
    font-size: 13px;
  }
  .pairs {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .pair {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 14px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .side-head {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .marks {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
  }
  .marks input {
    width: 64px;
    min-height: 34px;
    padding: 4px 8px;
  }
  .badge {
    flex: 1 1 200px;
    width: auto;
    min-height: 34px;
    padding: 4px 10px;
    font-size: 14px;
  }
  .side-actions {
    display: flex;
    gap: 8px;
  }
  .missing {
    padding: 24px;
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius);
    color: var(--muted);
    text-align: center;
  }
  .save-bar {
    position: sticky;
    bottom: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    padding: 14px 0;
    background: var(--bg);
    border-top: 1px solid var(--line);
  }
  .all-skills {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    align-items: center;
  }
</style>
