<script lang="ts">
  import { deleteTestPlan, getSettings, listDecks, listTasks, newId, saveSkill, saveTestPlan } from '../lib/db';
  import { loadPractice, relativeDay, type PracticeCollection } from '../lib/practice/load';
  import { withChildren } from '../lib/practice/mix';
  import { DEFAULT_RAMP, KIND_LABEL, rampOf, stageOf, STAGE_LABEL, STAGE_TEXT } from '../lib/planner/assessments';
  import { dateKey, dueLabel, keyToTime, todayKey } from '../lib/planner/dates';
  import { plural } from '../lib/load';
  import { go, href } from '../lib/router.svelte';
  import { SUBJECTS, type AssessmentKind, type Deck, type RampDays, type Task, type TestPlan } from '../lib/types';

  /** from: opened from the planner rather than practice, which changes the way back. */
  let { id, from }: { id: string; from?: 'planner' } = $props();

  let data = $state.raw<PracticeCollection | null>(null);
  let decks = $state.raw<Deck[]>([]);
  let milestones = $state.raw<Task[]>([]);
  let today = $state('');
  let name = $state('');
  let subject = $state('');
  let date = $state('');
  let kind = $state<AssessmentKind>('test');
  let weighting = $state<number | ''>('');
  let customRamp = $state(false);
  let ramp = $state<RampDays>({ ...DEFAULT_RAMP.test });
  let skillIds = $state<string[]>([]);
  let deckIds = $state<string[]>([]);
  let mark = $state<number | ''>('');
  let outOf = $state<number | ''>('');
  let badSkillIds = $state<string[]>([]);
  let created = Date.now();
  let error = $state('');

  const back = $derived(from === 'planner' ? href('planner', 'exams') : href('practice'));

  async function load() {
    const settings = await getSettings();
    today = todayKey(Date.now(), settings.dayStartHour);
    const [d, allDecks, tasks] = await Promise.all([loadPractice(), listDecks(), listTasks()]);
    data = d;
    decks = allDecks;
    milestones = tasks.filter((t) => t.assessmentId === id).sort((a, b) => a.due.localeCompare(b.due));
    const plan = d.plans.find((p) => p.id === id);
    if (plan) {
      name = plan.name;
      subject = plan.subject;
      date = dateKey(plan.date);
      kind = plan.kind ?? 'test';
      weighting = plan.weighting ?? '';
      customRamp = !!plan.ramp;
      ramp = { ...(rampOf(plan) ?? DEFAULT_RAMP.test) };
      skillIds = [...plan.skillIds];
      deckIds = [...(plan.deckIds ?? [])];
      mark = plan.mark ?? '';
      outOf = plan.outOf ?? '';
      badSkillIds = [...(plan.badSkillIds ?? [])];
      created = plan.created;
    } else {
      subject = [...new Set(d.skills.map((s) => s.subject))][0] ?? SUBJECTS[1];
      date = dateKey(Date.now() + 21 * 86_400_000);
    }
  }
  load();

  const plan = $derived(data?.plans.find((p) => p.id === id));
  const subjectSkills = $derived(data?.skills.filter((s) => s.subject === subject && !s.parentId) ?? []);
  const subjectDecks = $derived(decks.filter((d) => d.subject === subject));
  const topics = $derived([...new Set(subjectSkills.map((s) => s.topic || 'Other'))]);
  const stage = $derived(plan ? stageOf(plan, today) : 'none');
  const isPast = $derived(!!date && !!today && date < today);
  // How often each chosen skill has come up since the plan was made (aim: at least twice).
  const counts = $derived.by(() => {
    const m = new Map<string, number>();
    if (!data || !plan) return m;
    const ids = withChildren(plan.skillIds, data.skills);
    for (const a of data.attempts) {
      if (a.at < plan.created || !ids.has(a.skillId)) continue;
      const top = data.skills.find((s) => s.id === a.skillId);
      const key = top?.parentId && plan.skillIds.includes(top.parentId) ? top.parentId : a.skillId;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  });

  function setKind(k: AssessmentKind) {
    kind = k;
    if (k !== 'assignment' && !customRamp) ramp = { ...DEFAULT_RAMP[k] };
  }

  function toggleTopic(topic: string) {
    const ids = subjectSkills.filter((s) => (s.topic || 'Other') === topic).map((s) => s.id);
    const all = ids.every((i) => skillIds.includes(i));
    skillIds = all ? skillIds.filter((i) => !ids.includes(i)) : [...new Set([...skillIds, ...ids])];
  }

  const num = (v: number | '') => (v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));

  async function save(): Promise<TestPlan | null> {
    error = '';
    if (!name.trim()) return (error = 'Give it a name, like "Ext 1 term 1 test".'), null;
    if (!date) return (error = 'Pick the date.'), null;
    const r = { build: Number(ramp.build) || 0, focus: Number(ramp.focus) || 0, final: Number(ramp.final) || 0 };
    if (customRamp && !(r.build >= r.focus && r.focus >= r.final && r.final >= 0)) {
      return (error = 'Prep stages must go build, then focus, then final, counting down to the day.'), null;
    }
    const record: TestPlan = {
      id: plan?.id ?? newId(),
      name: name.trim(),
      subject,
      date: keyToTime(date),
      skillIds: kind === 'assignment' ? [] : skillIds.filter((s) => subjectSkills.some((k) => k.id === s)),
      created,
      kind,
      weighting: num(weighting),
      ramp: customRamp && kind !== 'assignment' ? r : undefined,
      deckIds: kind === 'assignment' ? [] : deckIds.filter((d) => subjectDecks.some((k) => k.id === d)),
      mark: num(mark),
      outOf: num(outOf),
      badSkillIds: badSkillIds.length ? [...badSkillIds] : undefined,
    };
    // Skills that went badly come back straight away.
    const newlyBad = badSkillIds.filter((s) => !(plan?.badSkillIds ?? []).includes(s));
    for (const skill of data?.skills ?? []) {
      if (newlyBad.includes(skill.id) && skill.fsrs.state !== 0) await saveSkill({ ...skill, fsrs: { ...skill.fsrs, due: Date.now() } });
    }
    await saveTestPlan(record);
    return record;
  }

  async function saveAndBack() {
    if (await save()) location.hash = back;
  }

  async function addMilestone() {
    const saved = await save();
    if (saved) go('planner', 'task', 'new', saved.id);
  }

  async function remove() {
    if (!plan || !confirm(`Delete "${plan.name}"? Your attempts stay.`)) return;
    await deleteTestPlan(plan.id);
    location.hash = back;
  }
