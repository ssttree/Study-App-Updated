<script lang="ts">
  import { deleteTask, getImage, getSettings, getTask, listSkills, listTestPlans, newId, saveImage, saveTask } from '../lib/db';
  import { finishTask, reopenTask, taskFromQuick } from '../lib/planner/actions';
  import { addDays, todayKey } from '../lib/planner/dates';
  import { QUICK_MINUTES } from '../lib/planner/quickadd';
  import { go, href } from '../lib/router.svelte';
  import { SUBJECTS, type Skill, type Task, type TaskType, type TestPlan } from '../lib/types';

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
        found: { subject: false, due: false, minutes: false, type: false, optional: false },
      });
      // Coming from an assignment's page: start as one of its milestones.
      const a = assignments.find((x) => x.id === assessmentId);
      if (a) Object.assign(task, { assessmentId: a.id, subject: a.subject, type: 'assignment', minutes: 60 });
    }
  }
  load();

  const skill = $derived(task?.skillId ? skills.find((s) => s.id === task!.skillId) : undefined);

  async function save() {
    if (!task) return;
    error = '';
    if (!task.title.trim()) return void (error = 'Give it a name, like "Finish Q5 to 10".');
    if (!task.due) return void (error = 'Pick a due date.');
    const clean: Task = {
      ...$state.snapshot(task),
      title: task.title.trim(),
      minutes: Math.max(5, Math.round(Number(task.minutes) || 20)),
    };
    await saveTask(clean);
    go('planner', 'homework');
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
    const file = input.files?.[0];
    input.value = '';
    if (!file || !task) return;
    if (file.size > 15 * 1024 * 1024) return void (error = 'That PDF is over 15 MB, which is too big to keep in the browser.');
    pdfBusy = true;
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const imageId = task.attachmentId ?? newId();
      await saveImage({ id: imageId, data, width: 0, height: 0 });
      task.attachmentId = imageId;
      task.attachmentName = file.name;
      if (!isNew) await saveTask($state.snapshot(task));
    } finally {
      pdfBusy = false;
    }
  }

  async function openPdf() {
    if (!task?.attachmentId) return;
    const image = await getImage(task.attachmentId);
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
      {#if task.type === 'smartered'}
        <h2>SmarterEd set</h2>
        {#if skill}
          <p class="muted">
            Linked to the skill <a href={href('practice', 'skill', skill.id)}>{skill.name}</a>. It ticks itself off once you
            have done every question in a problem session.
          </p>
          <div><a class="btn primary" href={href('practice', 'run', 'skill', skill.id)}>Do these questions</a></div>
        {:else}
          <p class="muted">
            Add the worksheet PDF and the app cuts out the questions and worked solutions, the same as a practice import.
            {task.required ? '' : 'Since it is optional, it joins your skill pool and comes up in your daily mix.'}
          </p>
          {#if isNew}
            <p class="muted small">Save it first, then add the PDF from the homework list.</p>
          {:else}
            <div><a class="btn primary" href={href('practice', 'import', 'task', task.id)}>Add the PDF</a></div>
          {/if}
        {/if}
      {:else}
        <h2>Attached PDF</h2>
        {#if task.attachmentId}
          <div class="actions">
            <button class="btn" onclick={openPdf}>Open {task.attachmentName ?? 'PDF'}</button>
            <label class="btn">Replace<input class="sr-only" type="file" accept="application/pdf" onchange={attach} /></label>
          </div>
        {:else}
          <label class="btn">{pdfBusy ? 'Saving...' : 'Attach a PDF'}<input class="sr-only" type="file" accept="application/pdf" onchange={attach} /></label>
        {/if}
      {/if}
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
