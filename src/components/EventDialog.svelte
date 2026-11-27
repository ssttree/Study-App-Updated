<script lang="ts" module>
  import type { BlockTemplate, PlanItem } from '../lib/types';
  import type { BuiltDay } from '../lib/planner/build';

  /** What the window is open for. */
  export type EventTarget =
    | { mode: 'new'; date: string; start: string; minutes?: number }
    | { mode: 'item'; day: BuiltDay; item: PlanItem }
    | { mode: 'block'; block: BlockTemplate | null };
</script>

<script lang="ts">
  // One window for three jobs: adding an event by hand, opening anything on
  // the calendar to choose what you'll study in it (and start it), and making
  // or changing one of your reusable blocks.
  import StudyPicker from './StudyPicker.svelte';
  import { completeItem, deleteBlock, placeItem, removeItem, reopenItem, saveBlock, updateItem } from '../lib/planner/actions';
  import { changedItem, eventItem, SESSION_TYPES } from '../lib/planner/blocks';
  import { decksLink, hasPick, itemLink, itemText, skillsLink, type StudyNames } from '../lib/planner/labels';
  import { clockMinutes, clockText, dayLabel } from '../lib/planner/dates';
  import type { PlannerData } from '../lib/planner/load';
  import { newId } from '../lib/db';
  import { rememberSession } from '../lib/planner/active';
  import { SUBJECTS, type SessionType, type StudyPick } from '../lib/types';

  let {
    target,
    data,
    names,
    onclose,
    onchanged,
    ondone,
  }: {
    target: EventTarget;
    data: PlannerData;
    names: StudyNames;
    onclose: () => void;
    /** Something was saved: reload the planner. */
    onchanged: () => Promise<void> | void;
    /** A session was ticked off here: the planner cheers. */
    ondone?: () => void;
  } = $props();

  // The window is made fresh for each target, so the starting values are read once.
  // svelte-ignore state_referenced_locally
  const t = target;
  const item = t.mode === 'item' ? t.item : null;
  const isEvent = t.mode === 'new' || t.mode === 'block' || item?.kind === 'event';
  const tasks = $derived(new Map(data.tasks.map((x) => [x.id, x])));
  const assessments = $derived(new Map(data.assessments.map((x) => [x.id, x])));
  const text = $derived(item ? itemText(item, tasks, assessments, data.today, names) : null);

  let title = $state(t.mode === 'block' ? (t.block?.name ?? '') : item?.kind === 'event' ? (item.title ?? '') : '');
  let date = $state(t.mode === 'new' ? t.date : t.mode === 'item' ? t.day.date : '');
  let start = $state(t.mode === 'new' ? t.start : (item?.start ?? ''));
  let minutes = $state(t.mode === 'block' ? (t.block?.minutes ?? 30) : t.mode === 'new' ? (t.minutes ?? 30) : (item?.minutes ?? 30));
  let study = $state<StudyPick>(structuredClone((t.mode === 'block' ? t.block?.study : item?.study) ?? {}));
  let session = $state<SessionType | undefined>(t.mode === 'block' ? t.block?.session : item?.session);
  let subject = $state((t.mode === 'block' ? t.block?.subject : item?.kind === 'event' ? item.subjects?.[0] : '') ?? '');
  let notes = $state((t.mode === 'block' ? t.block?.notes : item?.notes) ?? '');
  let asBlock = $state(false);
  let saving = $state(false);
  let error = $state('');

  const heading = $derived(
    t.mode === 'new' ? 'Add an event' : t.mode === 'block' ? (t.block ? 'Change block' : 'New block') : (text?.title ?? 'Event'),
  );
  const done = item?.status === 'done';
  /** The subject to open the lists on: the item's own, if it has one. */
  const subjectHint = $derived(subject || (item?.subjects?.[0] ?? (item?.taskId ? tasks.get(item.taskId)?.subject : '') ?? ''));

  let dialog = $state<HTMLDialogElement | null>(null);
  $effect(() => {
    dialog?.showModal();
  });

  /** Saves what's in the window. Returns false if something's missing. */
  async function save(started = false): Promise<boolean> {
    error = '';
    if (t.mode === 'block') {
      if (!title.trim()) return fail('Give the block a name.');
      await saveBlock(data.availability, { id: t.block?.id ?? newId(), name: title, minutes, study, session, subject, notes });
      return true;
    }
    if (t.mode === 'new') {
      if (!title.trim()) return fail('Give the event a name.');
      if (!date || date < data.today) return fail('Pick today or a later day.');
      await placeItem(data.days, date, eventItem({ title, start: start || undefined, minutes, study, session, subject, notes }));
      if (asBlock) await saveBlock(data.availability, { id: newId(), name: title, minutes, study, session, subject, notes });
      return true;
    }
    if (item && t.mode === 'item') {
      await updateItem(t.day, item, {
        title: item.kind === 'event' ? title : undefined,
        minutes,
        start: start || undefined,
        study,
        session,
        subject: isEvent ? subject : undefined,
        notes,
        started,
      });
    }
    return true;
  }
  /** Ticks it off with what's in the window kept (one save, so nothing is lost). */
  async function markDone(it: PlanItem) {
    if (t.mode !== 'item') return;
    const changed = changedItem(it, { title: it.kind === 'event' ? title : undefined, minutes, start: start || undefined, study, session, subject: isEvent ? subject : undefined, notes });
    const day = { ...t.day, plan: { ...t.day.plan, items: t.day.plan.items.map((x) => (x.id === it.id ? changed : x)) } };
    await completeItem(day, changed, data.tasks);
  }
  function fail(message: string): false {
    error = message;
    return false;
  }

  /** Runs a change, tells the planner, and closes. */
  async function run(fn: () => Promise<unknown>) {
    if (saving) return;
    saving = true;
    try {
      await fn();
      await onchanged();
      dialog?.close();
    } finally {
      saving = false;
    }
  }

  // Start: saves what you picked, marks the item started, then opens the study.
  const picked = $derived({ ...item, study, minutes } as PlanItem);
  const practiceLink = $derived(skillsLink(study, minutes));
  const cardsLink = $derived(decksLink(study));
  const defaultLink = $derived(item && !hasPick(study) ? itemLink(picked, tasks) : '');
  async function startWith(link: string) {
    if (saving || !item || t.mode !== 'item') return;
    saving = true;
    try {
      await save(true);
      rememberSession(t.day.date, item.id);
      location.hash = link;
    } finally {
      saving = false;
    }
  }
  const canStart = $derived(t.mode === 'item' && !!item && !done && t.day.date >= data.today);
  const lengths = [15, 20, 30, 45, 60, 75, 90, 120, 180];
  const lengthOptions = $derived(lengths.includes(minutes) ? lengths : [...lengths, minutes].sort((a, b) => a - b));
