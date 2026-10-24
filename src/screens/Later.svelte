<script lang="ts">
  import { href } from '../lib/router.svelte';

  let { feature }: { feature: 'planner' | 'progress' } = $props();

  const info = {
    planner: {
      title: 'Planner and homework',
      text: 'Homework list, automatic study plan, exam prep and Google Calendar. Coming after problem practice.',
    },
    progress: {
      title: 'Progress',
      text: 'Weak skills, recall by topic with colour grading, weekly totals and your real marks. Coming once there is review history to show.',
    },
  } as const;

  const item = $derived(info[feature]);
</script>

<main class="page">
  <section class="wrap">
    <div class="eyebrow accent">Coming later</div>
    <h1>{item.title}</h1>
    <p class="muted">{item.text}</p>
    <div><a class="btn primary" href={href('today')}>Back to today</a></div>
  </section>
</main>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  h1 {
    font-size: 40px;
  }
  p {
    margin: 0;
    font-size: 18px;
    max-width: 560px;
  }
</style>
