<script lang="ts">
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import brandIcon from '#lib/assets/favicon.svg';
	import { assignmentChanges } from '../lib/assignment-changes.js';
	import { REPORT_SCHEMA_VERSION, assignmentContextFacts, type AlzRelease, type ComparisonReport, type ComparisonStatus, type PolicyAssignmentContext } from '../lib/types.js';

	function assignmentFacts(assignments: PolicyAssignmentContext[]) {
		return JSON.stringify(assignments.map(assignmentContextFacts));
	}
	function changedAssignments(assignments: PolicyAssignmentContext[], other: PolicyAssignmentContext[]) {
		return assignments.filter((assignment) =>
			!other.some((candidate) => candidate.assignmentId === assignment.assignmentId
				&& JSON.stringify(assignmentContextFacts(candidate)) === JSON.stringify(assignmentContextFacts(assignment))));
	}

	let releases = $state<AlzRelease[]>([]);
	let fromTag = $state('');
	let toTag = $state('');
	let report = $state<ComparisonReport | null>(null);
	let expandedChanges = $state<Record<string, boolean>>({});
	let loadingReleases = $state(true);
	let submitting = $state(false);
	let jobStatus = $state<ComparisonStatus | null>(null);
	let pageError = $state('');
	let search = $state('');
	let announcement = $state('');
	const lifecycle = new AbortController();
	let disposed = false;
	let restoreComparison = false;
	let pendingJob: { id: string; fromTag: string; toTag: string } | null = null;

	const kindLabels: Record<string, string> = {
		policy: 'Policy definition', initiative: 'Policy initiative', assignment: 'Policy assignment',
		archetype: 'Archetype definition', architecture: 'Architecture definition', role: 'Role definition',
		configuration: 'Library configuration', documentation: 'Documentation'
	};

	const statusLabels: Record<string, string> = {
		added: 'Added',
		modified: 'Updated',
		removed: 'Removed'
	};
	const statusIcons: Record<string, string> = {
		added: 'M8 3v10M3 8h10',
		modified: 'M12.5 6A5 5 0 0 0 3 5M3 1.5V5h3.5M3.5 10A5 5 0 0 0 13 11m0 3.5V11H9.5',
		removed: 'M3 8h10',
		deprecated: 'M8 2 1.5 13h13L8 2ZM8 6v3M8 11v.1'
	};

	const searchableChanges = $derived(
		(report?.changes ?? []).map((change) => ({
			change,
			text: `${change.title} ${change.description ?? ''} ${change.summary} ${change.facts.join(' ')} ${[...change.assignmentsBefore, ...change.assignmentsAfter].flatMap((assignment) => assignment.scopes).join(' ')}`.toLowerCase()
		}))
	);
	const searchQuery = $derived(search.toLowerCase());
	const visibleChanges = $derived(
		searchableChanges.filter(({ text }) => text.includes(searchQuery)).map(({ change }) => change)
			.sort((a, b) => {
				const order = (change: typeof a) => change.status === 'added' ? 0
					: change.status === 'removed' ? 1 : change.deprecated ? 2 : 3;
				return order(a) - order(b);
			})
	);

	onMount(() => {
		const params = new URL(window.location.href).searchParams;
		restoreComparison = params.has('from') || params.has('to');
		void loadReleases();
		return () => {
			disposed = true;
			lifecycle.abort();
		};
	});

	async function requestApi(url: string, options: RequestInit = {}) {
		const timeout = new AbortController();
		const timer = setTimeout(() => timeout.abort(new DOMException('Request timed out.', 'TimeoutError')), 15_000);
		try {
			const response = await fetch(url, {
				...options,
				signal: AbortSignal.any([lifecycle.signal, options.signal ?? lifecycle.signal, timeout.signal])
			});
			let payload: unknown;
			try {
				payload = await response.json();
			} catch (error) {
				if (error instanceof SyntaxError) throw new Error('The server returned an unreadable response. Try again.');
				throw error;
			}
			if (!response.ok) {
				const message = payload && typeof payload === 'object' && 'error' in payload
					&& typeof payload.error === 'string' ? payload.error : 'The request could not be completed. Try again.';
				throw new Error(message);
			}
			if (!payload || typeof payload !== 'object') throw new Error('The server returned an invalid response. Try again.');
			return payload;
		} catch (error) {
			if (error instanceof DOMException && error.name === 'TimeoutError') {
				throw new Error('The request timed out. Try again; your release selection is preserved.');
			}
			if (error instanceof TypeError) throw new Error('Could not reach the server. Check your connection and try again.');
			throw error;
		} finally {
			clearTimeout(timer);
		}
	}

	function waitForPoll(signal: AbortSignal) {
		return new Promise<void>((resolve, reject) => {
			signal.throwIfAborted();
			const timer = setTimeout(() => {
				signal.removeEventListener('abort', abort);
				resolve();
			}, 1500);
			function abort() {
				clearTimeout(timer);
				signal.removeEventListener('abort', abort);
				reject(signal.reason);
			}
			signal.addEventListener('abort', abort, { once: true });
		});
	}

	function completeComparison(result: ComparisonReport) {
		const totalKeys = ['changed', 'added', 'modified', 'removed'] as const;
		const validSources = (sources: { label: string; url: string }[]) =>
			Array.isArray(sources) && sources.every((source) =>
				source && typeof source.label === 'string' && typeof source.url === 'string');
		const validStrings = (values: string[]) => Array.isArray(values) && values.every((value) => typeof value === 'string');
		const validAssignments = (assignments: PolicyAssignmentContext[]) =>
			Array.isArray(assignments) && assignments.every((assignment) =>
				assignment && typeof assignment.assignmentId === 'string' && typeof assignment.name === 'string'
				&& typeof assignment.definition === 'string' && typeof assignment.effect === 'string'
				&& typeof assignment.enforcement === 'string' && validStrings(assignment.scopes)
				&& validStrings(assignment.parameters) && validStrings(assignment.notes) && validSources(assignment.sources));
		if (result.schemaVersion !== REPORT_SCHEMA_VERSION || !result.from || !result.to
			|| typeof result.from.version !== 'string' || typeof result.to.version !== 'string'
			|| typeof result.from.url !== 'string' || typeof result.to.url !== 'string'
			|| typeof result.summary !== 'string' || typeof result.complete !== 'boolean'
			|| typeof result.generatedAt !== 'string' || !Number.isFinite(Date.parse(result.generatedAt))
			|| !result.coverage || typeof result.coverage.explanation !== 'string'
			|| !result.totals || !totalKeys.every((key) => Number.isSafeInteger(result.totals[key]) && result.totals[key] >= 0)
			|| !Array.isArray(result.changes) || !result.changes.every((change) =>
				change && typeof change.id === 'string' && typeof change.title === 'string'
				&& Object.hasOwn(kindLabels, change.kind) && Object.hasOwn(statusLabels, change.status)
				&& typeof change.summary === 'string' && validStrings(change.facts) && validStrings(change.warnings)
				&& validAssignments(change.assignmentsBefore) && validAssignments(change.assignmentsAfter) && validSources(change.sources))) {
			throw new Error('The server returned an invalid report. Retry the comparison.');
		}
		report = result;
		jobStatus = 'completed';
		pendingJob = null;
		announcement = `Comparison ready: ${result.from.version} to ${result.to.version}. ${result.totals.changed} library updates.`;
	}

	async function loadReleases() {
		loadingReleases = true;
		pageError = '';
		try {
			const payload = await requestApi('/api/releases') as { releases?: AlzRelease[]; syncedAt?: string };
			if (!Array.isArray(payload.releases) || !payload.releases.every((release) =>
				release && typeof release.tag === 'string' && typeof release.version === 'string' && typeof release.url === 'string')
				|| (payload.syncedAt !== undefined && (typeof payload.syncedAt !== 'string' || !Number.isFinite(Date.parse(payload.syncedAt))))) {
				throw new Error('The server returned an invalid release catalog. Try loading releases again.');
			}
			releases = payload.releases;
			if (restoreComparison) {
				const params = new URL(window.location.href).searchParams;
				const savedFrom = params.get('from');
				const savedTo = params.get('to');
				if (!savedFrom || !savedTo || savedFrom === savedTo
					|| !releases.some((release) => release.tag === savedFrom)
					|| !releases.some((release) => release.tag === savedTo)) {
					restoreComparison = false;
					if (releases.length >= 2) {
						fromTag = releases[1].tag;
						toTag = releases[0].tag;
					}
					throw new Error('This comparison link needs two different available ALZ releases. Choose releases and compare again.');
				}
				fromTag = savedFrom;
				toTag = savedTo;
			} else if (releases.length >= 2) {
				if (!releases.some((release) => release.tag === fromTag)) fromTag = releases[1].tag;
				if (!releases.some((release) => release.tag === toTag)) toTag = releases[0].tag;
			}
		} catch (error) {
			if (!disposed) pageError = error instanceof Error ? error.message : 'Release information could not be loaded.';
		} finally {
			if (!disposed) loadingReleases = false;
		}
		if (!disposed && !pageError && restoreComparison) {
			restoreComparison = false;
			await compareReleases();
		}
	}

	async function compareReleases() {
		if (!fromTag || !toTag || fromTag === toTag || submitting) return;
		submitting = true;
		report = null;
		expandedChanges = {};
		jobStatus = null;
		pageError = '';
		announcement = '';
		search = '';

		try {
			const url = new URL(window.location.href);
			url.searchParams.set('from', fromTag);
			url.searchParams.set('to', toTag);
			replaceState(url, page.state);
			if (pendingJob && pendingJob.fromTag === fromTag && pendingJob.toTag === toTag) {
				jobStatus = 'queued';
				await pollComparison(pendingJob.id);
				return;
			}
			pendingJob = null;
			const result = await requestApi('/api/comparisons', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ fromTag, toTag })
			}) as {
				status?: ComparisonStatus;
				jobId?: string;
				report?: ComparisonReport;
				error?: string;
			};

			if (result.report) {
				completeComparison(result.report);
				return;
			}
			if (typeof result.jobId !== 'string' || (result.status !== 'queued' && result.status !== 'running')) {
				throw new Error('The server returned an invalid comparison status. Try again.');
			}

			jobStatus = result.status;
			pendingJob = { id: result.jobId, fromTag, toTag };
			await pollComparison(result.jobId);
		} catch (error) {
			if (!disposed) {
				pageError = error instanceof DOMException && error.name === 'TimeoutError'
					? 'This comparison is taking longer than expected. Retry to check the same job again.'
					: error instanceof Error ? error.message : 'The comparison could not be completed.';
				jobStatus = null;
			}
		} finally {
			if (!disposed) submitting = false;
		}
	}

	async function pollComparison(jobId: string) {
		const signal = AbortSignal.any([lifecycle.signal, AbortSignal.timeout(270_000)]);
		for (let attempt = 0; attempt < 180; attempt += 1) {
			await waitForPoll(signal);
			const result = await requestApi(`/api/comparisons/${encodeURIComponent(jobId)}`, { signal }) as {
				status?: ComparisonStatus;
				report?: ComparisonReport;
				error?: string;
			};
			if (result.status === 'completed' && result.report) {
				completeComparison(result.report);
				return;
			}
			if (result.status === 'failed') {
				pendingJob = null;
				throw new Error(result.error ?? 'Report generation failed. Try again.');
			}
			if (result.status !== 'queued' && result.status !== 'running') {
				throw new Error('The server returned an unknown comparison status.');
			}
			jobStatus = result.status;
		}
		throw new Error('This comparison is taking longer than expected. You can retry without losing your selection.');
	}
