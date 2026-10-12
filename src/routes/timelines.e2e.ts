import { expect, test } from '@playwright/test';
import { TIMELINE_SCHEMA_VERSION, type TimelineIndex, type TimelineReport, type TimelineSummary } from '../lib/timelines.js';

const upstream = 'https://github.com/Azure/Azure-Landing-Zones-Library';
const releases = ['2026.08.0', '2026.04.2', '2026.04.1'].map((version) => ({
	tag: `platform/alz/${version}`, version, url: `${upstream}/tree/platform/alz/${version}`
}));
const summary: TimelineSummary = {
	library: 'alz', kind: 'policy', name: 'Audit-Tags-Mandatory',
	title: 'Audit for mandatory tags on resources',
	description: 'Audits resources to ensure they have required tags based on tag array. Does not apply to resource groups.',
	firstRelease: releases[2].version, latestRelease: releases[0].version,
	presentInLatest: true, deprecated: false, releaseCount: 3, changeCount: 1, gapCount: 0,
	lastUpdatedRelease: releases[1].version
};
const policyChange = {
	id: 'policy:Audit-Tags-Mandatory', kind: 'policy' as const, title: summary.title,
	status: 'modified' as const, summary: 'Version 1.0.0 to 1.0.1.',
	beforeVersion: '1.0.0', afterVersion: '1.0.1',
	facts: ['Version changed from 1.0.0 to 1.0.1.', 'Policy mode changed from All to Indexed.'],
	warnings: ['Scopes describe library assignments, not deployed resources.'],
	assignmentsBefore: [], assignmentsAfter: [],
	sources: [{ label: 'New definition', url: `${upstream}/blob/b263f4b6ce380915dc88b78532cfc63e43a4e3c9/platform/alz/policy_definitions/Audit-Tags-Mandatory.alz_policy_definition.json` }]
};
const index: TimelineIndex = {
	schemaVersion: TIMELINE_SCHEMA_VERSION, generationId: '11111111-1111-4111-8111-111111111111',
	generatedAt: '2026-10-12T12:00:00.000Z', syncedAt: '2026-10-12T11:00:00.000Z',
	gaps: [],
	reports: [
		summary,
		{ ...summary, library: 'slz', title: 'Sovereign tags' },
		{ ...summary, kind: 'initiative', name: 'Network', title: 'Network policy set', presentInLatest: false,
			deprecatedRelease: releases[2].version, removedRelease: releases[1].version },
		{ ...summary, kind: 'archetype', name: 'corp', title: 'corp', changeCount: 0, firstReleaseStatus: 'added', deprecated: true,
			deprecatedRelease: releases[1].version }
	]
};
const timeline: TimelineReport = {
	...summary, schemaVersion: index.schemaVersion, generationId: index.generationId,
	generatedAt: index.generatedAt, syncedAt: index.syncedAt,
	entries: [
		{ release: releases[0], status: 'modified', version: '1.0.1', changeType: 'definition', change: policyChange },
		{ release: releases[1], status: 'unchanged', version: '1.0.0', source: releases[1].url },
		{ release: releases[2], status: 'first-observed', version: '1.0.0', source: releases[2].url }
	]
};
const comparison = {
	schemaVersion: 6, scope: 'platform/alz/', complete: true,
	generatedAt: index.generatedAt,
	from: { ...releases[1], sha: 'a'.repeat(40) }, to: { ...releases[0], sha: 'b'.repeat(40) },
	totals: { changed: 3, added: 0, modified: 3, removed: 0 }, summary: 'Three changes.',
	coverage: { sourceFilesChanged: 3, explanation: 'Full ALZ release context analyzed.' },
	changes: [
		policyChange,
		{ ...policyChange, id: 'initiative:Network', kind: 'initiative', title: 'Network policy set' },
		{ ...policyChange, id: 'archetype:corp', kind: 'archetype', title: 'corp' }
	]
};

