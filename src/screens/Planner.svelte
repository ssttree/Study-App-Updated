<script lang="ts">
  import QuickAdd from '../components/QuickAdd.svelte';
  import { loadPlanner, type PlannerData } from '../lib/planner/load';
  import {
    addItem,
    completeItem,
    dropTask,
    moveItem,
    reopenItem,
    rescheduleTask,
    setSubject,
    shrinkTask,
    skipItem,
    startItem,
    togglePin,
  } from '../lib/planner/actions';
  import { ASK_AFTER_CARRIES, EXTRA_WINDOW, extraItem, type BuiltDay } from '../lib/planner/build';
  import { addDays, clockMinutes, dayLabel, dueLabel, minutesText } from '../lib/planner/dates';
  import { itemColour, itemLink, itemText, KIND_TEXT, windowTime } from '../lib/planner/labels';
  import { stageOf, STAGE_LABEL } from '../lib/planner/assessments';
  import { shortSubject } from '../lib/practice/load';
  import { plural } from '../lib/load';
  import { href } from '../lib/router.svelte';
  import type { PlanItem, StudyWindow, Task } from '../lib/types';

  let data = $state.raw<PlannerData | null>(null);
  let busy = $state(false);
  let dragging = $state<string | null>(null);
  let over = $state<string | null>(null);

  async function reload() {
    data = await loadPlanner();
  }
  reload();

  /** Runs a change, then rebuilds the plan around it. */
  async function act(fn: () => Promise<unknown>) {
    if (busy) return;
    busy = true;
    try {
      await fn();
      await reload();
    } finally {
      busy = false;
    }
  }

  const tasks = $derived(new Map((data?.tasks ?? []).map((t) => [t.id, t])));
  const assessments = $derived(new Map((data?.assessments ?? []).map((a) => [a.id, a])));
  const today = $derived(data?.days[0]);

  /** Flashcards count as done once nothing is left to review today. */
  function isDone(item: PlanItem): boolean {
    if (item.status === 'done') return true;
    return item.kind === 'flashcards' && !!data && data.cardsLeft === 0 && data.logsToday.length > 0;
  }

  /** The next thing: the first unfinished item in a window that hasn't ended yet, else anything left. */
  const next = $derived.by(() => {
    if (!today || !data) return undefined;
    const open = today.plan.items.filter((it) => it.status === 'todo' && !isDone(it) && !it.optional);
    const d = new Date(data.now);
    const nowMinutes = d.getHours() * 60 + d.getMinutes();
    const ends = (it: PlanItem) => {
      const w = today.windows.find((x) => x.id === it.windowId);
      return w ? clockMinutes(w.start) + w.minutes : 24 * 60;
    };
    return open.find((it) => ends(it) > nowMinutes) ?? open[0];
  });
  const slipping = $derived(
    (data?.tasks ?? []).filter((t) => t.status === 'open' && t.assessmentId && data && t.due < data.today),
  );
  const asks = $derived((data?.tasks ?? []).filter((t) => t.status === 'open' && t.carryOvers >= ASK_AFTER_CARRIES));
  const soon = $derived(
    (data?.assessments ?? [])
      .filter((a) => {
        const s = data ? stageOf(a, data.today) : 'none';
        return s === 'build' || s === 'focus' || s === 'final';
      })
      .sort((a, b) => a.date - b.date),
  );
  const subjects = $derived([...new Set((data?.practice.skills ?? []).map((s) => s.subject))].sort());

  function groups(day: BuiltDay): { window: StudyWindow | null; id: string; items: PlanItem[] }[] {
    const out = day.windows.map((w) => ({ window: w as StudyWindow | null, id: w.id, items: day.plan.items.filter((it) => it.windowId === w.id) }));
    const extra = day.plan.items.filter((it) => it.windowId === EXTRA_WINDOW);
    if (extra.length) out.push({ window: null, id: EXTRA_WINDOW, items: extra });
    return out;
  }

  function moveTargets(): { value: string; label: string }[] {
    if (!data) return [];
    const out: { value: string; label: string }[] = [];
    for (const d of data.days) {
      for (const w of d.windows) out.push({ value: `${d.date}|${w.id}`, label: `${dayLabel(d.date, data.today)} · ${w.name}` });
    }
    return out;
  }

  function onMove(day: BuiltDay, item: PlanItem, e: Event) {
    const select = e.currentTarget as HTMLSelectElement;
    const [date, windowId] = select.value.split('|');
    select.value = '';
    if (date && windowId && data) act(() => moveItem(data!.days, day.date, item.id, date, windowId));
  }

  function snooze(day: BuiltDay, item: PlanItem) {
    if (!data) return;
    const tomorrow = data.days.find((d) => d.date === addDays(day.date, 1));
    if (!tomorrow) return;
    const kind = item.kind === 'flashcards' ? 'bus' : item.optional ? 'flexible' : 'desk';
    const w = tomorrow.windows.find((x) => x.kind === kind) ?? tomorrow.windows.find((x) => x.kind === 'desk') ?? tomorrow.windows[0];
    act(() => moveItem(data!.days, day.date, item.id, tomorrow.date, w?.id ?? EXTRA_WINDOW));
  }

  function onSubject(day: BuiltDay, item: PlanItem, e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value;
    if (value) act(() => setSubject(day, item, [value]));
  }

  function moreTime() {
    if (!data || !today) return;
    const item = extraItem(today, data.input);
    if (item) act(() => addItem(today!, item));
  }

  function startLink(day: BuiltDay, item: PlanItem) {
    // Opening an item marks it started, so a rebuild leaves it alone.
    startItem(day, item);
  }

  // Drag and drop between windows and days.
  function dragStart(e: DragEvent, day: BuiltDay, item: PlanItem) {
    dragging = `${day.date}|${item.id}`;
    e.dataTransfer?.setData('text/plain', dragging);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }
  function dragOver(e: DragEvent, zone: string) {
    if (!dragging) return;
    e.preventDefault();
    over = zone;
  }
  function drop(e: DragEvent, date: string, windowId: string) {
    e.preventDefault();
    const payload = e.dataTransfer?.getData('text/plain') || dragging;
    dragging = over = null;
    if (!payload || !data) return;
    const [fromDate, itemId] = payload.split('|');
    act(() => moveItem(data!.days, fromDate, itemId, date, windowId));
  }

  function newDate(task: Task, e: Event) {
    const value = (e.currentTarget as HTMLInputElement).value;
    if (value) act(() => rescheduleTask(task, value));
  }

  const planned = (day: BuiltDay) => day.plan.items.filter((it) => it.status !== 'skipped').reduce((m, it) => m + it.minutes, 0);
