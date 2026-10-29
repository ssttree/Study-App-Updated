<script lang="ts">
  import { loadPractice, relativeDay, shortSubject, type PracticeCollection } from '../lib/practice/load';
  import { activePlans, activeSkills, buildDailyMix, costMinutes, recommendSubjects } from '../lib/practice/mix';
  import { plural } from '../lib/load';
  import { addStarterSkills } from '../lib/practice/save';
  import { STARTER_SKILLS } from '../lib/practice/subjects';
  import { href } from '../lib/router.svelte';

  let data = $state.raw<PracticeCollection | null>(null);
  let chosen = $state('');
  let second = $state('');

  loadPractice().then((d) => (data = d));

  /** Business Studies and Engineering Studies: no SmarterEd sheets, so they start from the syllabus. */
  const written = Object.keys(STARTER_SKILLS);
  const needsSetup = $derived(data ? written.filter((subject) => !data!.skills.some((s) => s.subject === subject)) : []);
  let settingUp = $state('');

  async function setUp(subject: string) {
    settingUp = subject;
    try {
      await addStarterSkills(subject);
      data = await loadPractice();
    } finally {
      settingUp = '';
    }
  }

  const view = $derived.by(() => {
    if (!data) return null;
    const now = Date.now();
    const ranked = recommendSubjects(data, now, data.dayEnd);
    const plans = activePlans(data.plans, now);
    const subjects = [...new Set(data.skills.map((s) => s.subject))].sort();
    const active = activeSkills(data);
    const bySubject = subjects.map((subject) => {
      const skills = data!.skills.filter((s) => s.subject === subject);
      const on = active.filter((s) => s.subject === subject);
      const due = on.filter((s) => s.fsrs.state === 0 || s.fsrs.due <= data!.dayEnd).length;
      const questions = data!.problems.filter((p) => skills.some((s) => s.id === p.skillId)).length;
      return { subject, skills: skills.length, on: on.length, due, questions };
    });
    return { ranked, plans, bySubject };
  });

  const subject = $derived(chosen || view?.ranked[0]?.subject || '');
  const pick = $derived(view?.ranked.find((r) => r.subject === subject));
  const preview = $derived.by(() => {
    if (!data || !subject) return null;
    const subjects = second && second !== subject ? [subject, second] : [subject];
    const items = buildDailyMix(data, { subjects, minutes: data.settings.problemMinutes, dayEnd: data.dayEnd, rng: () => 0.5 });
    return {
      count: items.length,
      skills: new Set(items.map((i) => i.skill.id)).size,
      minutes: Math.round(items.reduce((m, i) => m + costMinutes(i.problem, i.skill.subject), 0)),
      subjects,
    };
  });
</script>