</script>

<dialog bind:this={dialog} class="ev-dialog" aria-labelledby="ev-title" {onclose}>
  <form
    method="dialog"
    onsubmit={(e) => {
      e.preventDefault();
      run(async () => {
        if (!(await save())) throw new Error('missing');
      }).catch(() => {});
    }}
  >
    <div class="head">
      <div>
        <h2 id="ev-title">{heading}</h2>
        {#if t.mode === 'item'}
          <p class="muted small sub">
            {dayLabel(t.day.date, data.today)}{item?.start ? ` · ${clockText(clockMinutes(item.start))}` : ''}{text?.detail && !isEvent ? ` · ${text.detail}` : ''}
          </p>
        {:else if t.mode === 'block'}
          <p class="muted small sub">A block you can drag onto the calendar whenever you want this session.</p>
        {/if}
      </div>
      <button type="button" class="btn small" onclick={() => dialog?.close()}>Close</button>
    </div>

    <div class="fields">
      {#if isEvent}
        <label class="field name">
          Name
          <!-- svelte-ignore a11y_autofocus -->
          <input type="text" bind:value={title} placeholder={t.mode === 'block' ? 'e.g. Chem flashcards' : 'e.g. Ext 2 proofs, or Dentist'} autofocus={t.mode !== 'item'} />
        </label>
      {/if}
      {#if t.mode === 'new'}
        <label class="field">Day<input type="date" bind:value={date} min={data.today} /></label>
      {/if}
      {#if t.mode !== 'block'}
        <label class="field">Starts<input type="time" step="900" bind:value={start} /></label>
      {/if}
      {#if isEvent}
        <label class="field">
          Subject
          <select bind:value={subject}>
            <option value="">No subject</option>
            {#each SUBJECTS as s (s)}<option value={s}>{s}</option>{/each}
          </select>
        </label>
      {/if}
      <label class="field">
        Length
        <select bind:value={minutes}>
          {#each lengthOptions as m (m)}<option value={m}>{m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`}</option>{/each}
        </select>
      </label>
    </div>

    <label class="field notes">
      Description
      <textarea rows="2" bind:value={notes} placeholder="e.g. Ex 4.08 Q1 to 12, then check answers. Bring the formula sheet."></textarea>
    </label>

    <section class="session">
      <h3 id="session-label">Type of session</h3>
      <div class="session-pick" role="radiogroup" aria-labelledby="session-label">
        {#each SESSION_TYPES as s (s.value)}
          <button
            type="button"
            role="radio"
            aria-checked={session === s.value}
            class="session-opt {s.value}"
            class:on={session === s.value}
            onclick={() => (session = session === s.value ? undefined : s.value)}
          >
            <strong>{s.label}</strong>
            <span class="small">{s.help}</span>
          </button>
        {/each}
      </div>
    </section>

    <section class="study">
      <h3>What you'll study</h3>
      {#if item && !isEvent && !hasPick(study)}
        <p class="muted small">Start opens {text?.title ?? 'this'} as usual. Pick skills or decks to study something else in this time instead.</p>
      {/if}
      <StudyPicker skills={data.practice.skills} decks={data.decks} value={study} onchange={(v) => (study = v)} {subjectHint} />
    </section>

    {#if t.mode === 'new'}
      <label class="check">
        <input type="checkbox" bind:checked={asBlock} />
        Also keep it as a block, to drag in again next time
      </label>
    {/if}

    {#if error}<p class="warn small">{error}</p>{/if}

    <div class="foot">
      {#if canStart}
        {#if practiceLink}<button type="button" class="btn primary" disabled={saving} onclick={() => startWith(practiceLink)}>Start practice</button>{/if}
        {#if cardsLink}<button type="button" class="btn" class:primary={!practiceLink} disabled={saving} onclick={() => startWith(cardsLink)}>Start flashcards</button>{/if}
        {#if defaultLink}<button type="button" class="btn primary" disabled={saving} onclick={() => startWith(defaultLink)}>Start</button>{/if}
      {/if}
      <button type="submit" class="btn" class:primary={!canStart || !(practiceLink || cardsLink || defaultLink)} disabled={saving}>
        {t.mode === 'new' ? 'Add to calendar' : t.mode === 'block' ? 'Save block' : 'Save'}
      </button>
      <span class="grow"></span>
      {#if t.mode === 'item' && item}
        {#if item.status === 'done'}
          <button type="button" class="btn small" disabled={saving} onclick={() => run(() => reopenItem(t.day, item, data.tasks))}>Not done</button>
        {:else}
          <button type="button" class="btn small" disabled={saving} onclick={() => run(() => markDone(item)).then(() => ondone?.())}>Done</button>
        {/if}
        <button type="button" class="btn small danger" disabled={saving} onclick={() => run(() => removeItem(t.day, item))}>Take off calendar</button>
      {:else if t.mode === 'block' && t.block}
        <button type="button" class="btn small danger" disabled={saving} onclick={() => run(() => deleteBlock(data.availability, t.block!.id))}>Delete block</button>
      {/if}
    </div>
  </form>
</dialog>

<style>
  .session {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .session-pick {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
  }
  .session-opt {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    text-align: left;
    padding: 12px 14px;
    border-radius: var(--radius);
    border: 1px solid var(--line-strong);
    background: transparent;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .session-opt span {
    color: var(--muted);
  }
  .session-opt.on.apply {
    border-color: var(--info);
    background: color-mix(in srgb, var(--info) 14%, transparent);
  }
  .session-opt.on.practice {
    border-color: var(--good);
    background: color-mix(in srgb, var(--good) 14%, transparent);
  }
  .ev-dialog {
    width: min(760px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    padding: 20px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
  }
  .ev-dialog::backdrop {
    background: rgb(0 0 0 / 55%);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }
  h2 {
    font-size: 20px;
    margin: 0;
  }
  h3 {
    font-size: 15px;
    margin: 0 0 8px;
  }
  .sub {
    margin: 4px 0 0;
  }
  .small {
    font-size: 13px;
  }
  .fields {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr;
    gap: 12px;
  }
  @media (max-width: 640px) {
    .fields {
      grid-template-columns: 1fr 1fr;
    }
    .name {
      grid-column: 1 / -1;
    }
  }
  .fields input[type='time'],
  .fields input[type='date'] {
    min-height: 44px;
    padding: 10px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    font: 400 16px var(--font);
    color-scheme: dark;
  }
  .check {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    font-size: 14px;
  }
  .check input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
  .warn {
    color: var(--warn);
    margin: 0;
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .grow {
    flex: 1;
  }
</style>
