<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import TimelineShell from '../../lib/TimelineShell.svelte';
	import { isLibrary } from '../../lib/libraries.js';
	import { isTimelineKind, timelineHref, timelineKindLabels, TIMELINE_KINDS, type TimelineIndex } from '../../lib/timelines.js';
	import { requestTimelineApi } from '../../lib/timeline-api.js';

	let index = $state<TimelineIndex | null>(null);
	let loading = $state(true);
	let error = $state('');
	let search = $state('');
	let library = $state('');
	let kind = $state('');
	const controller = new AbortController();
	const results = $derived(index?.reports.filter((report) =>
		(!library || report.library === library) && (!kind || report.kind === kind)
		&& `${report.title} ${report.name} ${report.description ?? ''}`.toLowerCase().includes(search.toLowerCase().trim())) ?? []);
	const gaps = $derived(index?.gaps.filter((gap) => !library || gap.library === library) ?? []);

	async function loadIndex() {
		loading = true;
		error = '';
		try {
			index = await requestTimelineApi<TimelineIndex>('/api/timelines', controller.signal);
		} catch (cause) {
			if (!controller.signal.aborted) error = cause instanceof Error ? cause.message : 'The timeline overview could not be loaded.';
		} finally {
			loading = false;
		}
	}

	function updateFilters() {
		const url = new URL(page.url.href);
		for (const [key, value] of [['q', search], ['library', library], ['kind', kind]]) {
			if (value) url.searchParams.set(key, value);
			else url.searchParams.delete(key);
		}
		replaceState(url, page.state);
	}

	onMount(() => {
		search = page.url.searchParams.get('q') ?? '';
		const selectedLibrary = page.url.searchParams.get('library');
		const selectedKind = page.url.searchParams.get('kind');
		library = isLibrary(selectedLibrary) ? selectedLibrary : '';
		kind = isTimelineKind(selectedKind) ? selectedKind : '';
		void loadIndex();
		return () => controller.abort();
	});
</script>

<svelte:head><title>Timelines | Landing Zone Release Brief</title></svelte:head>