</script>

<svelte:head>
	<title>ALZ Release Brief</title>
</svelte:head>

<main class="app-shell">
	<a class="skip-link" href="#page-title">Skip to comparison</a>
	<div class="sr-only" role="status" aria-label="Comparison status" aria-live="polite" aria-atomic="true">{announcement}</div>
	<noscript><p class="notice">JavaScript is required to load releases and generate comparisons. Enable JavaScript, then reload this page.</p></noscript>
	<!--
	THESIS: Make the ALZ release delta the task, not a dashboard about the task.
	OWN-WORLD: High-contrast white and cool-gray engineering workspace, cobalt action color, compact system typography, crisp rules, and restrained code treatment.
	STORY: Engineers choose two published ALZ tags and understand policy versions, behavior, effects, and library assignment scopes, with source evidence one click away.
	FIRST VIEWPORT: A slim repository header sits above the comparison title and two equal release selectors; the primary Compare releases action anchors their right edge.
	FORM: Familiar release-comparison interface, chosen from the user's preference; shaped to sit beside GitHub Releases and Azure engineering tools, without an added metaphor.
	-->
	<header class="topbar">
		<a class="brand" href="/" aria-label="ALZ Release Brief home">
			<img class="brand-mark" src={brandIcon} width="28" height="28" alt="" />
			<span>ALZ Release Brief</span>
		</a>
		<a
			class="repository-link"
			href="https://github.com/sjovang/alzlib-diff-for-humans"
			target="_blank"
			rel="noreferrer"
		>
			<span class="repository-name">sjovang / alzlib-diff-for-humans</span>
			<span aria-hidden="true">↗</span>
		</a>
	</header>

	<div class="content">
		<section class="intro" aria-labelledby="page-title">
			<div>
				<h1 id="page-title" tabindex="-1">ALZ release changes, explained</h1>
				<p>
					Compare two Azure Landing Zones Library releases. This tool connects changes across policies, initiatives, and assignments to explain what changed, what it does, and where it applies—in plain language, not raw JSON diffs.
				</p>
			</div>
		</section>

		<section class="comparison-form" aria-label="Release selection">
			<label class="release-field">
				<span class="field-label"><span class="sr-only">FROM Release</span><span aria-hidden="true">From release</span></span>
				<div class="release-picker">
				<select bind:value={fromTag} aria-describedby="from-release-tag" disabled={loadingReleases || releases.length === 0 || submitting}>
					{#if loadingReleases}
						<option value="">Loading published releases…</option>
					{:else if releases.length === 0}
						<option value="">No ALZ releases available</option>
					{:else}
						{#each releases as release (release.tag)}
							<option value={release.tag}>{release.version}</option>
						{/each}
					{/if}
				</select>
				<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5" stroke="currentColor" stroke-width="1.8" /></svg>
				</div>
				<span id="from-release-tag" class="sr-only">{fromTag || 'Select a release tag'}</span>
			</label>

			<div class="direction" aria-hidden="true">
				<svg viewBox="0 0 24 24" fill="none">
					<path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.8" />
				</svg>
			</div>

			<label class="release-field">
				<span class="field-label"><span class="sr-only">TO Release</span><span aria-hidden="true">To release</span></span>
				<div class="release-picker">
				<select bind:value={toTag} aria-describedby="to-release-tag" disabled={loadingReleases || releases.length === 0 || submitting}>
					{#if loadingReleases}
						<option value="">Loading published releases…</option>
					{:else if releases.length === 0}
						<option value="">No ALZ releases available</option>
					{:else}
						{#each releases as release (release.tag)}
							<option value={release.tag}>{release.version}</option>
						{/each}
					{/if}
				</select>
				<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5" stroke="currentColor" stroke-width="1.8" /></svg>
				</div>
				<span id="to-release-tag" class="sr-only">{toTag || 'Select a release tag'}</span>
			</label>

			<button
				class="compare-button"
				onclick={compareReleases}
				disabled={loadingReleases || releases.length < 2 || fromTag === toTag || submitting}
			>
				{#if submitting}
					<span class="button-spinner" aria-hidden="true"></span>
					Preparing…
				{:else}
					Compare releases
					<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
						<path d="M3.5 10h13m-5-5 5 5-5 5" stroke="currentColor" stroke-width="1.7" />
					</svg>
				{/if}
			</button>
		</section>
		{#if !loadingReleases && releases.length >= 2 && fromTag === toTag}
			<p class="selection-hint">Choose two different releases to compare.</p>
		{/if}

		{#if pageError}
			<div class="notice error-notice" role="alert">
				<strong>{releases.length === 0 ? 'Could not load releases.' : 'Could not complete the comparison.'}</strong>
				<span>{pageError}</span>
				{#if releases.length === 0}
					<button class="text-button" onclick={loadReleases} disabled={loadingReleases}>Try loading releases again</button>
				{:else}
					<button class="text-button" onclick={compareReleases} disabled={submitting || fromTag === toTag}>Retry comparison</button>
				{/if}
			</div>
		{/if}

		{#if jobStatus === 'queued' || jobStatus === 'running'}
			<div class="notice progress-notice" role="status" aria-live="polite">
				<span class="progress-pulse" aria-hidden="true"></span>
				<div>
					<strong>{jobStatus === 'queued' ? 'Comparison queued' : 'Building your report'}</strong>
					<span>
						{jobStatus === 'queued'
							? 'The worker will start shortly. This page will update automatically.'
							: 'Connecting policy changes to initiatives, assignment effects, and library scopes.'}
					</span>
				</div>
			</div>
		{/if}

		{#if report}
			<section class="report" aria-labelledby="report-title">
				<div class="report-heading">
					<h2 id="report-title" class="sr-only">{report.from.version} to {report.to.version}</h2>
					<div class="totals" aria-label="Library change totals">
						<span><b>{report.totals.modified}</b> updated</span>
						<span><b class="added-count">{report.totals.added}</b> added</span>
						<span><b class="removed-count">{report.totals.removed}</b> removed</span>
					</div>
					<p class="report-meta">
						Generated <time datetime={report.generatedAt}>{new Date(report.generatedAt).toLocaleString()}</time> ·
						<a href={report.from.url} target="_blank" rel="noreferrer">source tags</a>
					</p>
				</div>
				{#if !report.complete}
					<div class="notice coverage-warning" role="status">
						<div>
							<strong>Some release source information is missing.</strong>
							<p>{report.coverage.explanation}</p>
						</div>
					</div>
				{/if}

				<div class="changes-heading">
					<div>
						<h3>What changed</h3>
						<span aria-live="polite" aria-atomic="true">{visibleChanges.length} of {report.changes.length} updates</span>
					</div>
					<div class="change-controls">
						<label class="search-field">
							<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
								<circle cx="8.8" cy="8.8" r="5.8" stroke="currentColor" stroke-width="1.5" />
								<path d="m13 13 4 4" stroke="currentColor" stroke-width="1.5" />
							</svg>
							<span class="sr-only">Search library changes</span>
							<input bind:value={search} placeholder="Find a policy or scope" />
						</label>
					</div>
				</div>

				{#if report.changes.length === 0}
					<div class="empty-filter">
						<strong>No semantic ALZ library changes were found between these releases.</strong>
						<span>Other library areas are intentionally outside this comparison.</span>
					</div>
				{:else}
				<div class="file-list">
					{#each visibleChanges as change (change.id)}
						<details class="file-change" open={expandedChanges[change.id] ?? false}
							ontoggle={(event) => { expandedChanges[change.id] = event.currentTarget.open; }}>
							<summary>
								<span class="change-statuses">
									{#if !change.deprecationOnly}
									<span class="file-status" title={statusLabels[change.status]} class:status-added={change.status === 'added'} class:status-removed={change.status === 'removed'}>
										<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d={statusIcons[change.status]} stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
										<span class="sr-only">{statusLabels[change.status]}</span>
									</span>
									{/if}
									{#if change.deprecated}
										<span class="file-status status-deprecated" title="Deprecated">
											<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d={statusIcons.deprecated} stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
											<span class="sr-only">Deprecated</span>
										</span>
									{/if}
								</span>
								<span class="file-path">
									<strong>{change.title}</strong>
									<span class="file-meta">
										<span class="change-kind">{kindLabels[change.kind]}</span>
										<small>{change.summary}</small>
									</span>
								</span>
								<span class="version-change" class:version-updated={Boolean(change.beforeVersion && change.afterVersion && change.beforeVersion !== change.afterVersion)}>
									{#if change.beforeVersion && change.afterVersion && change.beforeVersion !== change.afterVersion}
										{change.beforeVersion} → {change.afterVersion}
									{:else}
										{change.afterVersion ?? change.beforeVersion ?? ''}
									{/if}
								</span>
								<svg class="chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true">
									<path d="m5 7.5 5 5 5-5" stroke="currentColor" stroke-width="1.6" />
								</svg>
							</summary>
							{#if expandedChanges[change.id]}
							{@const assignmentDeltas = assignmentChanges(change.assignmentsBefore, change.assignmentsAfter)}
							{@const referenceOnlyAssignmentChange = assignmentDeltas.length > 0 && assignmentDeltas.every((assignment) =>
								assignment.changes.length === 1 && assignment.changes[0].label === 'Referenced definition')}
							{@const assignmentSections = [
								{ label: 'Previous affected assignments', assignments: changedAssignments(change.assignmentsBefore, change.assignmentsAfter), show: change.status !== 'added' && assignmentFacts(change.assignmentsBefore) !== assignmentFacts(change.assignmentsAfter) },
								{ label: change.status === 'added' ? 'Library assignments' : 'Current library assignments', assignments: assignmentFacts(change.assignmentsBefore) !== assignmentFacts(change.assignmentsAfter) ? changedAssignments(change.assignmentsAfter, change.assignmentsBefore) : change.assignmentsAfter, show: change.status !== 'removed' }
							]}
							<div class="file-detail">
								<p class="change-outcome">{change.summary}</p>
								{#each assignmentDeltas as assignment}
									<div class="detail-group assignment-delta">
										<h4>{referenceOnlyAssignmentChange ? 'Assignment reference' : `Assignment change: ${assignment.name}`}</h4>
										<dl class="delta-list">
											{#each assignment.changes as delta}
												<div>
													<dt>{delta.label}</dt>
													<dd><span class="delta-label">Before</span> {delta.before}</dd>
													<dd><span class="delta-label">After</span> {delta.after}</dd>
												</div>
											{/each}
										</dl>
										{#if assignment.unchanged.length}
											<p class="unchanged-context">{referenceOnlyAssignmentChange ? 'Assignment settings are unchanged.' : `Unchanged: ${assignment.unchanged.join(', ')}.`}</p>
										{/if}
									</div>
								{/each}
								{#if !referenceOnlyAssignmentChange && change.description}<p class="change-summary">{change.description}</p>{/if}
								{#if !referenceOnlyAssignmentChange && change.facts.length}
									<div class="detail-group">
										<h4>Change explained</h4>
										<ul class="fact-list">
											{#each change.facts as fact}
												<li>{fact}</li>
											{/each}
										</ul>
									</div>
								{/if}
								{#if referenceOnlyAssignmentChange}
									<details class="assignment-evidence">
										<summary>Show full assignment context</summary>
										{#each assignmentSections as section}
											{#if section.show && section.assignments.length}
												<div class="detail-group assignment-context">
													<h4>{section.label}</h4>
													{#each section.assignments as assignment}
														<div class="assignment-row">
															<strong>{assignment.name}</strong>
															<p>References: {assignment.definition}</p>
															<p>{assignment.effect}</p>
															<p>{assignment.enforcement}</p>
															<ul class="fact-list">
																{#each assignment.scopes as scope}<li>{scope}</li>{/each}
																{#each assignment.parameters as parameter}<li>{parameter}</li>{/each}
																{#each assignment.notes as note}<li>{note}</li>{/each}
															</ul>
															<div class="source-links">
																{#each assignment.sources as source}
																	<a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>
																{/each}
															</div>
														</div>
													{/each}
												</div>
											{/if}
										{/each}
										{#if change.warnings.length}
											<div class="detail-group review-notes">
												<h4>Interpretation notes</h4>
												<ul class="fact-list">
													{#each change.warnings as warning}<li>{warning}</li>{/each}
												</ul>
											</div>
										{/if}
									</details>
								{:else}
									{#each assignmentSections as section}
										{#if section.show && section.assignments.length}
											<div class="detail-group assignment-context">
												<h4>{section.label}</h4>
												{#each section.assignments as assignment}
													<div class="assignment-row">
														<strong>{assignment.name}</strong>
														<p>References: {assignment.definition}</p>
														<p>{assignment.effect}</p>
														<p>{assignment.enforcement}</p>
														<ul class="fact-list">
															{#each assignment.scopes as scope}<li>{scope}</li>{/each}
															{#each assignment.parameters as parameter}<li>{parameter}</li>{/each}
															{#each assignment.notes as note}<li>{note}</li>{/each}
														</ul>
														<div class="source-links">
															{#each assignment.sources as source}
																<a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>
															{/each}
														</div>
													</div>
												{/each}
											</div>
											{/if}
										{/each}
								{/if}
								{#if !referenceOnlyAssignmentChange && change.warnings.length}
									<div class="detail-group review-notes">
										<h4>Interpretation notes</h4>
										<ul class="fact-list">
											{#each change.warnings as warning}<li>{warning}</li>{/each}
										</ul>
									</div>
								{/if}
								<div class="source-links" aria-label="Source evidence">
									{#each change.sources as source}
										<a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>
									{/each}
								</div>
							</div>
							{/if}
						</details>
					{:else}
						<div class="empty-filter">
							<strong>No library changes match your search.</strong>
							<button class="text-button" onclick={() => { search = ''; }}>Clear search</button>
						</div>
					{/each}
				</div>
				{/if}

			</section>
		{:else if !pageError && jobStatus !== 'queued' && jobStatus !== 'running'}
			<section class="empty-report" aria-live="polite">
				<div class="empty-mark" aria-hidden="true">
					<svg viewBox="0 0 64 64" fill="none">
						<path d="M12 17h40M12 32h15m10 0h15M12 47h40" stroke="currentColor" stroke-width="2" />
						<circle cx="32" cy="32" r="5" fill="currentColor" />
					</svg>
				</div>
				<div>
					<h2>{loadingReleases ? 'Loading published releases' : releases.length < 2 ? 'Waiting for ALZ releases' : 'Your comparison will appear here'}</h2>
					<p>
						{loadingReleases
							? 'Reading the stored ALZ release catalog.'
							: releases.length < 2
								? 'At least two published ALZ releases are needed to create a comparison.'
								: 'Choose two versions to understand what policies do, how they changed, and where the library assigns them.'}
					</p>
				</div>
			</section>
		{/if}

	</div>
</main>

<style>
	:global(*) { box-sizing: border-box; }
	:global(body) {
		margin: 0;
		background: #f4f7fb;
		color: #192639;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		font-size: 15px;
		line-height: 1.5;
		-webkit-font-smoothing: antialiased;
	}
	:global(button), :global(input), :global(select) { font: inherit; }
	:global(a) { color: inherit; }
	.app-shell { min-height: 100vh; }
	.skip-link { position: absolute; inset-block-start: 8px; inset-inline-start: 18px; z-index: 1; padding: 10px 14px; background: #fff; color: #175ba9; transform: translateY(-150%); }
	.skip-link:focus { transform: translateY(0); }
	.topbar {
		height: 64px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 max(28px, calc((100vw - 1180px) / 2));
		background: #fff;
		border-bottom: 1px solid #dce3ed;
	}
	.brand {
		display: inline-flex;
		flex: none;
		min-height: 44px;
		gap: 11px;
		align-items: center;
		color: #152338;
		font-size: 15px;
		font-weight: 700;
		text-decoration: none;
		letter-spacing: -0.02em;
	}
	.brand-mark {
		display: block;
		width: 28px;
		height: 28px;
	}
	.repository-link {
		display: inline-flex;
		min-height: 44px;
		align-items: center;
		gap: 8px;
		color: #52647b;
		font-size: 13px;
		text-decoration: none;
	}
	.repository-name { min-width: 0; }
	.repository-link:hover, .report-meta a:hover { color: #145bc0; }
	.content { max-width: 1180px; margin: 0 auto; padding: 48px max(28px, env(safe-area-inset-right)) max(32px, env(safe-area-inset-bottom)) max(28px, env(safe-area-inset-left)); }
	.intro {
		text-align: center;
		margin-bottom: 48px;
	}
	h1, h2, h3, h4, p { margin: 0; }
	h1 {
		color: #17263b;
		font-size: clamp(31px, 4vw, 42px);
		letter-spacing: -0.045em;
		line-height: 1.12;
		font-weight: 680;
	}
	.intro p { max-width: 620px; margin: 16px auto 0; color: #53657b; font-size: 16px; }
	.comparison-form {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 24px minmax(0, 1fr) auto;
		align-items: center;
		gap: 16px;
	}
	.release-field { display: flex; min-width: 0; align-items: center; gap: 12px; padding: 4px 12px; border: 1px solid #708198; border-radius: 5px; background: #fff; }
	.release-field:focus-within { border-color: #1768d2; }
	.release-field:has(select:disabled) { background: #f6f8fb; }
	.field-label {
		display: flex;
		align-items: center;
		color: #52647b;
		font-size: 13px;
		font-weight: 650;
		flex: none;
		white-space: nowrap;
	}
	select, .search-field {
		min-height: 44px;
		border: 1px solid #c5d0de;
		border-radius: 5px;
		background: #fff;
		color: #192c43;
	}
	.release-picker { position: relative; flex: 1; min-width: 0; }
	.release-picker svg { position: absolute; top: 50%; right: 0; width: 20px; height: 20px; transform: translateY(-50%); pointer-events: none; color: #175ba9; }
	.release-field select { appearance: none; width: 100%; padding: 0 28px 0 0; border: 0; border-radius: 0; font-size: 20px; font-weight: 650; letter-spacing: -0.02em; cursor: pointer; }
	.release-field select:disabled { font-size: 16px; letter-spacing: normal; }
	select:focus-visible, input:focus-visible, button:focus-visible, summary:focus-visible, a:focus-visible {
		outline: 3px solid #1768d2;
		outline-offset: 2px;
	}
	select:disabled { background: #f6f8fb; color: #66788f; cursor: wait; }
	.direction { display: flex; align-items: center; justify-content: center; color: #175ba9; }
	.direction svg { width: 24px; height: 24px; flex: none; }
	.comparison-form .compare-button { min-height: 52px; align-self: stretch; }
	.compare-button {
		display: inline-flex;
		min-height: 44px;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 0 17px;
		border: 1px solid #1459bc;
		border-radius: 5px;
		background: #1768d2;
		color: #fff;
		font-weight: 650;
		white-space: nowrap;
		cursor: pointer;
		transition: background 120ms ease, border-color 120ms ease;
	}
	.compare-button:hover:not(:disabled) { background: #0f56b2; border-color: #0f56b2; }
	.compare-button:active:not(:disabled) { background: #104a97; border-color: #104a97; }
	.compare-button:disabled { border-color: #b8c5d4; background: #c7d2df; color: #516175; cursor: not-allowed; }
	.compare-button svg { width: 18px; height: 18px; }
	.selection-hint { margin-top: 12px; color: #485b73; font-size: 14px; }
	.button-spinner {
		width: 15px;
		height: 15px;
		border: 2px solid rgb(255 255 255 / 45%);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 800ms linear infinite;
	}
	.notice {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		margin-top: 18px;
		padding: 15px 17px;
		border: 1px solid #cbd9eb;
		border-radius: 6px;
		background: #edf4fc;
		color: #314e6d;
		font-size: 13px;
	}
	.notice strong { display: block; color: #233d5d; }
	.progress-notice { align-items: center; }
	.progress-notice > div { display: grid; gap: 2px; }
	.progress-pulse { width: 10px; height: 10px; flex: none; border-radius: 50%; background: #2473d4; box-shadow: 0 0 0 4px #d8eafe; }
	.error-notice { flex-wrap: wrap; border-color: #e4c8c4; background: #fff4f2; color: #75413b; }
	.error-notice strong { color: #713a33; }
	.error-notice span { flex-basis: 100%; }
	.error-notice .text-button { margin-left: auto; }
	.report { margin-top: 48px; }
	.report-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 8px 24px;
	}
	.report-meta { color: #52647b; font-size: 12px; }
	.report-meta a { display: inline-flex; min-height: 44px; align-items: center; color: #315e91; text-decoration: none; }
	.coverage-warning { border-color: #dfc996; background: #fff8e8; color: #795515; }
	.coverage-warning strong { color: #795515; }
	.totals { display: flex; flex-wrap: wrap; gap: 14px; color: #596b80; font-size: 12px; white-space: nowrap; }
	.totals b { color: #263a52; font-size: 13px; }
	.added-count { color: #187348 !important; }
	.removed-count { color: #b44347 !important; }
	.changes-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		padding: 24px 0 13px;
	}
	.changes-heading > div:first-child { display: flex; align-items: baseline; gap: 11px; }
	.changes-heading h3 { color: #20344c; font-size: 18px; letter-spacing: -0.02em; }
	.changes-heading > div:first-child span { color: #52647b; font-size: 12px; }
	.change-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
	.search-field { display: flex; min-height: 44px; align-items: center; gap: 7px; padding: 0 9px; }
	.search-field svg { width: 16px; height: 16px; color: #708198; }
	.search-field input { width: 220px; min-width: 0; min-height: 44px; border: 0; background: transparent; color: #243950; font-size: 14px; }
	.search-field input::placeholder { color: #52647b; opacity: 1; }
	.search-field:focus-within { border-color: #3181dc; box-shadow: 0 0 0 2px #d8eaff; }
	.file-list { border-top: 1px solid #cbd5e1; }
	.file-change { border-bottom: 1px solid #d8e0e9; background: #fff; }
	.file-change summary {
		display: grid;
		grid-template-columns: 48px minmax(0, 1fr) 145px 20px;
		align-items: center;
		gap: 13px;
		min-height: 76px;
		padding: 14px 13px;
		list-style: none;
		cursor: pointer;
		transition: background 120ms ease;
	}
	.file-change summary::-webkit-details-marker { display: none; }
	.file-change summary:hover { background: #f8fafc; }
	.file-change[open] summary { background: #edf4fc; }
	.change-statuses { display: flex; align-items: center; gap: 6px; }
	.file-status {
		display: inline-flex;
		align-items: center;
		width: 20px;
		height: 20px;
		flex: none;
		justify-content: center;
		color: #175ba9;
	}
	.file-status svg { width: 20px; height: 20px; flex: none; }
	.status-added { color: #257048; }
	.status-removed { color: #a13c40; }
	.status-deprecated { color: #b45309; }
	.file-path { display: grid; min-width: 0; gap: 3px; }
	.file-path > strong { color: #234c7e; font-size: 16px; font-weight: 650; overflow-wrap: anywhere; }
	.file-meta { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
	.change-kind { display: inline-flex; width: fit-content; align-items: center; padding: 2px 6px; border: 1px solid #cbd5e1; border-radius: 3px; background: #f4f7fb; color: #192639; font-size: 12px; font-weight: 650; line-height: 1.3; }
	.file-path small { color: #52647b; font-size: 12px; overflow-wrap: anywhere; }
	.version-change { color: #314e6d; font-size: 12px; text-align: right; overflow-wrap: anywhere; }
	.version-updated { color: #192639; font-weight: 650; font-variant-numeric: tabular-nums; }
	.chevron { width: 17px; height: 17px; color: #7b8ba0; transition: transform 160ms cubic-bezier(.16, 1, .3, 1); }
	.file-change[open] .chevron { transform: rotate(180deg); }
	.file-detail { padding: 0 20px 22px 74px; background: #fff; }
	.change-outcome { padding-top: 16px; color: #192639; font-size: 15px; font-weight: 650; overflow-wrap: anywhere; }
	.delta-list { margin: 0; display: grid; gap: 12px; color: #314e6d; font-size: 13px; }
	.delta-list dt { font-weight: 650; margin-bottom: 4px; }
	.delta-list dd { margin: 0; display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 8px; overflow-wrap: anywhere; }
	.delta-label { color: #52647b; }
	.unchanged-context { margin-top: 8px; color: #52647b; font-size: 13px; }
	.assignment-evidence { margin-top: 14px; }
	.assignment-evidence > summary { min-height: 44px; width: fit-content; display: flex; align-items: center; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
	.change-summary { padding: 5px 0 13px; color: #4d6077; font-size: 13px; overflow-wrap: anywhere; }
	.detail-group { margin-top: 14px; }
	.detail-group h4 { margin-bottom: 8px; color: #314e6d; font-size: 13px; font-weight: 700; }
	.detail-group p { margin-top: 5px; color: #485b73; font-size: 13px; overflow-wrap: anywhere; }
	.fact-list { margin: 0; padding-left: 20px; color: #485b73; font-size: 13px; line-height: 1.65; }
	.fact-list li { margin-top: 5px; overflow-wrap: anywhere; }
	.assignment-row { padding: 12px 0; border-bottom: 1px solid #dce4ed; }
	.assignment-row strong { color: #314e6d; font-size: 13px; overflow-wrap: anywhere; }
	.review-notes { padding: 12px 0; }
	.source-links { display: flex; flex-wrap: wrap; gap: 4px 20px; margin-top: 18px; font-size: 14px; color: #175ba9; }
	.source-links a { display: inline-flex; align-items: center; min-height: 44px; max-width: 100%; overflow-wrap: anywhere; text-underline-offset: 3px; }
	.empty-filter { display: grid; justify-items: start; gap: 8px; padding: 26px 14px; border-bottom: 1px solid #d8e0e9; color: #53677e; font-size: 13px; }
	.text-button { min-height: 44px; padding: 0; border: 0; background: none; color: #175ba9; font-size: 14px; font-weight: 650; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
	.text-button:disabled { cursor: not-allowed; }
	.empty-report {
		display: flex;
		align-items: center;
		gap: 19px;
		min-height: 204px;
		margin-top: 38px;
		padding: 34px 38px;
		border-top: 1px solid #d2dce8;
		border-bottom: 1px solid #d2dce8;
		color: #527095;
	}
	.empty-mark { display: grid; width: 54px; height: 54px; flex: none; place-items: center; border: 1px solid #c9d8e9; border-radius: 50%; background: #eaf2fb; color: #3574b9; }
	.empty-mark svg { width: 34px; height: 34px; }
	.empty-report h2 { color: #293f58; font-size: 17px; letter-spacing: -0.02em; }
	.empty-report p { max-width: 620px; margin-top: 6px; color: #5e7188; font-size: 13px; }
	.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; clip-path: inset(50%); }
	@keyframes spin { to { transform: rotate(360deg); } }
	@media (prefers-reduced-motion: reduce) {
		.button-spinner { animation: none; }
		.compare-button, .chevron, .file-change summary { transition: none; }
	}
	@media (max-width: 900px) {
		.content { padding-top: 40px; }
		.intro { margin-bottom: 40px; }
		.comparison-form { grid-template-columns: minmax(0, 1fr) 28px minmax(0, 1fr); gap: 14px; }
		.compare-button { grid-column: 1 / -1; justify-self: end; }
		.comparison-form .compare-button { align-self: center; }
		.changes-heading { align-items: flex-start; flex-direction: column; }
		.file-change summary { grid-template-columns: 48px minmax(0, 1fr) 100px 20px; }
		.change-controls { width: 100%; }
		.search-field { flex: 1; }
		.search-field input { width: 100%; }
	}
	@media (max-width: 650px) {
		.topbar { min-height: 58px; height: auto; padding: env(safe-area-inset-top) max(18px, env(safe-area-inset-right)) 0 max(18px, env(safe-area-inset-left)); gap: 12px; }
		.repository-link { max-width: 48%; min-width: 0; font-size: 11px; }
		.repository-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.content { padding: 32px max(18px, env(safe-area-inset-right)) max(26px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left)); }
		.intro { margin-bottom: 32px; }
		h1 { font-size: 32px; }
		.intro p { margin-top: 12px; font-size: 16px; }
		.comparison-form { grid-template-columns: 1fr; gap: 8px; }
		.direction { height: 20px; }
		.direction svg { transform: rotate(90deg); }
		.compare-button { grid-column: auto; width: 100%; margin-top: 8px; }
		.report { margin-top: 36px; }
		.report-heading { align-items: flex-start; flex-direction: column; }
		.totals { gap: 13px; }
		.changes-heading { display: grid; grid-template-columns: minmax(0, 1fr); justify-content: stretch; align-items: start; gap: 12px; }
		.changes-heading > div:first-child { justify-content: space-between; }
		.change-controls { width: 100%; }
		.search-field input { width: 100%; }
		.search-field input { font-size: 16px; }
		.file-change summary { grid-template-columns: minmax(0, 1fr) auto 16px; gap: 10px 8px; padding: 16px 12px; }
		.change-statuses { grid-column: 1; grid-row: 1; }
		.file-path { grid-column: 1 / -1; grid-row: 2; gap: 6px; }
		.file-path > strong { font-size: 16px; }
		.file-path small { font-size: 14px; }
		.version-change { grid-column: 2; grid-row: 1; text-align: end; max-width: 120px; }
		.chevron { grid-column: 3; grid-row: 1; }
		.file-detail { padding: 0 12px 18px; }
		.change-summary, .detail-group p, .fact-list { font-size: 16px; }
		.detail-group h4, .assignment-row strong { font-size: 14px; }
		.empty-report { align-items: flex-start; min-height: auto; margin-top: 28px; padding: 25px 0; }
		.empty-mark { width: 44px; height: 44px; }
		.empty-mark svg { width: 28px; height: 28px; }
		.empty-report h2 { font-size: 17px; }
		.empty-report p { font-size: 16px; }
	}
	@media (hover: none) {
		.file-change summary:active { background: #edf4fc; }
	}
</style>
