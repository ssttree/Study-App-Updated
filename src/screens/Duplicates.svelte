<script lang="ts">
  // Find duplicates: lists questions that are in the app twice (the same
  // question with slightly different formatting, or the same picture cut a bit
  // differently) and lets you keep one copy.
  import ProblemView from '../components/ProblemView.svelte';
  import { getSettings, mergeProblems, saveSettings } from '../lib/db';
  import { findDuplicates, pairKey, type DuplicateGroup } from '../lib/practice/duplicates';
  import { pictureFingerprints } from '../lib/practice/fingerprint';
  import { loadPractice, shortSubject, type PracticeCollection } from '../lib/practice/load';
  import { plural } from '../lib/load';
  import { href } from '../lib/router.svelte';
  import type { Problem } from '../lib/types';

  let data = $state.raw<PracticeCollection | null>(null);
  let groups = $state.raw<DuplicateGroup[] | null>(null);
  let checked = $state(0);
  let pictures = $state(0);
  let busy = $state('');
  let kept = $state(0);
  let error = $state('');

  async function scan() {
    groups = null;
    checked = 0;
    data = await loadPractice();
    const imageIds = data.problems.filter((p) => !p.questionText && p.questionImage).map((p) => p.questionImage);
    pictures = imageIds.length;
    const fingerprints = await pictureFingerprints(imageIds, (n) => (checked = n));
    groups = findDuplicates(data.problems, data.skills, fingerprints, data.settings.notDuplicates ?? []);
  }
  scan();

  const skillName = (p: Problem) => data?.skills.find((s) => s.id === p.skillId)?.name ?? 'Unknown skill';
  const goes = (p: Problem) => data?.attempts.filter((a) => a.problemId === p.id).length ?? 0;
  const day = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  function why(g: DuplicateGroup): string {
    if (g.kind === 'same') return 'Same wording once formatting is ignored';
    if (g.kind === 'close') return `Almost the same wording (${Math.round(g.score * 100)}% match)`;
    return `Pictures look the same (${Math.round(g.score * 100)}% match)`;
  }

  async function keep(g: DuplicateGroup, p: Problem) {
    busy = p.id;
    error = '';
    try {
      const drop = g.problems.filter((x) => x.id !== p.id).map((x) => x.id);
      await mergeProblems(p.id, drop);
      kept += drop.length;
      groups = groups!.filter((x) => x !== g);
      data = await loadPractice();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = '';
    }
  }

  async function different(g: DuplicateGroup) {
    busy = 'different';
    try {
      const settings = await getSettings();
      const pairs = new Set(settings.notDuplicates ?? []);
      for (let i = 0; i < g.problems.length; i++) {
        for (let j = i + 1; j < g.problems.length; j++) pairs.add(pairKey(g.problems[i].id, g.problems[j].id));
      }
      await saveSettings({ ...settings, notDuplicates: [...pairs] });
      groups = groups!.filter((x) => x !== g);
    } finally {
      busy = '';
    }
  }
</script>

<main class="page">
  <section class="hero">
    <div class="eyebrow"><a href={href('practice')}>Practice</a> / Duplicates</div>
    <h1>Find duplicate questions</h1>
    <p class="lead muted">
      Looks through every subject for a question that is in the app twice, even when the spacing, capitals, maths or
      chemistry formatting is a bit different, or the picture was cut a little differently. A question you put into
      several skills on purpose is not counted.
    </p>
  </section>

  {#if error}<div class="notice warn">{error}</div>{/if}
  {#if kept}<div class="notice">Deleted {plural(kept, 'extra copy', 'extra copies')}. Your goes at them moved to the copy you kept.</div>{/if}

  {#if !groups}
    <p class="muted">
      {data ? `Checking ${plural(data.problems.length, 'question')}` : 'Loading'}{pictures ? ` (pictures ${checked} of ${pictures})` : ''}...
    </p>
  {:else if groups.length === 0}
    <section class="panel empty">
      <h2>No duplicates found</h2>
      <p class="muted small">Checked {plural(data?.problems.length ?? 0, 'question')} in every subject.</p>
      <div><button class="btn" onclick={scan}>Check again</button></div>
    </section>
  {:else}
    <div class="section-head">
      <h2>{plural(groups.length, 'likely duplicate', 'likely duplicates')}</h2>
      <span class="muted small">Pick the copy to keep. The others are deleted.</span>
    </div>
    {#each groups as g (g.problems.map((p) => p.id).join())}
      <section class="group panel">
        <div class="eyebrow accent">{shortSubject(g.subject)} · {why(g)}</div>
        <div class="copies">
          {#each g.problems as p (p.id)}
            <div class="copy">
              <ProblemView image={p.questionImage} text={p.questionText} alt={p.label || 'Question'} small />
              <div class="meta small">
                <a href={href('practice', 'skill', p.skillId)}>{skillName(p)}</a>
                <span class="muted mono">{[p.label, p.from && p.from !== p.label ? p.from : '', `added ${day(p.created)}`, goes(p) ? plural(goes(p), 'go') : 'not tried yet'].filter(Boolean).join(' · ')}</span>
              </div>
              <div>
                <button class="btn small primary" onclick={() => keep(g, p)} disabled={!!busy}>
                  {busy === p.id ? 'Keeping...' : 'Keep this one'}
                </button>
              </div>
            </div>
          {/each}
        </div>
        <div class="foot">
          <button class="btn small" onclick={() => different(g)} disabled={!!busy}>Not the same, keep all</button>
        </div>
      </section>
    {/each}
  {/if}
</main>

<style>
  .hero {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .lead {
    margin: 0;
    font-size: 17px;
    max-width: 640px;
  }
  h2 {
    font-size: 15px;
    font-weight: 700;
    margin: 0;
  }
  .section-head {
    display: flex;
    gap: 12px;
    align-items: baseline;
    justify-content: space-between;
    flex-wrap: wrap;
  }
  .empty {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 20px;
  }
  .empty p {
    margin: 0;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px;
  }
  .copies {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 16px;
  }
  .copy {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .small {
    font-size: 13px;
  }
  .foot {
    border-top: 1px solid var(--line);
    padding-top: 12px;
  }
</style>
