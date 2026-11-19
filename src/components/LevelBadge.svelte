<script lang="ts">
  // The textbook level of a question, in the book's colours: green Foundation, blue Mastery, red Complex.
  import { LEVEL_NAMES } from '../lib/practice/mix';
  import type { ProblemLevel } from '../lib/types';

  let { level }: { level: ProblemLevel } = $props();
</script>

<span class="level {level}">{LEVEL_NAMES[level]}</span>

<style>
  .level {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: 400 12px var(--mono);
    color: var(--muted);
  }
  .level::before {
    content: '';
    width: 9px;
    height: 9px;
    background: var(--c);
  }
  .foundation {
    --c: var(--good);
  }
  .foundation::before {
    border-radius: 2px;
  }
  .mastery {
    --c: var(--info);
  }
  .mastery::before {
    border-radius: 50%;
  }
  .complex {
    --c: #ff7a7a;
  }
  .complex::before {
    clip-path: polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%);
  }
</style>
