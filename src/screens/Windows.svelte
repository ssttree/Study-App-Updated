<script lang="ts">
  import { getAvailability, getSettings, newId, saveAvailability } from '../lib/db';
  import { defaultAvailability, inSoccerSeason, templateWindows, weeklyMinutes } from '../lib/planner/availability';
  import { dayLabel, minutesText, todayKey, WEEKDAYS } from '../lib/planner/dates';
  import { KIND_HINT, KIND_TEXT } from '../lib/planner/labels';
  import { href } from '../lib/router.svelte';
  import type { Availability, Season, StudyWindow, WindowKind } from '../lib/types';

  let a = $state<Availability | null>(null);
  let today = $state('');
  let season = $state<'off' | 'soccer'>('off');
  let saved = $state(false);
  let dirty = $state(false);
  let oneOff = $state('');

  const ORDER = [1, 2, 3, 4, 5, 6, 0];
  const KINDS: WindowKind[] = ['bus', 'desk', 'flexible'];
  const SEASONS: { value: Season; label: string }[] = [
    { value: 'all', label: 'All year' },
    { value: 'off', label: 'Off season only' },
    { value: 'soccer', label: 'Soccer season only' },
  ];

  async function load() {
    const settings = await getSettings();
    today = todayKey(Date.now(), settings.dayStartHour);
    a = await getAvailability();
    season = inSoccerSeason(today, a) ? 'soccer' : 'off';
    oneOff = today;
  }
  load();

  const shown = $derived(a ? a.windows.filter((w) => w.season === 'all' || w.season === season) : []);
  const totals = $derived(a ? weeklyMinutes($state.snapshot(a) as Availability, season) : null);
  const overrides = $derived(
    a
      ? Object.keys(a.overrides)
          .filter((k) => k >= today)
          .sort()
      : [],
  );
  const oneOffWindows = $derived(a && oneOff ? (a.overrides[oneOff] ?? null) : null);

  function changed() {
    dirty = true;
    saved = false;
  }

  function toggleDay(w: StudyWindow, day: number) {
    w.days = w.days.includes(day) ? w.days.filter((d) => d !== day) : [...w.days, day].sort();
    changed();
  }

  function addWindow() {
    if (!a) return;
    a.windows.push({ id: newId(), name: 'New window', days: [1, 2, 3, 4, 5], start: '19:00', minutes: 30, kind: 'desk', season: 'all' });
    changed();
  }

  function removeWindow(w: StudyWindow) {
    if (!a) return;
    a.windows = a.windows.filter((x) => x.id !== w.id);
    changed();
  }

  function toggleTraining(day: number) {
    if (!a) return;
    a.trainingDays = a.trainingDays.includes(day) ? a.trainingDays.filter((d) => d !== day) : [...a.trainingDays, day].sort();
    changed();
  }

  /** MM-DD stored; shown as a date in the current year. */
  const mdToDate = (md: string) => `${today.slice(0, 4)}-${md}`;
  function setSeason(which: 'soccerStart' | 'soccerEnd', value: string) {
    if (!a || !value) return;
    a[which] = value.slice(5);
    changed();
  }

  function editDay() {
    if (!a || !oneOff) return;
    a.overrides[oneOff] = templateWindows(oneOff, $state.snapshot(a) as Availability).map((w) => ({ ...w, days: [] }));
    changed();
  }
  function dayOff() {
    if (!a || !oneOff) return;
    a.overrides[oneOff] = [];
    changed();
  }
  function backToNormal(key: string) {
    if (!a) return;
    delete a.overrides[key];
    changed();
  }
  function addToDay() {
    if (!a || !oneOff) return;
    (a.overrides[oneOff] ??= []).push({ id: newId(), name: 'Extra', days: [], start: '10:00', minutes: 45, kind: 'desk', season: 'all' });
    changed();
  }

  async function save() {
    if (!a) return;
    const clean = $state.snapshot(a) as Availability;
    for (const w of clean.windows) w.minutes = Math.max(5, Math.round(Number(w.minutes) || 30));
    // Old one-off days are not needed any more.
    for (const k of Object.keys(clean.overrides)) if (k < today) delete clean.overrides[k];
    await saveAvailability(clean);
    a = clean;
    dirty = false;
    saved = true;
    setTimeout(() => (saved = false), 2000);
  }

  function reset() {
    if (!confirm('Go back to the starting windows? Your one-off days are kept.')) return;
    if (!a) return;
    a = { ...defaultAvailability(), overrides: $state.snapshot(a.overrides) };
    changed();
  }
