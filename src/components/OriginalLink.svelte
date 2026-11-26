<script lang="ts">
  // Opens the PDF a question was cut from, at its page, so a bad crop can be
  // fixed by hand (screenshot the right part, then paste it into Edit question).
  // PDFs imported since this was added are kept on the device; for older ones,
  // or on another device, you pick the file once and it is kept from then on.
  import { getSourcePdf, keepSourcePdf, saveProblem } from '../lib/db';
  import type { Problem } from '../lib/types';

  let { problem, onlinked }: { problem: Problem; onlinked?: (p: Problem) => void } = $props();

  let url = $state('');
  let checked = $state(false);
  const file = $derived(problem.origin?.file ?? '');
  const page = $derived(problem.origin?.page);

  $effect(() => {
    const name = file;
    let made = '';
    let gone = false;
    checked = false;
    url = '';
    (async () => {
      const pdf = name ? await getSourcePdf(name) : undefined;
      if (gone) return;
      if (pdf) made = url = URL.createObjectURL(pdf.data);
      checked = true;
    })();
    return () => {
      gone = true;
      // Give a tab that was just opened time to read it first.
      if (made) setTimeout(() => URL.revokeObjectURL(made), 60_000);
    };
  });

  const link = $derived(url ? `${url}#page=${page ?? 1}` : '');

  async function picked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    const name = file || f.name;
    await keepSourcePdf(new File([f], name, { type: f.type || 'application/pdf' }));
    if (!problem.origin) {
      const linked: Problem = { ...problem, origin: { file: name } };
      await saveProblem(linked);
      onlinked?.(linked);
    } else {
      // Same file name: reload it so the link appears.
      const pdf = await getSourcePdf(name);
      if (pdf) url = URL.createObjectURL(pdf.data);
    }
  }
</script>

<span class="original">
  {#if link}
    <a class="btn small" href={link} target="_blank" rel="noopener">Open original{page ? `, page ${page}` : ''}</a>
    <span class="muted small name" title={file}>{file}</span>
  {:else if checked}
    <label class="btn small">
      {file ? 'Find the PDF' : 'Link the original PDF'}
      <input class="sr-only" type="file" accept="application/pdf,.pdf" onchange={picked} />
    </label>
    <span class="muted small name">
      {#if file}Pick {file} once{page ? ` (it opens at page ${page})` : ''} and it's kept on this device.{:else}From {problem.from || 'an unknown file'}. Pick the PDF once and it's kept with this question.{/if}
    </span>
  {/if}
</span>

<style>
  .original {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .name {
    max-width: 360px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
