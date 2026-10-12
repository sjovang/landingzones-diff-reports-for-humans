<script lang="ts">
	import { page } from '$app/state';
	import brandIcon from './assets/favicon.svg';

	const onTimelines = $derived(page.url.pathname === '/timelines' || page.url.pathname.startsWith('/timelines/'));
</script>

<header class="topbar">
	<a class="brand" href="/" aria-label="Landing Zone Release Brief home">
		<img class="brand-mark" src={brandIcon} width="28" height="28" alt="" />
		<span>Landing Zone Release Brief</span>
	</a>
	<nav aria-label="Main navigation">
		<a href="/" aria-current={!onTimelines ? 'page' : undefined}>Compare releases</a>
		<span class="nav-divider" aria-hidden="true"></span>
		<a href="/timelines" aria-current={onTimelines ? 'page' : undefined}>Timelines</a>
	</nav>
	<a class="repository-link"
		href="https://github.com/sjovang/landingzones-diff-reports-for-humans"
		target="_blank" rel="noreferrer"
		aria-label="View source repository on GitHub (opens in a new tab)"
		title="View source repository on GitHub">
		<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
			<path d="M12 .75a11.25 11.25 0 0 0-3.558 21.922c.563.104.77-.244.77-.542 0-.267-.01-.974-.015-1.912-3.13.68-3.79-1.508-3.79-1.508-.512-1.3-1.25-1.646-1.25-1.646-1.023-.7.078-.686.078-.686 1.132.08 1.727 1.162 1.727 1.162 1.006 1.724 2.64 1.226 3.283.937.103-.729.394-1.226.716-1.508-2.498-.284-5.124-1.25-5.124-5.565 0-1.23.44-2.232 1.16-3.02-.117-.284-.503-1.43.11-2.98 0 0 .945-.302 3.094 1.153A10.79 10.79 0 0 1 12 6.18c.955.004 1.917.129 2.815.379 2.148-1.455 3.092-1.153 3.092-1.153.615 1.55.228 2.696.112 2.98.722.788 1.158 1.79 1.158 3.02 0 4.326-2.63 5.278-5.135 5.557.404.35.764 1.043.764 2.1 0 1.517-.014 2.741-.014 3.114 0 .3.203.65.774.54A11.252 11.252 0 0 0 12 .75Z" />
		</svg>
	</a>
</header>

<style>
	.topbar { display: flex; align-items: center; gap: 24px; min-height: 64px; padding: 0 max(28px, calc((100vw - 1180px) / 2)); background: #fff; border-bottom: 1px solid #cbd5e1; }
	.brand { display: inline-flex; align-items: center; gap: 11px; min-height: 44px; color: #192639; font-size: 15px; font-weight: 700; text-decoration: none; letter-spacing: -0.02em; }
	.brand-mark { display: block; flex: none; width: 28px; height: 28px; }
	nav { display: flex; align-items: center; gap: 12px; margin-left: auto; }
	.nav-divider { width: 1px; height: 16px; flex: none; background: #cbd5e1; }
	nav a { display: inline-flex; align-items: center; min-height: 44px; color: #52647b; font-size: 13px; text-decoration: none; white-space: nowrap; }
	nav a[aria-current] { color: #1768d2; font-weight: 650; }
	nav a:hover { color: #0f56b2; text-decoration: underline; text-underline-offset: 3px; }
	.repository-link { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 44px; height: 44px; color: #52647b; border-radius: 5px; }
	.repository-link:hover { color: #1768d2; background: #edf4fc; }
	a:focus-visible { outline: 3px solid #1768d2; outline-offset: 2px; }
	@media (max-width: 650px) {
		.topbar { display: grid; grid-template-columns: minmax(0, 1fr) 44px; gap: 0 12px; padding: env(safe-area-inset-top) max(18px, env(safe-area-inset-right)) 8px max(18px, env(safe-area-inset-left)); }
		.brand { min-width: 0; }
		.brand span { overflow-wrap: anywhere; }
		nav { grid-column: 1 / -1; grid-row: 2; margin-left: 0; }
		.repository-link { grid-column: 2; grid-row: 1; }
	}
</style>
