<script lang="ts">
  import { href } from '../lib/router.svelte';

  let { on }: { on: 'subjects' | 'activity' | 'marks' } = $props();

  const tabs = [
    { id: 'subjects', label: 'Subjects', link: href('progress') },
    { id: 'activity', label: 'Activity', link: href('progress', 'activity') },
    { id: 'marks', label: 'Marks', link: href('progress', 'marks') },
  ] as const;
</script>

<nav class="seg" aria-label="Progress">
  {#each tabs as t (t.id)}
    <a class:on={on === t.id} href={t.link} aria-current={on === t.id ? 'page' : undefined}>{t.label}</a>
  {/each}
</nav>

<style>
  .seg {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }
  .seg a {
    display: inline-flex;
    align-items: center;
    min-height: 40px;
    padding: 0 14px;
    border-radius: 20px;
    color: var(--muted);
    text-decoration: none;
    font-size: 14px;
  }
  .seg a:hover {
    color: var(--text);
  }
  .seg a.on {
    background: var(--line);
    color: var(--text);
  }
</style>
