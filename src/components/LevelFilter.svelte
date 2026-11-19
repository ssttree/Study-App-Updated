<script lang="ts">
  // Chooses which textbook levels (Foundation, Mastery, Complex) come up in
  // practice. Saved in settings, so the daily mix, test prep, homework and
  // single-skill sets all follow it.
  import { getSettings, saveSettings } from '../lib/db';
  import { LEVEL_NAMES, LEVELS } from '../lib/practice/mix';
  import type { Problem, ProblemLevel } from '../lib/types';

  let {
    problems,
    levels,
    onchange,
  }: { problems: Pick<Problem, 'level'>[]; levels: ProblemLevel[] | undefined; onchange?: (levels: ProblemLevel[]) => void } = $props();

  const counts = $derived(Object.fromEntries(LEVELS.map((l) => [l, problems.filter((p) => p.level === l).length])) as Record<ProblemLevel, number>);
  const chosen = $derived(levels ?? LEVELS);

  async function toggle(level: ProblemLevel) {
    let next = chosen.includes(level) ? chosen.filter((l) => l !== level) : [...chosen, level];
    // Never filter everything out: switching off the last level switches the others back on.
    if (!next.length) next = LEVELS.filter((l) => l !== level);
    next = LEVELS.filter((l) => next.includes(l));
    const settings = await getSettings();
    await saveSettings({ ...settings, levels: next.length === LEVELS.length ? undefined : next });
    onchange?.(next);
  }
</script>

<div class="levels" role="group" aria-label="Textbook levels to practise">
  <span class="muted small">Textbook levels</span>
  {#each LEVELS as l (l)}
    <button type="button" class="chip {l}" class:on={chosen.includes(l)} aria-pressed={chosen.includes(l)} onclick={() => toggle(l)}>
      {LEVEL_NAMES[l]} <span class="mono">{counts[l]}</span>
    </button>
  {/each}
</div>

<style>
  .levels {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .levels > span {
    margin-right: 4px;
  }
  .small {
    font-size: 13px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 0 12px;
    border-radius: 18px;
    border: 1px solid var(--line-strong);
    background: transparent;
    color: var(--muted);
    font: 400 14px var(--font);
    cursor: pointer;
  }
  .chip::before {
    content: '';
    width: 9px;
    height: 9px;
    background: var(--c);
    opacity: 0.45;
  }
  .chip .mono {
    font: 400 12px var(--mono);
    color: var(--dim);
  }
  .chip.on {
    border-color: var(--c);
    color: var(--text);
    background: color-mix(in srgb, var(--c) 12%, transparent);
  }
  .chip.on::before {
    opacity: 1;
  }
  .foundation {
    --c: var(--good);
  }
  .foundation::before {
    border-radius: 2px;
  }
  .mastery {
    --c: var(--info);
  }
  .mastery::before {
    border-radius: 50%;
  }
  .complex {
    --c: #ff7a7a;
  }
  .complex::before {
    clip-path: polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%);
  }
</style>
