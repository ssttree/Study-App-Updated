<script lang="ts">
  // Shown when a review or practice block finishes: the calendar item it was
  // started from has been ticked off for you, with a little celebration.
  import { onMount } from 'svelte';
  import { celebrate } from '../lib/celebrate';
  import { finishSession, type SessionKind, type Ticked } from '../lib/planner/active';
  import { href } from '../lib/router.svelte';

  let { kind }: { kind: SessionKind } = $props();
  let ticked = $state<Ticked | null>(null);
  let el = $state<HTMLElement | null>(null);

  onMount(() => {
    finishSession(kind).then((t) => {
      ticked = t;
      if (t) queueMicrotask(() => celebrate(el));
    });
  });
  const title = $derived(ticked ? ticked.item.title || 'Your session' : '');
</script>

{#if ticked}
  <div class="ticked" bind:this={el} role="status">
    <span class="check" aria-hidden="true">✓</span>
    <div>
      <strong>Ticked off on your planner: {title}</strong>
      <span class="muted small">
        {ticked.weekDone} {ticked.weekDone === 1 ? 'session' : 'sessions'} done this week. <a href={href('planner')}>Planner</a>
      </span>
    </div>
  </div>
{/if}

<style>
  .ticked {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 18px;
    border-radius: var(--radius);
    border: 1px solid color-mix(in srgb, var(--good) 55%, transparent);
    background: color-mix(in srgb, var(--good) 10%, transparent);
    text-align: left;
    animation: in 500ms cubic-bezier(0.3, 1.4, 0.5, 1);
  }
  .ticked div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .check {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    flex: none;
    border-radius: 50%;
    background: var(--good);
    color: var(--bg);
    font-weight: 700;
    font-size: 20px;
    animation: pop 600ms cubic-bezier(0.3, 1.8, 0.5, 1) 150ms both;
  }
  @keyframes in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: none; }
  }
  @keyframes pop {
    from { transform: scale(0); }
    to { transform: scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .ticked,
    .check {
      animation: none;
    }
  }
</style>
