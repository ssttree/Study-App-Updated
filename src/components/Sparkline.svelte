<script lang="ts">
  // A small trend line of weekly recall, oldest on the left. Weeks before
  // anything existed are left blank rather than drawn as zero.
  let { values, colour = 'var(--muted)', label }: { values: (number | null)[]; colour?: string; label: string } = $props();

  const W = 120;
  const H = 32;
  const points = $derived(
    values
      .map((v, i) => (v === null ? null : { x: 4 + (i * (W - 8)) / Math.max(1, values.length - 1), y: H - 4 - v * (H - 8), v }))
      .filter((p): p is { x: number; y: number; v: number } => p !== null),
  );
</script>

<svg viewBox="0 0 {W} {H}" width={W} height={H} role="img" aria-label={label}>
  {#if points.length > 1}
    <polyline points={points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={colour} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
  {/if}
  {#each points as p, i (i)}
    <circle cx={p.x} cy={p.y} r={i === points.length - 1 ? 3 : 0} fill={colour}><title>{Math.round(p.v * 100)}%</title></circle>
  {/each}
</svg>

<style>
  svg {
    display: block;
    overflow: visible;
  }
</style>