<TimelineShell>
	<!-- THESIS: Find one library object, then read its complete release history.
	OWN-WORLD: Preserve the engineering brief's system type, cobalt links and flat divided rows.
	STORY: Search policies, policy sets and archetypes, including removed objects; open a stable timeline URL.
	FIRST VIEWPORT: Title and purpose above one search/filter bar and a compact object list.
	FORM: Searchable library index; no comparison controls, generation button or dashboard tiles. -->
	<header class="intro">
		<h1>Definition and archetype timelines</h1>
		<p>Follow an object's history across ALZ or SLZ releases, from its latest state back to its introduction.</p>
	</header>
	<form class="search-controls" onsubmit={(event) => { event.preventDefault(); updateFilters(); }}>
		<label class="search">
			<span>Find a definition or archetype</span>
			<input type="search" placeholder="Search by name, ID or description" value={search} oninput={(event) => { search = event.currentTarget.value; updateFilters(); }} />
		</label>
		<label class="dropdown-filter">
			<span>Library</span>
			<select value={library} onchange={(event) => { library = event.currentTarget.value; updateFilters(); }}>
				<option value="">ALZ and SLZ</option><option value="alz">ALZ</option><option value="slz">SLZ</option>
			</select>
			<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5" stroke="currentColor" stroke-width="1.8" /></svg>
		</label>
		<label class="dropdown-filter">
			<span>Type</span>
			<select value={kind} onchange={(event) => { kind = event.currentTarget.value; updateFilters(); }}>
				<option value="">All types</option>
				{#each TIMELINE_KINDS as value}<option value={value}>{timelineKindLabels[value]}</option>{/each}
			</select>
			<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5" stroke="currentColor" stroke-width="1.8" /></svg>
		</label>
	</form>
	{#if loading}
		<p class="feedback" role="status">Loading published timelines...</p>
	{:else if error}
		<div class="feedback error" role="alert">
			<h2>Timelines are unavailable</h2><p>{error}</p>
			<button onclick={loadIndex}>Retry loading timelines</button>
		</div>
	{:else if index}
		<div class="index-meta">
			<p role="status">{results.length} {results.length === 1 ? 'timeline' : 'timelines'}</p>
			<p>Generated <time datetime={index.generatedAt}>{new Date(index.generatedAt).toLocaleString()}</time></p>
		</div>
		{#if gaps.length}
			<details class="coverage-note">
				<summary>{gaps.length} release coverage {gaps.length === 1 ? 'gap' : 'gaps'}</summary>
				<p>Missing cached data leaves object presence and changes unknown. Objects that exist only in missing releases cannot be listed. Hydrate the missing snapshots and regenerate to fill the gaps.</p>
				<ul>{#each gaps as gap (gap.release.tag)}<li>{gap.library.toUpperCase()} · {gap.release.version}: {gap.reason}</li>{/each}</ul>
			</details>
		{/if}
		{#if results.length}
			<ul class="object-list">
				{#each results as report (`${report.library}:${report.kind}:${report.name}`)}
					<li>
						<a href={timelineHref(report.library, report.kind, report.name)}>
							<div class="object-title">
								<strong>{report.title}</strong>
								{#if report.description}<span>{report.description}</span>{/if}
							</div>
							<div class="object-meta">
								{#if report.presentInLatest === null}<span class="deprecated">Latest state unknown</span>
								{:else if !report.presentInLatest}<span class="removed">Not in latest release</span>
								{:else if report.deprecated}<span class="deprecated">Deprecated</span>{/if}
								<span>{report.library.toUpperCase()} · {timelineKindLabels[report.kind]}</span>
								<span>{report.firstReleaseStatus === 'added' ? 'First introduced' : 'First observed'}: {report.firstRelease}</span>
								{#if report.deprecatedRelease}<span>Deprecated: {report.deprecatedRelease}</span>{/if}
								{#if report.removedRelease}<span>Removed: {report.removedRelease}</span>{/if}
								{#if report.presentInLatest === true && report.lastUpdatedRelease}<span>Last updated: {report.lastUpdatedRelease}</span>{/if}
								{#if report.gapCount}<span class="deprecated">{report.gapCount} coverage {report.gapCount === 1 ? 'gap' : 'gaps'}</span>{/if}
							</div>
							<span class="open-label">View timeline →</span>
						</a>
					</li>
				{/each}
			</ul>
		{:else}
			<div class="feedback"><h2>No matching timelines</h2><p>{index.reports.length ? 'Try a different name or clear the library and type filters.' : 'No objects were found in the available snapshots. Review the coverage gaps, hydrate the cache and regenerate.'}</p>
				<button onclick={() => { search = ''; library = ''; kind = ''; updateFilters(); }}>Clear filters</button>
			</div>
		{/if}
		<p class="generation-note">Timelines are published by a separate, manually triggered generation job. Browsing this index does not generate reports. Catalog synchronized <time datetime={index.syncedAt}>{new Date(index.syncedAt).toLocaleString()}</time>.</p>
	{/if}
</TimelineShell>

<style>
	h1, h2, p { margin: 0; }
	h1 { font-size: clamp(28px, 4vw, 36px); line-height: 1.2; letter-spacing: -0.035em; }
	.intro p { max-width: 75ch; margin-top: 12px; color: #52647b; font-size: 16px; }
	.search-controls { display: grid; grid-template-columns: minmax(0, 1fr) 180px 220px; align-items: end; gap: 18px; margin-top: 32px; }
	label { display: flex; flex-direction: column; gap: 8px; min-width: 0; font-size: 13px; font-weight: 650; }
	input, select, button { font: inherit; }
	input, select { min-height: 44px; width: 100%; padding: 10px 12px; border: 1px solid #c5d0de; border-radius: 5px; background: #fff; color: #192639; font-size: 15px; }
	input::placeholder { color: #52647b; }
	.dropdown-filter { position: relative; flex-direction: row; min-height: 44px; align-items: center; gap: 8px; padding: 0 9px; border: 1px solid #c5d0de; border-radius: 5px; background: #fff; color: #52647b; font-weight: 600; }
	.dropdown-filter:focus-within { border-color: #3181dc; box-shadow: 0 0 0 2px #d8eaff; }
	.dropdown-filter select { appearance: none; flex: 1; min-width: 0; min-height: 42px; padding: 0 24px 0 0; border: 0; border-radius: 0; background: transparent; font-size: 14px; cursor: pointer; }
	.dropdown-filter select:focus-visible { outline: none; }
	.dropdown-filter svg { position: absolute; top: 50%; right: 9px; width: 20px; height: 20px; transform: translateY(-50%); pointer-events: none; color: #175ba9; }
	.index-meta { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; margin-top: 32px; color: #52647b; font-size: 13px; }
	.object-list { margin: 12px 0 0; padding: 0; list-style: none; border-top: 1px solid #cbd5e1; }
	.object-list li { border-bottom: 1px solid #cbd5e1; }
	.object-list a { display: grid; grid-template-columns: minmax(0, 1fr) max-content; grid-template-areas: "title meta" "action meta"; gap: 12px 24px; align-items: start; min-height: 88px; padding: 18px 16px; color: #192639; text-decoration: none; }
	.object-list a:hover { background: #edf4fc; }
	.object-title, .object-meta { display: flex; flex-direction: column; gap: 5px; min-width: 0; overflow-wrap: anywhere; }
	.object-title { grid-area: title; }
	.object-meta { grid-area: meta; max-width: 280px; }
	.object-title strong { font-size: 16px; font-weight: 650; }
	.object-title span, .object-meta { font-size: 13px; color: #52647b; }
	.open-label { grid-area: action; color: #1768d2; font-size: 13px; }
	.object-meta .removed { color: #a13c40; }
	.object-meta .deprecated { color: #795515; }
	.feedback { margin-top: 32px; padding: 24px 0; border-top: 1px solid #cbd5e1; }
	.feedback h2 { font-size: 18px; }
	.feedback p { margin-top: 8px; color: #52647b; }
	button { min-height: 44px; margin-top: 12px; padding: 0; border: 0; background: none; color: #1768d2; text-decoration: underline; cursor: pointer; }
	.error h2 { color: #a13c40; }
	.generation-note { margin-top: 24px; max-width: 75ch; font-size: 13px; color: #52647b; }
	.coverage-note { margin-top: 16px; color: #795515; font-size: 15px; }
	.coverage-note summary { min-height: 44px; padding: 10px 0; cursor: pointer; }
	.coverage-note p { max-width: 75ch; }
	.coverage-note ul { padding-left: 20px; overflow-wrap: anywhere; }
	.coverage-note summary:focus-visible { outline: 3px solid #1768d2; outline-offset: 2px; }
	input:focus-visible, select:focus-visible, button:focus-visible, a:focus-visible { outline: 3px solid #1768d2; outline-offset: 2px; }
	@media (max-width: 900px) {
		.search-controls { grid-template-columns: 1fr 1fr; }
		.search { grid-column: 1 / -1; }
	}
	@media (max-width: 650px) {
		.search-controls { grid-template-columns: 1fr; gap: 12px; }
		input, select { font-size: 16px; }
		.dropdown-filter select { font-size: 16px; }
		.object-list a { grid-template-columns: minmax(0, 1fr); grid-template-areas: "title" "action" "meta"; gap: 12px; padding: 18px 0; }
		.object-meta { max-width: none; }
	}
</style>
