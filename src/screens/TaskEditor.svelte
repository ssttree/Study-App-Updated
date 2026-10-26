<script lang="ts">
  import { deleteImage, deleteTask, getImage, getSettings, getTask, listSkills, listTestPlans, newId, saveImage, saveTask } from '../lib/db';
  import { finishTask, reopenTask, taskFromQuick } from '../lib/planner/actions';
  import { addDays, todayKey } from '../lib/planner/dates';
  import { QUICK_MINUTES } from '../lib/planner/quickadd';
  import { go, href } from '../lib/router.svelte';
  import { SUBJECTS, taskAttachments, taskSkillIds, type Skill, type Task, type TaskType, type TestPlan } from '../lib/types';

  /** assessmentId: start as a milestone of this assignment. */
  let { id, assessmentId }: { id: string; assessmentId?: string } = $props();

  const TYPES: { value: TaskType; label: string }[] = [
    { value: 'classwork', label: 'Class work' },
    { value: 'smartered', label: 'SmarterEd set' },
    { value: 'assignment', label: 'Assignment' },
    { value: 'other', label: 'Other' },
  ];

  let task = $state<Task | null>(null);
  let isNew = $state(false);
  let today = $state('');
  let skills = $state.raw<Skill[]>([]);
  let assignments = $state.raw<TestPlan[]>([]);
  let error = $state('');
  let pdfBusy = $state(false);

  async function load() {
    const settings = await getSettings();
    today = todayKey(Date.now(), settings.dayStartHour);
    [skills, assignments] = await Promise.all([listSkills(), listTestPlans().then((p) => p.filter((a) => a.kind === 'assignment'))]);
    const found = id !== 'new' ? await getTask(id) : undefined;
    if (found) {
      task = found;
    } else {
      isNew = true;
      task = taskFromQuick({
        title: '',
        subject: '',
        type: 'classwork',
        due: addDays(today, 1),
        minutes: 20,
        required: true,
        study: 'desk',
        found: { subject: false, due: false, minutes: false, type: false, optional: false },
      });
      // Coming from an assignment's page: start as one of its milestones.
      const a = assignments.find((x) => x.id === assessmentId);
      if (a) Object.assign(task, { assessmentId: a.id, subject: a.subject, type: 'assignment', minutes: 60 });
    }
  }
  load();

  const linked = $derived(task ? taskSkillIds(task).map((id) => skills.find((s) => s.id === id)).filter((s): s is Skill => !!s) : []);
  const files = $derived(task ? taskAttachments(task) : []);
  // Sets already in the app that could be linked, this subject first.
  const linkable = $derived(
    task
      ? skills
          .filter((s) => !s.parentId && !linked.some((l) => l.id === s.id))
          .sort((a, b) => Number(b.subject === task!.subject) - Number(a.subject === task!.subject) || a.name.localeCompare(b.name))
      : [],
  );
  let pickSkill = $state('');

  async function persist() {
    if (task && !isNew) await saveTask($state.snapshot(task));
  }

  async function linkSkill() {
    if (!task || !pickSkill) return;
    task.skillIds = [...taskSkillIds(task), pickSkill];
    task.skillId = undefined;
    pickSkill = '';
    await persist();
  }

  async function unlinkSkill(id: string) {
    if (!task) return;
    task.skillIds = taskSkillIds(task).filter((s) => s !== id);
    task.skillId = undefined;
    await persist();
  }

  /** Checks and saves the task. False when something is missing. */
  async function store(): Promise<boolean> {
    if (!task) return false;
    error = '';
    if (!task.title.trim()) return (error = 'Give it a name, like "Finish Q5 to 10".'), false;
    if (!task.due) return (error = 'Pick a due date.'), false;
    const clean: Task = {
      ...$state.snapshot(task),
      title: task.title.trim(),
      minutes: Math.max(5, Math.round(Number(task.minutes) || 20)),
    };
    await saveTask(clean);
    return true;
  }

  async function save() {
    if (await store()) go('planner', 'homework');
  }

  /** Adds questions from SmarterEd PDFs or an ATAR Notes test. New homework is saved first so they link to it. */
  async function addQuestions(from: 'import' | 'atar') {
    if (!task || !(await store())) return;
    go('practice', from, 'task', task.id);
  }

  async function remove() {
    if (!task || !confirm(`Delete "${task.title}"?`)) return;
    await deleteTask(task.id);
    go('planner', 'homework');
  }

  async function toggleDone() {
    if (!task) return;
    if (task.status === 'open') await finishTask($state.snapshot(task));
    else await reopenTask($state.snapshot(task));
    go('planner', 'homework');
  }

  async function attach(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const picked = [...(input.files ?? [])];
    input.value = '';
    if (!picked.length || !task) return;
    error = '';
    pdfBusy = true;
    try {
      const list = taskAttachments(task);
      for (const file of picked) {
        if (file.size > 15 * 1024 * 1024) {
          error = `${file.name} is over 15 MB, which is too big to keep in the browser.`;
          continue;
        }
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const id = newId();
        await saveImage({ id, data, width: 0, height: 0 });
        list.push({ id, name: file.name });
      }
      task.attachments = list;
      task.attachmentId = task.attachmentName = undefined;
      await persist();
    } finally {
      pdfBusy = false;
    }
  }

  async function removePdf(id: string) {
    if (!task) return;
    task.attachments = taskAttachments(task).filter((f) => f.id !== id);
    task.attachmentId = task.attachmentName = undefined;
    await deleteImage(id);
    await persist();
  }

  async function openPdf(id: string) {
    const image = await getImage(id);
    if (!image) return;
    const blob = await (await fetch(image.data)).blob();
    window.open(URL.createObjectURL(blob), '_blank');
  }