<main class="page">
  {#if data && view}
    {#if data.problems.length === 0}
      <section class="hero">
        <div class="eyebrow accent">Problem practice</div>
        <h1>Add your first questions</h1>
        <p class="lead muted">
          Drop in a SmarterEd worksheet and the app cuts out every question and its worked solution. Each
          worksheet becomes a skill. The app then mixes questions from different skills, so you practise picking
          the right method, the way a real exam asks you to.
        </p>
        <div class="actions">
          <a class="btn primary" href={href('practice', 'import')}>Import SmarterEd PDFs</a>
          <a class="btn" href={href('practice', 'atar')}>Add an ATAR Notes topic test</a>
          <a class="btn" href={href('practice', 'write')}>Type a question</a>
        </div>
      </section>
    {:else if view.ranked.length === 0}
      <section class="hero">
        <div class="eyebrow accent">Problem practice</div>
        <h1>No skills switched on</h1>
        <p class="lead muted">Switch on the skills you have been taught in class and they join the daily mix.</p>
        <div class="actions"><a class="btn primary" href={href('practice', 'skills')}>Choose skills</a></div>
      </section>
    {:else if preview}
      <section class="hero">
        <div class="eyebrow accent">Next · about {Math.max(preview.minutes, 1)} min on paper</div>
        <h1>{preview.subjects.map(shortSubject).join(' + ')} problems</h1>
        <p class="lead muted">
          {`About ${plural(preview.count, 'question')} mixed from ${plural(preview.skills, 'skill')}.`}
          {pick?.reason ? `Suggested because: ${pick.reason}.` : ''}
          Have paper and a pen ready.
        </p>
        <div class="actions">
          {#if preview.count > 0}
            <a class="btn primary" href={href('practice', 'run', 'mix', ...preview.subjects)}>Start the mix</a>
          {/if}
          <label class="inline">
            <span class="sr-only">Subject</span>
            <select bind:value={chosen}>
              <option value="">{view.ranked[0].subject} (suggested)</option>
              {#each view.ranked.slice(1) as r (r.subject)}
                <option value={r.subject}>{r.subject}</option>
              {/each}
            </select>
          </label>
          {#if view.ranked.length > 1}
            <label class="inline">
              <span class="sr-only">Second subject</span>
              <select bind:value={second}>
                <option value="">No second subject</option>
                {#each view.ranked.filter((r) => r.subject !== subject) as r (r.subject)}
                  <option value={r.subject}>+ {r.subject}</option>
                {/each}
              </select>
            </label>
          {/if}
        </div>
        <p class="muted small note">
          Mixed practice feels slower and you will get more wrong than doing one topic at a time. That is normal, and
          it is why you remember more weeks later.
        </p>
      </section>
    {/if}

    {#if data.skills.length > 0}
      <section>
        <div class="section-head">
          <h2>Tests coming up</h2>
          <a class="mono small" href={href('practice', 'plan', 'new')}>New test plan</a>
        </div>
        {#each view.plans as plan (plan.id)}
          <div class="row">
            <span class="dot" style:background="var(--accent)"></span>
            <a class="name" href={href('practice', 'plan', plan.id)}>{plan.name}</a>
            <span class="mono muted small">{shortSubject(plan.subject)} · {relativeDay(plan.date, data.dayEnd)} · {plural(plan.skillIds.length, 'skill')}</span>
            <a class="btn small" href={href('practice', 'run', 'plan', plan.id)}>Practise for it</a>
          </div>
        {:else}
          <p class="muted small empty">
            No tests planned. Two or three weeks before a test, make a plan: pick the skills it covers and the app
            focuses your problems on them.
          </p>
        {/each}
      </section>

      <section>
        <div class="section-head">
          <h2>Skills by subject</h2>
          <a class="mono small" href={href('practice', 'skills')}>All skills</a>
        </div>
        {#each view.bySubject as s (s.subject)}
          <a class="row subject" href={href('practice', 'skills', s.subject)}>
            <span class="dot" style:background={s.due > 0 ? 'var(--accent)' : 'var(--dot)'}></span>
            <span class="name">{s.subject}</span>
            <span class="mono muted small">
              {s.on} of {plural(s.skills, 'skill')} on · {s.due} due · {plural(s.questions, 'question')}
            </span>
          </a>
        {/each}
      </section>

      {#if data.problems.length}
      <section class="add">
        <h2>Add questions</h2>
        <div class="actions">
          <a class="btn" href={href('practice', 'import')}>SmarterEd PDFs</a>
          <a class="btn" href={href('practice', 'atar')}>ATAR Notes topic test</a>
          <a class="btn" href={href('practice', 'import')}>Past HSC paper</a>
          <a class="btn" href={href('practice', 'write')}>Type a question</a>
        </div>
      </section>
      {/if}
    {/if}

    {#if needsSetup.length}
      <section class="setup panel">
        <h2>Business Studies and Engineering Studies</h2>
        <p class="muted small">
          These have no SmarterEd sheets, so the app starts them from the syllabus: one skill for each part of each
          topic, switched off until you add questions. Add questions from a NESA past HSC paper (box each question,
          then its marking guideline), an ATAR Notes test, or type them in. In practice you plan your answer in dot
          points and check it against the marking guideline, then say whether you picked the right concept.
        </p>
        <div class="actions">
          {#each needsSetup as subject (subject)}
            <button class="btn" onclick={() => setUp(subject)} disabled={!!settingUp}>
              {settingUp === subject ? 'Adding...' : `Set up ${subject}`}
            </button>
          {/each}
        </div>
      </section>
    {/if}
  {/if}
</main>

<style>
  .hero {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  h1 {
    font-size: 44px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .lead {
    margin: 0;
    font-size: 18px;
    max-width: 600px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 8px;
    align-items: center;
  }
  .inline select {
    width: auto;
    min-width: 200px;
  }
  .setup {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 20px;
  }
  .setup p {
    margin: 0;
    max-width: 640px;
  }
  .note {
    max-width: 560px;
    margin: 4px 0 0;
  }
  .section-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 4px;
  }
  h2 {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .small {
    font-size: 13px;
  }
  .name {
    flex: 1 1 240px;
  }
  .subject {
    color: var(--text);
    text-decoration: none;
    min-height: 44px;
  }
  .subject:hover .name {
    color: var(--accent);
  }
  .empty {
    margin: 0;
    padding: 14px 0;
    border-top: 1px solid var(--line);
    max-width: 600px;
  }
  .add {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  @media (max-width: 640px) {
    h1 {
      font-size: 34px;
    }
  }
</style>
