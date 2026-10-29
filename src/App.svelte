<script lang="ts">
  import { router, href } from './lib/router.svelte';
  import Today from './screens/Today.svelte';
  import Review from './screens/Review.svelte';
  import Decks from './screens/Decks.svelte';
  import DeckView from './screens/DeckView.svelte';
  import CardEditor from './screens/CardEditor.svelte';
  import Settings from './screens/Settings.svelte';
  import Progress from './screens/Progress.svelte';
  import ProgressSubject from './screens/ProgressSubject.svelte';
  import ProgressTopic from './screens/ProgressTopic.svelte';
  import Activity from './screens/Activity.svelte';
  import Marks from './screens/Marks.svelte';
  import MarksImport from './screens/MarksImport.svelte';
  import MarkEditor from './screens/MarkEditor.svelte';
  import WeeklyReview from './screens/WeeklyReview.svelte';
  import CustomStudy from './screens/CustomStudy.svelte';
  import Import from './screens/Import.svelte';
  import Practice from './screens/Practice.svelte';
  import Skills from './screens/Skills.svelte';
  import SkillView from './screens/SkillView.svelte';
  import PdfImport from './screens/PdfImport.svelte';
  import AtarImport from './screens/AtarImport.svelte';
  import PlanEditor from './screens/PlanEditor.svelte';
  import PracticeRun from './screens/PracticeRun.svelte';
  import Planner from './screens/Planner.svelte';
  import Homework from './screens/Homework.svelte';
  import TaskEditor from './screens/TaskEditor.svelte';
  import Windows from './screens/Windows.svelte';
  import Exams from './screens/Exams.svelte';
  import Connect from './screens/Connect.svelte';
  import Devices from './screens/Devices.svelte';
  import Join from './screens/Join.svelte';
  import { DATA_SYNCED, DATA_SYNC_EVERY, sync } from './lib/sync';

  const tabs = [
    { label: 'Today', link: href('today'), match: ['today'] },
    { label: 'Cards', link: href('decks'), match: ['decks', 'deck', 'card', 'newCard', 'custom', 'import'] },
    { label: 'Practice', link: href('practice'), match: ['practice', 'skills', 'skill', 'pdfImport', 'atarImport', 'plans', 'plan'] },
    { label: 'Planner', link: href('planner'), match: ['planner', 'homework', 'task', 'windows', 'exams', 'connect', 'plan:planner'] },
    { label: 'Progress', link: href('progress'), match: ['progress', 'progressSubject', 'progressTopic', 'activity', 'marks', 'marksImport', 'mark'] },
  ];

  const route = $derived(router.route);
  const key = $derived(route.name === 'plan' && route.from ? `plan:${route.from}` : route.name);

  // Catch up with the server now, every minute while the app is on screen, when it comes back
  // online or into view, and when you leave it (so the other devices get what you just did).
  $effect(() => {
    sync();
    const t = setInterval(() => document.visibilityState === 'visible' && sync(), DATA_SYNC_EVERY);
    const online = () => sync();
    const visible = () => sync();
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
    };
  });

  // Another device's changes arrived: reload screens that only show things. Screens where
  // you're typing or studying are left alone and pick it up next time they open.
  const REFRESH = new Set(['today', 'decks', 'deck', 'practice', 'plans', 'skills', 'skill', 'planner', 'homework', 'exams', 'progress', 'progressSubject', 'progressTopic', 'activity', 'marks', 'settings']);
  let dataVersion = $state(0);
  $effect(() => {
    const changed = () => {
      if (REFRESH.has(router.route.name)) dataVersion++;
    };
    window.addEventListener(DATA_SYNCED, changed);
    return () => window.removeEventListener(DATA_SYNCED, changed);
  });

  let now = $state(new Date());
  $effect(() => {
    const t = setInterval(() => (now = new Date()), 30_000);
    return () => clearInterval(t);
  });
  const clock = $derived(
    now.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) +
      ' · ' +
      now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false }),
  );
</script>

