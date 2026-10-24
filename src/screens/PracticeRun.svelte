<script lang="ts">
  import ProblemImage from '../components/ProblemImage.svelte';
  import { recordAttempt } from '../lib/db';
  import { plural } from '../lib/load';
  import { loadPractice, shortSubject, type PracticeCollection } from '../lib/practice/load';
  import {
    buildDailyMix,
    buildSkillSet,
    buildTestPrep,
    costMinutes,
    makeAttempt,
    makeSkillScheduler,
    rateSkill,
    type MixItem,
  } from '../lib/practice/mix';
  import { formatInterval, previewIntervals, RATINGS, type RatingValue } from '../lib/scheduler';
  import { href } from '../lib/router.svelte';
  import type { MethodChoice, MistakeTag, Skill } from '../lib/types';
  import type { FSRS } from 'ts-fsrs';

  let { parts }: { parts: string[] } = $props();

  interface Done {
    rating: RatingValue;
    method: MethodChoice;
  }

  let data = $state.raw<PracticeCollection | null>(null);
  let items = $state.raw<MixItem[]>([]);
  let results = $state.raw<Done[]>([]);
  let title = $state('');
  let planId: string | undefined;
  let scheduler: FSRS | null = null;
  let index = $state(0);
  let revealed = $state(false);
  let picked = $state<string | null>(null);
  let rightLetter = $state<string | null>(null);
  let method = $state<MethodChoice | null>(null);
  let confusedWith = $state('');
  let mistake = $state<MistakeTag | null>(null);
  let saving = $state(false);
  let startedAt = Date.now();
  let questionAt = $state(Date.now());
  let now = $state(Date.now());
  let loaded = $state(false);

  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  async function start() {
    const d = await loadPractice();
    data = d;
    scheduler = makeSkillScheduler(d.settings);
    const minutes = d.settings.problemMinutes;
    const [kind, ...rest] = parts;
    if (kind === 'plan') {
      const plan = d.plans.find((p) => p.id === rest[0]);
      if (plan) {
        planId = plan.id;
        title = plan.name;
        items = buildTestPrep(d, plan, minutes);
      }
    } else if (kind === 'skill') {
      const skill = d.skills.find((s) => s.id === rest[0]);
      title = skill?.name ?? 'Skill';
      items = buildSkillSet(d, rest[0], minutes);
    } else {
      title = rest.map(shortSubject).join(' + ') + ' mix';
      items = buildDailyMix(d, { subjects: rest, minutes, dayEnd: d.dayEnd });
    }
    loaded = true;
    startedAt = questionAt = Date.now();
  }
  start();

  const current = $derived(items[index]);
  const finished = $derived(loaded && index >= items.length);
  const plannedMinutes = $derived(Math.round(items.reduce((m, i) => m + costMinutes(i.problem), 0)));
  const elapsed = $derived(Math.max(0, now - startedAt));
  const onQuestion = $derived(Math.max(0, now - questionAt));
  const target = $derived(current ? (current.problem.marks || 2) * 1.5 * 60_000 : 0);
  const intervals = $derived(current && scheduler && revealed ? previewIntervals(scheduler, current.skill.fsrs) : null);
  const knownLetter = $derived(current?.problem.answerLetter ?? rightLetter);
  const otherSkills = $derived(
    data && current
      ? data.skills.filter((s) => s.subject === current.skill.subject && s.id !== current.skill.id).sort((a, b) => a.name.localeCompare(b.name))
      : [],
  );

  function clock(ms: number): string {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function reveal() {
    if (!current || revealed) return;
    revealed = true;
  }

  async function rate(rating: RatingValue) {
    if (!current || !revealed || !method || !scheduler || !data || saving) return;
    saving = true;
    const item = current;
    const at = Date.now();
    const before = item.skill;
    const after = rateSkill(scheduler, before, rating, at);
    const attempt = makeAttempt(
      {
        problemId: item.problem.id,
        skillId: before.id,
        at,
        rating,
        method,
        confusedWith: method !== 'yes' && confusedWith ? confusedWith : undefined,
        mistake: mistake ?? undefined,
        picked: picked ?? undefined,
        seconds: Math.round(Math.min(at - questionAt, 60 * 60_000) / 1000),
        planId,
      },
      before,
    );
    // The first time you say which letter was right, it is kept so next time the app can mark it.
    const problem = item.problem.mc && !item.problem.answerLetter && rightLetter ? { ...item.problem, answerLetter: rightLetter } : undefined;
    try {
      await recordAttempt(after, attempt, problem);
    } finally {
      saving = false;
    }
    // Later questions from the same skill (test prep rounds) use its new schedule.
    items = items.map((it, i) => (i > index && it.skill.id === after.id ? { ...it, skill: after } : it));
    results = [...results, { rating, method }];
    next();
  }

  function next() {
    index += 1;
    revealed = false;
    picked = null;
    rightLetter = null;
    method = null;
    confusedWith = '';
    mistake = null;
    questionAt = Date.now();
    window.scrollTo(0, 0);
  }

  function skip() {
    if (!current) return;
    // Move it to the end, in case you want to come back to it.
    const item = current;
    items = [...items.slice(0, index), ...items.slice(index + 1), item];
    revealed = false;
    picked = null;
    method = null;
    questionAt = Date.now();
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (!current) return;
    if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      reveal();
    } else if (revealed && /^[yY]$/.test(e.key)) method = 'yes';
    else if (revealed && /^[pP]$/.test(e.key)) method = 'partly';
    else if (revealed && /^[nN]$/.test(e.key)) method = 'no';
    else if (revealed && method && /^[1-4]$/.test(e.key)) rate(Number(e.key) as RatingValue);
  }

  const ratingColour: Record<number, string> = { 1: 'var(--warn)', 2: 'var(--muted)', 3: 'var(--info)', 4: 'var(--good)' };
  const MISTAKES: { value: MistakeTag; label: string }[] = [
    { value: 'slip', label: 'Careless slip' },
    { value: 'content', label: "Didn't know the content" },
    { value: 'misread', label: 'Misread the question' },
    { value: 'time', label: 'Ran out of time' },
  ];
  const sourceName = { smartered: 'SmarterEd', atarnotes: 'ATAR Notes', snip: 'Snipped' } as const;

  const summary = $derived.by(() => {
    const n = results.length;
    const right = results.filter((r) => r.method === 'yes').length;
    return {
      n,
      again: results.filter((r) => r.rating === 1).length,
      methodRight: n ? Math.round((right / n) * 100) : 0,
      minutes: Math.round(elapsed / 60_000),
    };
  });
