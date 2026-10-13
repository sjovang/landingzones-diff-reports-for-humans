<script lang="ts">
	import { dev } from '$app/env';
import favicon from '#lib/assets/favicon.svg';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
	{#if !dev}
		<script
			defer
			src="https://stats.liasis.dev/script.js"
			data-website-id="c5a1add3-10ce-49b1-998e-44ba203a3da1"
			data-performance="true"
			data-do-not-track="true"
		></script>
	{/if}
	<link rel="icon" href={favicon} />
	<meta
		name="description"
		content="Compare Azure Landing Zones Library releases with plain-language reports that connect policy changes to initiatives, effects, and assignment scopes—not raw JSON diffs."
	/>
	<meta name="theme-color" content="#f4f7fb" />
</svelte:head>

{@render children()}
