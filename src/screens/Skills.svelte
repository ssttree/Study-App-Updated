<script lang="ts">
  import { saveSkill } from '../lib/db';
  import { loadPractice, relativeDay, type PracticeCollection } from '../lib/practice/load';
  import { plural } from '../lib/load';
  import { href } from '../lib/router.svelte';
  import type { Skill } from '../lib/types';
  import CourseFilter from '../components/CourseFilter.svelte';
  import QuestionCount, { countPart, savedCount } from '../components/QuestionCount.svelte';
  import { isExtensionWork, mixesCourses } from '../lib/practice/course';
  import { levelChosen } from '../lib/practice/mix';

  let count = $state(savedCount());

  let { subject = '' }: { subject?: string } = $props();

  let data = $state.raw<PracticeCollection | null>(null);
  const load = async () => (data = await loadPractice());
  load();

  const groups = $derived.by(() => {
    if (!data) return [];
    // Questions per skill, split into the Extension work and the Advanced work an Extension book mixes in.
    const subjectOf = new Map(data.skills.map((s) => [s.id, s.subject]));
    const count = new Map<string, { ext: number; adv: number }>();
    for (const p of data.problems) {
      if (!levelChosen(p, data.settings.levels)) continue;
      const c = count.get(p.skillId) ?? { ext: 0, adv: 0 };
      if (isExtensionWork(p, subjectOf.get(p.skillId) ?? '')) c.ext++;
      else c.adv++;
      count.set(p.skillId, c);
    }
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
            .map((s) => ({ skill: s, ...(count.get(s.id) ?? { ext: 0, adv: 0 }) }))
            .map((r) => ({ ...r, questions: shown(r.skill.subject, r.ext, r.adv) }))
            // With one course picked, a skill with none of its questions drops out of the list.
            .filter((r) => !choiceFor(r.skill.subject) || r.questions > 0),
        })),
      };
    });
  });

  const choiceFor = (subject: string) => (mixesCourses(subject) ? data?.settings.courseChoice : undefined);
  /** Questions that come up, with the course choice applied. */
  function shown(subject: string, ext: number, adv: number): number {
    const c = choiceFor(subject);
    return c === 'extension' ? ext : c === 'advanced' ? adv : ext + adv;
  }
  /** Each course's total in the subjects listed, for the filter. */
  const totals = $derived.by(() => {
    if (!data) return { ext: 0, adv: 0, any: false };
    const mixing = new Set(data.skills.filter((s) => mixesCourses(s.subject) && (!subject || s.subject === subject)).map((s) => s.id));
    let ext = 0;
    let adv = 0;
    for (const p of data.problems) {
      if (!mixing.has(p.skillId) || !levelChosen(p, data.settings.levels)) continue;
      const sub = data.skills.find((s) => s.id === p.skillId)!.subject;
      if (isExtensionWork(p, sub)) ext++;
      else adv++;
    }
    return { ext, adv, any: mixing.size > 0 && adv > 0 };
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
    <div class="tools">
      {#if data && totals.any}
        <CourseFilter choice={data.settings.courseChoice} extension={totals.ext} advanced={totals.adv} onchange={load} />
      {/if}
      <QuestionCount bind:value={count} minutes={data?.settings.problemMinutes} />
    </div>
    {#if data && totals.any}
      <p class="muted small">
        The Extension textbook mixes Advanced work in. Pick Extension only to leave it out of these skills, your daily
        mix and test prep, or Advanced only to practise just that.
      </p>
    {/if}
  </section>

  {#if data && groups.length === 0}
    <p class="muted">No skills yet. <a href={href('practice', 'import')}>Import a SmarterEd PDF</a> to make one.</p>
  {/if}

  {#each groups as g (g.subject)}
    <section>
      <h2>{g.subject}</h2>
      {#each g.topics as t (t.topic)}
        <div class="topic eyebrow">{t.topic}</div>
        {#each t.skills as { skill, questions, ext, adv } (skill.id)}
          <div class="row" class:child={!!skill.parentId}>
            <label class="taught">
              <input type="checkbox" checked={skill.on} onchange={() => toggle(skill)} />
              <span class="sr-only">Taught: {skill.name}</span>
            </label>
            <a class="name" href={href('practice', 'skill', skill.id)}>{skill.name}</a>
            <span class="mono muted small">
              {plural(questions, 'question')}{!choiceFor(skill.subject) && mixesCourses(skill.subject) && adv > 0 ? (ext > 0 ? ` (${adv} Adv)` : ' · Advanced') : ''} · {status(skill)}
            </span>
            {#if questions > 0}<a class="btn small" href={href('practice', 'run', 'skill', skill.id, ...countPart(count))}>Practise</a>{/if}
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
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 24px;
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