</script>

<main class="page">
  <section class="head">
    <div class="eyebrow">
      {#if from === 'planner'}<a href={href('planner')}>Planner</a> / <a href={back}>Exams</a>{:else}<a href={back}>Practice</a> / Test plan{/if}
    </div>
    <h1>{plan ? plan.name : 'New assessment'}</h1>
    {#if plan && data && kind !== 'assignment'}
      <div class="actions">
        {#if plan.skillIds.length}<a class="btn primary" href={href('practice', 'run', 'plan', plan.id)}>Practise for it</a>{/if}
        <span class="stage mono">{STAGE_LABEL[stage]}</span>
        <span class="muted small">{relativeDay(plan.date, data.dayEnd)}</span>
      </div>
      {#if stage === 'build' || stage === 'focus' || stage === 'final'}
        <p class="muted">{STAGE_TEXT[stage]}</p>
      {/if}
    {:else if !plan}
      <p class="muted">
        Add it as soon as you know the date. The planner ramps up prep by itself: in-scope skills get more problem time,
        then test prep mode, then timed sets in the last few days.
      </p>
    {/if}
  </section>

  {#if error}<div class="notice warn">{error}</div>{/if}

  {#if data}
    <section class="panel fields">
      <label class="field wide">Name<input type="text" bind:value={name} placeholder="e.g. Chemistry Module 5 test" /></label>
      <label class="field">
        Subject
        <select bind:value={subject}>
          {#each SUBJECTS as s (s)}<option value={s}>{s}</option>{/each}
        </select>
      </label>
      <label class="field">
        Kind
        <select value={kind} onchange={(e) => setKind(e.currentTarget.value as AssessmentKind)}>
          {#each ['test', 'exam', 'assignment'] as const as k (k)}<option value={k}>{KIND_LABEL[k]}</option>{/each}
        </select>
      </label>
      <label class="field">{kind === 'assignment' ? 'Due date' : 'Date'}<input type="date" bind:value={date} /></label>
      <label class="field">Weighting %<input type="number" min="0" max="100" bind:value={weighting} placeholder="e.g. 25" /></label>
    </section>

    {#if kind !== 'assignment'}
      <section>
        <h2>Prep ramp</h2>
        <p class="muted small">
          {KIND_LABEL[kind]}s start the build stage {DEFAULT_RAMP[kind].build} days out, focus {DEFAULT_RAMP[kind].focus} days
          out and the final stage {DEFAULT_RAMP[kind].final} days out.
        </p>
        <label class="check">
          <input type="checkbox" bind:checked={customRamp} onchange={() => !customRamp && (ramp = { ...DEFAULT_RAMP[kind as 'test' | 'exam'] })} />
          <span>Use different lengths for this one</span>
        </label>
        {#if customRamp}
          <div class="ramp">
            <label class="field">Build (days out)<input type="number" min="0" bind:value={ramp.build} /></label>
            <label class="field">Focus<input type="number" min="0" bind:value={ramp.focus} /></label>
            <label class="field">Final<input type="number" min="0" bind:value={ramp.final} /></label>
          </div>
        {/if}
      </section>

      <section>
        <h2>Flashcard decks in it</h2>
        <p class="muted small">In the focus stage, cards in these decks aim for 95% recall instead of 90%.</p>
        {#each subjectDecks as d (d.id)}
          <label class="row pick">
            <input type="checkbox" value={d.id} bind:group={deckIds} />
            <span class="grow">{d.name}</span>
            <span class="mono muted small">{d.module}</span>
          </label>
        {:else}
          <p class="muted small">No {subject} decks yet.</p>
        {/each}
      </section>

      <section>
        <h2>Skills in it</h2>
        {#if !subjectSkills.length}
          <p class="muted small">No skills in {subject} yet. <a href={href('practice', 'import')}>Import some questions</a> first.</p>
        {/if}
        {#each topics as topic (topic)}
          <div class="topic">
            <span class="eyebrow">{topic}</span>
            <button class="btn small" onclick={() => toggleTopic(topic)}>Tick all</button>
          </div>
          {#each subjectSkills.filter((s) => (s.topic || 'Other') === topic) as s (s.id)}
            <label class="row pick">
              <input type="checkbox" value={s.id} bind:group={skillIds} />
              <span class="grow">{s.name}</span>
              {#if plan && plan.skillIds.includes(s.id)}
                <span class="mono small" class:muted={(counts.get(s.id) ?? 0) >= 2} class:accent={(counts.get(s.id) ?? 0) < 2}>
                  done {plural(counts.get(s.id) ?? 0, 'time')}
                </span>
              {/if}
            </label>
          {/each}
        {/each}
      </section>
    {:else}
      <section>
        <h2>Milestones</h2>
        <p class="muted small">
          Split it into steps with dates (plan, draft, edit, submit). Each one is a homework task, and the planner warns you
          if one slips.
        </p>
        {#each milestones as t (t.id)}
          <a class="row pick" href={href('planner', 'task', t.id)}>
            <span class="dot" style:background={t.status !== 'open' ? 'var(--good)' : t.due < today ? 'var(--warn)' : 'var(--accent)'}></span>
            <span class="grow">{t.title}</span>
            <span class="mono small" class:late={t.status === 'open' && t.due < today}>
              {t.status !== 'open' ? 'done' : t.due < today ? `slipping · ${dueLabel(t.due, today)}` : dueLabel(t.due, today)}
            </span>
            <span class="mono muted small">{t.minutes} min</span>
          </a>
        {:else}
          <p class="muted small">No milestones yet.</p>
        {/each}
        <div class="actions"><button class="btn" onclick={addMilestone}>Add a milestone</button></div>
      </section>
    {/if}

    {#if isPast}
      <section class="panel result">
        <h2>How it went</h2>
        <div class="ramp">
          <label class="field">Your mark<input type="number" min="0" bind:value={mark} /></label>
          <label class="field">Out of<input type="number" min="0" bind:value={outOf} /></label>
        </div>
        {#if kind !== 'assignment' && skillIds.length}
          <p class="muted small">Tick the skills that went badly. They come back in your next problem sessions.</p>
          {#each subjectSkills.filter((s) => skillIds.includes(s.id)) as s (s.id)}
            <label class="row pick">
              <input type="checkbox" value={s.id} bind:group={badSkillIds} />
              <span class="grow">{s.name}</span>
            </label>
          {/each}
        {/if}
      </section>
    {/if}

    <div class="actions">
      <button class="btn primary" onclick={saveAndBack}>Save</button>
      {#if plan}<button class="btn danger" onclick={remove}>Delete</button>{/if}
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
    max-width: 640px;
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
  section > p {
    margin: 0 0 8px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
    padding: 18px;
  }
  .wide {
    grid-column: 1 / -1;
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
  .ramp {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
    margin-top: 10px;
  }
  .check {
    display: flex;
    gap: 10px;
    align-items: center;
    cursor: pointer;
  }
  .check input,
  .pick input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
  .topic {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 16px;
  }
  .pick {
    cursor: pointer;
    min-height: 44px;
    color: var(--text);
    text-decoration: none;
  }
  .grow {
    flex: 1;
  }
  .small {
    font-size: 13px;
  }
  .accent {
    color: var(--accent);
  }
  .late {
    color: var(--warn);
  }
  .stage {
    font-size: 12px;
    padding: 2px 10px;
    border-radius: 10px;
    border: 1px solid var(--accent);
    color: var(--accent);
  }
  .result {
    padding: 18px;
  }
</style>