</script>

<main class="page wide">
  <section class="head">
    <div class="eyebrow"><a href={href('planner')}>Planner</a> / Study windows</div>
    <h1>Study windows</h1>
    <p class="muted">
      The times you <em>can</em> study in a normal week. Each window has a kind that tells the planner what fits there.
      Change a single day below for one-offs like a late shift or an excursion.
    </p>
  </section>

  {#if a}
    <div class="tabs" role="tablist">
      <button role="tab" class="btn small" class:on={season === 'off'} aria-selected={season === 'off'} onclick={() => (season = 'off')}>
        Off season
      </button>
      <button
        role="tab"
        class="btn small"
        class:on={season === 'soccer'}
        aria-selected={season === 'soccer'}
        onclick={() => (season = 'soccer')}
      >
        Soccer season
      </button>
      {#if totals}
        <span class="mono muted small">
          {minutesText(totals.desk)} desk · {minutesText(totals.bus)} bus · {minutesText(totals.flexible)} flexible a week
        </span>
      {/if}
    </div>

    {#if season === 'soccer'}
      <section class="panel season">
        <label class="field">Season starts<input type="date" value={mdToDate(a.soccerStart)} onchange={(e) => setSeason('soccerStart', e.currentTarget.value)} /></label>
        <label class="field">Season ends<input type="date" value={mdToDate(a.soccerEnd)} onchange={(e) => setSeason('soccerEnd', e.currentTarget.value)} /></label>
        <div class="field">
          <span>Training nights (desk windows from 4pm drop out)</span>
          <div class="days">
            {#each ORDER as d (d)}
              <button class="day" class:on={a.trainingDays.includes(d)} aria-pressed={a.trainingDays.includes(d)} onclick={() => toggleTraining(d)}>
                {WEEKDAYS[d].slice(0, 3)}
              </button>
            {/each}
          </div>
        </div>
      </section>
    {/if}

    <section>
      {#each shown as w (w.id)}
        <div class="window panel">
          <div class="line">
            <label class="field grow">Name<input type="text" bind:value={w.name} oninput={changed} /></label>
            <label class="field">Starts<input type="time" bind:value={w.start} oninput={changed} /></label>
            <label class="field">Minutes<input type="number" min="5" max="600" step="5" bind:value={w.minutes} oninput={changed} /></label>
            <label class="field">
              Kind
              <select bind:value={w.kind} onchange={changed}>
                {#each KINDS as k (k)}<option value={k}>{KIND_TEXT[k]}</option>{/each}
              </select>
            </label>
            <label class="field">
              When
              <select bind:value={w.season} onchange={changed}>
                {#each SEASONS as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
              </select>
            </label>
          </div>
          <div class="line">
            <div class="days" role="group" aria-label="Days">
              {#each ORDER as d (d)}
                <button class="day" class:on={w.days.includes(d)} aria-pressed={w.days.includes(d)} onclick={() => toggleDay(w, d)}>
                  {WEEKDAYS[d].slice(0, 3)}
                </button>
              {/each}
            </div>
            <span class="muted small grow">{KIND_HINT[w.kind]}</span>
            <button class="btn small danger" onclick={() => removeWindow(w)}>Remove</button>
          </div>
        </div>
      {/each}
      <div class="actions">
        <button class="btn" onclick={addWindow}>Add a window</button>
        <button class="btn" onclick={reset}>Back to the starting windows</button>
      </div>
    </section>

    <section>
      <h2>One-off days</h2>
      <p class="muted small">
        Changes to a single day, like a late shift or a day off. Once Google Calendar is connected your work shifts will
        do this by themselves.
      </p>
      <div class="actions">
        <input type="date" bind:value={oneOff} min={today} />
        {#if oneOffWindows === null}
          <button class="btn small" onclick={editDay} disabled={!oneOff}>Change this day</button>
          <button class="btn small" onclick={dayOff} disabled={!oneOff}>Make it a day off</button>
        {:else}
          <button class="btn small" onclick={addToDay}>Add a window</button>
          <button class="btn small" onclick={() => backToNormal(oneOff)}>Back to normal</button>
        {/if}
      </div>
      {#if oneOffWindows}
        {#each oneOffWindows as w (w.id)}
          <div class="row">
            <input class="name-in" type="text" bind:value={w.name} oninput={changed} aria-label="Name" />
            <input type="time" bind:value={w.start} oninput={changed} aria-label="Starts" />
            <input class="mins-in" type="number" min="5" step="5" bind:value={w.minutes} oninput={changed} aria-label="Minutes" />
            <select class="kind-in" bind:value={w.kind} onchange={changed} aria-label="Kind">
              {#each KINDS as k (k)}<option value={k}>{KIND_TEXT[k]}</option>{/each}
            </select>
            <button
              class="btn small"
              onclick={() => {
                a!.overrides[oneOff] = a!.overrides[oneOff].filter((x) => x.id !== w.id);
                changed();
              }}>Remove</button
            >
          </div>
        {:else}
          <p class="muted small">A day off: no windows.</p>
        {/each}
      {/if}
      {#each overrides as k (k)}
        <div class="row">
          <span class="dot" style:background="var(--accent)"></span>
          <button class="linkish grow" onclick={() => (oneOff = k)}>{dayLabel(k, today)}</button>
          <span class="mono muted small">
            {a.overrides[k].length ? a.overrides[k].map((w) => `${w.name} ${w.minutes} min`).join(', ') : 'day off'}
          </span>
          <button class="btn small" onclick={() => backToNormal(k)}>Back to normal</button>
        </div>
      {/each}
    </section>

    <div class="save-bar">
      <button class="btn primary" onclick={save} disabled={!dirty}>Save windows</button>
      {#if saved}<span class="muted">Saved. The planner rebuilds around them.</span>{/if}
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
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .btn.on,
  .day.on {
    background: var(--text);
    border-color: var(--text);
    color: var(--bg);
  }
  .small {
    font-size: 13px;
  }
  .season {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 14px;
    padding: 18px;
  }
  div.field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
    color: var(--muted);
  }
  .window {
    padding: 14px 16px;
    margin-bottom: 10px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 14px;
    align-items: flex-end;
  }
  .line .field {
    min-width: 110px;
  }
  .grow {
    flex: 1 1 200px;
  }
  .days {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .day {
    min-width: 44px;
    min-height: 36px;
    border-radius: 18px;
    border: 1px solid var(--line-strong);
    background: transparent;
    color: var(--muted);
    font: 400 13px var(--mono);
    cursor: pointer;
  }
  input[type='time'],
  input[type='date'] {
    min-height: 44px;
    padding: 8px 12px;
    border-radius: 10px;
    border: 1px solid var(--line-strong);
    background: var(--surface);
    color: var(--text);
    font: 400 15px var(--font);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    margin: 8px 0;
  }
  .name-in {
    flex: 1 1 160px;
    width: auto;
  }
  .mins-in {
    width: 90px;
  }
  .kind-in {
    width: auto;
  }
  .linkish {
    background: none;
    border: 0;
    color: var(--accent);
    font: inherit;
    text-align: left;
    cursor: pointer;
    padding: 0;
  }
  .save-bar {
    position: sticky;
    bottom: 0;
    display: flex;
    gap: 14px;
    align-items: center;
    padding: 14px 0;
    background: var(--bg);
    border-top: 1px solid var(--line);
  }
</style>
