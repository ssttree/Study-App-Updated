<script lang="ts" module>
  const KEY = 'study-app:question-count';
  export const COUNTS = [5, 8, 10, 12, 15, 20, 25, 30];

  /** The number of questions picked last time, or 0 for "fit the usual time". */
  export function savedCount(): number {
    try {
      const n = Number(localStorage.getItem(KEY));
      return COUNTS.includes(n) ? n : 0;
    } catch {
      return 0;
    }
  }

  /** The last part of a practice link that asks for that many questions, if any. */
  export function countPart(n: number): string[] {
    return n > 0 ? [`${n}q`] : [];
  }
</script>

<script lang="ts">
  // How many questions a practice session has. Remembered for next time.
  let { value = $bindable(savedCount()), minutes }: { value?: number; minutes?: number } = $props();

  function pick(e: Event) {
    value = Number((e.currentTarget as HTMLSelectElement).value);
    try {
      localStorage.setItem(KEY, String(value));
    } catch {
      /* not remembered */
    }
  }
</script>

<label class="count">
  <span class="muted small">Questions</span>
  <select value={value} onchange={pick}>
    <option value={0}>Fit {minutes ? `${minutes} min` : 'the usual time'}</option>
    {#each COUNTS as n (n)}<option value={n}>{n} questions</option>{/each}
  </select>
</label>

<style>
  .count {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  select {
    min-height: 40px;
  }
</style>
