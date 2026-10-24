<script lang="ts">
  import { saveTask } from '../lib/db';
  import { parseQuickAdd } from '../lib/planner/quickadd';
  import { taskFromQuick } from '../lib/planner/actions';
  import { dueLabel } from '../lib/planner/dates';
  import { shortSubject } from '../lib/practice/load';
  import type { Task } from '../lib/types';

  let { today, onadded }: { today: string; onadded: (task: Task) => void } = $props();

  let line = $state('');
  let input = $state<HTMLInputElement | null>(null);
  const parsed = $derived(line.trim() ? parseQuickAdd(line, today) : null);

  async function add(e: SubmitEvent) {
    e.preventDefault();
    if (!parsed) return;
    const task = taskFromQuick(parsed);
    await saveTask(task);
    line = '';
    input?.focus();
    onadded(task);
  }
</script>

<form class="quick" onsubmit={add}>
  <label class="sr-only" for="quick-add">Add homework</label>
  <div class="bar">
    <input
      id="quick-add"
      bind:this={input}
      type="text"
      bind:value={line}
      placeholder="chem finish q5-10 fri 20m"
      autocomplete="off"
      enterkeyhint="done"
    />
    <button class="btn primary" type="submit" disabled={!parsed}>Add</button>
  </div>
  {#if parsed}
    <div class="chips mono" aria-live="polite">
      <span class="chip strong">{parsed.title}</span>
      <span class="chip" class:guess={!parsed.found.subject}>{parsed.subject ? shortSubject(parsed.subject) : 'no subject'}</span>
      <span class="chip" class:guess={!parsed.found.due}>{dueLabel(parsed.due, today)}</span>
      <span class="chip" class:guess={!parsed.found.minutes}>{parsed.minutes} min</span>
      {#if parsed.type === 'smartered'}<span class="chip">SmarterEd set</span>{/if}
      {#if parsed.type === 'assignment'}<span class="chip">assignment</span>{/if}
      {#if !parsed.required}<span class="chip">optional</span>{/if}
    </div>
  {:else}
    <p class="hint muted small">
      Subject, due day and time in any order: <span class="mono">chem</span>, <span class="mono">ext1</span>,
      <span class="mono">adv</span>, <span class="mono">eng</span> (English), <span class="mono">engin</span>;
      <span class="mono">fri</span>, <span class="mono">tmr</span>, <span class="mono">3/11</span>;
      <span class="mono">20m</span>, <span class="mono">1h</span>. Add <span class="mono">set</span> for a SmarterEd set,
      <span class="mono">opt</span> if it's optional.
    </p>
  {/if}
</form>

<style>
  .quick {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .bar {
    display: flex;
    gap: 10px;
  }
  .bar input {
    flex: 1;
    min-width: 0;
    font-family: var(--mono);
    font-size: 15px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    font-size: 12px;
  }
  .chip {
    padding: 3px 9px;
    border-radius: 12px;
    border: 1px solid var(--line-strong);
    color: var(--text);
  }
  .chip.strong {
    border-color: var(--accent);
  }
  .chip.guess {
    color: var(--dim);
    border-style: dashed;
  }
  .hint {
    margin: 0;
  }
  .small {
    font-size: 13px;
  }
</style>
