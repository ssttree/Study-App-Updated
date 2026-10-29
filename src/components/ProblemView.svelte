<script lang="ts">
  // A question or its answer: a picture cut from a PDF or screenshot, or typed text.
  import MathText from './MathText.svelte';
  import ProblemImage from './ProblemImage.svelte';

  let { image, text, alt, small = false }: { image?: string; text?: string; alt: string; small?: boolean } = $props();
</script>

{#if text}
  <div class="typed panel" class:small>
    <MathText {text} class="card-text" />
  </div>
{:else}
  <ProblemImage id={image} {alt} {small} />
{/if}

<style>
  .typed {
    padding: 20px 24px;
  }
  .typed :global(.card-text) {
    font-size: 19px;
  }
  .typed.small {
    padding: 10px 14px;
  }
  .typed.small :global(.card-text) {
    font-size: 15px;
  }
</style>