</script>

<main class="page wide">
  {#if data && today}
    <section class="hero">
      <div class="eyebrow accent">
        Planner · {new Date(data.now).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
      </div>
      {#if next}
        {@const text = itemText(next, tasks, assessments, data.today)}
        <h1>Next: {text.title}</h1>
        <p class="lead muted">
          {minutesText(next.minutes)} in {today.windows.find((w) => w.id === next.windowId)?.name ?? 'extra time'}. {text.detail}.
        </p>
        <div class="actions">
          <a class="btn primary" href={itemLink(next, tasks)} onclick={() => startLink(today, next)}>Start</a>
          <button class="btn" onclick={moreTime} disabled={busy}>I've got 20 more minutes</button>
        </div>
      {:else if today.windows.length === 0}
        <h1>No study windows today</h1>
        <p class="lead muted">Enjoy the day off. Your next windows are below.</p>
        <div class="actions"><button class="btn" onclick={moreTime} disabled={busy}>I've got 20 minutes anyway</button></div>
      {:else}
        <h1>Today's plan is done</h1>
        <p class="lead muted">Everything planned for today is ticked off or skipped.</p>
        <div class="actions"><button class="btn primary" onclick={moreTime} disabled={busy}>I've got 20 more minutes</button></div>
      {/if}
    </section>

    <section class="panel add">
      <QuickAdd today={data.today} onadded={() => reload()} />
    </section>

    {#each today.warnings as w (w)}<div class="notice warn">{w}</div>{/each}
    {#each slipping as t (t.id)}
      <div class="notice warn">
        The milestone "{t.title}" for {assessments.get(t.assessmentId!)?.name ?? 'an assignment'} is slipping, now
        {dueLabel(t.due, data.today)}. <a href={href('planner', 'exam', t.assessmentId!)}>Look at the assignment</a>
      </div>
    {/each}

    {#each asks as t (t.id)}
      <div class="notice ask">
        <div>
          <strong>"{t.title}"</strong> has been carried over {t.carryOvers} times. What should happen to it?
        </div>
        <div class="ask-actions">
          <label class="inline">
            <span class="small">New due date</span>
            <input type="date" value={t.due} onchange={(e) => newDate(t, e)} />
          </label>
          <button class="btn small" onclick={() => act(() => shrinkTask(t, Math.max(5, Math.round((t.minutes - t.spent) / 2))))}>
            Shrink to {Math.max(5, Math.round((t.minutes - t.spent) / 2))} min
          </button>
          <button class="btn small danger" onclick={() => act(() => dropTask(t))}>Drop it</button>
        </div>
      </div>
    {/each}

    <section>
      <div class="section-head">
        <h2>Today</h2>
        <span class="mono muted small">{minutesText(planned(today))} planned</span>
      </div>
      {#each groups(today) as g (g.id)}
        <div
          class="window"
          class:over={over === `${today.date}|${g.id}`}
          role="list"
          ondragover={(e) => dragOver(e, `${today.date}|${g.id}`)}
          ondragleave={() => (over = null)}
          ondrop={(e) => drop(e, today.date, g.id)}
        >
          <div class="window-head">
            <span class="wname">{g.window?.name ?? 'Extra time'}</span>
            {#if g.window}
              <span class="mono muted small">{windowTime(g.window)} · {KIND_TEXT[g.window.kind]}</span>
              {#if today.free[g.id] >= 5}<span class="mono dim small">{today.free[g.id]} min free</span>{/if}
            {/if}
          </div>
          {#each g.items as item (item.id)}
            {@const text = itemText(item, tasks, assessments, data.today)}
            {@const done = isDone(item)}
            <div
              class="item"
              class:done
              class:skipped={item.status === 'skipped'}
              role="listitem"
              draggable={item.status === 'todo'}
              ondragstart={(e) => dragStart(e, today, item)}
              ondragend={() => (dragging = over = null)}
            >
              <input
                type="checkbox"
                class="tick"
                checked={done}
                disabled={busy || item.status === 'skipped' || (item.kind === 'flashcards' && done && item.status !== 'done')}
                aria-label="Done: {text.title}"
                onchange={() => act(() => (item.status === 'done' ? reopenItem(today, item, data!.tasks) : completeItem(today, item, data!.tasks)))}
              />
              <span class="dot" style:background={itemColour(item)}></span>
              <span class="what">
                <span class="title">
                  {text.title}
                  {#if item.kind === 'homework' && item.taskId && (tasks.get(item.taskId)?.carryOvers ?? 0) > 0}
                    <span class="tag">carried over</span>
                  {/if}
                  {#if item.pinned}<span class="tag pin">pinned</span>{/if}
                  {#if item.optional}<span class="tag">optional</span>{/if}
                </span>
                <span class="muted small">{text.detail}</span>
              </span>
              <span class="mono small mins">{item.minutes} min</span>
              <span class="tools">
                {#if item.status === 'skipped'}
                  <button class="btn small" onclick={() => act(() => reopenItem(today, item, data!.tasks))}>Undo skip</button>
                {:else if !done}
                  <a class="btn small primary" href={itemLink(item, tasks)} onclick={() => startLink(today, item)}>Start</a>
                  <details class="more">
                    <summary class="btn small">More</summary>
                    <div class="more-tools">
                      {#if item.kind === 'problems' && subjects.length > 1}
                        <label class="sr-only" for="subj-{item.id}">Problem subject</label>
                        <select id="subj-{item.id}" class="mini" onchange={(e) => onSubject(today, item, e)}>
                          <option value="">Swap subject</option>
                          {#each subjects.filter((s) => !item.subjects?.includes(s)) as s (s)}<option value={s}>{shortSubject(s)}</option>{/each}
                        </select>
                      {/if}
                      <button class="btn small" onclick={() => act(() => togglePin(today, item))}>{item.pinned ? 'Unpin' : 'Pin'}</button>
                      <button class="btn small" onclick={() => snooze(today, item)} disabled={busy}>Tomorrow</button>
                      <button class="btn small" onclick={() => act(() => skipItem(today, item))}>Skip</button>
                      <label class="sr-only" for="move-{item.id}">Move to</label>
                      <select id="move-{item.id}" class="mini" onchange={(e) => onMove(today, item, e)}>
                        <option value="">Move to</option>
                        {#each moveTargets() as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
                      </select>
                    </div>
                  </details>
                {/if}
              </span>
            </div>
          {:else}
            <p class="empty muted small">Nothing planned{g.window?.kind === 'flexible' ? ': no optional work waiting' : ''}.</p>
          {/each}
        </div>
      {:else}
        <p class="muted">No study windows today. <a href={href('planner', 'windows')}>Change your windows</a></p>
      {/each}
    </section>

    <section>
      <div class="section-head">
        <h2>This week</h2>
        <span class="muted small">Drag anything to another window or day. Moving it pins it there.</span>
      </div>
      <div class="week">
        {#each data.days as day (day.date)}
          <div class="day" class:today={day.date === data.today}>
            <div class="day-head">
              <strong>{dayLabel(day.date, data.today)}</strong>
              <span class="mono dim small">{minutesText(planned(day))}</span>
            </div>
            {#each day.warnings as w (w)}<div class="mini-warn small" title={w}>Homework won't fit</div>{/each}
            {#each groups(day) as g (g.id)}
              <div
                class="slot"
                class:over={over === `${day.date}|${g.id}`}
                role="list"
                aria-label="{dayLabel(day.date, data.today)}, {g.window?.name ?? 'Extra time'}"
                ondragover={(e) => dragOver(e, `${day.date}|${g.id}`)}
                ondragleave={() => (over = null)}
                ondrop={(e) => drop(e, day.date, g.id)}
              >
                <div class="slot-name mono dim">{g.window ? `${g.window.start} ${g.window.name}` : 'Extra'}</div>
                {#each g.items as item (item.id)}
                  {@const text = itemText(item, tasks, assessments, data.today)}
                  <div
                    class="chip"
                    class:done={isDone(item)}
                    class:skipped={item.status === 'skipped'}
                    class:pinned={item.pinned}
                    role="listitem"
                    draggable={item.status === 'todo'}
                    ondragstart={(e) => dragStart(e, day, item)}
                    ondragend={() => (dragging = over = null)}
                    title="{text.title} · {item.minutes} min"
                  >
                    <span class="dot" style:background={itemColour(item)}></span>
                    <span class="chip-text">{text.title}</span>
                    <span class="mono dim">{item.minutes}</span>
                  </div>
                {/each}
              </div>
            {:else}
              <div class="slot-name mono dim">No windows</div>
            {/each}
          </div>
        {/each}
      </div>
    </section>

    <section class="links">
      <a class="row link" href={href('planner', 'homework')}>
        <span class="dot" style:background="var(--good)"></span>
        <span class="name">Homework list</span>
        <span class="mono muted small">{plural(data.tasks.filter((t) => t.status === 'open').length, 'task')} open</span>
      </a>
      <a class="row link" href={href('planner', 'exams')}>
        <span class="dot" style:background="var(--warn)"></span>
        <span class="name">Exams and assessments</span>
        <span class="mono muted small">
          {#if soon.length}{soon.map((a) => `${a.name} (${STAGE_LABEL[stageOf(a, data!.today)]})`).join(', ')}{:else}none in prep{/if}
        </span>
      </a>
      <a class="row link" href={href('planner', 'windows')}>
        <span class="dot"></span>
        <span class="name">Study windows</span>
        <span class="mono muted small">when you can study each week, soccer season, one-off days</span>
      </a>
    </section>
  {/if}
</main>

<style>
  .hero {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  h1 {
    font-size: 40px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .lead {
    margin: 0;
    font-size: 18px;
    max-width: 640px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 8px;
  }
  .add {
    padding: 16px 18px;
  }
  .ask {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ask-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .inline {
    display: inline-flex;
    gap: 8px;
    align-items: center;
  }
  input[type='date'] {
    min-height: 36px;
    padding: 4px 8px;
    border-radius: 8px;
    border: 1px solid var(--line-strong);
    background: var(--surface);
    color: var(--text);
    font: 400 14px var(--font);
  }
  .section-head {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 8px;
  }
  h2 {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .small {
    font-size: 13px;
  }
  .dim {
    color: var(--dim);
  }
  .window {
    border-top: 1px solid var(--line);
    padding: 14px 0 8px;
    border-radius: 4px;
  }
  .window.over,
  .slot.over {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    outline: 1px dashed var(--accent);
  }
  .window-head {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    align-items: baseline;
    margin-bottom: 6px;
  }
  .wname {
    font-weight: 700;
  }
  .item {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
    padding: 10px 0;
    cursor: grab;
  }
  .item.done .title,
  .item.skipped .title {
    text-decoration: line-through;
    color: var(--muted);
  }
  .tick {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
    flex: none;
  }
  .what {
    flex: 1 1 260px;
    display: flex;
    flex-direction: column;
  }
  .tag {
    font-family: var(--mono);
    font-size: 11px;
    padding: 1px 7px;
    margin-left: 6px;
    border-radius: 10px;
    border: 1px solid var(--line-strong);
    color: var(--muted);
    vertical-align: 2px;
    text-decoration: none;
    display: inline-block;
  }
  .tag.pin {
    border-color: var(--accent);
    color: var(--accent);
  }
  .mins {
    color: var(--muted);
    min-width: 56px;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .more {
    position: relative;
  }
  .more summary {
    list-style: none;
  }
  .more summary::-webkit-details-marker {
    display: none;
  }
  .more[open] summary {
    border-color: var(--muted);
  }
  .more-tools {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    min-width: 220px;
    background: var(--surface-2);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
  }
  select.mini {
    width: auto;
    min-height: 36px;
    padding: 4px 30px 4px 10px;
    font-size: 14px;
    border-radius: 18px;
  }
  .empty {
    margin: 0;
    padding: 4px 0 8px;
  }
  .week {
    display: grid;
    grid-template-columns: repeat(7, minmax(140px, 1fr));
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 6px;
  }
  .day {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .day.today {
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  }
  .day-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 14px;
  }
  .slot {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 34px;
    padding: 4px;
    border-radius: 6px;
  }
  .slot-name {
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 7px;
    border-radius: 6px;
    background: var(--surface-2);
    font-size: 12px;
    cursor: grab;
  }
  .chip.pinned {
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .chip.done .chip-text,
  .chip.skipped .chip-text {
    text-decoration: line-through;
    color: var(--dim);
  }
  .chip-text {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mini-warn {
    color: var(--warn);
    font-size: 11px;
  }
  .link {
    color: var(--text);
    text-decoration: none;
    min-height: 52px;
  }
  .link:hover .name {
    color: var(--accent);
  }
  .name {
    flex: 1 1 220px;
  }
  @media (max-width: 640px) {
    h1 {
      font-size: 32px;
    }
    .week {
      grid-template-columns: repeat(7, 150px);
    }
  }
</style>
