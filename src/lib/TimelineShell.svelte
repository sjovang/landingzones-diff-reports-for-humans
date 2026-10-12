<script lang="ts">
	import AppHeader from './AppHeader.svelte';
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

<div class="timeline-shell">
	<a class="skip-link" href="#timeline-content">Skip to timeline content</a>
	<AppHeader />
	<main id="timeline-content" tabindex="-1">
		{@render children()}
	</main>
</div>

<style>
	:global(body) { margin: 0; background: #f4f7fb; color: #192639; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
	:global(*) { box-sizing: border-box; }
	.timeline-shell { min-height: 100vh; }
	main { max-width: 1180px; padding: 48px 28px; margin: 0 auto; outline: none; }
	.skip-link { position: absolute; top: 8px; left: 18px; z-index: 1; padding: 10px 14px; background: #fff; color: #1768d2; transform: translateY(-150%); }
	.skip-link:focus { transform: translateY(0); }
	a:focus-visible { outline: 3px solid #1768d2; outline-offset: 2px; }
	@media (max-width: 650px) {
		main { padding: 32px 18px; }
	}
</style>
