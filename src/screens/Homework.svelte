<script lang="ts">
  import QuickAdd from '../components/QuickAdd.svelte';
  import { getSettings, listTasks, listTestPlans } from '../lib/db';
  import { finishTask, reopenTask } from '../lib/planner/actions';
  import { remaining } from '../lib/planner/build';
  import { daysBetween, dueLabel, todayKey } from '../lib/planner/dates';
  import { shortSubject } from '../lib/practice/load';
  import { plural } from '../lib/load';
  import { href } from '../lib/router.svelte';
  import { taskSkillIds, type Task, type TestPlan } from '../lib/types';

  let tasks = $state.raw<Task[]>([]);
  let assessments = $state.raw<Map<string, TestPlan>>(new Map());
  let today = $state('');
  let loaded = $state(false);
  let showDone = $state(false);
  let justAdded = $state('');

  async function load() {
    const settings = await getSettings();
    today = todayKey(Date.now(), settings.dayStartHour);
    const [t, a] = await Promise.all([listTasks(), listTestPlans()]);
    tasks = t;
    assessments = new Map(a.map((x) => [x.id, x]));
    loaded = true;
  }
  load();

  const open = $derived(tasks.filter((t) => t.status === 'open').sort((a, b) => a.due.localeCompare(b.due) || a.created - b.created));
  const groups = $derived.by(() => {
    const req = open.filter((t) => t.required);
    const by = (min: number, max: number) => req.filter((t) => daysBetween(today, t.due) >= min && daysBetween(today, t.due) <= max);
    return [
      { name: 'Late', list: req.filter((t) => t.due < today) },
      { name: 'Due today or tomorrow', list: by(0, 1) },
      { name: 'This week', list: by(2, 7) },
      { name: 'Later', list: by(8, 100_000) },
      { name: 'Optional', list: open.filter((t) => !t.required) },
    ].filter((g) => g.list.length);
  });
  const done = $derived(
    tasks
      .filter((t) => t.status !== 'open')
      .sort((a, b) => (b.finished ?? 0) - (a.finished ?? 0))
      .slice(0, 30),
  );
  const totalLeft = $derived(open.filter((t) => t.required).reduce((m, t) => m + remaining(t), 0));

  async function toggle(t: Task) {
    if (t.status === 'open') await finishTask(t);
    else await reopenTask(t);
    await load();
  }

  function added(t: Task) {
    justAdded = t.id;
    load();
  }
</script>

<main class="page">
  <section class="head">
    <div class="eyebrow"><a href={href('planner')}>Planner</a> / Homework</div>
    <h1>Homework</h1>
    {#if loaded}
      <p class="muted">
        {#if open.length}
          {plural(open.filter((t) => t.required).length, 'task')} to do, about {totalLeft} min. The planner fits them
          into your desk windows, due soonest first.
        {:else}
          Nothing to do. Add homework as you get it, in class or at the end of the day.
        {/if}
      </p>
    {/if}
  </section>

  <section class="panel add">
    <QuickAdd {today} onadded={added} />
    {#if justAdded}
      {@const fresh = tasks.find((t) => t.id === justAdded)}
      {#if fresh}
        <p class="small added">
          Added "{fresh.title}". <a href={href('planner', 'task', fresh.id)}>Add worksheets or a PDF to it</a>
        </p>
      {/if}
    {/if}
    <a class="small more" href={href('planner', 'task', 'new')}>More options (desk or flashcards, SmarterEd and ATAR Notes questions, PDFs, notes)</a>
  </section>

  {#each groups as g (g.name)}
    <section>
      <h2 class:late={g.name === 'Late'}>{g.name}</h2>
      {#each g.list as t (t.id)}
        {@const a = t.assessmentId ? assessments.get(t.assessmentId) : undefined}
        <div class="row task" class:fresh={t.id === justAdded}>
          <input type="checkbox" class="tick" checked={false} aria-label="Done: {t.title}" onchange={() => toggle(t)} />
          <span class="what">
            <a class="title" href={href('planner', 'task', t.id)}>{t.title}</a>
            <span class="muted small">
              {[t.subject ? shortSubject(t.subject) : '', a ? `${a.name} milestone` : '', t.type === 'smartered' ? 'SmarterEd set' : '', t.study === 'flashcards' ? 'flashcards' : '']
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          {#if t.carryOvers > 0}<span class="tag">carried over{t.carryOvers > 1 ? ` ×${t.carryOvers}` : ''}</span>{/if}
          {#if taskSkillIds(t).length}
            <a class="btn small" href={href('practice', 'run', 'task', t.id)}>Do questions</a>
          {:else if t.type === 'smartered'}
            <a class="btn small" href={href('practice', 'import', 'task', t.id)}>Add the PDF</a>
          {/if}
          <span class="mono small due" class:late={t.due < today}>{dueLabel(t.due, today)}</span>
          <span class="mono small muted mins">{remaining(t)} min</span>
        </div>
      {/each}
    </section>
  {/each}

  {#if done.length}
    <section>
      <button class="btn small" onclick={() => (showDone = !showDone)}>{showDone ? 'Hide' : 'Show'} finished ({done.length})</button>
      {#if showDone}
        {#each done as t (t.id)}
          <div class="row task finished">
            <input type="checkbox" class="tick" checked={t.status === 'done'} aria-label="Reopen {t.title}" onchange={() => toggle(t)} />
            <span class="what">
              <a class="title" href={href('planner', 'task', t.id)}>{t.title}</a>
              <span class="muted small">{t.subject ? shortSubject(t.subject) : ''}{t.status === 'dropped' ? ' · dropped' : ''}</span>
            </span>
          </div>
        {/each}
      {/if}
    </section>
  {/if}
</main>

<style>
  .added {
    margin: 0;
  }
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
    margin-bottom: 4px;
  }
  h2.late,
  .due.late {
    color: var(--warn);
  }
  .add {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .more {
    align-self: flex-start;
  }
  .small {
    font-size: 13px;
  }
  .task {
    min-height: 56px;
  }
  .task.fresh {
    background: color-mix(in srgb, var(--accent) 7%, transparent);
  }
  .tick {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }
  .what {
    flex: 1 1 240px;
    display: flex;
    flex-direction: column;
  }
  .title {
    color: var(--text);
    text-decoration: none;
  }
  .title:hover {
    color: var(--accent);
  }
  .finished .title {
    color: var(--muted);
    text-decoration: line-through;
  }
  .tag {
    font-family: var(--mono);
    font-size: 11px;
    padding: 1px 7px;
    border-radius: 10px;
    border: 1px solid var(--line-strong);
    color: var(--muted);
  }
  .mins {
    min-width: 56px;
    text-align: right;
  }
</style>
