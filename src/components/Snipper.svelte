<script lang="ts">
  // Shows the pages of a PDF so you can drag a box around a question or a
  // solution. Used to fix a bad crop and to snip PDFs that are not SmarterEd sheets.
  import type { OpenPdf, Picture } from '../lib/practice/pdf';

  let {
    pdf,
    prompt,
    onpick,
    startPage = 0,
  }: { pdf: OpenPdf; prompt: string; onpick: (picture: Picture) => void; startPage?: number } = $props();

  let pages = $state<{ url: string; width: number; height: number }[]>([]);
  let drag = $state<{ page: number; x0: number; y0: number; x1: number; y1: number } | null>(null);
  let busy = $state(false);
  let scroller = $state<HTMLDivElement | null>(null);

  $effect(() => {
    let live = true;
    (async () => {
      const list = [];
      for (let i = 0; i < pdf.pageCount; i++) {
        list.push(await pdf.pageImage(i));
        if (!live) return;
        pages = [...list];
        if (i === startPage) queueMicrotask(() => scroller?.querySelectorAll('.pg')[startPage]?.scrollIntoView({ block: 'start' }));
      }
    })();
    return () => {
      live = false;
    };
  });

  function point(e: PointerEvent, el: HTMLElement, page: { width: number; height: number }) {
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(page.width, ((e.clientX - r.left) / r.width) * page.width)),
      y: Math.max(0, Math.min(page.height, ((e.clientY - r.top) / r.height) * page.height)),
    };
  }

  function down(e: PointerEvent, i: number) {
    if (busy) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const p = point(e, el, pages[i]);
    drag = { page: i, x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  }

  function move(e: PointerEvent, i: number) {
    if (!drag || drag.page !== i) return;
    const p = point(e, e.currentTarget as HTMLElement, pages[i]);
    drag = { ...drag, x1: p.x, y1: p.y };
  }

  async function up() {
    if (!drag) return;
    const d = drag;
    const box = { x0: Math.min(d.x0, d.x1), x1: Math.max(d.x0, d.x1), top: Math.min(d.y0, d.y1), bottom: Math.max(d.y0, d.y1) };
    if (box.x1 - box.x0 < 8 || box.bottom - box.top < 8) {
      drag = null;
      return;
    }
    busy = true;
    try {
      const picture = await pdf.crop([{ page: d.page, ...box }]);
      if (picture) onpick(picture);
    } finally {
      busy = false;
      drag = null;
    }
  }
</script>

<div class="snipper">
  <p class="prompt"><strong>{prompt}</strong> <span class="muted">Drag a box around it on the page.</span></p>
  <div class="pages" bind:this={scroller}>
    {#each pages as page, i (i)}
      <div
        class="pg"
        role="presentation"
        style:aspect-ratio="{page.width} / {page.height}"
        onpointerdown={(e) => down(e, i)}
        onpointermove={(e) => move(e, i)}
        onpointerup={up}
      >
        <img src={page.url} alt="Page {i + 1}" draggable="false" />
        {#if drag && drag.page === i}
          <div
            class="box"
            style:left="{(Math.min(drag.x0, drag.x1) / page.width) * 100}%"
            style:top="{(Math.min(drag.y0, drag.y1) / page.height) * 100}%"
            style:width="{(Math.abs(drag.x1 - drag.x0) / page.width) * 100}%"
            style:height="{(Math.abs(drag.y1 - drag.y0) / page.height) * 100}%"
          ></div>
        {/if}
        <span class="num mono">{i + 1}</span>
      </div>
    {:else}
      <p class="muted">Drawing the pages...</p>
    {/each}
  </div>
</div>

<style>
  .snipper {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .prompt {
    margin: 0;
  }
  .pages {
    max-height: 75vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 4px;
    border-radius: var(--radius);
    background: var(--surface-2);
  }
  .pg {
    position: relative;
    width: 100%;
    background: #fff;
    cursor: crosshair;
    touch-action: none;
    user-select: none;
  }
  .pg img {
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
  }
  .box {
    position: absolute;
    border: 2px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
  }
  .num {
    position: absolute;
    right: 8px;
    bottom: 6px;
    font-size: 12px;
    color: #555;
  }
</style>
