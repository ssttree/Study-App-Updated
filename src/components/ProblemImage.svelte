<script lang="ts" module>
  import { getImage } from '../lib/db';

  // Pictures are loaded from the database once and kept while the app is open.
  const cache = new Map<string, Promise<string>>();
  export function imageData(id: string): Promise<string> {
    let p = cache.get(id);
    if (!p) {
      p = getImage(id).then((img) => img?.data ?? '');
      cache.set(id, p);
    }
    return p;
  }
</script>

<script lang="ts">
  let { id, src, alt, small = false }: { id?: string; src?: string; alt: string; small?: boolean } = $props();
  let data = $state('');
  $effect(() => {
    if (src) {
      data = src;
      return;
    }
    if (!id) return;
    let live = true;
    imageData(id).then((d) => live && (data = d));
    return () => {
      live = false;
    };
  });
</script>

<div class="paper" class:small>
  {#if data}
    <img src={data} {alt} />
  {:else}
    <span class="blank">Picture missing</span>
  {/if}
</div>

<style>
  /* Scans keep their white page, so dark mode never makes them hard to read. */
  .paper {
    background: #ffffff;
    border-radius: var(--radius);
    padding: 18px 20px;
    overflow-x: auto;
    box-shadow: 0 0 0 1px var(--line);
  }
  .paper.small {
    padding: 8px 10px;
  }
  img {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 0 auto;
  }
  .paper:not(.small) img {
    /* Crops are drawn at twice the PDF size; this shows them at a comfortable reading size. */
    max-width: min(100%, 860px);
  }
  .blank {
    color: #555;
    font-size: 14px;
  }
</style>
