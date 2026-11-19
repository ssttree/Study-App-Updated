<script lang="ts">
  import type { TaskNotification } from '../lib/types';

  let { notification, onopen }: { notification: TaskNotification; onopen: () => void } = $props();

  /** Sections shown open; the rest start folded. */
  const OPEN = new Set(['Context', 'Requirements', 'Submission']);
</script>

<section class="panel note">
  <div class="top">
    <h2>Task notification</h2>
    {#if notification.fileId}<button class="btn small" onclick={onopen}>Download the original</button>{/if}
  </div>
  <p class="muted small mono">
    {notification.fileName} · uploaded {new Date(notification.uploaded).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
  </p>
  {#each notification.warnings as w (w)}
    <div class="notice warn small">{w}</div>
  {/each}
  {#each notification.sections as s (s.heading)}
    <details open={OPEN.has(s.heading)}>
      <summary>{s.heading}</summary>
      <div class="body">
        {#each s.rows as row, r (r)}
          {#if row.length === 1}
            {#each row[0].filter(Boolean) as p, i (i)}<p>{p}</p>{/each}
          {:else}
            <div class="cells" style:grid-template-columns={`3fr repeat(${row.length - 1}, minmax(60px, 1fr))`}>
              {#each row as cell, c (c)}
                <div class:mono={c > 0}>
                  {#each cell as p, i (i)}<p class:blank={!p}>{p || ' '}</p>{/each}
                </div>
              {/each}
            </div>
          {/if}
        {/each}
      </div>
    </details>
  {/each}
</section>

<style>
  .note {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  h2 {
    font-size: 15px;
    font-weight: 700;
    margin: 0;
  }
  p {
    margin: 0;
  }
  .small {
    font-size: 13px;
  }
  .notice.small {
    margin: 0;
  }
  details {
    border-top: 1px solid var(--line);
    padding: 10px 0 2px;
  }
  summary {
    cursor: pointer;
    font-weight: 600;
    min-height: 32px;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 0 8px;
    color: var(--text);
    font-size: 14px;
    line-height: 1.5;
    max-width: 760px;
  }
  .cells {
    display: grid;
    gap: 4px 16px;
    padding: 6px 0;
    border-bottom: 1px solid var(--line);
  }
  .cells .mono {
    font-size: 13px;
    text-align: right;
  }
  .blank {
    min-height: 1.5em;
  }
</style>
