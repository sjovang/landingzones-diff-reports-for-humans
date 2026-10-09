import { expect, test } from '@playwright/test';

const releases = [
	{ tag: 'platform/alz/2026.10.0', version: '2026.10.0', url: 'https://github.com/Azure/Azure-Landing-Zones-Library/tree/platform/alz/2026.10.0' },
	{ tag: 'platform/alz/2025.10.0', version: '2025.10.0', url: 'https://github.com/Azure/Azure-Landing-Zones-Library/tree/platform/alz/2025.10.0' }
];
const slzReleases = [
	...releases.map((release) => ({ ...release, tag: release.tag.replace('/alz/', '/slz/') })),
	{ tag: 'platform/slz/2024.10.0', version: '2024.10.0', url: 'https://github.com/Azure/Azure-Landing-Zones-Library/tree/platform/slz/2024.10.0' }
];

const report = {
	schemaVersion: 6,
	scope: 'platform/alz/',
	complete: true,
	generatedAt: '2026-01-12T14:00:00.000Z',
	from: { ...releases[1], sha: 'b'.repeat(40) },
	to: { ...releases[0], sha: 'a'.repeat(40) },
	totals: { changed: 1, added: 0, modified: 1, removed: 0 },
	summary: '1 policy definition changed.',
	coverage: { sourceFilesChanged: 1, explanation: 'Full ALZ release context analyzed.' },
	changes: [
		{
			id: 'policy:Require-Nsg', kind: 'policy',
			title: 'Subnets should have a Network Security Group',
			description: 'Checks that subnets have a Network Security Group.',
			status: 'modified',
			summary: 'Version 1.1.0 to 1.2.0.',
			beforeVersion: '1.1.0', afterVersion: '1.2.0',
			facts: ['Version changed from 1.1.0 to 1.2.0.', 'Effect default changed from Audit to Deny.'],
			warnings: ['Scopes describe library configuration, not a deployed environment.'],
			assignmentsBefore: [],
			assignmentsAfter: [{ assignmentId: 'Require-Nsg', name: 'Require NSG', definition: 'Require-Nsg, version 1.2.0', definitionId: 'Require-Nsg', definitionTitle: 'Require NSG', definitionVersion: '1.2.0', scopes: ['Corp (corp), architecture: alz'],
				parameters: [], notes: [], sources: [],
				effect: 'Deny — blocks matching non-compliant requests', enforcement: 'Default — normal policy enforcement' }],
			sources: [{ label: 'View source changes on GitHub', url: 'https://github.com/Azure/Azure-Landing-Zones-Library/compare/old...new' }]
		}
	]
};

