<script lang="ts">
  import { deleteTestPlan, newId, saveTestPlan } from '../lib/db';
  import { loadPractice, relativeDay, type PracticeCollection } from '../lib/practice/load';
  import { withChildren } from '../lib/practice/mix';
  import { plural } from '../lib/load';
  import { go, href } from '../lib/router.svelte';
  import { SUBJECTS, type TestPlan } from '../lib/types';

  let { id }: { id: string } = $props();

  let data = $state.raw<PracticeCollection | null>(null);
  let name = $state('');
  let subject = $state('');
  let date = $state('');
  let skillIds = $state<string[]>([]);
  let created = Date.now();
  let error = $state('');

  const toInput = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  loadPractice().then((d) => {
    data = d;
    const plan = d.plans.find((p) => p.id === id);
    if (plan) {
      name = plan.name;
      subject = plan.subject;
      date = toInput(plan.date);
      skillIds = [...plan.skillIds];
      created = plan.created;
    } else {
      subject = [...new Set(d.skills.map((s) => s.subject))][0] ?? SUBJECTS[1];
      date = toInput(Date.now() + 21 * 86_400_000);
    }
  });

  const plan = $derived(data?.plans.find((p) => p.id === id));
  const subjects = $derived([...new Set(data?.skills.map((s) => s.subject) ?? [])].sort());
  const subjectSkills = $derived(data?.skills.filter((s) => s.subject === subject && !s.parentId) ?? []);
  const topics = $derived([...new Set(subjectSkills.map((s) => s.topic || 'Other'))]);
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

  function toggleTopic(topic: string) {
    const ids = subjectSkills.filter((s) => (s.topic || 'Other') === topic).map((s) => s.id);
    const all = ids.every((i) => skillIds.includes(i));
    skillIds = all ? skillIds.filter((i) => !ids.includes(i)) : [...new Set([...skillIds, ...ids])];
  }

  async function save() {
    error = '';
    if (!name.trim()) return void (error = 'Give the test a name, like "Ext 1 term 1 test".');
    if (!date) return void (error = 'Pick the test date.');
    if (!skillIds.length) return void (error = 'Tick the skills the test covers.');
    const [y, m, d] = date.split('-').map(Number);
    const record: TestPlan = {
      id: plan?.id ?? newId(),
      name: name.trim(),
      subject,
      date: new Date(y, m - 1, d).getTime(),
      skillIds: skillIds.filter((s) => subjectSkills.some((k) => k.id === s)),
      created,
    };
    await saveTestPlan(record);
    go('practice');
  }

  async function remove() {
    if (!plan || !confirm(`Delete the plan "${plan.name}"? Your attempts stay.`)) return;
    await deleteTestPlan(plan.id);
    go('practice');
  }
</script>

<main class="page">
  <section class="head">
    <div class="eyebrow"><a href={href('practice')}>Practice</a> / Test plan</div>
    <h1>{plan ? plan.name : 'New test plan'}</h1>
    <p class="muted">
      Start two or three weeks before a test. Pick the skills it covers and the app gives them first claim on your
      daily problems for that subject, with every skill coming up at least twice before the day. You can also
      practise just these skills any time.
    </p>
    {#if plan && data}
      <div class="actions">
        <a class="btn primary" href={href('practice', 'run', 'plan', plan.id)}>Practise for this test</a>
        <span class="muted small">Test {relativeDay(plan.date, data.dayEnd)}</span>
      </div>
    {/if}
  </section>

  {#if error}<div class="notice warn">{error}</div>{/if}

  {#if data}
    <section class="panel fields">
      <label class="field">Name<input type="text" bind:value={name} placeholder="e.g. Ext 1 polynomials test" /></label>
      <label class="field">
        Subject
        <select bind:value={subject}>
          {#each subjects.length ? subjects : SUBJECTS as s (s)}<option value={s}>{s}</option>{/each}
        </select>
      </label>
      <label class="field">Test date<input type="date" bind:value={date} /></label>
    </section>

    <section>
      <h2>Skills in the test</h2>
      {#if !subjectSkills.length}
        <p class="muted">No skills in {subject} yet. <a href={href('practice', 'import')}>Import some questions</a> first.</p>
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

    <div class="actions">
      <button class="btn primary" onclick={save}>Save plan</button>
      {#if plan}<button class="btn danger" onclick={remove}>Delete plan</button>{/if}
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
    margin-bottom: 4px;
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
  .topic {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 16px;
  }
  .pick {
    cursor: pointer;
    min-height: 44px;
  }
  .pick input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
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
</style>
