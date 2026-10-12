<script lang="ts">
	import { page } from '$app/state';
	import TimelineShell from '../../../../../lib/TimelineShell.svelte';
	import TimelineView from '../../../../../lib/TimelineView.svelte';
	import { isTimelineIdentity, timelineKindLabels, type TimelineReport } from '../../../../../lib/timelines.js';
	import { requestTimelineApi } from '../../../../../lib/timeline-api.js';
	import { descriptionParts } from '../../../../../lib/description-links.js';

	let timeline = $state<TimelineReport | null>(null);
	let loading = $state(true);
	let error = $state('');
	let retry = $state(0);
	const firstPresence = $derived(timeline?.entries.findLast((entry) => entry.status !== 'gap' && entry.status !== 'absent'));
	const firstDeprecated = $derived(timeline?.entries.findLast((entry) => entry.deprecated));
	const removed = $derived(timeline?.presentInLatest === false
		? timeline.entries.find((entry) => entry.status === 'removed') : undefined);

	$effect(() => {
		const { library, kind, name } = page.params;
		const identity = { library, kind, name };
		retry;
		timeline = null;
		error = '';
		if (!isTimelineIdentity(identity)) {
			error = 'Invalid timeline URL. Choose an ALZ or SLZ policy, policy set, or archetype from the overview.';
			loading = false;
			return;
		}
		const controller = new AbortController();
		const apiUrl = `/api/timelines/${identity.library}/${identity.kind}/${encodeURIComponent(identity.name)}`;
		loading = true;
		async function load() {
			try {
				const report = await requestTimelineApi<TimelineReport>(apiUrl, controller.signal);
				if (!controller.signal.aborted) timeline = report;
			} catch (cause) {
				if (!controller.signal.aborted) error = cause instanceof Error ? cause.message : 'The timeline could not be loaded.';
			} finally {
				if (!controller.signal.aborted) loading = false;
			}
		}
		void load();
		return () => controller.abort();
	});
</script>

<svelte:head>
	<title>{timeline ? `${timeline.title} | ${timeline.library.toUpperCase()} timeline` : 'Object timeline'} | Landing Zone Release Brief</title>
</svelte:head>

<TimelineShell>
	<!-- THESIS: Read one object's full history at an identity-based URL.
	OWN-WORLD: Engineering brief; compact metadata above a source-backed vertical release sequence.
	STORY: See the latest state, scan every release back to introduction, and inspect individual changes.
	FIRST VIEWPORT: Back link, object identity and release range lead directly into newest-first history.
	FORM: Dedicated reading page; viewing never schedules or generates a report. -->
	<a class="back-link" href="/timelines">← All timelines</a>
	{#if loading}
		<h1>Object timeline</h1><p class="feedback" role="status">Loading published timeline...</p>
	{:else if error}
		<h1>Timeline unavailable</h1>
		<div class="feedback" role="alert"><p>{error}</p>
			<button onclick={() => { retry++; }}>Retry loading timeline</button>
		</div>
	{:else if timeline}
		<header class="object-heading">
			<h1>{timeline.title}</h1>
			{#if timeline.description}
				<p class="description">{#each descriptionParts(timeline.description) as part}{#if part.href}<a href={part.href} target="_blank" rel="noreferrer" aria-label={`${part.text} (opens in a new tab)`}>{part.text}</a>{:else}{part.text}{/if}{/each}</p>
			{/if}
			<table class="metadata-table" aria-label="Object metadata">
				<tbody>
					<tr><th scope="row">Library</th><td>{timeline.library.toUpperCase()}</td></tr>
					<tr><th scope="row">Type</th><td>{timelineKindLabels[timeline.kind]}</td></tr>
					<tr><th scope="row">Name</th><td>{timeline.name}</td></tr>
				</tbody>
				<tbody class="lifecycle">
					<tr>
						<th scope="row">{firstPresence?.status === 'added' ? 'First introduced' : 'First observed'}</th>
						<td>{timeline.firstRelease}</td>
					</tr>
					{#if firstDeprecated}
						<tr>
							<th scope="row">Deprecated</th>
							<td>{firstDeprecated.release.version}</td>
						</tr>
					{/if}
					{#if removed}
						<tr><th scope="row">Removed</th><td>{removed.release.version}</td></tr>
					{/if}
				</tbody>
				<tbody>
					{#if timeline.presentInLatest === null || timeline.presentInLatest === false || timeline.deprecated}
						<tr><th scope="row">Latest state</th><td>
							{#if timeline.presentInLatest === null}<span class="deprecated">Latest state unknown</span>
							{:else if !timeline.presentInLatest}<span class="removed">Not in latest release</span>
							{:else if timeline.deprecated}<span class="deprecated">Deprecated</span>{/if}
						</td></tr>
					{/if}
					{#if timeline.presentInLatest === true && timeline.entries[0]?.source}
						<tr><th scope="row">Source</th><td>
							<a class="current-source" href={timeline.entries[0].source} target="_blank" rel="noreferrer"
								aria-label="View current file on GitHub (opens in a new tab)">View current file on GitHub ↗</a>
						</td></tr>
					{/if}
				</tbody>
			</table>
		</header>
		<TimelineView {timeline} />
		<footer>
			<p>Generated <time datetime={timeline.generatedAt}>{new Date(timeline.generatedAt).toLocaleString()}</time> · Catalog synchronized <time datetime={timeline.syncedAt}>{new Date(timeline.syncedAt).toLocaleString()}</time>.</p>
			<p>This is a separately generated library history, not a report of deployed Azure resources. The URL stays the same when a new generation is published.</p>
		</footer>
	{/if}
</TimelineShell>

<style>
	h1, p { margin: 0; }
	h1 { max-width: 36ch; font-size: clamp(28px, 4vw, 36px); line-height: 1.2; letter-spacing: -0.035em; overflow-wrap: anywhere; }
	.back-link { display: inline-flex; align-items: center; min-height: 44px; margin-bottom: 20px; color: #1768d2; font-size: 15px; text-underline-offset: 3px; }
	.description { max-width: 75ch; margin-top: 16px; font-size: 16px; color: #52647b; overflow-wrap: anywhere; }
	.description a { color: #1768d2; text-underline-offset: 3px; }
	.description a:hover { color: #0f56b2; }
	.object-heading { padding-bottom: 32px; margin-bottom: 32px; border-bottom: 1px solid #cbd5e1; }
	.metadata-table { width: 100%; max-width: 75ch; margin-top: 24px; border-collapse: collapse; table-layout: fixed; color: #52647b; font-size: 13px; }
	.metadata-table th, .metadata-table td { padding: 4px 0; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
	.metadata-table th { width: 140px; padding-right: 12px; font-weight: 650; }
	.current-source { color: #1768d2; font-size: 13px; text-underline-offset: 3px; overflow-wrap: anywhere; }
	.current-source:hover { color: #0f56b2; }
	.removed { color: #a13c40; }
	.deprecated { color: #795515; }
	.feedback { margin-top: 24px; color: #52647b; }
	button { min-height: 44px; padding: 0; border: 0; margin-top: 12px; background: none; font: inherit; color: #1768d2; text-decoration: underline; cursor: pointer; }
	a:focus-visible, button:focus-visible { outline: 3px solid #1768d2; outline-offset: 2px; }
	footer { margin-top: 24px; color: #52647b; font-size: 13px; }
	footer p { max-width: 75ch; margin-top: 8px; }
</style>