</script>

<svelte:window onkeydown={onKey} />

<div class="run">
  <header class="bar">
    <a class="back" href={href('practice')}>{finished ? '← Practice' : '← Pause block'}</a>
    <span class="title">{title}</span>
    {#if loaded && !finished && items.length}
      <span class="mono muted time">{clock(elapsed)} of ~{plannedMinutes} min</span>
    {/if}
  </header>

  {#if loaded && items.length === 0}
    <main class="empty">
      <h1>Nothing to practise here</h1>
      <p class="muted">
        There are no questions in these skills yet, or none are switched on. Import a worksheet or tick Taught on a
        skill first.
      </p>
      <a class="btn primary" href={href('practice')}>Back to practice</a>
    </main>
  {:else if finished}
    <main class="empty">
      <div class="eyebrow accent">Block done</div>
      <h1>{plural(summary.n, 'question')} in {summary.minutes} min</h1>
      <p class="muted">
        Right method on {summary.methodRight}% of them{summary.again ? `, and ${summary.again} to come back to soon` : ''}.
        If that felt harder than doing one topic at a time, good: mixing is meant to feel that way, and it is what
        makes the methods stick for the exam.
      </p>
      <div class="actions">
        <a class="btn primary" href={href('practice')}>Back to practice</a>
        <a class="btn" href={href('today')}>Today</a>
      </div>
    </main>
  {:else if current}
    <div class="layout">
      <aside>
        <ol class="list">
          {#each items as it, i (i)}
            {@const r = results[i]}
            <li class="q" class:now={i === index} class:dim={i > index}>
              <span class="mono num">{i + 1}</span>
              <span class="grow">{i < index || (i === index && revealed) ? it.skill.name : '?'}</span>
              {#if r}
                <span class="mono small" style:color={ratingColour[r.rating]}>{RATINGS[r.rating - 1].label}</span>
              {:else if i === index}
                <span class="mono small accent">now</span>
              {/if}
            </li>
          {/each}
        </ol>
        <p class="muted small">The skills stay hidden until you reveal, so you have to work out which method each question needs.</p>
      </aside>

      <main class="work">
        <div class="q-head">
          <h1>Question {index + 1} of {items.length}</h1>
          <span class="mono muted small">
            {sourceName[current.problem.source]}{current.problem.label ? ` · ${current.problem.label}` : ''} · {plural(current.problem.marks, 'mark')}
          </span>
        </div>

        <ProblemImage id={current.problem.questionImage} alt="Question {index + 1}" />
        <div class="hint muted small">
          <span>Work it on paper{current.problem.mc ? ', then pick your letter' : ''}.</span>
          <span class="mono timer" class:over={onQuestion > target}>{clock(onQuestion)} · aim {clock(target)}</span>
        </div>

        {#if current.problem.mc}
          <div class="letters" role="group" aria-label="Your answer">
            {#each ['A', 'B', 'C', 'D'] as l (l)}
              <button
                class="chip"
                class:on={picked === l}
                class:right={revealed && knownLetter === l}
                class:wrong={revealed && picked === l && knownLetter && knownLetter !== l}
                onclick={() => !revealed && (picked = l)}
                aria-pressed={picked === l}
              >
                {l}
              </button>
            {/each}
            {#if revealed && knownLetter && picked}
              <span class="verdict" class:good={picked === knownLetter}>{picked === knownLetter ? 'Right' : `Not quite, it was ${knownLetter}`}</span>
            {/if}
          </div>
        {/if}

        {#if !revealed}
          <div class="actions">
            <button class="btn primary" onclick={reveal}>Show worked solution</button>
            <button class="btn" onclick={skip}>Skip for now</button>
            <span class="muted small keys">Space shows it</span>
          </div>
        {:else}
          <section class="solution">
            <div class="eyebrow accent">Worked solution · {current.skill.name}</div>
            {#if current.problem.solutionImage}
              <ProblemImage id={current.problem.solutionImage} alt="Worked solution" />
            {:else}
              <p class="muted">No worked solution saved for this one. Check your answer in the original source.</p>
            {/if}
          </section>

          <section class="mark panel">
            {#if current.problem.mc && !current.problem.answerLetter}
              <div class="line">
                <span class="label">Which letter was right?</span>
                {#each ['A', 'B', 'C', 'D'] as l (l)}
                  <button class="chip" class:on={rightLetter === l} onclick={() => (rightLetter = l)} aria-pressed={rightLetter === l}>{l}</button>
                {/each}
                <span class="muted small">Saved, so next time the app marks it.</span>
              </div>
            {/if}
            <div class="line">
              <span class="label">Did you pick the right method?</span>
              {#each [['yes', 'Yes'], ['partly', 'Partly'], ['no', 'No']] as [value, label] (value)}
                <button class="chip" class:on={method === value} onclick={() => (method = value as MethodChoice)} aria-pressed={method === value}>{label}</button>
              {/each}
            </div>
            {#if method && method !== 'yes' && otherSkills.length}
              <label class="line">
                <span class="label small">Which skill did you mix it up with? (optional)</span>
                <select bind:value={confusedWith}>
                  <option value="">Not sure</option>
                  {#each otherSkills as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
                </select>
              </label>
            {/if}
            <div class="line">
              <span class="label small">What went wrong? (optional)</span>
              {#each MISTAKES as m (m.value)}
                <button class="chip small" class:on={mistake === m.value} onclick={() => (mistake = mistake === m.value ? null : m.value)} aria-pressed={mistake === m.value}>{m.label}</button>
              {/each}
            </div>
            <div class="rates">
              {#each RATINGS as r (r.value)}
                <button class="rate" onclick={() => rate(r.value)} disabled={!method || saving} title={!method ? 'Answer the method question first' : ''}>
                  {r.label}
                  <span>{intervals ? formatInterval(intervals[r.value]) : ''}</span>
                </button>
              {/each}
            </div>
            <p class="muted small keys">
              Again: wrong or stuck. Hard: right but slow or shaky. Good: right. Easy: right and quick.
              {#if !method}Tap the method answer first (or press Y, P or N).{:else}Keys 1 to 4 work too.{/if}
            </p>
          </section>
        {/if}
      </main>
    </div>
  {/if}
</div>

<style>
  .run {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 24px;
    padding: 14px 32px;
    border-bottom: 1px solid var(--line);
  }
  .back {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    text-decoration: none;
    font-size: 15px;
  }
  .title {
    font-weight: 700;
  }
  .time {
    margin-left: auto;
    font-size: 13px;
  }
  .layout {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 40px;
    width: 100%;
    max-width: 1220px;
    margin: 0 auto;
    padding: 32px 32px 56px;
  }
  aside {
    flex: 1 1 220px;
    max-width: 280px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .q {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 10px 14px;
    border-radius: var(--radius);
    font-size: 15px;
  }
  .q.now {
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--accent);
    font-weight: 700;
  }
  .q.dim {
    color: var(--muted);
  }
  .num {
    width: 18px;
    color: var(--muted);
  }
  .q.now .num,
  .accent {
    color: var(--accent);
  }
  .grow {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .small {
    font-size: 13px;
  }
  aside p {
    margin: 0;
    line-height: 1.5;
  }
  .work {
    flex: 999 1 560px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .q-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
    align-items: baseline;
  }
  h1 {
    font-size: 28px;
  }
  .hint {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
    margin-top: -8px;
  }
  .timer {
    opacity: 0.7;
  }
  .timer.over {
    color: var(--accent);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
  }
  .keys {
    margin: 0;
  }
  .solution {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .mark {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 22px 24px;
    border-radius: 16px;
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .line select {
    width: auto;
    min-width: 240px;
  }
  .label {
    font-weight: 700;
    margin-right: 8px;
  }
  .label.small {
    font-weight: 400;
    color: var(--muted);
  }
  .letters {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .chip {
    min-height: 46px;
    min-width: 46px;
    padding: 0 20px;
    border: 1px solid var(--line-strong);
    border-radius: 23px;
    background: var(--surface);
    color: var(--text);
    font: 700 15px var(--font);
    cursor: pointer;
  }
  .chip.small {
    min-height: 38px;
    padding: 0 14px;
    font-weight: 400;
    font-size: 14px;
  }
  .chip.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  .chip.right {
    box-shadow: 0 0 0 2px var(--good);
  }
  .chip.wrong {
    background: var(--warn);
    border-color: var(--warn);
  }
  .verdict {
    color: var(--warn);
    font-weight: 700;
  }
  .verdict.good {
    color: var(--good);
  }
  .rates {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .rate {
    flex: 1 1 110px;
    min-height: 60px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border: 1px solid var(--line-strong);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
    font: 700 16px var(--font);
    cursor: pointer;
  }
  .rate:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .rate:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .rate span {
    font: 400 12px var(--mono);
    color: var(--muted);
  }
  .empty {
    max-width: 640px;
    margin: 0 auto;
    padding: 64px 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .empty p {
    margin: 0;
    font-size: 17px;
  }
  @media (max-width: 640px) {
    .bar {
      padding: 8px 16px;
    }
    .layout {
      padding: 20px 16px 48px;
      gap: 24px;
    }
    aside {
      max-width: none;
      order: 2;
    }
  }
</style>