test('explains policy versions, effects, and scopes with source links instead of raw diffs', async ({ page }) => {
	await page.route('**/api/releases', (route) =>
		route.fulfill({ status: 200, json: { releases, syncedAt: '2026-10-07T12:00:00.000Z' } })
	);
	await page.route('**/api/comparisons', (route) =>
		route.fulfill({
			status: 202,
			json: {
				jobId: 'test-job',
				cacheKey: 'test-cache-key',
				status: 'queued',
				fromTag: releases[1].tag,
				toTag: releases[0].tag
			}
		})
	);
	await page.route('**/api/comparisons/test-job', (route) =>
		route.fulfill({
			status: 200,
			json: {
				jobId: 'test-job',
				cacheKey: 'test-cache-key',
				status: 'completed',
				fromTag: releases[1].tag,
				toTag: releases[0].tag,
				report
			}
		})
	);

	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'ALZ release changes, explained' })).toBeVisible();
	await expect(page).toHaveTitle('ALZ | Landing Zone Release Brief');
	await expect(page.getByRole('link', { name: 'Landing Zone Release Brief home' })).toBeVisible();
	await expect.poll(() => page.locator('.brand-mark').evaluate((image) =>
		image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true);
	const upstreamLink = page.getByRole('link', { name: 'Azure Landing Zones Library', exact: true });
	await expect(upstreamLink).toHaveAttribute('href', 'https://github.com/Azure/azure-landing-zones-library');
	await expect(upstreamLink).toHaveAttribute('target', '_blank');
	await expect(page.getByLabel(/FROM Release/)).toHaveValue(releases[1].tag);
	await expect(page.locator('footer')).toHaveCount(0);
	await expect(page.locator('.scope-note')).toHaveCount(0);
	await expect(page.locator('.repository-link')).toHaveAttribute('href', 'https://github.com/sjovang/alzlib-diff-for-humans');
	await expect(page.locator('.repository-name')).toHaveText('sjovang / alzlib-diff-for-humans');
	await awaitCompareButton(page);
	await expect(page.locator('.intro')).toHaveCSS('text-align', 'center');
	const introSpacing = await page.evaluate(() => {
		const intro = document.querySelector('.intro')!.getBoundingClientRect();
		const navigation = document.querySelector('.topbar')!.getBoundingClientRect();
		const pickers = document.querySelector('.comparison-controls')!.getBoundingClientRect();
		return { above: intro.top - navigation.bottom, below: pickers.top - intro.bottom };
	});
	expect(introSpacing.above).toBe(introSpacing.below);
	for (const field of await page.locator('.release-field').all()) {
		expect((await field.boundingBox())!.height).toBeLessThanOrEqual(54);
		await expect(field.locator('select')).toHaveCSS('min-height', '44px');
	}
	if (page.viewportSize()!.width > 900) {
		const heights = await page.locator('.comparison-form').evaluate((form) =>
			[...form.querySelectorAll('.release-field, .compare-button')].map((element) => element.getBoundingClientRect().height));
		expect(heights).toHaveLength(3);
		expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
	}

	await page.getByRole('button', { name: /Compare releases/ }).click();
	await expect(page.getByRole('heading', { name: '2025.10.0 to 2026.10.0' })).toBeVisible();
	const reportGap = await page.evaluate(() => {
		const pickerBottom = document.querySelector('.comparison-form')!.getBoundingClientRect().bottom;
		const reportTop = document.querySelector('.report')!.getBoundingClientRect().top;
		return reportTop - pickerBottom;
	});
	expect(reportGap).toBe(24);
	await expect(page.locator('#report-title')).toHaveClass(/\bsr-only\b/);
	await expect(page.locator('.coverage-warning')).toHaveCount(0);
	await expect(page.locator('.summary-copy, .report-context')).toHaveCount(0);
	await expect(page.getByLabel('Library change totals')).toBeVisible();
	await expect(page.locator('.summary-strip')).toHaveCount(0);
	await expect(page.locator('.report-heading .totals')).toHaveCount(1);
	await expect(page.locator('.changes-heading [aria-live]')).toHaveCount(0);
	await expect(page.locator('.report-meta a')).toHaveCount(0);
	await expect(page.locator('.report-heading time')).toHaveAttribute('datetime', report.generatedAt);
	await expect(page.locator('.report-meta')).toHaveText(/^Generated /);
	await expect(page.locator('.changes-heading')).toHaveCSS('padding-top', '36px');
	await expect(page.locator('.report-heading')).toHaveCSS('border-top-width', '0px');
	await expect(page.locator('.report-heading')).toHaveCSS('border-bottom-width', '0px');
	await expect(page.locator('footer')).toHaveCount(0);

	const fileSummary = page.locator('summary').filter({ hasText: report.changes[0].title });
	await expect(fileSummary.locator('.version-change')).toHaveClass(/version-updated/);
	await expect(fileSummary.locator('.file-path > strong')).toHaveCSS('font-size', '16px');
	await expect(fileSummary.locator('.file-status svg')).toHaveCount(1);
	await fileSummary.click();
	await expect(page.getByText('Change explained')).toBeVisible();
	await expect(page.getByText('Version changed from 1.1.0 to 1.2.0.')).toBeVisible();
	await expect(page.getByText('Corp (corp), architecture: alz')).toBeVisible();
	await expect(page.getByText('Deny — blocks matching non-compliant requests')).toBeVisible();
	await expect(page.getByRole('link', { name: 'View source changes on GitHub' })).toHaveAttribute('href', /github.com/);
	await expect(page.locator('pre')).toHaveCount(0);
	await page.getByLabel('Search library changes').fill('no match');
	await expect(page.getByText('No library changes match these filters.')).toBeVisible();
	await page.getByRole('button', { name: 'Clear filters' }).click();
	await expect(page.locator('.change-controls input')).toHaveCount(1);
	await expect(page.locator('.change-controls select')).toHaveCount(2);
	await expect(fileSummary).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('explains missing source coverage without showing a routine success badge', async ({ page }) => {
	await page.route('**/api/releases', (route) => route.fulfill({ json: { releases } }));
	await page.route('**/api/comparisons', (route) => route.fulfill({ json: {
		status: 'completed',
		report: { ...report, complete: false, coverage: { sourceFilesChanged: 1, explanation: 'Assignment source files were unavailable.' } }
	} }));
	await page.goto('/');
	await page.getByRole('button', { name: 'Compare releases' }).click();
	await expect(page.locator('.coverage-warning')).toContainText('Some release source information is missing.');
	await expect(page.locator('.coverage-warning')).toContainText('Assignment source files were unavailable.');
});

test('restores a non-default comparison and its report after refresh', async ({ page }) => {
	const older = { ...releases[1], tag: 'platform/alz/2024.10.0', version: '2024.10.0' };
	const savedReport = { ...report, from: { ...older, sha: 'c'.repeat(40) } };
	let submissions = 0;
	await page.route('**/api/releases', (route) => route.fulfill({ json: { releases: [...releases, older] } }));
	await page.route('**/api/comparisons', (route) => {
		expect(route.request().postDataJSON()).toEqual({ fromTag: older.tag, toTag: releases[0].tag });
		submissions++;
		return route.fulfill(submissions === 1
			? { json: { status: 'completed', report: savedReport } }
			: { json: { status: 'running', jobId: 'restored-job' } });
	});
	await page.route('**/api/comparisons/restored-job', (route) =>
		route.fulfill({ json: { status: 'completed', report: savedReport } }));
	await page.goto('/');
	await awaitCompareButton(page);
	await expect(page.getByLabel(/FROM Release/)).toHaveAccessibleDescription(releases[1].tag);
	await page.getByLabel(/FROM Release/).selectOption(older.tag);
	await page.getByRole('button', { name: 'Compare releases' }).click();
	await expect(page.getByRole('heading', { name: '2024.10.0 to 2026.10.0' })).toBeVisible();
	const url = new URL(page.url());
	expect(url.searchParams.get('from')).toBe(older.tag);
	expect(url.searchParams.get('to')).toBe(releases[0].tag);
	await page.reload();
	await expect(page.getByRole('heading', { name: '2024.10.0 to 2026.10.0' })).toBeVisible();
	await expect(page.getByLabel(/FROM Release/)).toHaveValue(older.tag);
	await expect(page.getByLabel(/TO Release/)).toHaveValue(releases[0].tag);
	await expect(page.getByText(savedReport.changes[0].title, { exact: true })).toBeVisible();
	expect(submissions).toBe(2);
});

test('reports invalid comparison links instead of silently comparing default releases', async ({ page }) => {
	let submissions = 0;
	await page.route('**/api/releases', (route) => route.fulfill({ json: { releases } }));
	await page.route('**/api/comparisons', (route) => {
		submissions++;
		return route.fulfill({ json: { status: 'completed', report } });
	});
	for (const params of [
		new URLSearchParams({ from: 'missing', to: releases[0].tag }),
		new URLSearchParams({ from: releases[0].tag, to: releases[0].tag }),
		new URLSearchParams({ from: releases[1].tag })
	]) {
		await page.goto(`/?${params}`);
		await expect(page.getByRole('alert')).toContainText('comparison link needs two different available ALZ releases');
		await awaitCompareButton(page);
	}
	expect(submissions).toBe(0);
	await page.getByRole('button', { name: 'Retry comparison' }).click();
	await expect(page.getByRole('heading', { name: '2025.10.0 to 2026.10.0' })).toBeVisible();
});

test('shows an initiative replacement separately from unchanged policy settings', async ({ page }) => {
	const assignment = report.changes[0].assignmentsAfter[0];
	const before = { ...assignment, definition: 'Network guardrails (Network_20250326, version 2.0.0)', definitionId: 'Network_20250326', definitionVersion: '2.0.0' };
	const after = { ...before, definition: 'Network guardrails (Network_20260714, version 2.1.0)', definitionId: 'Network_20260714', definitionVersion: '2.1.0' };
	const summary = 'Assignment now references Network guardrails, version 2.1.0. Policy rules and assignment settings are unchanged.';
	await page.route('**/api/releases', (route) => route.fulfill({ json: { releases } }));
	await page.route('**/api/comparisons', (route) => route.fulfill({ json: {
		status: 'completed', report: { ...report, changes: [{
			...report.changes[0], summary, beforeVersion: '1.1.0', afterVersion: '1.1.0',
			assignmentsBefore: [before], assignmentsAfter: [after],
			facts: ['The policy evaluation rule is unchanged.']
		}] }
	} }));
	await page.goto('/');
	await page.getByRole('button', { name: /Compare releases/ }).click();
	await page.locator('.file-change summary').click();
	await expect(page.locator('.change-outcome')).toHaveText(summary);
	await expect(page.locator('.assignment-delta dt')).toHaveText('Referenced definition');
	await expect(page.locator('.assignment-delta dd').nth(0)).toContainText('Network_20250326, version 2.0.0');
	await expect(page.locator('.assignment-delta dd').nth(1)).toContainText('Network_20260714, version 2.1.0');
	await expect(page.locator('.unchanged-context')).toHaveText('Assignment settings are unchanged.');
	await expect(page.locator('.change-summary')).toHaveCount(0);
	await expect(page.locator('.assignment-context').first()).toBeHidden();
	await expect(page.locator('.review-notes')).toBeHidden();
	await page.getByText('Show full assignment context').click();
	await expect(page.locator('.assignment-context')).toHaveCount(2);
	await expect(page.locator('.assignment-context').first()).toBeVisible();
	await expect(page.locator('.review-notes')).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('distinguishes added, updated, removed, and deprecated items with accessible icon-only statuses', async ({ page }) => {
	const changes = [
		{ ...report.changes[0], id: 'new', title: 'New policy', status: 'added', beforeVersion: undefined },
		{ ...report.changes[0], id: 'updated', title: 'Updated initiative', kind: 'initiative', status: 'modified' },
		{ ...report.changes[0], id: 'removed', title: 'Removed archetype', kind: 'archetype', status: 'removed' },
		{ ...report.changes[0], id: 'deprecated', title: 'Deprecated assignment', kind: 'assignment', status: 'modified', deprecated: true },
		{ ...report.changes[0], id: 'deprecation-only', title: 'Deprecation-only architecture', kind: 'architecture', status: 'modified',
			deprecated: true, deprecationOnly: true, beforeVersion: '1.1.0', afterVersion: '1.1.0-deprecated' }
	];
	await page.route('**/api/releases', (route) => route.fulfill({ status: 200, json: { releases } }));
	await page.route('**/api/comparisons', (route) => route.fulfill({
		status: 200, json: { status: 'completed', report: { ...report, changes, totals: { changed: 4, added: 1, modified: 2, removed: 1 } } }
	}));
	await page.goto('/');
	await page.getByRole('button', { name: /Compare releases/ }).click();
	await expect(page.locator('.file-path > strong')).toHaveText([
		'New policy', 'Removed archetype', 'Deprecated assignment', 'Deprecation-only architecture', 'Updated initiative'
	]);
	await expect(page.locator('.change-kind')).toHaveText([
		'Policy definition', 'Archetype definition', 'Policy assignment', 'Architecture definition', 'Policy initiative'
	]);
	for (const [title, label, color] of [
		['New policy', 'Added', 'rgb(37, 112, 72)'],
		['Updated initiative', 'Updated', 'rgb(23, 91, 169)'],
		['Removed archetype', 'Removed', 'rgb(161, 60, 64)'],
		['Deprecated assignment', 'Deprecated', 'rgb(180, 83, 9)']
	]) {
		const summary = page.locator('summary').filter({ hasText: title });
		const badge = summary.locator('.file-status').filter({ hasText: label });
		await expect(badge).toBeVisible();
		await expect(badge).toHaveAttribute('title', label);
		await expect(badge.locator('.sr-only')).toHaveText(label);
		await expect(badge).toHaveCSS('width', '20px');
		await expect(badge).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
		await expect(badge).toHaveCSS('border-width', '0px');
		await expect(badge).toHaveCSS('color', color);
		await expect(badge.locator('svg[aria-hidden="true"]')).toHaveCount(1);
		await expect(badge.locator('svg')).toHaveCSS('width', '20px');
	}
	const deprecated = page.locator('summary').filter({ hasText: 'Deprecated assignment' });
	await expect(page.locator('summary').filter({ hasText: 'New policy' }).locator('.version-change')).not.toHaveClass(/version-updated/);
	await expect(deprecated.locator('.file-status')).toHaveCount(2);
	const icons = await deprecated.locator('.file-status').evaluateAll((elements) =>
		elements.map((element) => {
			const { top, right, left } = element.getBoundingClientRect();
			return { top, right, left };
		}));
	expect(icons[0].top).toBe(icons[1].top);
	expect(icons[1].left).toBeGreaterThan(icons[0].right);
	const deprecationOnly = page.locator('summary').filter({ hasText: 'Deprecation-only architecture' });
	await expect(deprecationOnly.locator('.file-status')).toHaveCount(1);
	await expect(deprecationOnly.locator('.file-status')).toHaveAttribute('title', 'Deprecated');

	for (const [status, titles] of [
		['added', ['New policy']],
		['modified', ['Updated initiative']],
		['deprecated', ['Deprecated assignment', 'Deprecation-only architecture']],
		['removed', ['Removed archetype']]
	] as const) {
		const filter = page.getByLabel('Filter by status');
		await filter.selectOption(status);
		await expect(filter).toHaveValue(status);
		await expect(page.locator('.file-path > strong')).toHaveText(titles);
	}
	await page.getByLabel('Filter by status').selectOption('');
	await expect(page.locator('.file-path > strong')).toHaveCount(5);
	await page.getByLabel('Filter by status').selectOption('added');
	await page.getByLabel('Filter by type').selectOption('initiative');
	await expect(page.getByText('No library changes match these filters.')).toBeVisible();
	await page.getByRole('button', { name: 'Clear filters' }).click();
	await expect(page.locator('.file-path > strong')).toHaveCount(5);
	await page.getByLabel('Filter by type').selectOption('initiative');
	await expect(page.locator('.file-path > strong')).toHaveText(['Updated initiative']);
	await page.getByLabel('Search library changes').fill('not found');
	await expect(page.getByText('No library changes match these filters.')).toBeVisible();
	await page.getByRole('button', { name: 'Clear filters' }).click();
	await expect(page.locator('.file-path > strong')).toHaveCount(5);
	const filterLayout = await page.evaluate(() => {
		const bounds = (selector: string) => {
			const { left, right, top, bottom } = document.querySelector(selector)!.getBoundingClientRect();
			return { left, right, top, bottom };
		};
		return {
			heading: bounds('.changes-heading'),
			headingText: bounds('.changes-heading h3'),
			toolbar: bounds('.change-controls'),
			status: bounds('.status-filter'),
			type: bounds('.type-filter'),
			search: bounds('.search-field'),
			statusStyle: getComputedStyle(document.querySelector('.status-filter')!),
			typeStyle: getComputedStyle(document.querySelector('.type-filter')!),
			searchStyle: getComputedStyle(document.querySelector('.search-field')!),
			controlHeights: [...document.querySelectorAll('.status-filter, .type-filter, .search-field')]
				.map((element) => element.getBoundingClientRect().height)
		};
	});
	expect(filterLayout.search.right).toBeLessThanOrEqual(filterLayout.toolbar.right + 1);
	expect(filterLayout.controlHeights.every((height) => height >= 44)).toBe(true);
	if (page.viewportSize()!.width <= 650) expect(filterLayout.controlHeights.at(-1)).toBeLessThanOrEqual(48);
	for (const fieldStyle of [filterLayout.statusStyle, filterLayout.typeStyle]) {
		expect(fieldStyle.borderTopWidth).toBe(filterLayout.searchStyle.borderTopWidth);
		expect(fieldStyle.borderTopColor).toBe(filterLayout.searchStyle.borderTopColor);
		expect(fieldStyle.borderTopLeftRadius).toBe(filterLayout.searchStyle.borderTopLeftRadius);
		expect(fieldStyle.backgroundColor).toBe(filterLayout.searchStyle.backgroundColor);
	}
	if (page.viewportSize()!.width > 900) {
		expect(filterLayout.headingText.left).toBe(filterLayout.heading.left);
		expect(filterLayout.headingText.right).toBeLessThan(filterLayout.toolbar.left);
		expect(Math.abs(filterLayout.headingText.top + filterLayout.headingText.bottom - filterLayout.toolbar.top - filterLayout.toolbar.bottom)).toBeLessThanOrEqual(20);
		expect(filterLayout.search.left).toBeGreaterThan(filterLayout.type.right);
	} else if (page.viewportSize()!.width > 650) {
		expect(filterLayout.toolbar.top).toBeGreaterThan(filterLayout.headingText.bottom);
		expect(filterLayout.search.left).toBeGreaterThan(filterLayout.type.right);
	} else {
		expect(filterLayout.toolbar.top).toBeGreaterThan(filterLayout.headingText.bottom);
		expect(filterLayout.search.top).toBeGreaterThan(filterLayout.type.bottom);
	}
	await page.getByLabel('Filter by status').focus();
	await expect(page.locator('.status-filter')).toHaveCSS('border-top-color', 'rgb(49, 129, 220)');
	await page.getByLabel('Filter by type').focus();
	await expect(page.locator('.type-filter')).toHaveCSS('border-top-color', 'rgb(49, 129, 220)');
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

async function awaitCompareButton(page: import('@playwright/test').Page) {
	await expect(page.getByRole('button', { name: /Compare releases/ })).toBeEnabled();
}

test('recovers from release failures and rejects malformed catalogs explicitly', async ({ page }) => {
	let attempts = 0;
	await page.route('**/api/releases', (route) => {
		attempts++;
		return route.fulfill(attempts === 1
			? { status: 503, json: { error: 'Release synchronization is unavailable. Try again later.' } }
			: attempts === 2 ? { status: 200, json: {} }
				: { status: 200, json: { releases } });
	});
	await page.goto('/');
	await expect(page.getByRole('alert')).toContainText('Could not load releases.');
	await expect(page.getByRole('alert')).toContainText('Release synchronization is unavailable');
	await page.getByRole('button', { name: 'Try loading releases again' }).click();
	await expect(page.getByRole('alert')).toContainText('invalid release catalog');
	await page.getByRole('button', { name: 'Try loading releases again' }).click();
	await awaitCompareButton(page);
	await expect(page.getByRole('alert')).toHaveCount(0);
});

test('resumes the same job after a polling error and announces completion', async ({ page }) => {
	let submissions = 0;
	let polls = 0;
	await page.route('**/api/releases', (route) => route.fulfill({ status: 200, json: { releases } }));
	await page.route('**/api/comparisons', (route) => {
		submissions++;
		return route.fulfill({ status: 202, json: { status: 'queued', jobId: 'resumable-job' } });
	});
	await page.route('**/api/comparisons/resumable-job', (route) => {
		polls++;
		return route.fulfill(polls === 1
			? { status: 503, json: { error: 'Storage is temporarily unavailable.' } }
			: { status: 200, json: { status: 'completed', report } });
	});
	await page.goto('/');
	await page.getByRole('button', { name: 'Compare releases' }).click();
	await expect(page.getByLabel(/FROM Release/)).toBeDisabled();
	await expect(page.getByRole('alert')).toContainText('Storage is temporarily unavailable.');
	await expect(page.getByLabel(/FROM Release/)).toHaveValue(releases[1].tag);
	await page.getByRole('button', { name: 'Retry comparison' }).click();
	await expect(page.getByRole('status', { name: 'Comparison status' })).toContainText('Comparison ready: 2025.10.0 to 2026.10.0.');
	expect(submissions).toBe(1);
	expect(polls).toBe(2);
});

test('times out stalled requests with an actionable message', async ({ page }) => {
	await page.clock.install();
	await page.route('**/api/releases', () => {});
	const requested = page.waitForRequest('**/api/releases');
	await page.goto('/');
	await requested;
	await page.clock.fastForward(15_001);
	await expect(page.getByRole('alert')).toContainText('request timed out');
	await expect(page.getByRole('button', { name: 'Try loading releases again' })).toBeEnabled();
});

test('handles offline errors, unreadable responses, and identical selections', async ({ page }) => {
	let attempts = 0;
	await page.route('**/api/releases', (route) => route.fulfill({ status: 200, json: { releases } }));
	await page.route('**/api/comparisons', (route) => {
		attempts++;
		return attempts === 1 ? route.abort('failed')
			: route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad gateway</html>' });
	});

	await page.goto('/');
	await page.getByRole('button', { name: 'Compare releases' }).click();
	await expect(page.getByRole('alert')).toContainText('Check your connection');
	await page.getByRole('button', { name: 'Retry comparison' }).click();
	await expect(page.getByRole('alert')).toContainText('unreadable response');
	await page.getByLabel(/FROM Release/).selectOption(releases[0].tag);
	await expect(page.getByText('Choose two different releases to compare.')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Compare releases' })).toBeDisabled();
});

test('rejects malformed reports without rendering a broken result', async ({ page }) => {
	await page.route('**/api/releases', (route) => route.fulfill({ status: 200, json: { releases } }));
	await page.route('**/api/comparisons', (route) => route.fulfill({ status: 200, json: { status: 'completed', report: {} } }));
	await page.goto('/');
	await page.getByRole('button', { name: 'Compare releases' }).click();
	await expect(page.getByRole('alert')).toContainText('invalid report');
	await expect(page.locator('.report')).toHaveCount(0);
	await awaitCompareButton(page);
});

test('switches libraries, clears the report, and remembers separate pairs across reloads', async ({ page }, testInfo) => {
	await page.route('**/api/releases', (route) => route.fulfill({ json: { releases: [...releases, ...slzReleases] } }));
	await page.route('**/api/comparisons', (route) => {
		const pair = route.request().postDataJSON();
		expect(pair.fromTag.split('/')[1]).toBe(pair.toTag.split('/')[1]);
		const stream = pair.fromTag.includes('/slz/') ? slzReleases : releases;
		return route.fulfill({ json: { status: 'completed', report: {
			...report, scope: pair.fromTag.includes('/slz/') ? 'platform/slz/' : 'platform/alz/',
			from: { ...stream.find((release) => release.tag === pair.fromTag), sha: 'b'.repeat(40) },
			to: { ...stream.find((release) => release.tag === pair.toTag), sha: 'a'.repeat(40) },
			coverage: { ...report.coverage, explanation: 'SLZ includes relevant inherited definitions from pinned ALZ dependencies.' }
		} } });
	});
	await page.goto('/');
	await expect(page.getByRole('radio', { name: 'ALZ', exact: true })).toBeChecked();
	await expect(page.locator('.intro')).toContainText('Azure Landing Zones (ALZ)');
	await expect(page.locator('.intro')).toContainText('Sovereign Landing Zone (SLZ)');
	await page.getByRole('button', { name: 'Compare releases' }).click();
	await expect(page.locator('.report')).toBeVisible();
	await page.getByRole('radio', { name: 'SLZ', exact: true }).check();
	await expect(page.locator('.report')).toHaveCount(0);
	await expect(page).toHaveTitle('SLZ | Landing Zone Release Brief');
	await expect(page.getByRole('link', { name: 'Landing Zone Release Brief home' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'SLZ release changes, explained' })).toBeVisible();
	await expect(page.getByLabel(/FROM Release/)).toHaveValue(slzReleases[1].tag);
	expect(await page.locator('.release-picker option').evaluateAll((options) =>
		options.every((option) => option instanceof HTMLOptionElement && option.value.startsWith('platform/slz/')))).toBe(true);
	await page.getByLabel(/FROM Release/).selectOption(slzReleases[2].tag);
	await page.getByRole('radio', { name: 'ALZ', exact: true }).check();
	await expect(page.getByLabel(/FROM Release/)).toHaveValue(releases[1].tag);
	await page.getByRole('radio', { name: 'SLZ', exact: true }).check();
	await expect(page.getByLabel(/FROM Release/)).toHaveValue(slzReleases[2].tag);
	await page.reload();
	await expect(page.getByRole('radio', { name: 'SLZ', exact: true })).toBeChecked();
	await expect(page.getByLabel(/FROM Release/)).toHaveValue(slzReleases[2].tag);
	await page.getByRole('button', { name: 'Compare releases' }).click();
	await expect(page.locator('.dependency-note')).toContainText('pinned ALZ');
	await expect(page).toHaveURL(/library=slz/);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	const switchBounds = (await page.locator('.library-switch').boundingBox())!;
	const pickerBounds = (await page.locator('.comparison-form').boundingBox())!;
	expect(switchBounds.y + switchBounds.height).toBeLessThan(pickerBounds.y);
	expect(await page.locator('.library-switch label').evaluateAll((labels) =>
		labels.every((label) => label.getBoundingClientRect().height >= 44))).toBe(true);
	await page.screenshot({ path: testInfo.outputPath('slz.png'), fullPage: true });
});

test('restores legacy SLZ links and rejects mixed-library or mismatched links', async ({ page }) => {
	let comparisons = 0;
	await page.route('**/api/releases', (route) => route.fulfill({ json: { releases: [...releases, ...slzReleases] } }));
	await page.route('**/api/comparisons', (route) => {
		comparisons++;
		return route.fulfill({ json: { status: 'completed', report: { ...report, scope: 'platform/slz/',
			from: { ...slzReleases[1], sha: 'b'.repeat(40) }, to: { ...slzReleases[0], sha: 'a'.repeat(40) }
		} } });
	});
	await page.goto(`/?from=${encodeURIComponent(slzReleases[1].tag)}&to=${encodeURIComponent(slzReleases[0].tag)}`);
	await expect(page.getByRole('radio', { name: 'SLZ', exact: true })).toBeChecked();
	await expect(page.locator('.report')).toBeVisible();
	expect(comparisons).toBe(1);
	for (const query of [
		`from=${encodeURIComponent(slzReleases[1].tag)}&to=${encodeURIComponent(releases[0].tag)}`,
		`library=alz&from=${encodeURIComponent(slzReleases[1].tag)}&to=${encodeURIComponent(slzReleases[0].tag)}`,
		'library=unknown'
	]) {
		await page.goto(`/?${query}`);
		await expect(page.getByRole('alert')).toContainText('comparison link');
		await expect(page.locator('.report')).toHaveCount(0);
	}
	expect(comparisons).toBe(1);
});

test('supports keyboard library selection and explicit unavailable and single-release states', async ({ page }) => {
	await page.route('**/api/releases', (route) => route.fulfill({ json: { releases } }));
	await page.goto('/');
	const alz = page.getByRole('radio', { name: 'ALZ', exact: true });
	await alz.focus();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByRole('radio', { name: 'SLZ', exact: true })).toBeChecked();
	await expect(page.getByRole('button', { name: 'Compare releases' })).toBeDisabled();
	await expect(page.getByText('No SLZ releases are in the synchronized catalog.', { exact: false })).toBeVisible();
	await page.unroute('**/api/releases');
	await page.route('**/api/releases', (route) => route.fulfill({ json: { releases: [slzReleases[0]] } }));
	await page.reload();
	await expect(page.getByText('At least two SLZ releases are needed for a comparison.')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Compare releases' })).toBeDisabled();
});

test('rejects a report from the wrong library and disables switching while a job is pending', async ({ page }) => {
	await page.route('**/api/releases', (route) => route.fulfill({ json: { releases: [...releases, ...slzReleases] } }));
	await page.route('**/api/comparisons', (route) => route.fulfill({ json: { status: 'queued', jobId: 'slz-job' } }));
	await page.route('**/api/comparisons/slz-job', (route) =>
		route.fulfill({ json: { status: 'completed', report } }));
	await page.goto('/?library=slz');
	await page.getByRole('button', { name: 'Compare releases' }).click();
	await expect(page.getByRole('radio', { name: 'ALZ', exact: true })).toBeDisabled();
	await expect(page.getByRole('alert')).toContainText('invalid report');
	await expect(page.locator('.report')).toHaveCount(0);
	await expect(page.getByRole('radio', { name: 'ALZ', exact: true })).toBeEnabled();
});

test('recovers unavailable saved pairs and retains selections in memory when browser storage is blocked', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('release-brief-pairs-v1', JSON.stringify({
		slz: { fromTag: 'platform/slz/1900.0.0', toTag: 'platform/slz/1901.0.0' }
	})));
	await page.route('**/api/releases', (route) => route.fulfill({ json: { releases: [...releases, ...slzReleases] } }));
	await page.goto('/?library=slz');
	await expect(page.getByText('Your saved SLZ releases are no longer available.', { exact: false })).toBeVisible();
	await expect(page.getByLabel(/FROM Release/)).toHaveValue(slzReleases[1].tag);
	await page.evaluate(() => Object.defineProperty(window, 'localStorage', {
		configurable: true, get() { throw new DOMException('Storage blocked', 'SecurityError'); }
	}));
	await page.getByLabel(/FROM Release/).selectOption(slzReleases[2].tag);
	await expect(page.getByText('Your browser could not save release selections.', { exact: false })).toBeVisible();
	await page.getByRole('radio', { name: 'ALZ', exact: true }).check();
	await page.getByRole('radio', { name: 'SLZ', exact: true }).check();
	await expect(page.getByLabel(/FROM Release/)).toHaveValue(slzReleases[2].tag);
	await expect(page.getByText('Your browser could not save release selections.', { exact: false })).toBeVisible();
});

test('adapts reports across narrow, tablet, landscape, and wide viewports', async ({ page }) => {
	await page.route('**/api/releases', (route) => route.fulfill({ status: 200, json: { releases } }));
	await page.route('**/api/comparisons', (route) => route.fulfill({ status: 200, json: { status: 'completed', report } }));
	await page.goto('/');
	await page.getByRole('button', { name: 'Compare releases' }).click();
	await page.locator('summary').click();
	for (const [width, height] of [[320, 700], [390, 844], [650, 900], [768, 1024], [844, 390], [1024, 768], [1920, 1080]]) {
		await page.setViewportSize({ width, height });
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		expect(await page.locator('.brand, .repository-link, .search-field input, .source-links a')
			.evaluateAll((elements) => elements.every((element) => element.getBoundingClientRect().height >= 44))).toBe(true);
		if (width <= 650) {
			const title = await page.locator('.file-path').boundingBox();
			const row = await page.locator('summary').boundingBox();
			expect(title!.width).toBeGreaterThan(row!.width - 30);
			const controls = await page.locator('.change-controls').boundingBox();
			expect(controls!.width).toBeGreaterThan(row!.width - 2);
			expect(await page.locator('.file-path > strong').evaluate((element) => getComputedStyle(element).fontSize)).toBe('16px');
		}
	}
});

test('keeps long multilingual content usable with accessible controls and reduced motion', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	const long = '非常に長いポリシー名 العربية Netzwerküberwachung '.repeat(12);
	const change = {
		...report.changes[0], title: long, description: `${long} https://example.com/${'unbroken'.repeat(80)}`,
		assignmentsAfter: [{ ...report.changes[0].assignmentsAfter[0], name: 'Assignment'.repeat(80), scopes: [long] }]
	};
	await page.route('**/api/releases', (route) => route.fulfill({ status: 200, json: { releases } }));
	await page.route('**/api/comparisons', (route) => route.fulfill({ status: 200, json: { status: 'completed', report: { ...report, changes: [change] } } }));
	await page.goto('/');
	await page.keyboard.press('Tab');
	await expect(page.getByRole('link', { name: 'Skip to comparison' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'ALZ release changes, explained' })).toBeFocused();
	expect(await page.locator('.empty-report').evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
	await page.getByRole('button', { name: 'Compare releases' }).click();
	expect(await page.locator('.report-heading').evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
	await page.locator('summary').click();
	expect(await page.locator('.chevron').evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0s');
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	for (const selector of ['.search-field input', '.source-links a']) {
		expect(await page.locator(selector).evaluateAll((elements) =>
			elements.every((element) => element.getBoundingClientRect().height >= 44))).toBe(true);
	}
	await page.getByLabel('Search library changes').fill('nonexistent');
	await expect(page.getByText('No library changes match these filters.')).toBeVisible();
});

test('renders details on demand and preserves keyboard disclosure across filters', async ({ page }) => {
	const changes = Array.from({ length: 200 }, (_, index) => ({
		...report.changes[0], id: `policy-${index}`, title: `Policy ${index}`,
		assignmentsBefore: [{ ...report.changes[0].assignmentsAfter[0], effect: 'Audit' }]
	}));
	await page.route('**/api/releases', (route) => route.fulfill({ json: { releases } }));
	await page.route('**/api/comparisons', (route) => route.fulfill({
		json: { status: 'completed', report: { ...report, changes, totals: { changed: 200, added: 0, modified: 200, removed: 0 } } }
	}));
	await page.goto('/');
	await page.getByRole('button', { name: 'Compare releases' }).click();
	await expect(page.locator('summary')).toHaveCount(200);
	await expect(page.locator('.file-detail')).toHaveCount(0);
	const first = page.locator('summary').first();
	await first.focus();
	await page.keyboard.press('Enter');
	await expect(page.locator('.file-detail')).toHaveCount(1);
	await expect(page.getByText('Previous affected assignments')).toBeVisible();
	await expect(page.getByText('Current library assignments')).toBeVisible();
	await page.getByLabel('Search library changes').fill('no match');
	await expect(page.locator('summary')).toHaveCount(0);
	await page.getByRole('button', { name: 'Clear filters' }).click();
	await expect(page.locator('.file-detail')).toHaveCount(1);
	await first.focus();
	await page.keyboard.press('Space');
	await expect(page.locator('.file-detail')).toHaveCount(0);
	await page.getByLabel('Search library changes').fill('Corp');
	await expect(page.locator('summary')).toHaveCount(200);
	await page.getByRole('button', { name: 'Compare releases' }).click();
	await expect(page.locator('.file-detail')).toHaveCount(0);
});
