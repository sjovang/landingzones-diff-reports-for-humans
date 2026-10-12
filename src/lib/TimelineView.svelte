<script lang="ts">
	import type { TimelineReport, TimelineStatus } from './timelines.js';
	import { assignmentChanges } from './assignment-changes.js';

	let { timeline }: { timeline: TimelineReport } = $props();
	const visibleEntries = $derived(timeline.entries.filter((entry) => entry.status !== 'unchanged' && entry.status !== 'absent'));
	const labels: Record<TimelineStatus, string> = {
		'first-observed': 'First observed', added: 'Introduced', reintroduced: 'Reintroduced',
		modified: 'Updated', removed: 'Removed', unchanged: 'Unchanged', absent: 'Not present', gap: 'Coverage gap'
	};
</script>

<section class="timeline" aria-labelledby="history-heading">
	<h2 id="history-heading">Release history</h2>
	<p class="history-note">Newest-first history, with unchanged and not-present releases omitted. This object was first {timeline.entries.findLast((entry) => entry.status !== 'gap')?.status === 'added' ? 'introduced' : 'observed'} in {timeline.firstRelease}. Expand a change for its explanation and source evidence.</p>
	{#if timeline.gapCount}
		<p class="history-note coverage-note">{timeline.gapCount} {timeline.gapCount === 1 ? 'release has' : 'releases have'} missing cached data. Presence and changes cannot be determined for those releases, and releases across a gap are not compared. Hydrate the missing snapshots and regenerate to fill the gaps.</p>
	{/if}
	{#if timeline.library === 'slz'}
		<p class="history-note">SLZ history includes objects inherited from each release's pinned ALZ dependency. Leaving the SLZ inventory does not imply deletion from ALZ. Source links use the object's actual immutable commit.</p>
	{/if}
	<ol class="timeline-list">
		{#each visibleEntries as entry (entry.release.tag)}
			<li class:gap-entry={entry.status === 'gap'}>
				<div class="release-label">
					<a href={entry.release.url} target="_blank" rel="noreferrer">{entry.release.version} ↗</a>
				</div>
				<div class="timeline-event">
					<div class="event-heading">
						<h3>{entry.change?.deprecationOnly ? 'Deprecated' : entry.changeType === 'usage' ? 'Library usage changed' : entry.status === 'removed' && timeline.library === 'slz' ? 'No longer included in SLZ' : labels[entry.status]}</h3>
						{#if entry.version}<span>v{entry.version}</span>{/if}
						{#if entry.provenance && timeline.library === 'slz'}<span>{entry.provenance === 'alz' ? 'Inherited from ALZ' : 'SLZ definition'}</span>{/if}
						{#if entry.deprecated && !entry.change?.deprecationOnly}<span class="deprecated-label">Deprecated</span>{/if}
					</div>
					{#if entry.change}
						<p>{entry.change.summary}</p>
						<details class="event-details">
							<summary>{entry.changeType === 'usage' ? 'Assignment changes and evidence' : 'Definition changes and evidence'}</summary>
							{#each assignmentChanges(entry.change.assignmentsBefore, entry.change.assignmentsAfter) as assignment}
								<h4>Assignment: {assignment.name}</h4>
								<dl class="assignment-deltas">
									{#each assignment.changes as delta}
										<div>
											<dt>{delta.label}</dt>
											<dd><b>Before:</b> {delta.before}</dd>
											<dd><b>After:</b> {delta.after}</dd>
										</div>
									{/each}
								</dl>
							{/each}
							{#if entry.change.facts.length}
								<ul>{#each entry.change.facts as fact}<li>{fact}</li>{/each}</ul>
							{/if}
							{#if entry.change.warnings.length}
								<h4>Interpretation notes</h4>
								<ul>{#each entry.change.warnings as warning}<li>{warning}</li>{/each}</ul>
							{/if}
							<div class="timeline-sources">
								{#each entry.change.sources as source}
									<a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>
								{/each}
							</div>
						</details>
					{:else if entry.status === 'gap'}
						<p>{entry.gapReason} Object presence and changes are unknown.</p>
					{:else if entry.status === 'first-observed'}
						<p>Observed in this release, but no earlier release is available for comparison, either because this is the catalog baseline or because cached data is missing. Introduction or changes since the previous observation cannot be established.</p>
					{:else}
						<p>Not present in this release's library inventory.</p>
					{/if}
					{#if entry.source && !entry.change}
						<a href={entry.source} target="_blank" rel="noreferrer">View definition ↗</a>
					{/if}
				</div>
			</li>
		{/each}
	</ol>
</section>

<style>
	h2, h3, h4, p { margin: 0; }
	h2 { font-size: 23px; letter-spacing: -0.025em; }
	.history-note { max-width: 75ch; margin-top: 12px; color: #52647b; font-size: 15px; }
	.timeline-list { margin: 32px 0 0; padding: 0; list-style: none; }
	.timeline-list > li { display: grid; grid-template-columns: 124px minmax(0, 1fr); gap: 24px; padding-bottom: 24px; }
	.release-label a { padding: 0; min-height: 24px; font-weight: 650; }
	.timeline-event { position: relative; min-width: 0; padding: 0 0 24px 24px; border-left: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1; }
	.timeline-event::before { content: ''; position: absolute; top: 7px; left: -4px; width: 7px; height: 7px; background: #1768d2; border-radius: 50%; }
	.gap-entry .timeline-event { border-left-style: dashed; }
	.gap-entry .timeline-event::before { background: #fff; border: 1px solid #795515; }
	.coverage-note, .gap-entry h3 { color: #795515; }
	.event-heading { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; }
	h3 { color: #192639; font-size: 16px; font-weight: 650; }
	.event-heading span { color: #52647b; font-size: 13px; }
	.event-heading .deprecated-label { color: #795515; }
	.timeline-event p { max-width: 75ch; margin-top: 6px; color: #52647b; font-size: 15px; overflow-wrap: anywhere; }
	.event-details { margin-top: 8px; }
	summary { width: fit-content; min-height: 44px; padding: 10px 0; color: #1768d2; font-size: 15px; cursor: pointer; }
	ul { margin: 4px 0 12px; padding-left: 20px; color: #52647b; font-size: 15px; line-height: 1.65; }
	ul li { margin-top: 5px; overflow-wrap: anywhere; }
	h4 { margin-top: 16px; font-size: 13px; color: #192639; }
	.assignment-deltas { margin: 8px 0 16px; font-size: 15px; color: #52647b; overflow-wrap: anywhere; }
	.assignment-deltas div + div { margin-top: 12px; }
	.assignment-deltas dt { font-weight: 650; color: #192639; }
	.assignment-deltas dd { margin: 4px 0 0; }
	.timeline-sources { display: flex; flex-wrap: wrap; gap: 4px 20px; }
	a { display: inline-flex; min-height: 44px; max-width: 100%; align-items: center; color: #1768d2; font-size: 15px; text-underline-offset: 3px; overflow-wrap: anywhere; }
	a:hover, summary:hover { color: #0f56b2; }
	summary:focus-visible, a:focus-visible { outline: 3px solid #1768d2; outline-offset: 2px; }
	@media (max-width: 650px) {
		.timeline-list > li { grid-template-columns: minmax(0, 1fr); gap: 12px; }
		.release-label { padding-left: 24px; }
		.timeline-event p, ul, .assignment-deltas { font-size: 16px; }
	}
</style>
