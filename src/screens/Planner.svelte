<script lang="ts">
  import QuickAdd from '../components/QuickAdd.svelte';
  import { sync } from '../lib/sync';
  import { loadPlanner, type PlannerData } from '../lib/planner/load';
  import {
    addItem,
    completeItem,
    dropTask,
    moveItem,
    moveItemTo,
    placeItem,
    removeItem,
    reopenItem,
    rescheduleTask,
    setMinutes,
    setSubject,
    shrinkTask,
    skipItem,
    startItem,
    togglePin,
  } from '../lib/planner/actions';
  import { ASK_AFTER_CARRIES, CALENDAR_WINDOW, EXTRA_WINDOW, calendarMode, extraItem, type BuiltDay } from '../lib/planner/build';
  import { entryItem, trayFor, type TrayEntry } from '../lib/planner/tray';
  import { addDays, clockMinutes, clockText, dayLabel, dueLabel, keyToTime, minutesText, weekday } from '../lib/planner/dates';
  import { windowsFor } from '../lib/planner/availability';
  import { dayEvents, type DayEvent } from '../lib/planner/calendar';
  import { itemColour, itemLink, itemText, KIND_TEXT, windowTime } from '../lib/planner/labels';
  import { stageOf, STAGE_LABEL } from '../lib/planner/assessments';
  import { shortSubject } from '../lib/practice/load';
  import { plural } from '../lib/load';
  import { href } from '../lib/router.svelte';
  import { listWeeklyReviews, saveAvailability } from '../lib/db';
  import { firstFree, hhmm, layoutDay, planningSlot, visibleRange, type DayLayout, type Span, type TimedItem } from '../lib/planner/timeline';
  import { reviewWeek } from '../lib/progress/review';
  import { untrack } from 'svelte';
  import { KINDS } from '../lib/planner/labels';
  import type { Availability, PlanItem, StudyWindow, Task, WeeklyReview } from '../lib/types';

  /** A date key: show that day in full instead of today. */
  let { day: dayProp }: { day?: string } = $props();
  // The page is rebuilt for a new address, so the first value is the only one.
  const dayKey = untrack(() => dayProp);

  let data = $state.raw<PlannerData | null>(null);
  let busy = $state(false);
  let dragging = $state<string | null>(null);
  let over = $state<string | null>(null);

  let reviews = $state.raw<WeeklyReview[]>([]);
  /** Days planned ahead: enough to see this week and the four after it. */
  const HORIZON = 35;
  /** Weeks ahead shown in the week view (0 is this week). */
  let weekOffset = $state(0);
  const MAX_WEEKS = 4;

  async function reload() {
    [data, reviews] = await Promise.all([loadPlanner(Date.now(), HORIZON), listWeeklyReviews()]);
  }
  // Show what's here straight away, then again if the server brought homework or calendar changes.
  reload().then(async () => {
    const r = await sync();
    if (r.collected || r.calendarsRead) await reload();
  });

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
  /** The day shown in full: today, or the one picked in the week. */
  const shown = $derived(data ? (data.days.find((d) => d.date === dayKey) ?? data.days[0]) : undefined);
  const isToday = $derived(!!shown && !!data && shown.date === data.today);

  // Day view shows one day in full, week view the whole week at once. Opening a day always shows it.
  let view = $state<'day' | 'week'>('day');
  try {
    if (!dayKey && localStorage.getItem('planner-view') === 'week') view = 'week';
  } catch {
    // Storage can be blocked; the day view is fine.
  }
  function pickView(v: 'day' | 'week') {
    view = v;
    try {
      localStorage.setItem('planner-view', v);
    } catch {
      // Not remembered, which is fine.
    }
  }
  /** The days either side of the one shown, for stepping through the week. */
  const prevDay = $derived(data && shown ? data.days.find((d) => d.date === addDays(shown.date, -1)) : undefined);
  const nextDay = $derived(data && shown ? data.days.find((d) => d.date === addDays(shown.date, 1)) : undefined);
  const dayHref = (date: string) => href('planner', 'day', date);

  /** Flashcards count as done once nothing is left to review today. */
  function isDone(item: PlanItem, date = data?.today): boolean {
    if (item.status === 'done') return true;
    return item.kind === 'flashcards' && !!data && date === data.today && data.cardsLeft === 0 && data.logsToday.length > 0;
  }

  /** The next thing: the first unfinished item in a window that hasn't ended yet, else anything left. */
  const next = $derived.by(() => {
    if (!today || !data) return undefined;
    const open = today.plan.items.filter((it) => it.status === 'todo' && !isDone(it, today.date) && !it.optional);
    const d = new Date(data.now);
    const nowMinutes = d.getHours() * 60 + d.getMinutes();
    const ends = (it: PlanItem) => {
      if (it.start) return clockMinutes(it.start) + it.minutes;
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
    // The next two weeks: further out is easier to drag in the week view.
    for (const d of data.days.slice(0, 14)) {
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
    if (calMode && item.start) {
      act(() => moveItemTo(data!.days, day.date, item.id, tomorrow.date, item.start!));
      return;
    }
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
    if (!item) return;
    if (calMode) {
      const start = freeTime(today.date, item.minutes);
      if (start !== null) Object.assign(item, { start: hhmm(start), windowId: CALENDAR_WINDOW });
    }
    act(() => addItem(today!, item));
  }

  function startLink(day: BuiltDay, item: PlanItem) {
    // Opening an item marks it started, so a rebuild leaves it alone.
    startItem(day, item);
  }

  // Drag and drop between windows and days.
  function dragStart(e: DragEvent, day: BuiltDay, item: PlanItem) {
    dragging = `${day.date}|${item.id}`;
    dragMinutes = item.minutes;
    grab = e.currentTarget instanceof HTMLElement ? e.clientY - e.currentTarget.getBoundingClientRect().top : 0;
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
    if (date < data.today) return;
    act(() => moveItem(data!.days, fromDate, itemId, date, windowId));
  }

  // Calendar mode: drop anywhere on a day, at the time under the pointer.
  /** How far down the dragged block it was picked up, so it lands where it looks like it will. */
  let grab = 0;
  let dragMinutes = 30;
  let preview = $state<{ date: string; start: number; minutes: number } | null>(null);

  function trayStart(e: DragEvent, entry: TrayEntry) {
    dragging = `tray|${entry.key}`;
    dragMinutes = entry.minutes;
    grab = 0;
    e.dataTransfer?.setData('text/plain', dragging);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove';
  }
  /** The time (snapped to 15 minutes) at a point on a day column. */
  function timeAt(cal: Cal, e: DragEvent): number {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientY - rect.top - grab;
    let lo = cal.range.start;
    let hi = cal.range.end;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cal.y(mid) <= px) lo = mid;
      else hi = mid;
    }
    const snapped = Math.round(lo / 15) * 15;
    return Math.max(cal.range.start, Math.min(snapped, cal.range.end - 15));
  }
  function colOver(e: DragEvent, cal: Cal, date: string) {
    if (!dragging || !data || date < data.today) return;
    e.preventDefault();
    const start = timeAt(cal, e);
    if (preview?.date !== date || preview.start !== start) preview = { date, start, minutes: dragMinutes };
  }
  function colDrop(e: DragEvent, cal: Cal, date: string) {
    e.preventDefault();
    const payload = e.dataTransfer?.getData('text/plain') || dragging;
    const start = hhmm(timeAt(cal, e));
    dragging = over = null;
    preview = null;
    if (!payload || !data || date < data.today) return;
    const [from, id] = payload.split('|');
    if (from === 'tray') {
      const entry = tray.find((t) => t.key === payload.slice(5));
      if (entry) act(() => placeItem(data!.days, date, entryItem(entry, start)));
    } else {
      act(() => moveItemTo(data!.days, from, id, date, start));
    }
  }
  function dragEnd() {
    dragging = over = null;
    preview = null;
  }

  /** Busy times on a day: calendar events, things already placed and the planning session. */
  function busyOn(date: string): Span[] {
    if (!data) return [];
    const day = data.days.find((d) => d.date === date);
    const placed = day ? layoutDay([], day.plan.items).items : [];
    const slot = planningSlot(data.input.availability, date, data.input.context?.(date)?.busy ?? []);
    return [...dayEvents(data.calendars, date).timed, ...placed, ...(slot ? [slot] : [])];
  }
  /** The next free time on a day that fits `minutes`: after now today, after school on school days. */
  function freeTime(date: string, minutes: number): number | null {
    if (!data) return null;
    const a = data.input.availability;
    const busySpans = busyOn(date);
    let from = a.earliest ? clockMinutes(a.earliest) : 7 * 60;
    if (date === data.today) from = Math.max(from, nowMinutes);
    const lessons = dayEvents(data.calendars, date).timed.filter((e) => e.kind === 'lesson');
    if (lessons.length) from = Math.max(from, Math.max(...lessons.map((l) => l.end)) + 20);
    return firstFree(busySpans, minutes, from, a.latest ? clockMinutes(a.latest) : 22 * 60);
  }
  /** Add: puts a tray entry on the day at its next free time (or with no time when the day is full). */
  function addEntry(entry: TrayEntry) {
    if (!data) return;
    const date = trayDate;
    const at = freeTime(date, entry.minutes);
    const item = entryItem(entry, at === null ? '' : hhmm(at));
    if (at === null) delete item.start;
    act(() => placeItem(data!.days, date, item));
  }
  function setStart(day: BuiltDay, item: PlanItem, e: Event) {
    const value = (e.currentTarget as HTMLInputElement).value;
    if (value && data) act(() => moveItemTo(data!.days, day.date, item.id, day.date, value));
  }
  function onMinutes(day: BuiltDay, item: PlanItem, e: Event) {
    const value = Number((e.currentTarget as HTMLSelectElement).value);
    if (value) act(() => setMinutes(day, item, value));
  }

  const calMode = $derived(data ? calendarMode(data.input.availability) : true);
  /** The day the to do tray adds to: the day shown, or today in the week view. */
  const trayDate = $derived(data && shown ? (view === 'day' && shown.date >= data.today ? shown.date : data.today) : '');
  const tray = $derived(
    data && trayDate
      ? trayFor({
          date: trayDate,
          today: data.today,
          tasks: data.tasks,
          assessments: data.assessments,
          plans: data.days.map((d) => d.plan),
          flashMinutes: data.input.flashMinutes,
          problemSubjects: data.input.problemSubjects,
          problemMinutes: data.settings.problemMinutes,
        })
      : [],
  );

  function newDate(task: Task, e: Event) {
    const value = (e.currentTarget as HTMLInputElement).value;
    if (value) act(() => rescheduleTask(task, value));
  }

  // Changing one day's windows (stored as a one-off day, like on the Study windows page).
  let editing = $state<StudyWindow[] | null>(null);
  const isOneOff = $derived(!!shown && !!data && !!data.input.availability.overrides[shown.date]);

  function editWindows() {
    if (!shown) return;
    editing = shown.windows.map((w) => ({ ...w, days: [] }));
  }
  function addWindow() {
    editing?.push({ id: crypto.randomUUID(), name: 'Extra', days: [], start: '16:00', minutes: 45, kind: 'desk', season: 'all' });
  }
  async function saveDay(windows: StudyWindow[] | null) {
    if (!data || !shown) return;
    const a: Availability = structuredClone(data.input.availability);
    if (windows) {
      a.overrides[shown.date] = windows.map((w) => ({ ...w, minutes: Math.max(5, Math.round(Number(w.minutes) || 30)) }));
    } else {
      delete a.overrides[shown.date];
    }
    editing = null;
    await act(() => saveAvailability(a));
  }

  const autoFill = $derived(data?.input.availability.autoFill !== false);
  /** Turns the planner's filling of spare time with problems, test prep and revision on or off. */
  function toggleAutoFill() {
    if (!data) return;
    const a: Availability = { ...structuredClone(data.input.availability), autoFill: !autoFill };
    act(() => saveAvailability(a));
  }

  // The calendar: windows and items at their real times, work shifts, and the weekly planning session.
  interface CalDay {
    day: BuiltDay;
    lay: DayLayout;
    /** Items with their place in pixels, nudged down so short ones never overlap. */
    items: { t: TimedItem; top: number; height: number }[];
    /** Classes, work and other calendar events, each in a lane so overlaps sit side by side. */
    events: (DayEvent & { lane: number; lanes: number })[];
    allDay: string[];
    planning: (Span & { done: boolean }) | null;
  }
  interface Cal {
    days: CalDay[];
    range: Span;
    hours: number[];
    /** Long empty stretches (like school hours), squeezed to a thin strip. */
    gaps: Span[];
    /** Minutes after midnight to pixels down the calendar. */
    y: (minutes: number) => number;
    height: number;
  }
  const GAP_PX = 26;

  function calendarOf(days: BuiltDay[], compact: boolean): Cal {
    const ppm = calMode ? (compact ? 0.62 : 1.1) : compact ? 0.9 : 1.6;
    const out = days.map((day) => {
      const busy = data?.input.context?.(day.date)?.busy ?? [];
      const slot = data ? planningSlot(data.input.availability, day.date, busy) : null;
      const week = reviewWeek(day.date);
      return {
        day,
        lay: layoutDay(day.windows, day.plan.items),
        items: [] as CalDay['items'],
        ...eventsOf(day.date),
        planning: slot ? { ...slot, done: reviews.some((r) => r.week === week) } : null,
      };
    });
    const spans = out.flatMap((c) => [...c.lay.windows, ...c.lay.items, ...c.events, ...(c.planning ? [c.planning] : [])]);
    let range = visibleRange(spans);
    if (calMode && data) {
      // A plain calendar shows your whole day, so there is room to drop things anywhere.
      const a = data.input.availability;
      const from = a.earliest ? clockMinutes(a.earliest) : 7 * 60;
      const to = a.latest ? clockMinutes(a.latest) : 22 * 60;
      range = visibleRange([...spans, { start: from, end: to }]);
    }

    // Squeeze empty stretches of two hours or more (whole hours only) so the busy parts stay big.
    const merged: Span[] = [];
    for (const sp of [...spans].sort((x, z) => x.start - z.start)) {
      const last = merged[merged.length - 1];
      if (last && sp.start <= last.end) last.end = Math.max(last.end, sp.end);
      else merged.push({ ...sp });
    }
    const gaps: Span[] = [];
    for (let i = 1; i < merged.length && !calMode; i++) {
      const start = Math.ceil(merged[i - 1].end / 60) * 60 + 30;
      const end = Math.floor(merged[i].start / 60) * 60 - 30;
      if (end - start >= 90) gaps.push({ start, end });
    }
    const y = (m: number) => {
      let px = 0;
      let at = range.start;
      for (const g of gaps) {
        if (m <= g.start) break;
        px += (g.start - at) * ppm;
        if (m < g.end) return px + ((m - g.start) / (g.end - g.start)) * GAP_PX;
        px += GAP_PX;
        at = g.end;
      }
      return px + (Math.min(m, range.end) - at) * ppm;
    };
    const hours: number[] = [];
    for (let h = range.start; h < range.end; h += 60) if (!gaps.some((g) => h > g.start && h < g.end)) hours.push(h);

    const minHeight = compact ? 18 : 30;
    for (const c of out) {
      let bottom = -Infinity;
      for (const t of [...c.lay.items].sort((x, z) => x.start - z.start)) {
        const top = Math.max(y(t.start), bottom + 2);
        const height = Math.max(minHeight, y(t.end) - y(t.start));
        c.items.push({ t, top, height });
        bottom = top + height;
      }
    }
    return { days: out, range, hours, gaps, y, height: y(range.end) };
  }
  /** Calendar events for a day, with overlapping ones split into lanes. */
  function eventsOf(date: string): { events: CalDay['events']; allDay: string[] } {
    const { timed, allDay } = dayEvents(data?.calendars ?? null, date);
    const events: CalDay['events'] = [];
    let group: CalDay['events'] = [];
    let groupEnd = -1;
    const close = () => {
      const lanes = Math.max(1, ...group.map((e) => e.lane + 1));
      for (const e of group) e.lanes = lanes;
      group = [];
    };
    for (const e of timed) {
      if (e.start >= groupEnd) close();
      const used = new Set(group.filter((g) => g.end > e.start).map((g) => g.lane));
      let lane = 0;
      while (used.has(lane)) lane++;
      const placed = { ...e, lane, lanes: 1 };
      group.push(placed);
      events.push(placed);
      groupEnd = Math.max(groupEnd, e.end);
    }
    close();
    return { events, allDay };
  }

  /** How full a day is outside study: classes and work, for planning energy. */
  function loadText(c: CalDay): string {
    const lessons = c.events.filter((e) => e.kind === 'lesson').length;
    const work = c.events.filter((e) => e.kind === 'work').reduce((m, e) => m + e.end - e.start, 0);
    const bits: string[] = [];
    if (lessons) bits.push(plural(lessons, 'class', 'classes'));
    if (work) bits.push(`work ${minutesText(work)}`);
    return bits.join(' · ');
  }

  const nowMinutes = $derived.by(() => {
    if (!data) return 0;
    const d = new Date(data.now);
    return d.getHours() * 60 + d.getMinutes();
  });
  /** Top and height of a span on the calendar. */
  function place(cal: Cal, s: Span, min = 0): string {
    const top = cal.y(Math.max(s.start, cal.range.start));
    return `top:${top}px;height:${Math.max(min, cal.y(Math.min(s.end, cal.range.end)) - top)}px`;
  }
  const spanText = (s: Span) => `${clockText(s.start)} to ${clockText(s.end)}`;

  const planningLabel = $derived.by(() => {
    if (!data) return '';
    const p = data.input.availability.planning;
    if (p === null) return 'off';
    if (reviews.some((r) => r.week === reviewWeek(data!.today))) return 'done this week';
    const t = p ?? { day: 0, start: '16:00' };
    return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.day]} ${t.start}`;
  });

  /** Monday of the week a date is in. */
  const mondayOf = (key: string) => addDays(key, -((weekday(key) + 6) % 7));
  /** The seven days (Monday to Sunday) of the week being looked at. Days already gone show what was planned. */
  const weekDays = $derived.by((): BuiltDay[] => {
    if (!data) return [];
    const start = addDays(mondayOf(data.today), weekOffset * 7);
    const out: BuiltDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i);
      const built = data.days.find((d) => d.date === date);
      if (built) out.push(built);
      else if (date < data.today) {
        out.push({
          date,
          windows: calMode ? [] : windowsFor(date, data.input.availability, data.input.context?.(date)),
          plan: data.input.saved.get(date) ?? { date, items: [], built: 0 },
          free: {},
          warnings: [],
        });
      }
    }
    return out;
  });
  const weekLabel = $derived.by(() => {
    if (!data) return '';
    if (weekOffset === 0) return 'This week';
    if (weekOffset === 1) return 'Next week';
    const start = addDays(mondayOf(data.today), weekOffset * 7);
    const fmt = (k: string, month: boolean) => new Date(keyToTime(k)).toLocaleDateString('en-AU', month ? { day: 'numeric', month: 'short' } : { day: 'numeric' });
    const end = addDays(start, 6);
    return `${fmt(start, start.slice(5, 7) !== end.slice(5, 7))} to ${fmt(end, true)}`;
  });

  const planned = (day: BuiltDay) => day.plan.items.filter((it) => it.status !== 'skipped').reduce((m, it) => m + it.minutes, 0);
</script>

<main class="page wide">
  {#if data && today && shown}
    {#if !isToday}
      <section class="hero">
        <div class="eyebrow"><a href={href('planner')}>Planner</a> / {dayLabel(shown.date, data.today)}</div>
        <h1>{new Date(shown.date + 'T12:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
        <p class="lead muted">
          {#if calMode}
            {minutesText(planned(shown))} of study on the calendar. Drag things from To do onto a time, or move what's there.
          {:else}
            {minutesText(planned(shown))} planned in {plural(shown.windows.length, 'window')}. Tick, move or skip anything, or change
            this day's windows under the calendar.
          {/if}
        </p>
        <div class="actions"><a class="btn" href={href('planner')}>Back to today</a></div>
      </section>
      {#each shown.warnings as w (w)}<div class="notice warn">{w}</div>{/each}
    {:else}
      <section class="hero">
        <div class="eyebrow accent">
          Planner · {new Date(data.now).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>
        {#if next}
          {@const text = itemText(next, tasks, assessments, data.today)}
          <h1>Next: {text.title}</h1>
          <p class="lead muted">
            {#if next.start}
              {minutesText(next.minutes)} at {clockText(clockMinutes(next.start))}. {text.detail}.
            {:else}
              {minutesText(next.minutes)} in {today.windows.find((w) => w.id === next.windowId)?.name ?? 'extra time'}. {text.detail}.
            {/if}
          </p>
          <div class="actions">
            <a class="btn primary" href={itemLink(next, tasks)} onclick={() => startLink(today, next)}>Start</a>
            <button class="btn" onclick={moreTime} disabled={busy}>I've got 20 more minutes</button>
          </div>
        {:else if calMode && !today.plan.items.length}
          <h1>Nothing on the calendar yet</h1>
          <p class="lead muted">Drag something from To do onto a free time, or press Add to put it in the next gap.</p>
          <div class="actions"><button class="btn" onclick={moreTime} disabled={busy}>I've got 20 minutes now</button></div>
        {:else if !calMode && today.windows.length === 0}
          <h1>No study windows today</h1>
          <p class="lead muted">Enjoy the day off.</p>
          <div class="actions"><button class="btn" onclick={moreTime} disabled={busy}>I've got 20 minutes anyway</button></div>
        {:else}
          <h1>Today's plan is done</h1>
          <p class="lead muted">Everything planned for today is ticked off or skipped.</p>
          <div class="actions"><button class="btn primary" onclick={moreTime} disabled={busy}>I've got 20 more minutes</button></div>
        {/if}
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
    {/if}

    <div class="layout">
      <div class="main-col">
        <div class="view-bar">
          <div class="seg" role="group" aria-label="Planner view">
            <button class:on={view === 'day'} aria-pressed={view === 'day'} onclick={() => pickView('day')}>Day</button>
            <button class:on={view === 'week'} aria-pressed={view === 'week'} onclick={() => pickView('week')}>Week</button>
          </div>
          {#if view === 'day'}
            <div class="step">
              {#if prevDay}<a class="btn small" href={dayHref(prevDay.date)} aria-label="Previous day">&larr; {dayLabel(prevDay.date, data.today)}</a>{/if}
              <strong class="step-now">{dayLabel(shown.date, data.today)}</strong>
              {#if nextDay}<a class="btn small" href={dayHref(nextDay.date)} aria-label="Next day">{dayLabel(nextDay.date, data.today)} &rarr;</a>{/if}
            </div>
          {:else}
            <div class="step">
              <button class="btn small" onclick={() => weekOffset--} disabled={weekOffset <= 0} aria-label="Previous week">&larr;</button>
              <strong class="step-now">{weekLabel}</strong>
              <button class="btn small" onclick={() => weekOffset++} disabled={weekOffset >= MAX_WEEKS} aria-label="Next week">&rarr;</button>
            </div>
          {/if}
        </div>

        {#if view === 'day'}
          {@const cal = calendarOf([shown], false)}
          {#if loadText(cal.days[0]) || cal.days[0].allDay.length}
            <div class="day-load small">
              {#if loadText(cal.days[0])}<span class="muted">{loadText(cal.days[0])}</span>{/if}
              {#each cal.days[0].allDay as t (t)}<span class="allday">{t}</span>{/each}
            </div>
          {/if}
          {@render calendar(cal, false)}
          {@render looseItems(shown, cal.days[0].lay.loose)}

          {#if !calMode}
          <section class="day-edit">
            {#if editing}
              <h2>Windows for {dayLabel(shown.date, data.today)}</h2>
              {#each editing as w, i (w.id)}
                <div class="edit-row">
                  <input class="name-in" type="text" bind:value={w.name} aria-label="Name" />
                  <input type="time" bind:value={w.start} aria-label="Starts" />
                  <input class="mins-in" type="number" min="5" step="5" bind:value={w.minutes} aria-label="Minutes" />
                  <select bind:value={w.kind} aria-label="Kind">
                    {#each KINDS as k (k)}<option value={k}>{KIND_TEXT[k]}</option>{/each}
                  </select>
                  <button class="btn small" onclick={() => editing!.splice(i, 1)}>Remove</button>
                </div>
              {:else}
                <p class="muted small">No windows: a day off.</p>
              {/each}
              <div class="actions">
                <button class="btn small" onclick={addWindow}>Add a window</button>
                <button class="btn small primary" onclick={() => saveDay($state.snapshot(editing))} disabled={busy}>Save this day</button>
                <button class="btn small" onclick={() => (editing = null)}>Cancel</button>
              </div>
            {:else}
              <div class="day-edit-line">
                <span class="muted small grow">
                  {minutesText(planned(shown))} planned.
                  {isOneOff ? 'This day has its own windows.' : 'Uses your normal weekly windows.'}
                </span>
                <button class="btn small" onclick={editWindows}>Change this day's windows</button>
                {#if isOneOff}
                  <button class="btn small" onclick={() => saveDay(null)} disabled={busy}>Back to normal</button>
                {:else}
                  <button class="btn small" onclick={() => saveDay([])} disabled={busy}>Make it a day off</button>
                {/if}
              </div>
            {/if}
          </section>
          {/if}
        {:else}
          <div class="week-scroll">
            {@render calendar(calendarOf(weekDays, true), true)}
          </div>
        {/if}
      </div>

      <aside class="side">
        {#if calMode}
          <section class="panel tray" aria-label="To do">
            <div class="tray-head">
              <h2>To do</h2>
              <span class="muted small">for {dayLabel(trayDate, data.today)}</span>
            </div>
            <p class="muted small tray-hint">Drag onto a time, or Add puts it in the next free gap.</p>
            {#each tray as entry (entry.key)}
              <div
                class="tray-item"
                class:urgent={entry.urgent}
                style:--c={itemColour({ kind: entry.kind, subjects: entry.subjects } as PlanItem)}
                role="listitem"
                draggable="true"
                ondragstart={(e) => trayStart(e, entry)}
                ondragend={dragEnd}
                title="Drag onto the calendar"
              >
                <span class="tray-text">
                  <span class="tray-title">{entry.title}</span>
                  <span class="muted small">{entry.minutes} min · {entry.detail}</span>
                </span>
                <button class="btn small" onclick={() => addEntry(entry)} disabled={busy}>Add</button>
              </div>
            {:else}
              <p class="muted small">Nothing waiting. Add homework below.</p>
            {/each}
          </section>
        {/if}
        <section class="panel add">
          <QuickAdd today={data.today} onadded={() => reload()} />
        </section>

        {#if !calMode}
        <label class="auto panel" title="When off, spare study time stays free instead of getting problems, test prep and revision">
          <input type="checkbox" checked={autoFill} onchange={toggleAutoFill} disabled={busy} />
          <span>
            <strong>Auto fill study time</strong>
            <span class="muted small">{autoFill ? 'Spare time gets problems, test prep and revision.' : 'Spare time is left free.'}</span>
          </span>
        </label>
        {/if}

        <nav class="links">
          <a class="link" href={href('planner', 'homework')}>
            <span class="dot" style:background="var(--good)"></span>
            <span class="name">Homework</span>
            <span class="mono muted small">{data.tasks.filter((t) => t.status === 'open').length} open</span>
          </a>
          <a class="link" href={href('planner', 'exams')}>
            <span class="dot" style:background="var(--warn)"></span>
            <span class="name">Exams</span>
            <span class="mono muted small">{soon.length ? `${soon.length} in prep` : 'none in prep'}</span>
          </a>
          <a class="link" href={href('progress', 'review')}>
            <span class="dot" style:background="var(--accent)"></span>
            <span class="name">Plan the week</span>
            <span class="mono muted small">{planningLabel}</span>
          </a>
          <a class="link" href={href('planner', 'windows')}>
            <span class="dot"></span>
            <span class="name">{calMode ? 'Planner settings' : 'Study windows'}</span>
            <span class="mono muted small">{calMode ? 'hours, planning time' : 'weekly times'}</span>
          </a>
          <a class="link" href={href('planner', 'connect')}>
            <span class="dot" style:background="var(--info)"></span>
            <span class="name">Phone and Google</span>
            <span class="mono muted small">quick add, calendars</span>
          </a>
        </nav>
      </aside>
    </div>
  {/if}
</main>

{#snippet calendar(cal: Cal, compact: boolean)}
  <div class="cal" class:compact style:--cols={cal.days.length}>
    {#if compact}
      <div class="cal-heads">
        <span></span>
        {#each cal.days as c (c.day.date)}
          <a class="cal-head" class:today={c.day.date === data!.today} class:past={c.day.date < data!.today} href={dayHref(c.day.date)} title="Open this day">
            <strong>{dayLabel(c.day.date, data!.today)}</strong>
            <span class="mono dim small">{minutesText(planned(c.day))} study</span>
            {#if loadText(c)}<span class="dim small">{loadText(c)}</span>{/if}
            {#each c.allDay as t (t)}<span class="allday small" title={t}>{t}</span>{/each}
            {#if c.day.warnings.length}<span class="mini-warn" title={c.day.warnings.join(' ')}>Homework won't fit</span>{/if}
          </a>
        {/each}
      </div>
    {/if}
    <div class="cal-body" style:height="{cal.height}px">
      <div class="hours" aria-hidden="true">
        {#each cal.hours as h (h)}<span style:top="{cal.y(h)}px">{clockText(h)}</span>{/each}
      </div>
      {#each cal.gaps as g (g.start)}
        <div class="gap" style:top="{cal.y(g.start)}px" style:height="{GAP_PX}px" title="{spanText(g)}: nothing planned">
          <span class="mono dim">{spanText(g)}</span>
        </div>
      {/each}
      {#each cal.days as c (c.day.date)}
        {@const day = c.day}
        <div
          class="col"
          class:today={day.date === data!.today}
          class:past={day.date < data!.today}
          role="group"
          aria-label={dayLabel(day.date, data!.today)}
          ondragover={(e) => calMode && colOver(e, cal, day.date)}
          ondragleave={(e) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) preview = null;
          }}
          ondrop={(e) => calMode && colDrop(e, cal, day.date)}
        >
          {#each cal.hours as h (h)}<div class="hline" style:top="{cal.y(h)}px"></div>{/each}
          {#each c.events as e, i (i)}
            <div
              class="ev ev-{e.kind}"
              style="{place(cal, e)};left:{(e.lane / e.lanes) * 100}%;width:calc({100 / e.lanes}% - 2px)"
              title="{e.title} · {spanText(e)}"
            >
              <span class="ev-title">{e.title}</span>
              {#if !compact}<span class="mono ev-time">{spanText(e)}</span>{/if}
            </div>
          {/each}

          {#each c.lay.windows as tw (tw.window.id)}
            {@const zone = `${day.date}|${tw.window.id}`}
            <div
              class="band kind-{tw.window.kind}"
              class:over={over === zone}
              style={place(cal, tw)}
              role="group"
              aria-label="{dayLabel(day.date, data!.today)}, {tw.window.name}"
              ondragover={(e) => dragOver(e, zone)}
              ondragleave={() => (over = null)}
              ondrop={(e) => drop(e, day.date, tw.window.id)}
              title="{tw.window.name} · {windowTime(tw.window)} · {KIND_TEXT[tw.window.kind]}"
            >
              {#if !compact}
                <span class="band-label">
                  <span>{tw.window.name}</span>
                  <span class="mono dim">{KIND_TEXT[tw.window.kind]}{day.free[tw.window.id] >= 5 ? ` · ${day.free[tw.window.id]} min free` : ''}</span>
                </span>
              {/if}
            </div>
          {/each}

          {#each c.items as p (p.t.item.id)}
            {@const pos = `top:${p.top}px;height:${p.height}px`}
            {#if compact}{@render chip(day, p.t, pos)}{:else}{@render block(day, p.t, pos, p.height)}{/if}
          {/each}

          {#if c.planning}
            <a
              class="planning"
              class:done={c.planning.done}
              style={place(cal, c.planning, compact ? 22 : 30)}
              href={href('progress', 'review')}
              title="Weekly planning: look back, pick focus skills, check the week ahead"
            >
              <span class="blk-title">{c.planning.done ? '✓ ' : ''}{compact ? 'Plan week' : 'Plan the week'}</span>
              {#if !compact}<span class="mono small blk-time">{spanText(c.planning)} · weekly review</span>{/if}
            </a>
          {/if}

          {#if day.date === data!.today && nowMinutes > cal.range.start && nowMinutes < cal.range.end && !cal.gaps.some((g) => nowMinutes > g.start && nowMinutes < g.end)}
            <div class="now" style:top="{cal.y(nowMinutes)}px" aria-label="Now"></div>
          {/if}
          {#if preview && preview.date === day.date}
            <div class="drop-at" style={place(cal, { start: preview.start, end: preview.start + preview.minutes }, 14)}>
              <span class="mono small">{clockText(preview.start)}</span>
            </div>
          {/if}
          {#if !calMode && !c.lay.windows.length && !c.planning}
            <span class="free-day muted small">No study windows</span>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet block(day: BuiltDay, t: TimedItem, pos: string, height: number)}
  {@const item = t.item}
  {@const text = itemText(item, tasks, assessments, data!.today)}
  {@const done = isDone(item, day.date)}
  {@const tall = height >= 48}
  <div
    class="blk"
    class:done
    class:tall
    class:pinned={item.pinned}
    style={pos}
    style:--c={itemColour(item)}
    role="group"
    draggable={item.status === 'todo'}
    ondragstart={(e) => dragStart(e, day, item)}
    ondragend={dragEnd}
  >
    <input
      type="checkbox"
      class="tick"
      checked={done}
      disabled={busy || (item.kind === 'flashcards' && done && item.status !== 'done')}
      aria-label="Done: {text.title}"
      onchange={() => act(() => (item.status === 'done' ? reopenItem(day, item, data!.tasks) : completeItem(day, item, data!.tasks)))}
    />
    <span class="blk-main">
      <span class="blk-title">
        {text.title}
        {#if item.kind === 'homework' && item.taskId && (tasks.get(item.taskId)?.carryOvers ?? 0) > 0}<span class="tag">carried over</span>{/if}
        {#if item.optional}<span class="tag">optional</span>{/if}
      </span>
      <span class="mono small blk-time">{spanText(t)} · {item.minutes} min{tall && text.detail ? ` · ${text.detail}` : ''}</span>
    </span>
    {#if !done}
      <span class="tools">
        <a class="btn small primary" href={itemLink(item, tasks)} onclick={() => startLink(day, item)}>Start</a>
        {@render moreMenu(day, item)}
      </span>
    {/if}
  </div>
{/snippet}

{#snippet chip(day: BuiltDay, t: TimedItem, pos: string)}
  {@const item = t.item}
  {@const text = itemText(item, tasks, assessments, data!.today)}
  <a
    class="chip"
    class:done={isDone(item, day.date)}
    class:pinned={item.pinned}
    style={pos}
    style:--c={itemColour(item)}
    href={dayHref(day.date)}
    draggable={item.status === 'todo' && day.date >= data!.today}
    ondragstart={(e) => dragStart(e, day, item)}
    ondragend={dragEnd}
    title="{text.title} · {spanText(t)} · {item.minutes} min"
  >
    <span class="chip-text">{text.title}</span>
  </a>
{/snippet}

{#snippet moreMenu(day: BuiltDay, item: PlanItem)}
  <details class="more">
    <summary class="btn small">More</summary>
    <div class="more-tools">
      {#if item.kind === 'problems' && subjects.length > 1}
        <label class="sr-only" for="subj-{item.id}">Problem subject</label>
        <select id="subj-{item.id}" class="mini" onchange={(e) => onSubject(day, item, e)}>
          <option value="">Swap subject</option>
          {#each subjects.filter((s) => !item.subjects?.includes(s)) as s (s)}<option value={s}>{shortSubject(s)}</option>{/each}
        </select>
      {/if}
      {#if calMode}
        <label class="mini-field">
          <span class="small muted">Starts</span>
          <input class="mini" type="time" step="900" value={item.start ?? ''} onchange={(e) => setStart(day, item, e)} />
        </label>
        <label class="sr-only" for="mins-{item.id}">Length</label>
        <select id="mins-{item.id}" class="mini" onchange={(e) => onMinutes(day, item, e)}>
          <option value="">{item.minutes} min</option>
          {#each [15, 20, 30, 45, 60, 90, 120].filter((m) => m !== item.minutes) as m (m)}<option value={m}>{m} min</option>{/each}
        </select>
        <button class="btn small" onclick={() => snooze(day, item)} disabled={busy}>Tomorrow</button>
        <button class="btn small" onclick={() => act(() => skipItem(day, item))}>Skip</button>
        <button class="btn small" onclick={() => act(() => removeItem(day, item))}>Take off</button>
      {:else}
        <button class="btn small" onclick={() => act(() => togglePin(day, item))}>{item.pinned ? 'Unpin' : 'Pin'}</button>
        <button class="btn small" onclick={() => snooze(day, item)} disabled={busy}>Tomorrow</button>
        <button class="btn small" onclick={() => act(() => skipItem(day, item))}>Skip</button>
        <label class="sr-only" for="move-{item.id}">Move to</label>
        <select id="move-{item.id}" class="mini" onchange={(e) => onMove(day, item, e)}>
          <option value="">Move to</option>
          {#each moveTargets() as m (m.value)}<option value={m.value}>{m.label}</option>{/each}
        </select>
      {/if}
    </div>
  </details>
{/snippet}

{#snippet looseItems(day: BuiltDay, items: PlanItem[])}
  {#if items.length}
    <section class="loose">
      {#each items as item (item.id)}
        {@const text = itemText(item, tasks, assessments, data!.today)}
        {@const done = isDone(item, day.date)}
        <div class="loose-item" class:done={done || item.status === 'skipped'}>
          <span class="dot" style:background={itemColour(item)}></span>
          <span class="grow">
            {text.title}
            <span class="muted small">· {item.status === 'skipped' ? 'skipped' : calMode ? 'no time set' : 'extra time'} · {item.minutes} min</span>
          </span>
          {#if item.status === 'skipped'}
            <button class="btn small" onclick={() => act(() => reopenItem(day, item, data!.tasks))}>Undo skip</button>
          {:else if !done}
            {#if calMode}
              <input class="mini" type="time" step="900" aria-label="Put it at" onchange={(e) => setStart(day, item, e)} />
              <button class="btn small" onclick={() => act(() => removeItem(day, item))}>Take off</button>
            {/if}
            <button class="btn small" onclick={() => act(() => completeItem(day, item, data!.tasks))}>Done</button>
            <a class="btn small primary" href={itemLink(item, tasks)} onclick={() => startLink(day, item)}>Start</a>
          {/if}
        </div>
      {/each}
    </section>
  {/if}
{/snippet}

<style>
  .hero {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  h1 {
    font-size: 34px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .lead {
    margin: 0;
    font-size: 17px;
    max-width: 640px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 6px;
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
  .grow {
    flex: 1 1 200px;
    min-width: 0;
  }

  /* Page layout: the calendar, with quick add and links beside it. */
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
    gap: 28px;
    align-items: start;
  }
  .main-col {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 14px;
    position: sticky;
    top: 16px;
  }
  .add {
    padding: 14px 16px;
  }
  .view-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 16px;
    align-items: center;
  }
  .seg {
    display: flex;
    gap: 2px;
    padding: 3px;
    border: 1px solid var(--line);
    border-radius: 22px;
  }
  .seg button {
    min-height: 36px;
    padding: 0 18px;
    border-radius: 18px;
    border: 0;
    background: transparent;
    color: var(--muted);
    font: 400 14px var(--font);
    cursor: pointer;
  }
  .seg button.on {
    background: var(--line);
    color: var(--text);
  }
  .step {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-left: auto;
  }
  .step-now {
    font-size: 14px;
    min-width: 70px;
    text-align: center;
  }
  .auto {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    cursor: pointer;
    padding: 14px 16px;
  }
  .auto > span {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 14px;
  }
  .auto input {
    width: 18px;
    height: 18px;
    margin-top: 2px;
    accent-color: var(--accent);
    flex: none;
  }
  .links {
    display: flex;
    flex-direction: column;
  }
  .link {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 0 4px;
    border-bottom: 1px solid var(--line);
    color: var(--text);
    text-decoration: none;
    font-size: 14px;
  }
  .link:hover .name {
    color: var(--accent);
  }
  .name {
    flex: 1;
  }

  /* The calendar. */
  .cal {
    --gutter: 46px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 12px 12px 12px 0;
  }
  .cal-heads {
    display: grid;
    grid-template-columns: var(--gutter) repeat(var(--cols), minmax(0, 1fr));
    gap: 6px;
    margin-bottom: 8px;
  }
  .cal-head {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 4px 6px;
    border-radius: 8px;
    color: inherit;
    text-decoration: none;
    font-size: 13px;
    min-width: 0;
  }
  .cal-head:hover {
    background: var(--surface-2);
  }
  .cal-head.past {
    pointer-events: none;
    opacity: 0.6;
  }
  .col.past {
    opacity: 0.55;
  }
  .cal-head.today {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .cal-body {
    position: relative;
    display: grid;
    grid-template-columns: var(--gutter) repeat(var(--cols), minmax(0, 1fr));
    gap: 6px;
  }
  .hours {
    position: relative;
  }
  .hours span {
    position: absolute;
    right: 8px;
    transform: translateY(-50%);
    font-family: var(--mono);
    font-size: 11px;
    color: var(--dim);
  }
  .hours span:first-child {
    transform: none;
  }
  .col {
    position: relative;
    min-width: 0;
  }
  .hline {
    position: absolute;
    left: 0;
    right: 0;
    height: 1px;
    background: var(--line);
  }
  .gap {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    background: repeating-linear-gradient(90deg, var(--line) 0 2px, transparent 2px 8px) center / 100% 1px no-repeat, var(--surface);
    pointer-events: none;
  }
  .gap span {
    background: var(--surface);
    padding: 0 8px;
  }
  .col.today {
    background-color: color-mix(in srgb, var(--accent) 4%, transparent);
  }
  .free-day {
    position: absolute;
    top: 8px;
    left: 8px;
  }
  /* Classes, work and other events from your calendars. */
  .ev {
    position: absolute;
    border-radius: 6px;
    padding: 3px 8px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-size: 12px;
    line-height: 1.25;
    border-left: 3px solid var(--ev);
    background: color-mix(in srgb, var(--ev) 13%, var(--surface));
    color: var(--muted);
    /* Above the study window bands so they read clearly, but drops still reach the band underneath. */
    z-index: 1;
    pointer-events: none;
  }
  .compact .ev {
    padding: 2px 4px;
    font-size: 11px;
  }
  .ev-lesson {
    --ev: var(--info);
  }
  .ev-work {
    --ev: var(--warn);
    background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--warn) 14%, var(--surface)) 0 6px, var(--surface) 6px 12px);
  }
  .ev-other {
    --ev: var(--dim);
  }
  .ev-title {
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ev-time {
    font-size: 11px;
    white-space: nowrap;
  }
  .day-load {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    align-items: center;
  }
  .allday {
    display: inline-block;
    max-width: 100%;
    padding: 1px 8px;
    border-radius: 10px;
    border: 1px solid var(--line-strong);
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cal-head .allday {
    font-size: 11px;
    padding: 0 6px;
  }
  .band {
    position: absolute;
    left: 0;
    right: 0;
    border-radius: 8px;
    border: 1px dashed var(--line-strong);
    background: color-mix(in srgb, var(--surface-2) 60%, transparent);
  }
  .band.over {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border-color: var(--accent);
  }
  .band-label {
    position: absolute;
    right: 10px;
    top: 6px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
    font-size: 12px;
    color: var(--muted);
    text-align: right;
    max-width: 130px;
    pointer-events: none;
  }
  .blk,
  .chip,
  .planning {
    position: absolute;
    border-radius: 8px;
    background: var(--surface-2);
    border: 1px solid var(--line-strong);
    box-shadow: inset 3px 0 0 var(--c, var(--accent));
  }
  .blk {
    left: 4px;
    right: 148px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 2px 8px 2px 12px;
    cursor: grab;
    z-index: 1;
  }
  .blk.tall {
    align-items: flex-start;
    padding-top: 7px;
  }
  .blk:hover,
  .blk:focus-within {
    z-index: 3;
    border-color: var(--muted);
  }
  .blk.pinned {
    border-color: color-mix(in srgb, var(--accent) 60%, var(--line-strong));
  }
  .blk-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .blk:not(.tall) .blk-main {
    flex-direction: row;
    align-items: baseline;
    gap: 10px;
  }
  .blk-title {
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .blk-time {
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .blk.done {
    opacity: 0.55;
  }
  .blk.done .blk-title {
    text-decoration: line-through;
  }
  .tick {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
    flex: none;
    margin: 0;
  }
  .blk.tall .tick {
    margin-top: 1px;
  }
  .tag {
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 400;
    padding: 0 6px;
    margin-left: 6px;
    border-radius: 10px;
    border: 1px solid var(--line-strong);
    color: var(--muted);
  }
  .tools {
    display: flex;
    gap: 6px;
    flex: none;
  }
  .tools :global(.btn.small) {
    min-height: 26px;
    padding: 0 10px;
    font-size: 13px;
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
  .more-tools {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 10;
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
  .planning {
    left: 4px;
    right: 4px;
    --c: var(--accent);
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 2px 10px 2px 12px;
    color: var(--text);
    text-decoration: none;
    border-style: dashed;
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, var(--surface));
    z-index: 1;
    overflow: hidden;
  }
  .planning.done {
    opacity: 0.55;
    border-style: solid;
  }
  .compact .planning .blk-title {
    font-size: 11px;
  }
  .chip {
    left: 2px;
    right: 2px;
    display: flex;
    align-items: flex-start;
    padding: 2px 4px 2px 8px;
    font-size: 11.5px;
    line-height: 1.3;
    color: var(--text);
    text-decoration: none;
    overflow: hidden;
    cursor: grab;
    z-index: 1;
  }
  .chip.done {
    opacity: 0.5;
  }
  .chip.done .chip-text {
    text-decoration: line-through;
  }
  .chip-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .now {
    position: absolute;
    left: -4px;
    right: 0;
    height: 2px;
    background: var(--warn);
    z-index: 4;
    pointer-events: none;
  }
  .now::before {
    content: '';
    position: absolute;
    left: -3px;
    top: -3px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--warn);
  }
  .week-scroll {
    overflow-x: auto;
  }
  .week-scroll .cal {
    min-width: 760px;
  }
  .mini-warn {
    color: var(--warn);
    font-size: 11px;
  }

  /* Extra time and skipped items, which have no set time. */
  .loose {
    display: flex;
    flex-direction: column;
  }
  .loose-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
    font-size: 14px;
  }
  .loose-item.done .grow {
    color: var(--muted);
    text-decoration: line-through;
  }

  .day-edit {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .day-edit-line,
  .edit-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .edit-row .name-in {
    flex: 1 1 160px;
  }
  .edit-row .mins-in {
    width: 80px;
  }

  @media (max-width: 900px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
    .side {
      position: static;
    }
  }
  @media (max-width: 640px) {
    h1 {
      font-size: 28px;
    }
    .blk {
      right: 4px;
    }
    .band-label,
    .blk:not(.tall) .blk-time {
      display: none;
    }
    .step {
      margin-left: 0;
    }
  }

  /* The to do tray (calendar mode). */
  .tray {
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tray-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  .tray-hint {
    margin: -4px 0 2px;
  }
  .tray-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-left: 3px solid var(--c);
    border-radius: 8px;
    background: var(--surface);
    cursor: grab;
  }
  .tray-item.urgent {
    border-color: color-mix(in srgb, var(--warn) 55%, var(--line));
    border-left-color: var(--c);
  }
  .tray-item:active {
    cursor: grabbing;
  }
  .tray-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .tray-title {
    font-weight: 600;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .drop-at {
    position: absolute;
    left: 2px;
    right: 2px;
    z-index: 3;
    border: 1.5px dashed var(--accent);
    border-radius: 6px;
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    pointer-events: none;
    padding: 1px 6px;
    color: var(--accent);
  }
  .mini-field {
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }
</style>