{#if route.name === 'review'}
  <!-- Review is a focus screen with no main menu. -->
  <Review filterParts={route.filter} />
{:else if route.name === 'customRun'}
  <Review customParts={route.parts} />
{:else if route.name === 'weeklyReview'}
  <!-- The weekly review is a short guided focus screen. -->
  <WeeklyReview />
{:else if route.name === 'practiceRun'}
  <!-- Problem practice is a focus screen too. -->
  {#key route}<PracticeRun parts={route.parts} />{/key}
{:else}
  <header class="top">
    <a class="brand" href={href('today')} aria-label="Study App, today"><span aria-hidden="true">●</span></a>
    <nav class="tabs" aria-label="Main">
      {#each tabs as tab (tab.label)}
        <a class:on={tab.match.includes(key)} href={tab.link} aria-current={tab.match.includes(key) ? 'page' : undefined}>
          {tab.label}
        </a>
      {/each}
    </nav>
    <span class="clock mono muted">{clock}</span>
    <a class="settings" class:on={key === 'settings' || key === 'devices'} href={href('settings')}>Settings</a>
  </header>

  {#key [route, dataVersion]}
    {#if route.name === 'today'}
      <Today />
    {:else if route.name === 'decks'}
      <Decks />
    {:else if route.name === 'deck'}
      <DeckView id={route.id} />
    {:else if route.name === 'card'}
      <CardEditor cardId={route.id} />
    {:else if route.name === 'newCard'}
      <CardEditor deckId={route.deckId} />
    {:else if route.name === 'custom'}
      <CustomStudy filterParts={route.filter} />
    {:else if route.name === 'import'}
      <Import />
    {:else if route.name === 'practice' || route.name === 'plans'}
      <Practice />
    {:else if route.name === 'skills'}
      <Skills subject={route.subject} />
    {:else if route.name === 'skill'}
      <SkillView id={route.id} />
    {:else if route.name === 'pdfImport'}
      <PdfImport taskId={route.taskId} />
    {:else if route.name === 'atarImport'}
      <AtarImport taskId={route.taskId} />
    {:else if route.name === 'plan'}
      <PlanEditor id={route.id} from={route.from} />
    {:else if route.name === 'planner'}
      <Planner day={route.day} />
    {:else if route.name === 'homework'}
      <Homework />
    {:else if route.name === 'task'}
      <TaskEditor id={route.id} assessmentId={route.assessmentId} />
    {:else if route.name === 'windows'}
      <Windows />
    {:else if route.name === 'exams'}
      <Exams />
    {:else if route.name === 'connect'}
      <Connect result={route.result} />
    {:else if route.name === 'settings'}
      <Settings />
    {:else if route.name === 'devices'}
      <Devices />
    {:else if route.name === 'join'}
      <Join key={route.key} />
    {:else if route.name === 'progress'}
      <Progress />
    {:else if route.name === 'progressSubject'}
      <ProgressSubject subject={route.subject} />
    {:else if route.name === 'progressTopic'}
      <ProgressTopic subject={route.subject} topic={route.topic} />
    {:else if route.name === 'activity'}
      <Activity />
    {:else if route.name === 'marks'}
      <Marks />
    {:else if route.name === 'marksImport'}
      <MarksImport />
    {:else if route.name === 'mark'}
      <MarkEditor id={route.id} assessmentId={route.assessmentId} year={route.year} />
    {:else}
      <main class="page"><h1>Page not found</h1><p><a href={href('today')}>Back to today</a></p></main>
    {/if}
  {/key}
{/if}

<style>
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 24px;
    padding: 14px 32px;
    border-bottom: 1px solid var(--line);
  }
  .brand {
    font-family: var(--mono);
    font-size: 14px;
    color: var(--accent);
    text-decoration: none;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .tabs a,
  .settings {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 14px;
    color: var(--muted);
    text-decoration: none;
    font-size: 15px;
    border-radius: 22px;
  }
  .tabs a:hover,
  .settings:hover {
    color: var(--text);
  }
  .tabs a.on,
  .settings.on {
    color: var(--bg);
    background: var(--text);
  }
  .clock {
    margin-left: auto;
    font-size: 13px;
  }
  @media (max-width: 640px) {
    .top {
      padding: 6px 12px;
      flex-wrap: nowrap;
      gap: 8px;
    }
    .tabs {
      flex-wrap: nowrap;
      overflow-x: auto;
      min-width: 0;
      scrollbar-width: none;
    }
    .tabs a,
    .settings {
      padding: 0 10px;
      white-space: nowrap;
    }
    .clock {
      display: none;
    }
  }
  :global(.page) {
    max-width: 760px;
    margin: 0 auto;
    padding: 48px 24px 64px;
    display: flex;
    flex-direction: column;
    gap: 40px;
  }
  :global(.page.wide) {
    max-width: 1100px;
  }
  @media (max-width: 640px) {
    :global(.page) {
      padding: 32px 16px 48px;
    }
  }
</style>
