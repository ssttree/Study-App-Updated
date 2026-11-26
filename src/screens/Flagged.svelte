<script lang="ts">
  // Flagged questions: ones marked as not captured properly while practising,
  // with the PDF they came from, to fix the crop by hand and take the flag off.
  import ProblemView from '../components/ProblemView.svelte';
  import ProblemEditor from '../components/ProblemEditor.svelte';
  import FlagDialog from '../components/FlagDialog.svelte';
  import OriginalLink from '../components/OriginalLink.svelte';
  import { flagProblem } from '../lib/db';
  import { loadPractice, shortSubject, type PracticeCollection } from '../lib/practice/load';
  import { copiesOf } from '../lib/practice/edit';
  import { practiceStyle } from '../lib/practice/subjects';
  import { plural } from '../lib/load';
  import { href } from '../lib/router.svelte';
  import type { Problem } from '../lib/types';

  let data = $state.raw<PracticeCollection | null>(null);
  let editing = $state.raw<Problem | null>(null);
  let flagging = $state.raw<Problem | null>(null);
  let showSolution = $state<string | null>(null);

  async function load() {
    data = await loadPractice();
  }
  load();

  const flagged = $derived((data?.problems ?? []).filter((p) => p.flag).sort((a, b) => b.flag!.at - a.flag!.at));
  const skillOf = (p: Problem) => data?.skills.find((s) => s.id === p.skillId);
  const day = (ts: number) => new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

  async function unflag(p: Problem) {
    await flagProblem(p.id, null);
    await load();
  }
</script>

<main class="page wide">
  <section class="head">
    <a class="back" href={href('practice')}>← Practice</a>
    <h1>Flagged questions</h1>
    <p class="muted">
      Questions you flagged as not captured properly. Open the original PDF at its page, screenshot the right part, then
      Fix it and paste the picture in with Ctrl + V.
    </p>
  </section>

  {#if !data}
    <p class="muted">Loading...</p>
  {:else if !flagged.length}
    <section class="panel empty">
      <h2>Nothing flagged</h2>
      <p class="muted">When a question looks wrong while you practise, press Flag next to Edit question and it shows up here.</p>
    </section>
  {:else}
    <p class="mono muted small">{plural(flagged.length, 'question')} to fix</p>
    <div class="list">
      {#each flagged as p (p.id)}
        {@const skill = skillOf(p)}
        <article class="item panel">
          <div class="top">
            <div class="what">
              <strong>{p.label || 'Question'}</strong>
              <span class="muted small">
                {skill ? `${shortSubject(skill.subject)} · ` : ''}{#if skill}<a href={href('practice', 'skill', skill.id)}>{skill.name}</a>{:else}Unknown skill{/if} · flagged {day(p.flag!.at)}
              </span>
            </div>
            {#if p.flag!.note}<p class="note">⚑ {p.flag!.note}</p>{/if}
          </div>
          <ProblemView image={p.questionImage} text={p.questionText} alt="Question {p.label}" small />
          {#if showSolution === p.id}
            <ProblemView image={p.solutionImage} text={p.solutionText} alt="Solution {p.label}" small />
          {/if}
          <div class="source">
            <span class="small muted">From {p.from || 'an unknown source'}</span>
            <OriginalLink problem={p} onlinked={() => load()} />
          </div>
          <div class="actions">
            <button class="btn small primary" onclick={() => (editing = p)}>Fix it</button>
            {#if p.solutionImage || p.solutionText}
              <button class="btn small" onclick={() => (showSolution = showSolution === p.id ? null : p.id)}>
                {showSolution === p.id ? 'Hide answer' : 'Show answer'}
              </button>
            {/if}
            <button class="btn small" onclick={() => (flagging = p)}>Change note</button>
            <button class="btn small" onclick={() => unflag(p)}>It's fine, take the flag off</button>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</main>

{#if editing && data}
  <ProblemEditor
    problem={editing}
    copies={copiesOf(editing, data.problems)}
    skillName={(sid) => data?.skills.find((s) => s.id === sid)?.name ?? 'another skill'}
    answerName={practiceStyle(skillOf(editing)?.subject ?? '').answerName}
    onsaved={() => load()}
    onclose={() => (editing = null)}
  />
{/if}

{#if flagging}
  <FlagDialog problem={flagging} onsaved={() => load()} onclose={() => (flagging = null)} />
{/if}

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .head p {
    margin: 0;
  }
  .back {
    text-decoration: none;
  }
  h1 {
    font-size: 34px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .item {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .top {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .what {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 12px;
  }
  .note {
    margin: 0;
    color: var(--warn);
  }
  .source,
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
  }
  .empty h2 {
    margin: 0 0 6px;
  }
  .empty p {
    margin: 0;
  }
</style>
