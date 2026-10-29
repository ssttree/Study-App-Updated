<script lang="ts">
  import { untrack } from 'svelte';
  import ProblemImage from '../components/ProblemImage.svelte';
  import Snipper from '../components/Snipper.svelte';
  import { getTask, listSkills, problemSkillsByKey, saveTask } from '../lib/db';
  import { plural } from '../lib/load';
  import { href } from '../lib/router.svelte';
  import { allKnown, findSkill, saveProblems, type SaveResult } from '../lib/practice/save';
  import { SUBJECTS, taskSkillIds, type Skill, type Task } from '../lib/types';
  import type { AnalysedSheet, DraftPair } from '../lib/practice/worksheet';
  import type { OpenPdf, Picture } from '../lib/practice/pdf';

  interface SheetState {
    id: number;
    fileName: string;
    analysed: AnalysedSheet;
    subject: string;
    /** 'new' or an existing skill's id. */
    skill: string;
    name: string;
    dotPoint: string;
    pairs: DraftPair[];
    showAll: boolean;
    /** A pair being fixed by hand, or the next box in snip mode. */
    fixing: { index: number; part: 'question' | 'solution' } | null;
    pendingQuestion: Picture | null;
    /** Snip mode: a separate PDF holding the answers, like a NESA marking guideline. */
    answers: OpenPdf | null;
    answersName: string;
    /** Last page boxed in each PDF, so switching between them comes back to the same place. */
    lastPage: { question: number; solution: number };
    /** Questions on this sheet that are in the app already. */
    knownCount: number;
    /** Set when every question is in the app already: the skill they are in. */
    knownSkill: string | null;
  }

  /** Set when importing a SmarterEd set from the homework list. */
  let { taskId }: { taskId?: string } = $props();
  let task = $state.raw<Task | null>(null);
  // The page is rebuilt for a new address, so the first value is the only one.
  const forTask = untrack(() => taskId);
  if (forTask) getTask(forTask).then((t) => (task = t ?? null));

  type Step = 'pick' | 'reading' | 'review' | 'saving' | 'done';
  let step = $state<Step>('pick');
  let error = $state('');
  let dragging = $state(false);
  let progress = $state('');
  let sheets = $state<SheetState[]>([]);
  let skills = $state.raw<Skill[]>([]);
  let results = $state.raw<{ fileName: string; result: SaveResult }[]>([]);
  let nextId = 0;

  // PDF.js is large, so it only loads once a PDF is picked.
  const reader = () => import('../lib/practice/worksheet');

  listSkills().then((s) => (skills = s));
  // Questions already in the app, so a worksheet imported before is just linked.
  let known = new Map<string, string>();
  problemSkillsByKey().then((m) => (known = m));

  async function openFiles(files: File[]) {
    error = '';
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!pdfs.length) {
      error = 'Pick one or more PDF files.';
      return;
    }
    step = 'reading';
    const lib = await reader();
    for (const [n, file] of pdfs.entries()) {
      progress = `${file.name} (${n + 1} of ${pdfs.length})`;
      try {
        const analysed = await lib.analyseSheet(file, (done, total) => (progress = `${file.name}: cropping ${done} of ${total}`));
        const subject = analysed.sheet.subject || task?.subject || SUBJECTS[1];
        const existing = findSkill(skills, subject, analysed.sheet.title);
        const knownSkill = analysed.smarterEd ? allKnown(analysed.pairs.map((p) => p.key), known) : null;
        const knownCount = analysed.pairs.filter((p) => known.has(p.key)).length;
        for (const p of analysed.pairs) if (known.has(p.key)) p.include = false;
        sheets.push({
          id: nextId++,
          fileName: file.name,
          analysed,
          subject,
          skill: knownSkill ?? existing?.id ?? 'new',
          name: analysed.sheet.title,
          dotPoint: '',
          pairs: analysed.pairs,
          showAll: false,
          fixing: analysed.smarterEd ? null : { index: -1, part: 'question' },
          pendingQuestion: null,
          answers: null,
          answersName: '',
          lastPage: { question: 0, solution: 0 },
          knownCount,
          knownSkill,
        });
      } catch (e) {
        error = `Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    step = sheets.length ? 'review' : 'pick';
  }

  function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    openFiles(files);
  }

  function drop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    openFiles([...(e.dataTransfer?.files ?? [])]);
  }

  const needsLook = (p: DraftPair) => p.problems.length > 0;

  async function addAnswers(sheet: SheetState, e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const lib = await reader();
      sheet.answers?.destroy();
      sheet.answers = await lib.openAnswers(file);
      sheet.answersName = file.name;
      sheet.lastPage.solution = 0;
    } catch (err) {
      error = `Could not read ${file.name}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  function removeAnswers(sheet: SheetState) {
    sheet.answers?.destroy();
    sheet.answers = null;
    sheet.answersName = '';
  }

  /** The PDF to box a solution in: the separate answers PDF when there is one. */
  const solutionPdf = (sheet: SheetState) => sheet.answers ?? sheet.analysed.pdf;

  function destroyAll() {
    for (const s of sheets) {
      s.analysed.pdf.destroy();
      s.answers?.destroy();
    }
  }

  function onPicked(sheet: SheetState, picture: Picture, page: number) {
    const f = sheet.fixing;
    if (!f) return;
    sheet.lastPage[f.part] = page;
    if (f.index >= 0) {
      const pair = sheet.pairs[f.index];
      if (f.part === 'question') pair.question = picture;
      else pair.solution = picture;
      pair.include = true;
      pair.problems = pair.problems.filter((p) => (f.part === 'question' ? !/^Question|^No question/.test(p) : !/solution/i.test(p)));
      sheet.fixing = null;
      return;
    }
    // Snip mode: a question box, then its solution box.
    if (f.part === 'question') {
      sheet.pendingQuestion = picture;
      sheet.fixing = { index: -1, part: 'solution' };
    } else {
      addSnipped(sheet, picture);
    }
  }

  function addSnipped(sheet: SheetState, solution: Picture | null) {
    if (!sheet.pendingQuestion) return;
    const n = sheet.pairs.length + 1;
    sheet.pairs.push({
      number: n,
      header: '',
      label: `Q${n}`,
      marks: 2,
      mc: false,
      key: `snip:${sheet.fileName}:${sheet.pendingQuestion.data.length}:${sheet.pendingQuestion.data.slice(-40)}`,
      question: sheet.pendingQuestion,
      solution,
      problems: [],
      include: true,
      skill: '',
    });
    sheet.pendingQuestion = null;
    sheet.fixing = { index: -1, part: 'question' };
  }

  const ready = $derived(sheets.every((s) => (s.skill !== 'new' || s.name.trim()) && s.subject));
  const total = $derived(sheets.reduce((n, s) => n + s.pairs.filter((p) => p.include).length, 0));
  const linkOnly = $derived(sheets.some((s) => s.knownSkill));

  async function saveAll() {
    step = 'saving';
    const out: { fileName: string; result: SaveResult }[] = [];
    try {
      for (const s of sheets) {
        const already = s.knownSkill ? skills.find((k) => k.id === s.knownSkill) : undefined;
        if (already) {
          out.push({ fileName: s.fileName, result: { skill: already, added: 0, skipped: s.knownCount } });
          continue;
        }
        const drafts = s.pairs.filter((p) => p.include && p.question.data);
        if (!drafts.length) continue;
        progress = s.fileName;
        const choice =
          s.skill === 'new'
            ? ({ kind: 'new', subject: s.subject, name: s.name, topic: s.analysed.sheet.topic, code: s.analysed.sheet.code, dotPoint: s.dotPoint } as const)
            : ({ kind: 'existing', id: s.skill } as const);
        // A past paper covers many skills: questions given their own skill are saved there.
        const groups = new Map<string, DraftPair[]>();
        for (const d of drafts) groups.set(d.skill ?? '', [...(groups.get(d.skill ?? '') ?? []), d]);
        for (const [skillId, group] of groups) {
          const result = await saveProblems(
            skillId ? { kind: 'existing', id: skillId } : choice,
            group,
            s.analysed.smarterEd ? 'smartered' : 'snip',
            s.analysed.smarterEd ? s.name || s.fileName : s.fileName.replace(/\.pdf$/i, ''),
          );
          out.push({ fileName: s.fileName, result });
        }
        skills = await listSkills();
      }
      destroyAll();
      // Homework: link the set to every worksheet's skill. An optional set just joins the skill pool.
      if (task && out[0]) {
        const skillIds = [...new Set([...taskSkillIds(task), ...out.map((r) => r.result.skill.id)])];
        const linked: Task = { ...task, skillIds, skillId: undefined };
        if (!task.required) Object.assign(linked, { status: 'done', finished: Date.now() });
        await saveTask(linked);
        task = linked;
      }
      results = out;
      sheets = [];
      step = 'done';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      step = 'review';
    }
  }

  function startOver() {
    destroyAll();
    sheets = [];
    results = [];
    step = 'pick';
  }
</script>

<main class="page wide">
  <section class="head">
    <div class="eyebrow"><a href={href('practice')}>Practice</a> / Import</div>
    <h1>Import PDFs</h1>
    {#if task}<p class="accent">For the homework "{task.title}"</p>{/if}
    <p class="muted">
      Drop in one or more worksheets. The app finds each question and its worked solution and cuts them out as
      pictures. Each worksheet becomes a skill, named after its title, and is switched on since your teacher has
      taught it. Pairs that look right are ticked already; you only need to check the ones marked.
    </p>
  </section>

  {#if error}<div class="notice warn">{error}</div>{/if}

  {#if step === 'pick' || step === 'reading'}
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
      {#if step === 'reading'}
        <span class="big">Reading...</span>
        <span class="muted mono small">{progress}</span>
      {:else}
        <span class="big">Drop PDFs here</span>
        <span class="muted">or click to choose. You can pick several at once.</span>
        <input class="sr-only" type="file" accept="application/pdf,.pdf" multiple onchange={pick} />
      {/if}
    </label>
    <p class="muted small">
      Other PDFs work too, like a NESA past HSC paper for Business Studies or Engineering Studies, or class notes with
      questions in them. The app shows the pages and you drag a box around each question, then its answer. If the
      answers are in a separate PDF, like the marking guidelines, you can add that PDF and box the answers there.
    </p>
  {:else if step === 'review'}
    {#each sheets as s (s.id)}
      {@const look = s.pairs.filter(needsLook)}
      {@const subjectSkills = skills.filter((k) => k.subject === s.subject && !k.parentId)}
      {#if s.knownSkill}
        <section class="sheet panel">
          <div class="mono muted small">{s.fileName}</div>
          <h2>Already in the app</h2>
          <p class="muted">
            All {s.knownCount} questions are in the skill
            <strong>{skills.find((k) => k.id === s.knownSkill)?.name ?? 'from before'}</strong>, so nothing needs
            checking.{task ? ' The homework will be linked to them.' : ''}
          </p>
        </section>
      {:else}
      <section class="sheet panel">
        <div class="sheet-head">
          <div>
            <div class="mono muted small">{s.fileName}</div>
            <h2>{s.analysed.smarterEd ? `${plural(s.pairs.length, 'question')} found` : 'Snip questions by hand'}</h2>
            {#if s.knownCount}<p class="muted small">{s.knownCount} already in the app, so they're unticked.</p>{/if}
          </div>
          {#if s.analysed.smarterEd}
            <span class="mono small" class:warn={look.length > 0}>
              {look.length ? `${look.length} to check` : 'All paired'}
            </span>
          {/if}
        </div>

        <div class="fields">
          <label class="field">
            Subject
            <select bind:value={s.subject}>
              {#each SUBJECTS as sub (sub)}<option value={sub}>{sub}</option>{/each}
            </select>
          </label>
          <label class="field">
            Skill
            <select bind:value={s.skill}>
              <option value="new">New skill</option>
              {#each subjectSkills as k (k.id)}<option value={k.id}>Add to: {k.name}</option>{/each}
            </select>
          </label>
          {#if s.skill === 'new'}
            <label class="field">Skill name<input type="text" bind:value={s.name} /></label>
            <label class="field">Dot point (optional)<input type="text" bind:value={s.dotPoint} placeholder="e.g. ME-F2.1" /></label>
          {/if}
        </div>
        {#if s.analysed.sheet.topic && s.skill === 'new'}
          <p class="muted small topic">Topic: {s.analysed.sheet.topic}</p>
        {/if}

        {#if s.fixing}
          <div class="fix">
            {#if s.fixing.index >= 0}
              <Snipper
                pdf={s.fixing.part === 'solution' ? solutionPdf(s) : s.analysed.pdf}
                startPage={s.lastPage[s.fixing.part]}
                prompt={`Question ${s.pairs[s.fixing.index].number}: box the ${s.fixing.part === 'question' ? 'question' : 'worked solution'}.`}
                onpick={(p, page) => onPicked(s, p, page)}
              />
              <button class="btn small" onclick={() => (s.fixing = null)}>Cancel</button>
            {:else}
              {#if !s.analysed.smarterEd}
                <div class="answers small">
                  {#if s.answers}
                    <span>Answers come from <strong>{s.answersName}</strong>.</span>
                    <button class="btn small" onclick={() => removeAnswers(s)}>Use this PDF instead</button>
                  {:else}
                    <span class="muted">Answers in a separate PDF, like a NESA marking guideline?</span>
                    <label class="btn small">
                      Add the answers PDF
                      <input class="sr-only" type="file" accept="application/pdf,.pdf" onchange={(e) => addAnswers(s, e)} />
                    </label>
                  {/if}
                </div>
              {/if}
              <Snipper
                pdf={s.fixing.part === 'solution' ? solutionPdf(s) : s.analysed.pdf}
                startPage={s.lastPage[s.fixing.part]}
                prompt={s.fixing.part === 'question'
                  ? `Question ${s.pairs.length + 1}: box the question.`
                  : `Now box its ${s.answers ? 'marking guideline' : 'answer or worked solution'}.`}
                onpick={(p, page) => onPicked(s, p, page)}
              />
              <div class="row-actions">
                {#if s.fixing.part === 'solution'}
                  <button class="btn small" onclick={() => addSnipped(s, null)}>This one has no answer</button>
                {/if}
                {#if s.analysed.smarterEd}
                  <button class="btn small" onclick={() => (s.fixing = null)}>Done snipping</button>
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        {#if s.pairs.length}
          {@const shown = s.showAll || !s.analysed.smarterEd ? s.pairs : look}
          {#if s.analysed.smarterEd}
            <div class="row-actions">
              <button class="btn small" onclick={() => (s.showAll = !s.showAll)}>
                {s.showAll ? 'Show only the ones to check' : `Show all ${s.pairs.length}`}
              </button>
              <button class="btn small" onclick={() => (s.fixing = { index: -1, part: 'question' })}>Snip an extra question</button>
            </div>
          {/if}
          {#each shown as p (p.key + p.number)}
            {@const i = s.pairs.indexOf(p)}
            <div class="pair" class:off={!p.include}>
              <div class="pair-head">
                <label class="tick">
                  <input type="checkbox" bind:checked={p.include} />
                  <span>{p.number}. {p.label || 'Question'}</span>
                </label>
                <label class="marks mono small"><input type="number" min="1" max="20" bind:value={p.marks} /> marks</label>
                {#if p.mc}<span class="mono small muted">MC</span>{/if}
                {#if !s.analysed.smarterEd && subjectSkills.length}
                  <label class="pair-skill small">
                    <span class="sr-only">Skill for question {p.number}</span>
                    <select bind:value={p.skill}>
                      <option value="">{s.skill === 'new' ? `Skill: ${s.name || 'new skill'}` : 'Same skill as the sheet'}</option>
                      {#each subjectSkills.filter((k) => k.id !== s.skill) as k (k.id)}<option value={k.id}>{k.name}</option>{/each}
                    </select>
                  </label>
                {/if}
                {#each p.problems as why (why)}<span class="flag small">{why}</span>{/each}
              </div>
              <div class="sides">
                <div class="side">
                  {#if p.question.data}<ProblemImage src={p.question.data} alt="Question {p.number}" small />{:else}<div class="missing">No question picture</div>{/if}
                  <button class="btn small" onclick={() => (s.fixing = { index: i, part: 'question' })}>Redo question box</button>
                </div>
                <div class="side">
                  {#if p.solution?.data}<ProblemImage src={p.solution.data} alt="Solution {p.number}" small />{:else}<div class="missing">No worked solution</div>{/if}
                  <button class="btn small" onclick={() => (s.fixing = { index: i, part: 'solution' })}>Redo solution box</button>
                </div>
              </div>
            </div>
          {/each}
          {#if s.analysed.smarterEd && !s.showAll && look.length === 0}
            <p class="muted small">Every question was matched to its worked solution.</p>
          {/if}
        {/if}
      </section>
      {/if}
    {/each}

    <div class="save-bar">
      <button class="btn primary" onclick={saveAll} disabled={!ready || (total === 0 && !linkOnly)}>
        {total === 0 && linkOnly ? (task ? 'Link to the homework' : 'Done') : `Save ${plural(total, 'question')}`}
      </button>
      <button class="btn" onclick={startOver}>Start over</button>
    </div>
  {:else if step === 'saving'}
    <section class="drop panel"><span class="big">Saving...</span><span class="muted mono small">{progress}</span></section>
  {:else if step === 'done'}
    <section class="done">
      {#each results as r, i (i)}
        <div class="row">
          <span class="dot" style:background="var(--accent)"></span>
          <a class="grow" href={href('practice', 'skill', r.result.skill.id)}>{r.result.skill.name}</a>
          <span class="mono muted small">
            {plural(r.result.added, 'question')} added{r.result.skipped ? ` · ${r.result.skipped} already here` : ''}
          </span>
        </div>
      {/each}
      {#if task && taskSkillIds(task).length}
        <p class="muted">
          {task.required
            ? `Linked to the homework "${task.title}". Doing these questions in a problem session ticks it off.`
            : `"${task.title}" is optional, so its questions joined your skill pool and will come up in your daily mix.`}
        </p>
      {/if}
      <div class="row-actions">
        {#if task && taskSkillIds(task).length && task.required}
          <a class="btn primary" href={href('practice', 'run', 'task', task.id)}>Do these questions now</a>
          <a class="btn" href={href('planner', 'homework')}>Back to homework</a>
        {:else}
          <a class="btn primary" href={href('practice')}>Go to practice</a>
          <button class="btn" onclick={startOver}>Import more</button>
        {/if}
      </div>
    </section>
  {/if}
</main>

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .accent {
    color: var(--accent);
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
  h2 {
    font-size: 20px;
  }
  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 56px 24px;
    border-style: dashed;
    border-color: var(--line-strong);
    text-align: center;
    cursor: pointer;
  }
  .drop.dragging {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, var(--surface));
  }
  .big {
    font-size: 22px;
  }
  .small {
    font-size: 13px;
  }
  .sheet {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px;
  }
  .sheet-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }
  .warn {
    color: var(--warn);
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
  }
  .topic {
    margin: -6px 0 0;
  }
  .answers {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }
  .fix {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    border: 1px solid var(--accent);
    border-radius: var(--radius);
  }
  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .pair {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }
  .pair.off .sides {
    opacity: 0.4;
  }
  .pair-head {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
    align-items: center;
  }
  .tick {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    min-height: 36px;
    cursor: pointer;
  }
  .tick input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
  .marks {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
  }
  .marks input {
    width: 64px;
    min-height: 34px;
    padding: 4px 8px;
  }
  .pair-skill select {
    width: auto;
    max-width: 320px;
    min-height: 34px;
    padding: 4px 8px;
  }
  .flag {
    color: var(--warn);
    border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
    border-radius: 12px;
    padding: 2px 10px;
  }
  .sides {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 14px;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }
  .side :global(.paper) {
    width: 100%;
  }
  .missing {
    width: 100%;
    padding: 24px;
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius);
    color: var(--muted);
    text-align: center;
  }
  .save-bar {
    position: sticky;
    bottom: 0;
    display: flex;
    gap: 12px;
    padding: 14px 0;
    background: var(--bg);
    border-top: 1px solid var(--line);
  }
  .done {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .grow {
    flex: 1 1 240px;
  }
</style>
