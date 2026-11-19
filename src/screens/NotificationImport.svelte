<script lang="ts">
  import { deleteImage, getSettings, listDecks, listSkills, listTestPlans, newId, saveImage, saveTestPlan } from '../lib/db';
  import { KIND_LABEL } from '../lib/planner/assessments';
  import { dateKey, dayLabel, todayKey } from '../lib/planner/dates';
  import {
    findExisting,
    parseNotification,
    planFromNotification,
    readDocx,
    type ParsedNotification,
  } from '../lib/planner/notification';
  import { shortSubject } from '../lib/practice/load';
  import { plural } from '../lib/load';
  import { href } from '../lib/router.svelte';
  import { SUBJECTS, type AssessmentKind, type Deck, type Skill, type TestPlan } from '../lib/types';

  interface Draft {
    key: string;
    file: File;
    parsed: ParsedNotification;
    name: string;
    subject: string;
    kind: AssessmentKind;
    /** Index into parsed.dateOptions, or -1 for a date typed in. */
    option: number;
    date: string;
    weighting: number | '';
    include: boolean;
  }

  /** The class picked last time for a subject with one date per class, so the next notification picks it too. */
  const CLASS_KEY = 'notification-class';
  const classes: Record<string, string> = JSON.parse(localStorage.getItem(CLASS_KEY) ?? '{}');

  let drafts = $state<Draft[]>([]);
  let failed = $state<{ name: string; problem: string }[]>([]);
  let plans = $state.raw<TestPlan[]>([]);
  let skills = $state.raw<Skill[]>([]);
  let decks = $state.raw<Deck[]>([]);
  let saved = $state.raw<{ plan: TestPlan; updated: boolean }[]>([]);
  let saving = $state(false);
  let dragging = $state(false);
  let today = $state(todayKey(Date.now(), 4));

  Promise.all([listTestPlans(), listSkills(), listDecks(), getSettings()]).then(([p, s, d, settings]) => {
    today = todayKey(Date.now(), settings.dayStartHour);
    plans = p;
    skills = s;
    decks = d;
  });

  async function add(files: File[]) {
    saved = [];
    for (const file of files) {
      if (!/\.docx$/i.test(file.name)) {
        failed = [...failed, { name: file.name, problem: 'Only Word (.docx) notifications can be read. Add this one by hand.' }];
        continue;
      }
      try {
        const parsed = parseNotification(readDocx(new Uint8Array(await file.arrayBuffer())), file.name);
        const remembered = classes[parsed.subject];
        const pick = Math.max(0, parsed.dateOptions.findIndex((o) => o.label && o.label === remembered));
        drafts.push({
          key: newId(),
          file,
          parsed,
          name: parsed.name,
          subject: parsed.subject || SUBJECTS[0],
          kind: parsed.kind,
          option: parsed.dateOptions.length ? pick : -1,
          date: parsed.dateOptions[pick]?.date ?? '',
          weighting: parsed.weighting ?? '',
          include: true,
        });
      } catch (e) {
        failed = [...failed, { name: file.name, problem: e instanceof Error ? e.message : String(e) }];
      }
    }
  }

  function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    add(files);
  }

  function drop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    add([...(e.dataTransfer?.files ?? [])]);
  }

  function setOption(d: Draft, i: number) {
    d.option = i;
    if (i >= 0) d.date = d.parsed.dateOptions[i].date;
  }

  const ready = $derived(drafts.filter((d) => d.include && d.date && d.name.trim()));

  function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function save() {
    saving = true;
    try {
      const done: { plan: TestPlan; updated: boolean }[] = [];
      let current = await listTestPlans();
      for (const d of ready) {
        // Keep the original file so it can be opened again (offline too).
        const fileId = newId();
        await saveImage({ id: fileId, data: await readAsDataUrl(d.file), width: 0, height: 0 });
        // Drafts are reactive proxies, which IndexedDB can't store.
        const parsed = $state.snapshot(d.parsed);
        const option = d.option >= 0 ? parsed.dateOptions[d.option] : undefined;
        const { plan, existing } = planFromNotification(
          parsed,
          {
            name: d.name,
            subject: d.subject,
            kind: d.kind,
            date: d.date,
            time: option?.time,
            weighting: d.weighting === '' ? undefined : Number(d.weighting),
            outOf: d.parsed.outOf,
          },
          { fileName: d.file.name, fileId },
          { plans: current, skills, decks, now: Date.now(), newId },
        );
        if (existing?.notification?.fileId) await deleteImage(existing.notification.fileId);
        await saveTestPlan(plan);
        current = [...current.filter((p) => p.id !== plan.id), plan];
        if (option?.label) classes[d.subject] = option.label;
        done.push({ plan, updated: !!existing });
      }
      localStorage.setItem(CLASS_KEY, JSON.stringify(classes));
      plans = current;
      saved = done;
      drafts = drafts.filter((d) => !ready.includes(d));
      failed = [];
    } finally {
      saving = false;
    }
  }
</script>