test('shares the same icon-only repository link and navigation across all pages', async ({ page }, testInfo) => {
	await page.route('**/api/releases', (route) => route.fulfill({ json: { releases } }));
	await page.route('**/api/timelines', (route) => route.fulfill({ json: index }));
	await page.route('**/api/timelines/alz/policy/Audit-Tags-Mandatory', (route) => route.fulfill({ json: timeline }));
	let headerHeight: number | undefined;
	for (const url of ['/', '/timelines', '/timelines/alz/policy/Audit-Tags-Mandatory']) {
		await page.goto(url);
		const header = page.locator('.topbar');
		await expect(header).toHaveCount(1);
		const nav = header.getByRole('navigation', { name: 'Main navigation' });
		await expect(nav.getByRole('link', { name: 'Compare releases', exact: true })).toHaveAttribute('href', '/');
		await expect(nav.getByRole('link', { name: 'Timelines', exact: true })).toHaveAttribute('href', '/timelines');
		await expect(nav.locator('[aria-current="page"]')).toHaveText(url === '/' ? 'Compare releases' : 'Timelines');
		await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
		await expect(nav.locator('.nav-divider')).toBeVisible();
		await expect(nav.locator('.nav-divider')).toHaveAttribute('aria-hidden', 'true');
		const repository = header.getByRole('link', { name: 'View source repository on GitHub (opens in a new tab)' });
		await expect(repository).toHaveAttribute('href', 'https://github.com/sjovang/landingzones-diff-reports-for-humans');
		await expect(repository).toHaveAttribute('target', '_blank');
		await expect(repository).toHaveText('');
		await expect(repository.locator('svg')).toBeVisible();
		await repository.focus();
		await expect(repository).toBeFocused();
		const bounds = await repository.boundingBox();
		expect(bounds!.width).toBeGreaterThanOrEqual(44);
		expect(bounds!.height).toBeGreaterThanOrEqual(44);
		const height = (await header.boundingBox())!.height;
		if (headerHeight !== undefined) expect(height).toBe(headerHeight);
		headerHeight = height;
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		if (url !== '/timelines/alz/policy/Audit-Tags-Mandatory') {
			await header.screenshot({ path: testInfo.outputPath(url === '/' ? 'comparison-header.png' : 'timelines-header.png') });
		}
	}
});