</script>

<main class="page">
  {#if task}
    <section class="head">
      <div class="eyebrow"><a href={href('planner')}>Planner</a> / <a href={href('planner', 'homework')}>Homework</a></div>
      <h1>{isNew ? 'New homework' : task.title || 'Homework'}</h1>
      {#if task.carryOvers > 0}
        <p class="muted">Carried over {task.carryOvers} {task.carryOvers === 1 ? 'time' : 'times'}. Changing the due date or estimate resets it.</p>
      {/if}
    </section>

    {#if error}<div class="notice warn">{error}</div>{/if}

    <section class="panel fields">
      <label class="field wide">What to do<input type="text" bind:value={task.title} placeholder="e.g. Finish Q5 to 10" /></label>
      <label class="field">
        Subject
        <select bind:value={task.subject}>
          <option value="">No subject</option>
          {#each SUBJECTS as s (s)}<option value={s}>{s}</option>{/each}
        </select>
      </label>
      <label class="field">
        Kind
        <select bind:value={task.type}>
          {#each TYPES as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
        </select>
      </label>
      <div class="field">
        <span>Where can you do it?</span>
        <div class="picks" role="group" aria-label="Where can you do it">
          <button class="btn small" class:on={task.study !== 'flashcards'} aria-pressed={task.study !== 'flashcards'} onclick={() => task && (task.study = 'desk')}>Desk study</button>
          <button class="btn small" class:on={task.study === 'flashcards'} aria-pressed={task.study === 'flashcards'} onclick={() => task && (task.study = 'flashcards')}>Flashcards</button>
        </div>
        <span class="small">
          {task.study === 'flashcards' ? 'Can go on the bus or in a study period.' : 'Only planned at a desk, never on the bus.'}
        </span>
      </div>
      <label class="field">Due<input type="date" bind:value={task.due} onchange={() => task && (task.carryOvers = 0)} /></label>
      <div class="field">
        <span>Time it should take (minutes)</span>
        <div class="picks">
          {#each QUICK_MINUTES as m (m)}
            <button class="btn small" class:on={Number(task.minutes) === m} onclick={() => task && ((task.minutes = m), (task.carryOvers = 0))}>{m}</button>
          {/each}
          <input type="number" min="5" max="600" bind:value={task.minutes} aria-label="Minutes" />
        </div>
        {#if task.spent > 0}<span class="small">{task.spent} min done so far</span>{/if}
      </div>
      <label class="check wide">
        <input type="checkbox" checked={!task.required} onchange={(e) => task && (task.required = !(e.currentTarget as HTMLInputElement).checked)} />
        <span>Optional <span class="muted">(only goes in flexible windows, never pushes anything due)</span></span>
      </label>
      {#if task.type === 'assignment' || task.assessmentId}
        <label class="field wide">
          Milestone of an assignment
          <select bind:value={task.assessmentId}>
            <option value={undefined}>Not part of an assignment</option>
            {#each assignments as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
          </select>
        </label>
      {/if}
      <label class="field wide">Notes<textarea rows="3" bind:value={task.notes}></textarea></label>
    </section>

    <section class="panel pdf">
      <h2>Practice questions</h2>
      <p class="muted small">
        Add SmarterEd worksheet PDFs or an ATAR Notes topic test, the same way as on the Practice page. Questions the app
        already has are just linked, and new ones are cut out and saved to your skills. Doing them in a problem session
        ticks this homework off.
        {task.required ? '' : 'Since it is optional, the questions join your skill pool and come up in your daily mix.'}
      </p>
      {#each linked as k (k.id)}
        <div class="file">
          <a class="grow" href={href('practice', 'skill', k.id)}>{k.name}</a>
          <button class="btn small" onclick={() => unlinkSkill(k.id)}>Unlink</button>
        </div>
      {/each}
      <div class="actions">
        {#if linked.length && !isNew}<a class="btn primary" href={href('practice', 'run', 'task', task.id)}>Do these questions</a>{/if}
        <button class="btn" onclick={() => addQuestions('import')}>{linked.length ? 'Add more SmarterEd PDFs' : 'Add SmarterEd PDFs'}</button>
        <button class="btn" onclick={() => addQuestions('atar')}>Add an ATAR Notes test</button>
      </div>
      {#if isNew}<p class="muted small">This saves the homework first, then opens the import.</p>{/if}
      {#if linkable.length}
        <div class="pick">
          <select bind:value={pickSkill} aria-label="Set already in the app">
            <option value="">Or pick a set already in the app...</option>
            {#each linkable as k (k.id)}<option value={k.id}>{k.subject === task.subject ? '' : `${k.subject}: `}{k.name}</option>{/each}
          </select>
          <button class="btn small" onclick={linkSkill} disabled={!pickSkill}>Link</button>
        </div>
      {/if}

      <h2 class="gap">Attached PDFs</h2>
      <p class="muted small">For anything you just need to read or hand in, like a task sheet or a reading.</p>
      {#each files as f (f.id)}
        <div class="file">
          <button class="linkish grow" onclick={() => openPdf(f.id)}>{f.name}</button>
          <button class="btn small" onclick={() => removePdf(f.id)}>Remove</button>
        </div>
      {/each}
      <div>
        <label class="btn">
          {pdfBusy ? 'Saving...' : files.length ? 'Add more PDFs' : 'Attach PDFs'}
          <input class="sr-only" type="file" accept="application/pdf" multiple onchange={attach} />
        </label>
      </div>
    </section>

    <div class="actions">
      <button class="btn primary" onclick={save}>{isNew ? 'Add homework' : 'Save'}</button>
      {#if !isNew}
        <button class="btn" onclick={toggleDone}>{task.status === 'open' ? 'Mark done' : 'Reopen'}</button>
        <button class="btn danger" onclick={remove}>Delete</button>
      {/if}
    </div>
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
  h2.gap {
    margin-top: 10px;
  }
  .linkish {
    background: none;
    border: 0;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
    padding: 0;
  }
  .pick {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .pick select {
    flex: 1;
    min-width: 0;
  }
  .file {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 8px 0;
    border-top: 1px solid var(--line);
  }
  .grow {
    flex: 1;
    min-width: 0;
    text-align: left;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 14px;
    padding: 18px;
  }
  .wide {
    grid-column: 1 / -1;
  }
  .field span {
    color: var(--muted);
    font-size: 14px;
  }
  div.field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .picks {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .picks input {
    width: 90px;
  }
  .btn.on {
    border-color: var(--accent);
    color: var(--accent);
  }
  .check {
    display: flex;
    gap: 10px;
    align-items: center;
    cursor: pointer;
  }
  .check input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
  input[type='date'] {
    min-height: 44px;
    padding: 8px 12px;
    border-radius: 10px;
    border: 1px solid var(--line-strong);
    background: var(--surface);
    color: var(--text);
    font: 400 16px var(--font);
  }
  .pdf {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .pdf p {
    margin: 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .small {
    font-size: 13px;
  }
</style>