<main class="page">
  <section class="head">
    <div class="eyebrow"><a href={href('planner')}>Planner</a> / <a href={href('planner', 'exams')}>Exams</a></div>
    <h1>Upload task notifications</h1>
    <p class="muted">
      Choose the Word files your teachers hand out. The app reads the subject, task, date, weighting and topics, adds
      each one to your exams so prep starts on time, and keeps the notification to read later.
    </p>
  </section>

  <label
    class="drop panel"
    class:dragging
    ondragover={(e) => {
      e.preventDefault();
      dragging = true;
    }}
    ondragleave={() => (dragging = false)}
    ondrop={drop}
  >
    <span class="btn primary">Choose .docx files</span>
    <span class="muted small">or drop them here. You can pick several at once.</span>
    <input class="sr-only" type="file" multiple accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onchange={pick} />
  </label>

  {#each failed as f (f.name)}
    <div class="notice warn">{f.name}: {f.problem}</div>
  {/each}

  {#if saved.length}
    <section class="panel done">
      <h2>{plural(saved.length, 'assessment')} saved</h2>
      {#each saved as s (s.plan.id)}
        <a class="row item" href={href('planner', 'exam', s.plan.id)}>
          <span class="grow">{s.plan.name} <span class="muted small">{shortSubject(s.plan.subject)}</span></span>
          <span class="mono small">{s.updated ? 'updated' : 'added'}</span>
          <span class="mono small">{s.plan.skillIds.length ? plural(s.plan.skillIds.length, 'skill') + ' ticked' : ''}</span>
          <span class="mono small when">{dayLabel(dateKey(s.plan.date), today)}</span>
        </a>
      {/each}
      <p class="muted small">Open each one to check the skills and flashcard decks in scope. They were ticked from the topics the notification names.</p>
      <div class="actions"><a class="btn" href={href('planner', 'exams')}>See all exams</a></div>
    </section>
  {/if}

  {#each drafts as d (d.key)}
    {@const existing = findExisting(plans, d.subject, d.name, d.parsed.taskNumber)}
    <section class="panel draft" class:off={!d.include}>
      <div class="draft-head">
        <label class="check">
          <input type="checkbox" bind:checked={d.include} />
          <span class="mono small muted">{d.file.name}</span>
        </label>
        {#if existing}<span class="tag mono">updates "{existing.name}"</span>{/if}
      </div>
      <div class="fields">
        <label class="field wide">Name<input type="text" bind:value={d.name} /></label>
        <label class="field">
          Subject
          <select bind:value={d.subject}>
            {#each SUBJECTS as s (s)}<option value={s}>{s}</option>{/each}
          </select>
        </label>
        <label class="field">
          Kind
          <select bind:value={d.kind}>
            {#each ['test', 'exam', 'assignment'] as const as k (k)}<option value={k}>{KIND_LABEL[k]}</option>{/each}
          </select>
        </label>
        <label class="field">Weighting %<input type="number" min="0" max="100" bind:value={d.weighting} /></label>
        <div class="field">
          <span>Marked out of</span>
          <span class="mono value">{d.parsed.outOf ?? 'not given'}</span>
        </div>
      </div>

      {#if d.parsed.dateOptions.length > 1}
        <div class="dates">
          <span class="small">Which class are you in?</span>
          {#each d.parsed.dateOptions as o, i (o.date)}
            <label class="row pick">
              <input type="radio" name={`date-${d.key}`} checked={d.option === i} onchange={() => setOption(d, i)} />
              <span class="grow">{o.label ?? 'Class ' + (i + 1)}</span>
              <span class="mono small">{dayLabel(o.date, today)}{o.time ? ` · ${o.time}` : ''}</span>
            </label>
          {/each}
        </div>
      {:else}
        <div class="fields">
          <label class="field">
            {d.kind === 'assignment' ? 'Due date' : 'Date'}
            <input type="date" bind:value={d.date} oninput={() => (d.option = -1)} />
          </label>
          <div class="field">
            <span>Read as</span>
            <span class="mono value">
              {d.date ? dayLabel(d.date, today) : 'no date'}{d.option === 0 && d.parsed.time ? ` · ${d.parsed.time}` : ''}
            </span>
          </div>
        </div>
      {/if}

      {#each d.parsed.warnings.filter((w) => !w.startsWith('There is a different date')) as w (w)}
        <div class="notice warn small">{w}</div>
      {/each}
      {#if d.parsed.topicText}
        <details>
          <summary class="muted small">Topics it names</summary>
          <pre class="topics small">{d.parsed.topicText}</pre>
        </details>
      {/if}
    </section>
  {/each}

  {#if drafts.length}
    <div class="actions">
      <button class="btn primary" onclick={save} disabled={!ready.length || saving}>
        {saving ? 'Saving...' : `Add ${plural(ready.length, 'assessment')}`}
      </button>
      <button class="btn" onclick={() => ((drafts = []), (failed = []))}>Clear</button>
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
    margin: 0 0 4px;
  }
  .drop {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px;
    padding: 22px 18px;
    border: 1px dashed var(--line-strong);
    cursor: pointer;
  }
  .drop.dragging {
    border-color: var(--accent);
  }
  .draft,
  .done {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .draft.off {
    opacity: 0.5;
  }
  .draft-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
    align-items: center;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
  }
  .wide {
    grid-column: 1 / -1;
  }
  .value {
    min-height: 44px;
    display: flex;
    align-items: center;
  }
  input[type='date'] {
    min-height: 44px;
    padding: 8px 12px;
    border-radius: 10px;
    border: 1px solid var(--line-strong);
    background: var(--surface);
    color: var(--text);
    font: 400 16px var(--font);
  }
  .check {
    display: flex;
    gap: 10px;
    align-items: center;
    cursor: pointer;
  }
  .check input,
  .pick input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
  .pick {
    cursor: pointer;
    min-height: 44px;
  }
  .tag {
    font-size: 12px;
    padding: 2px 10px;
    border-radius: 10px;
    border: 1px solid var(--accent);
    color: var(--accent);
  }
  .item {
    color: var(--text);
    text-decoration: none;
  }
  .grow {
    flex: 1;
  }
  .when {
    min-width: 120px;
    text-align: right;
  }
  .topics {
    white-space: pre-wrap;
    font-family: var(--font);
    color: var(--muted);
    margin: 8px 0 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .small {
    font-size: 13px;
  }
  .notice.small {
    margin: 0;
  }
</style>
