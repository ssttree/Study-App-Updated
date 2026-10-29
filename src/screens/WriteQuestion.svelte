<script lang="ts">
  // Type a question and its marking guideline. Handy for Business Studies and
  // Engineering Studies, where questions are mostly words: one your teacher
  // set, one from a textbook, or a past HSC question typed out.
  import MathText from '../components/MathText.svelte';
  import { listSkills } from '../lib/db';
  import { plural } from '../lib/load';
  import { href } from '../lib/router.svelte';
  import { saveProblems, type SaveResult } from '../lib/practice/save';
  import { SUBJECTS, type Skill } from '../lib/types';
  import { untrack } from 'svelte';

  let { subject: initial }: { subject?: string } = $props();

  let skills = $state.raw<Skill[]>([]);
  let subject = $state<string>(untrack(() => (initial && (SUBJECTS as readonly string[]).includes(initial) ? initial : 'Business Studies')));
  let skill = $state('new');
  let name = $state('');
  let source = $state('');
  let marks = $state(4);
  let question = $state('');
  let answer = $state('');
  let error = $state('');
  let saving = $state(false);
  let saved = $state.raw<SaveResult[]>([]);

  listSkills().then((s) => (skills = s));

  const subjectSkills = $derived(skills.filter((k) => k.subject === subject).sort((a, b) => (a.topic || '').localeCompare(b.topic || '') || a.name.localeCompare(b.name)));
  const ready = $derived(question.trim().length > 0 && (skill !== 'new' || name.trim().length > 0));

  async function save() {
    if (!ready || saving) return;
    saving = true;
    error = '';
    try {
      const label = source.trim();
      const choice = skill === 'new' ? ({ kind: 'new', subject, name } as const) : ({ kind: 'existing', id: skill } as const);
      const result = await saveProblems(
        choice,
        [{ questionText: question, solutionText: answer, label, marks: Math.max(1, Math.round(Number(marks) || 1)), mc: false, key: `typed:${question.trim()}` }],
        'typed',
        label || 'Typed question',
      );
      if (!result.added) error = 'That question is in this skill already.';
      else {
        saved = [result, ...saved];
        question = '';
        answer = '';
        source = '';
      }
      skills = await listSkills();
      skill = result.skill.id;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }
</script>

<main class="page wide">
  <section class="head">
    <div class="eyebrow"><a href={href('practice')}>Practice</a> / Type a question</div>
    <h1>Type a question</h1>
    <p class="muted">
      For questions that are mostly words, like Business Studies and Engineering Studies short answers. Type the
      question and what a full-mark answer needs (the marking guideline or your teacher's points). Maths works the
      Obsidian way: <code>$F = ma$</code>. Each question joins a skill and comes up in your daily mix like any other.
    </p>
  </section>

  {#if saved.length}
    <div class="notice">
      Saved {plural(saved.length, 'question')} this time, last one to
      <a href={href('practice', 'skill', saved[0].skill.id)}>{saved[0].skill.name}</a>. Type the next one whenever you are ready.
    </div>
  {/if}
  {#if error}<div class="notice warn">{error}</div>{/if}

  <section class="panel fields">
    <label class="field">
      Subject
      <select bind:value={subject} onchange={() => (skill = 'new')}>
        {#each SUBJECTS as s (s)}<option value={s}>{s}</option>{/each}
      </select>
    </label>
    <label class="field">
      Skill
      <select bind:value={skill}>
        <option value="new">New skill</option>
        {#each subjectSkills as k (k.id)}<option value={k.id}>{k.name}</option>{/each}
      </select>
    </label>
    {#if skill === 'new'}
      <label class="field">Skill name<input type="text" bind:value={name} placeholder="e.g. Marketing strategies" /></label>
    {/if}
    <label class="field">Where it is from (optional)<input type="text" bind:value={source} placeholder="e.g. 2022 HSC Q23" /></label>
    <label class="field">Marks<input type="number" min="1" max="25" bind:value={marks} /></label>
  </section>

  <section class="sides">
    <div class="side">
      <label class="field">Question<textarea rows="6" bind:value={question} placeholder="e.g. Explain how a business could use outsourcing as an operations strategy."></textarea></label>
      {#if question.trim()}<div class="preview panel"><MathText text={question} class="card-text" /></div>{/if}
    </div>
    <div class="side">
      <label class="field">
        Marking guideline (optional)
        <textarea rows="6" bind:value={answer} placeholder={'- Defines outsourcing\n- Explains a benefit and a cost\n- Business example, like Qantas outsourcing maintenance'}></textarea>
      </label>
      {#if answer.trim()}<div class="preview panel"><MathText text={answer} class="card-text" /></div>{/if}
    </div>
  </section>

  <div class="save-bar">
    <button class="btn primary" onclick={save} disabled={!ready || saving}>{saving ? 'Saving...' : 'Save question'}</button>
    <a class="btn" href={href('practice')}>Done</a>
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
    max-width: 680px;
  }
  .eyebrow a {
    color: inherit;
  }
  h1 {
    font-size: 36px;
  }
  code {
    font-family: var(--mono);
    font-size: 14px;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
    padding: 18px;
  }
  .sides {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 18px;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  textarea {
    width: 100%;
    resize: vertical;
  }
  .preview {
    padding: 14px 18px;
  }
  .preview :global(.card-text) {
    font-size: 16px;
  }
  .save-bar {
    display: flex;
    gap: 12px;
    padding: 14px 0;
    border-top: 1px solid var(--line);
  }
</style>