test('searches all object types and preserves filter URLs before opening a stable complete timeline', async ({ page }, testInfo) => {
	let generations = 0;
	await page.route('**/api/timelines/generate', (route) => { generations++; return route.fulfill({ status: 500 }); });
	await page.route('**/api/timelines', (route) => route.fulfill({ json: index }));
	await page.route('**/api/timelines/alz/policy/Audit-Tags-Mandatory', (route) => route.fulfill({ json: timeline }));
	await page.goto('/timelines');
	await expect(page.getByRole('heading', { name: 'Definition and archetype timelines' })).toBeVisible();
	await expect(page.locator('.object-list > li')).toHaveCount(4);
	await expect(page.locator('.object-list > li').first().locator('.object-title > span')).toHaveText(summary.description!);
	await expect(page.locator('.object-list > li').first().locator('.object-title')).not.toContainText(summary.name);
	await expect(page.locator('.object-list > li').first().getByText(`First observed: ${summary.firstRelease}`, { exact: true })).toBeVisible();
	await expect(page.locator('.object-list > li').first().getByText(`Last updated: ${summary.lastUpdatedRelease}`, { exact: true })).toBeVisible();
	const removedRow = page.locator('.object-list > li').filter({ hasText: 'Network policy set' });
	await expect(removedRow.getByText(`Removed: ${releases[1].version}`, { exact: true })).toBeVisible();
	await expect(removedRow.getByText(`Deprecated: ${releases[2].version}`, { exact: true })).toBeVisible();
	await expect(removedRow.getByText(/Last updated:/)).toHaveCount(0);
	await expect(removedRow.getByText('Not in latest release', { exact: true })).toBeVisible();
	await expect(removedRow.locator('.object-meta > span').first()).toHaveText('Not in latest release');
	const deprecatedRow = page.locator('.object-list > li').filter({ has: page.locator('.object-title strong', { hasText: /^corp$/ }) });
	await expect(deprecatedRow.locator('.object-meta > span').first()).toHaveText('Deprecated');
	await expect(deprecatedRow.getByText(`Deprecated: ${releases[1].version}`, { exact: true })).toBeVisible();
	await expect(deprecatedRow.getByText(`First introduced: ${summary.firstRelease}`, { exact: true })).toBeVisible();
	await expect(page.locator('.object-list')).not.toContainText('Latest release:');
	await expect(page.locator('.object-list')).not.toContainText('History through:');
	await expect(page.locator('.object-list')).not.toContainText('1 change');
	await expect(page.getByText('Not in latest release')).toBeVisible();
	await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('archetype');
	await expect(page.locator('.object-list > li')).toHaveCount(1);
	await expect(page.getByRole('link', { name: /corp.*View timeline/ })).toHaveAttribute('href', '/timelines/alz/archetype/corp');
	await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('');
	await page.getByRole('combobox', { name: 'Library', exact: true }).selectOption('alz');
	await page.getByLabel('Find a definition or archetype').fill('mandatory');
	await expect(page.locator('.object-list > li')).toHaveCount(1);
	expect(new URL(page.url()).searchParams.get('q')).toBe('mandatory');
	expect(new URL(page.url()).searchParams.get('library')).toBe('alz');
	await page.reload();
	await expect(page.getByLabel('Find a definition or archetype')).toHaveValue('mandatory');
	await expect(page.locator('.object-list > li')).toHaveCount(1);
	await page.screenshot({ path: testInfo.outputPath('overview.png'), fullPage: true });
	await page.getByRole('link', { name: /Audit for mandatory tags.*View timeline/ }).click();
	await expect(page).toHaveURL(/\/timelines\/alz\/policy\/Audit-Tags-Mandatory$/);
	await expect(page.getByRole('heading', { name: summary.title, exact: true })).toBeVisible();
	await expect(page.locator('.timeline-list > li')).toHaveCount(2);
	await expect(page.locator('.release-label a')).toHaveText([releases[0], releases[2]].map((release) => `${release.version} ↗`));
	await expect(page.getByRole('heading', { name: 'Unchanged', exact: true })).toHaveCount(0);
	await expect(page.getByText('unchanged and not-present releases omitted', { exact: false })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'First observed' })).toBeVisible();
	await expect(page.getByText(/no earlier release is available/)).toBeVisible();
	await page.locator('.event-details > summary').click();
	await expect(page.getByText('Policy mode changed from All to Indexed.')).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath('timeline.png'), fullPage: true });
	await page.reload();
	await expect(page.locator('.timeline-list > li')).toHaveCount(2);
	expect(generations).toBe(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('links policy, policy set, and archetype details to pages instead of embedding or generating timelines', async ({ page }) => {
	let timelineReads = 0;
	let comparisons = 0;
	await page.route('**/api/releases', (route) => route.fulfill({ json: { releases } }));
	await page.route('**/api/comparisons', (route) => {
		comparisons++;
		return route.fulfill({ json: { status: 'completed', report: comparison } });
	});

	await page.route('**/api/timelines/alz/policy/Audit-Tags-Mandatory', (route) => {
		timelineReads++;
		return route.fulfill({ json: timeline });
	});
	await page.goto('/');
	await expect(page.getByRole('link', { name: 'Timelines', exact: true })).toHaveAttribute('href', '/timelines');
	await page.getByRole('button', { name: 'Compare releases' }).click();
	for (const [position, href] of [
		[0, '/timelines/alz/policy/Audit-Tags-Mandatory'],
		[1, '/timelines/alz/initiative/Network'],
		[2, '/timelines/alz/archetype/corp']
	] as const) {
		const row = page.locator('.file-change').nth(position);
		await row.locator(':scope > summary').click();
		await expect(row.getByRole('link', { name: 'Show timeline' })).toHaveAttribute('href', href);
	}
	expect(timelineReads).toBe(0);
	await expect(page.locator('.timeline-list')).toHaveCount(0);
	await page.locator('.file-change').first().getByRole('link', { name: 'Show timeline' }).click();
	await expect(page.getByRole('heading', { name: 'Release history' })).toBeVisible();
	expect(timelineReads).toBe(1);
	expect(comparisons).toBe(1);
});

test('keeps the baseline for never-modified objects while hiding unchanged releases including the newest', async ({ page }) => {
	await page.route('**/api/timelines/alz/policy/Audit-Tags-Mandatory', (route) => route.fulfill({ json: {
		...timeline, changeCount: 0,
		entries: [
			{ release: releases[0], status: 'unchanged', version: '1.0.0', source: policyChange.sources[0].url },
			{ release: releases[1], status: 'unchanged', version: '1.0.0' },
			timeline.entries[2]
		]
	} }));
	await page.goto('/timelines/alz/policy/Audit-Tags-Mandatory');
	await expect(page.locator('.timeline-list > li')).toHaveCount(1);
	await expect(page.getByRole('heading', { name: 'First observed', exact: true })).toBeVisible();
	await expect(page.locator('.release-label a')).toHaveText([`${releases[2].version} ↗`]);
	await expect(page.getByText('3 releases · 0 changes', { exact: true })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Unchanged', exact: true })).toHaveCount(0);
	const currentSource = page.getByRole('link', { name: 'View current file on GitHub (opens in a new tab)' });
	await expect(currentSource).toHaveAttribute('href', policyChange.sources[0].url);
	await expect(currentSource).toHaveAttribute('target', '_blank');
	await expect(currentSource).toHaveAttribute('rel', 'noreferrer');
	const sourceRow = currentSource.locator('xpath=ancestor::tr');
	const nameRow = page.getByRole('row', { name: `Name ${summary.name}`, exact: true });
	const typeRow = page.getByRole('row', { name: 'Type Policy definition', exact: true });
	const typeHeight = (await typeRow.boundingBox())!.height;
	if ((await nameRow.boundingBox())!.height === typeHeight) {
		expect((await sourceRow.boundingBox())!.height).toBe(typeHeight);
	}
	await currentSource.focus();
	await expect(currentSource).toBeFocused();
	await expect(page.locator('.lifecycle th')).toHaveText(['First observed']);
	await expect(page.locator('.lifecycle td')).toHaveText([releases[2].version]);
	const metadata = page.getByRole('table', { name: 'Object metadata' });
	await expect(metadata.getByRole('row', { name: 'Library ALZ', exact: true })).toBeVisible();
	await expect(metadata.getByRole('row', { name: 'Type Policy definition', exact: true })).toBeVisible();
	await expect(metadata.getByRole('row', { name: `Name ${summary.name}`, exact: true })).toBeVisible();
	expect((await metadata.getByRole('rowheader', { name: 'Library', exact: true }).boundingBox())!.width).toBeLessThanOrEqual(140);
});

test('lists introduction, deprecation and removal milestones in the object header', async ({ page }, testInfo) => {
	await page.route('**/api/timelines/alz/policy/Audit-Tags-Mandatory', (route) => route.fulfill({ json: {
		...timeline, presentInLatest: false,
		entries: [
			{ release: releases[0], status: 'removed' },
			{ release: releases[1], status: 'modified', deprecated: true },
			{ release: releases[2], status: 'added' }
		]
	} }));
	await page.goto('/timelines/alz/policy/Audit-Tags-Mandatory');
	await expect(page.locator('.lifecycle th')).toHaveText(['First introduced', 'Deprecated', 'Removed']);
	await expect(page.locator('.lifecycle td')).toHaveText([releases[2].version, releases[1].version, releases[0].version]);
	await expect(page.getByRole('table', { name: 'Object metadata' })).not.toContainText(`${releases[2].version} to ${releases[0].version}`);
	await page.screenshot({ path: testInfo.outputPath('lifecycle.png'), fullPage: true });
});

test('does not link a removed object to a current source file', async ({ page }) => {
	await page.route('**/api/timelines/alz/policy/Audit-Tags-Mandatory', (route) => route.fulfill({ json: {
		...timeline, presentInLatest: false,
		entries: [
			{ release: releases[0], status: 'absent' },
			{ release: releases[1], status: 'removed' },
			timeline.entries[2]
		]
	} }));
	await page.goto('/timelines/alz/policy/Audit-Tags-Mandatory');
	await expect(page.getByText('Not in latest release', { exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'View current file on GitHub (opens in a new tab)' })).toHaveCount(0);
	await expect(page.locator('.lifecycle th')).toHaveText(['First observed', 'Removed']);
	await expect(page.locator('.timeline-list > li')).toHaveCount(2);
	await expect(page.locator('.timeline-list > li').first().getByRole('heading', { name: 'Removed', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Not present', exact: true })).toHaveCount(0);
});

test('renders HTTP links in descriptions safely and wraps long URLs', async ({ page }) => {
	const url = 'https://www.azadvertizer.net/azpolicyadvertizer/438c38d2-3772-465a-a9cc-7a6666a275ce.html';
	await page.route('**/api/timelines/alz/policy/Audit-Tags-Mandatory', (route) => route.fulfill({ json: {
		...timeline, description: `Superseded by ${url}. <script>alert(1)</script>`
	} }));
	await page.goto('/timelines/alz/policy/Audit-Tags-Mandatory');
	const link = page.locator('.description').getByRole('link');
	await expect(link).toHaveAttribute('href', url);
	await expect(link).toHaveAttribute('target', '_blank');
	await expect(link).toHaveAttribute('rel', 'noreferrer');
	await expect(page.locator('.description')).toContainText('<script>alert(1)</script>');
	await expect(page.locator('.description script')).toHaveCount(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('shows missing cache as gaps and unknown state rather than absence or invented changes', async ({ page }, testInfo) => {
	const partial: TimelineReport = {
		...timeline, firstRelease: releases[1].version, presentInLatest: null, gapCount: 2, changeCount: 0,
		entries: [
			{ release: releases[0], status: 'gap', gapReason: 'Missing cached snapshot for platform/alz/2026.08.0.' },
			{ release: releases[1], status: 'first-observed', version: '1.0.0', source: releases[1].url },
			{ release: releases[2], status: 'gap', gapReason: 'Missing cached pinned ALZ snapshot.' }
		]
	};
	const partialIndex: TimelineIndex = {
		...index, reports: [{ ...summary, firstRelease: releases[1].version, presentInLatest: null, gapCount: 2, changeCount: 0 }],
		gaps: [
			{ library: 'alz', release: releases[0], reason: partial.entries[0].gapReason! },
			{ library: 'alz', release: releases[2], reason: partial.entries[2].gapReason! }
		]
	};
	await page.route('**/api/timelines', (route) => route.fulfill({ json: partialIndex }));
	await page.route('**/api/timelines/alz/policy/Audit-Tags-Mandatory', (route) => route.fulfill({ json: partial }));
	await page.goto('/timelines');
	await expect(page.getByText('Latest state unknown', { exact: true })).toBeVisible();
	await expect(page.getByText('Not in latest release')).toHaveCount(0);
	await page.locator('.coverage-note > summary').click();
	await expect(page.getByText(/Objects that exist only in missing releases cannot be listed/)).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath('coverage-overview.png'), fullPage: true });
	await page.getByRole('link', { name: /Audit for mandatory tags.*View timeline/ }).click();
	await expect(page.getByText('Latest state unknown', { exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Coverage gap', exact: true })).toHaveCount(2);
	await expect(page.getByRole('link', { name: 'View current file on GitHub (opens in a new tab)' })).toHaveCount(0);
	await expect(page.getByText(/releases across a gap are not compared/)).toBeVisible();
	await expect(page.getByRole('heading', { name: 'First observed', exact: true })).toBeVisible();
	await expect(page.locator('.lifecycle th')).toHaveText(['First observed']);
	await expect(page.locator('.event-details')).toHaveCount(0);
	await page.screenshot({ path: testInfo.outputPath('coverage-timeline.png'), fullPage: true });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await page.route('**/api/timelines', (route) => route.fulfill({ json: { ...partialIndex, reports: [] } }));
	await page.goto('/timelines');
	await expect(page.getByText(/No objects were found in the available snapshots/)).toBeVisible();
	await expect(page.locator('.coverage-note > summary')).toBeVisible();
});

test('shows ungenerated, missing, and retry states without generating reports', async ({ page }) => {
	let reads = 0;
	await page.route('**/api/timelines', (route) => route.fulfill({ status: 503, json: {
		error: 'Timelines have not been generated yet. Run npm run timelines:generate.'
	} }));
	await page.goto('/timelines');
	await expect(page.getByRole('alert')).toContainText('npm run timelines:generate');
	await page.route('**/api/timelines/alz/policy/Audit-Tags-Mandatory', (route) => {
		reads++;
		return route.fulfill(reads === 1 ? { status: 404, json: { error: 'This object has no published timeline.' } } : { json: timeline });
	});
	await page.goto('/timelines/alz/policy/Audit-Tags-Mandatory');
	await expect(page.getByRole('alert')).toContainText('no published timeline');
	await page.getByRole('button', { name: 'Retry loading timeline', exact: true }).click();
	await expect(page.getByRole('heading', { name: summary.title, exact: true })).toBeVisible();
	await page.goto('/timelines/amba/policy/Tags');
	await expect(page.getByRole('alert')).toContainText('Invalid timeline URL');
});
