<script lang="ts">
  // Year 12 marks over time against the Year 11 baseline (a flat line), with
  // recall on each test day as a hollow dot for comparison. One axis: percent.
  import type { Mark } from '../lib/types';
  import { markPct } from '../lib/progress/load';
  import { keyToTime } from '../lib/planner/dates';

  let { marks, baseline, recalls }: { marks: Mark[]; baseline: number | null; recalls: Map<string, number | null> } = $props();

  const W = 640;
  const H = 200;
  const L = 36;
  const R = 12;
  const T = 12;
  const B = 28;

  const sorted = $derived([...marks].sort((a, b) => a.date.localeCompare(b.date)));
  const t0 = $derived(keyToTime(sorted[0].date));
  const t1 = $derived(keyToTime(sorted[sorted.length - 1].date));
  const x = (date: string) => L + (t1 === t0 ? (W - L - R) / 2 : ((keyToTime(date) - t0) / (t1 - t0)) * (W - L - R));
  const y = (p: number) => T + (1 - Math.max(0, Math.min(100, p)) / 100) * (H - T - B);
  let hover = $state<number | null>(null);
</script>

<div class="chart">
  <div class="legend small muted">
    <span><i class="sw mark"></i>Year 12 mark</span>
    {#if baseline !== null}<span><i class="sw base"></i>Year 11 average</span>{/if}
    <span><i class="sw recall"></i>Recall on the day</span>
  </div>
  <svg viewBox="0 0 {W} {H}" role="img" aria-label="Marks over time">
    {#each [0, 50, 100] as g (g)}
      <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} class="grid" />
      <text x={L - 6} y={y(g) + 4} class="axis" text-anchor="end">{g}%</text>
    {/each}
    {#if baseline !== null}
      <line x1={L} x2={W - R} y1={y(baseline)} y2={y(baseline)} class="base" />
    {/if}
    <polyline points={sorted.map((m) => `${x(m.date)},${y(markPct(m))}`).join(' ')} class="line" />
    {#each sorted as m, i (m.id)}
      {@const r = recalls.get(m.id)}
      {#if r !== null && r !== undefined}<circle cx={x(m.date)} cy={y(r * 100)} r="5" class="recall" />{/if}
      <circle cx={x(m.date)} cy={y(markPct(m))} r="5" class="dot" />
      <rect
        x={x(m.date) - 16}
        y={T}
        width="32"
        height={H - T - B}
        fill="transparent"
        role="presentation"
        onmouseenter={() => (hover = i)}
        onmouseleave={() => (hover = null)}
      />
    {/each}
  </svg>
  {#if hover !== null}
    {@const m = sorted[hover]}
    {@const r = recalls.get(m.id)}
    <div class="tip small">
      <strong>{m.name}</strong>
      {[`${Math.round(markPct(m))}%`, m.rank ? `rank ${m.rank}` : '', r !== null && r !== undefined ? `recall ${Math.round(r * 100)}%` : ''].filter(Boolean).join(' · ')}
    </div>
  {/if}
</div>

<style>
  .chart {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  svg {
    width: 100%;
    max-width: 720px;
    height: auto;
  }
  .small {
    font-size: 13px;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
  }
  .sw {
    display: inline-block;
    width: 14px;
    height: 0;
    margin-right: 6px;
    vertical-align: middle;
    border-top: 2px solid var(--text);
  }
  .sw.base {
    border-top: 2px dashed var(--muted);
  }
  .sw.recall {
    width: 10px;
    height: 10px;
    border: 2px solid var(--info);
    border-radius: 50%;
  }
  .grid {
    stroke: var(--line);
    stroke-width: 1;
  }
  .axis {
    fill: var(--dim);
    font: 11px var(--mono);
  }
  .base {
    stroke: var(--muted);
    stroke-width: 2;
    stroke-dasharray: 6 5;
  }
  .line {
    fill: none;
    stroke: var(--text);
    stroke-width: 2;
  }
  .dot {
    fill: var(--text);
    stroke: var(--bg);
    stroke-width: 2;
  }
  .recall {
    fill: var(--bg);
    stroke: var(--info);
    stroke-width: 2;
  }
  .tip {
    color: var(--text);
  }
</style>
