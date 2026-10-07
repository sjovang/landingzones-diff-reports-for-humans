<script lang="ts">
import favicon from '#lib/assets/favicon.svg';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta
		name="description"
		content="Compare Azure Landing Zones Library releases with plain-language reports that connect policy changes to initiatives, effects, and assignment scopes—not raw JSON diffs."
	/>
	<meta name="theme-color" content="#f4f7fb" />
</svelte:head>

{@render children()}
