<script lang="ts">
  import { saveSkill } from '../lib/db';
  import { loadPractice, relativeDay, type PracticeCollection } from '../lib/practice/load';
  import { plural } from '../lib/load';
  import { href } from '../lib/router.svelte';
  import type { Skill } from '../lib/types';

  let { subject = '' }: { subject?: string } = $props();

  let data = $state.raw<PracticeCollection | null>(null);
  const load = async () => (data = await loadPractice());
  load();

  const groups = $derived.by(() => {
    if (!data) return [];
    const count = new Map<string, number>();
    for (const p of data.problems) count.set(p.skillId, (count.get(p.skillId) ?? 0) + 1);
    const subjects = [...new Set(data.skills.map((s) => s.subject))].sort().filter((s) => !subject || s === subject);
    return subjects.map((sub) => {
      const mine = data!.skills.filter((s) => s.subject === sub);
      const tops = mine.filter((s) => !s.parentId || !mine.some((p) => p.id === s.parentId));
      const topics = [...new Set(tops.map((s) => s.topic || 'Other'))];
      return {
        subject: sub,
        topics: topics.map((topic) => ({
          topic,
          skills: tops
            .filter((s) => (s.topic || 'Other') === topic)
            .flatMap((s) => [s, ...mine.filter((c) => c.parentId === s.id)])
            .map((s) => ({ skill: s, questions: count.get(s.id) ?? 0 })),
        })),
      };
    });
  });

  function status(s: Skill): string {
    if (!s.on) return 'not taught yet';
    if (s.fsrs.state === 0) return 'new';
    if (s.fsrs.due <= data!.dayEnd) return 'due ' + relativeDay(s.fsrs.due, data!.dayEnd);
    return 'next ' + relativeDay(s.fsrs.due, data!.dayEnd);
  }

  async function toggle(s: Skill) {
    await saveSkill({ ...s, on: !s.on });
    await load();
  }
</script>

<main class="page wide">
  <section class="head">
    <div class="eyebrow"><a href={href('practice')}>Practice</a> / Skills</div>
    <h1>{subject || 'Skills'}</h1>
    <p class="muted">
      A skill is one subtopic, usually one SmarterEd worksheet. Tick <strong>Taught</strong> once you have covered it
      in class and it joins your daily mix. The app spaces each skill out with FSRS, so it comes back just before
      you would forget the method.
    </p>
    {#if subject}<a class="small" href={href('practice', 'skills')}>Show every subject</a>{/if}
  </section>

  {#if data && groups.length === 0}
    <p class="muted">No skills yet. <a href={href('practice', 'import')}>Import a SmarterEd PDF</a> to make one.</p>
  {/if}

  {#each groups as g (g.subject)}
    <section>
      <h2>{g.subject}</h2>
      {#each g.topics as t (t.topic)}
        <div class="topic eyebrow">{t.topic}</div>
        {#each t.skills as { skill, questions } (skill.id)}
          <div class="row" class:child={!!skill.parentId}>
            <label class="taught">
              <input type="checkbox" checked={skill.on} onchange={() => toggle(skill)} />
              <span class="sr-only">Taught: {skill.name}</span>
            </label>
            <a class="name" href={href('practice', 'skill', skill.id)}>{skill.name}</a>
            <span class="mono muted small">{plural(questions, 'question')} · {status(skill)}</span>
          </div>
        {/each}
      {/each}
    </section>
  {/each}
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
    font-size: 20px;
    margin-bottom: 8px;
  }
  .topic {
    margin: 18px 0 2px;
    font-size: 12px;
  }
  .row.child {
    padding-left: 34px;
  }
  .taught {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    margin: -10px 0 -10px -12px;
    cursor: pointer;
  }
  .taught input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }
  .name {
    flex: 1 1 260px;
    color: var(--text);
    text-decoration: none;
  }
  .name:hover {
    color: var(--accent);
  }
  .small {
    font-size: 13px;
  }
</style>
