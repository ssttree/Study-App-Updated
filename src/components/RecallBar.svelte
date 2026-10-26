<script lang="ts">
  import { GRADE_COLOUR, type Grade3 } from '../lib/progress/recall';

  let { recall, grade }: { recall: number | null; grade: Grade3 } = $props();
</script>

<div class="bar" role="presentation">
  {#if recall !== null}<div style:width="{Math.max(2, recall * 100)}%" style:background={GRADE_COLOUR[grade]}></div>{/if}
</div>

<style>
  .bar {
    height: 8px;
    background: var(--line);
    border-radius: 4px;
    flex: 1 1 140px;
    min-width: 80px;
  }
  .bar > div {
    height: 8px;
    border-radius: 4px;
  }
</style>
