<script lang="ts">
  // Fix a saved question: a wrong answer, a bad crop, a typo, the marks or the
  // multiple choice letter. Opens over the page, so a practice block carries on
  // from the same question once you save.
  import { untrack } from 'svelte';
  import MathText from './MathText.svelte';
  import ProblemImage from './ProblemImage.svelte';
  import { getImage, newId, updateProblems } from '../lib/db';
  import { imageToDataUrl } from '../lib/images';
  import { applyEdit, editForCopy, editFor, editProblemError, type ProblemPart } from '../lib/practice/edit';
  import { LEVELS, LEVEL_NAMES } from '../lib/practice/mix';
  import type { Problem, ProblemLevel } from '../lib/types';

  let {
    problem,
    copies = [],
    skillName = (id: string) => id,
    answerName = 'Answer',
    onsaved,
    onclose,
  }: {
    problem: Problem;
    /** The same question saved in other skills. */
    copies?: Problem[];
    skillName?: (skillId: string) => string;
    answerName?: string;
    onsaved: (saved: Problem, all: Problem[]) => void;
    onclose: () => void;
  } = $props();

  type Side = 'question' | 'solution';
  interface SideState {
    kind: 'text' | 'image' | 'none';
    text: string;
    id?: string;
    picture?: { data: string; width: number; height: number };
  }

  function sideState(part: ProblemPart): SideState {
    if (part.kind === 'text') return { kind: 'text', text: part.text };
    if (part.kind === 'image') return { kind: 'image', text: '', id: part.id };
    return { kind: 'none', text: '' };
  }

  const start = untrack(() => editFor(problem));
  let label = $state(start.label);
  let marks = $state(start.marks);
  let mc = $state(start.mc);
  let answerLetter = $state(start.answerLetter ?? '');
  let level = $state<ProblemLevel | ''>(start.level ?? '');
  let sides = $state<Record<Side, SideState>>({ question: sideState(start.question), solution: sideState(start.solution) });
  let active = $state<Side>('question');
  let alsoCopies = $state(true);
  let saving = $state(false);
  let error = $state('');
  let dialog = $state<HTMLDialogElement | null>(null);

  $effect(() => {
    dialog?.showModal();
  });

  function part(s: SideState): ProblemPart {
    if (s.kind === 'text') return { kind: 'text', text: s.text };
    if (s.kind === 'image') return { kind: 'image', id: s.id, picture: s.picture };
    return { kind: 'none' };
  }

  const edit = $derived({
    label,
    marks,
    mc,
    answerLetter: mc && answerLetter ? answerLetter : undefined,
    level: level || undefined,
    question: part(sides.question),
    solution: part(sides.solution),
  });
  const problemError = $derived(editProblemError(edit));
  const copyNames = $derived([...new Set(copies.map((c) => skillName(c.skillId)))].join(', '));

  async function usePicture(side: Side, file: File) {
    if (!file.type.startsWith('image/')) return;
    const data = await imageToDataUrl(file);
    const img = new Image();
    img.src = data;
    await img.decode();
    sides[side] = { ...sides[side], kind: 'image', picture: { data, width: img.naturalWidth, height: img.naturalHeight } };
    active = side;
  }

  function onPaste(e: ClipboardEvent) {
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (!file) return; // Text pastes into a text box as normal.
    e.preventDefault();
    usePicture(active, file);
  }

  async function save() {
    if (problemError || saving) return;
    saving = true;
    error = '';
    try {
      const mine = applyEdit(problem, edit, newId);
      const changes = [mine];
      if (alsoCopies) {
        const load = async (id: string) => {
          const img = await getImage(id);
          return img ? { data: img.data, width: img.width, height: img.height } : undefined;
        };
        for (const c of copies) changes.push(applyEdit(c, await editForCopy(edit, problem, c, load), newId));
      }
      await updateProblems(changes);
      onsaved(mine.problem, changes.map((c) => c.problem));
      dialog?.close();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }
</script>

<svelte:window onpaste={onPaste} />

{#snippet sideEditor(side: Side, title: string)}
  {@const s = sides[side]}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <section class="side" class:active={active === side} onclick={() => (active = side)} onfocusin={() => (active = side)}>
    <div class="side-head">
      <h3>{title}</h3>
      <div class="chip-row" role="group" aria-label="{title} as">
        <button type="button" class="chip" class:on={s.kind === 'text'} aria-pressed={s.kind === 'text'} onclick={() => (sides[side] = { ...s, kind: 'text' })}>Typed</button>
        <button type="button" class="chip" class:on={s.kind === 'image'} aria-pressed={s.kind === 'image'} onclick={() => (sides[side] = { ...s, kind: 'image' })}>Picture</button>
        {#if side === 'solution'}
          <button type="button" class="chip" class:on={s.kind === 'none'} aria-pressed={s.kind === 'none'} onclick={() => (sides[side] = { ...s, kind: 'none' })}>None</button>
        {/if}
      </div>
    </div>
    {#if s.kind === 'text'}
      <label class="sr-only" for="edit-{side}">{title}</label>
      <textarea id="edit-{side}" rows="6" bind:value={sides[side].text} placeholder={side === 'question' ? 'Type the question. Maths the Obsidian way: $x^2$' : 'Type the answer or marking guideline.'}></textarea>
      {#if s.text.trim()}<div class="preview panel"><MathText text={s.text} class="card-text" /></div>{/if}
    {:else if s.kind === 'image'}
      {#if s.picture || s.id}
        <ProblemImage id={s.picture ? undefined : s.id} src={s.picture?.data} alt={title} small />
      {:else}
        <div class="drop muted small">No picture yet.</div>
      {/if}
      <div class="pic-actions">
        <label class="btn small">
          {s.picture || s.id ? 'Replace picture' : 'Choose picture'}
          <input
            type="file"
            accept="image/*"
            class="sr-only"
            onchange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) usePicture(side, f);
              e.currentTarget.value = '';
            }}
          />
        </label>
        <span class="muted small">{active === side ? 'or press Ctrl + V to paste a screenshot' : 'or click here, then Ctrl + V'}</span>
      </div>
    {:else}
      <p class="muted small">No {title.toLowerCase()} saved. You check it against the original source.</p>
    {/if}
  </section>
{/snippet}

<dialog bind:this={dialog} class="editor" aria-labelledby="edit-title" onclose={onclose}>
  <form
    method="dialog"
    onsubmit={(e) => {
      e.preventDefault();
      save();
    }}
  >
    <div class="head">
      <h2 id="edit-title">Edit question</h2>
      <button type="button" class="btn small" onclick={() => dialog?.close()}>Cancel</button>
    </div>

    <div class="fields">
      <label class="field">Where it is from<input type="text" bind:value={label} placeholder="e.g. 2019 HSC Q12" /></label>
      <label class="field">Marks<input type="number" min="1" max="25" bind:value={marks} /></label>
      <label class="field">
        Level
        <select bind:value={level}>
          <option value="">No level</option>
          {#each LEVELS as l (l)}<option value={l}>{LEVEL_NAMES[l]}</option>{/each}
        </select>
      </label>
      <div class="field mc">
        <label class="check"><input type="checkbox" bind:checked={mc} /> Multiple choice</label>
        {#if mc}
          <div class="chip-row" role="group" aria-label="Correct letter">
            {#each ['A', 'B', 'C', 'D'] as l (l)}
              <button type="button" class="chip" class:on={answerLetter === l} aria-pressed={answerLetter === l} onclick={() => (answerLetter = answerLetter === l ? '' : l)}>{l}</button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="sides">
      {@render sideEditor('question', 'Question')}
      {@render sideEditor('solution', answerName)}
    </div>

    {#if copies.length}
      <label class="check copies">
        <input type="checkbox" bind:checked={alsoCopies} />
        Fix the copy in {copies.length === 1 ? 'the other skill' : `the ${copies.length} other skills`} too ({copyNames})
      </label>
    {/if}

    {#if error || problemError}<p class="warn small">{error || problemError}</p>{/if}

    <div class="foot">
      <button type="submit" class="btn primary" disabled={!!problemError || saving}>{saving ? 'Saving...' : 'Save changes'}</button>
      <button type="button" class="btn" onclick={() => dialog?.close()}>Cancel</button>
    </div>
  </form>
</dialog>

<style>
  .editor {
    width: min(1000px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    padding: 20px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
  }
  .editor::backdrop {
    background: rgb(0 0 0 / 55%);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .head,
  .side-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  h2 {
    font-size: 20px;
    margin: 0;
  }
  h3 {
    font-size: 15px;
    font-weight: 700;
    margin: 0;
  }
  .fields {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 2fr;
    gap: 12px;
    align-items: start;
  }
  @media (max-width: 720px) {
    .fields {
      grid-template-columns: 1fr 1fr;
    }
  }
  .mc {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .check {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    min-height: 36px;
  }
  .check input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
  .sides {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 14px;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    min-width: 0;
  }
  .side.active {
    border-color: var(--accent);
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
  }
  .preview {
    padding: 10px 14px;
  }
  .preview :global(.card-text) {
    font-size: 15px;
  }
  .drop {
    padding: 24px;
    text-align: center;
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius);
  }
  .pic-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    min-height: 32px;
    padding: 0 12px;
    border-radius: 16px;
    border: 1px solid var(--line-strong);
    background: transparent;
    color: var(--muted);
    font: 400 14px var(--font);
    cursor: pointer;
  }
  .chip.on {
    border-color: var(--accent);
    color: var(--text);
  }
  .foot {
    display: flex;
    gap: 12px;
  }
  .warn {
    color: var(--warn);
    margin: 0;
  }
  .small {
    font-size: 13px;
  }
</style>
