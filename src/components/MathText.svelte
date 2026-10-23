<script lang="ts">
  import { renderMarkdown } from '../lib/markdown';

  let { text, class: cls = 'card-text' }: { text: string; class?: string } = $props();

  const rendered = $derived(renderMarkdown(text));
</script>

<div class={cls}>{@html rendered.html}</div>
