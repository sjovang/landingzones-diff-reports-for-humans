import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLibraryTimelines, generateTimelines } from './timelines.js';
import { analyzeReleases, type ReleaseFiles } from './analysis.js';
import { getReleaseCatalog } from './release-catalog.js';
import { getTimelineIndexEtag, loadReleaseSnapshot, publishTimelineIndex, saveTimelineReport } from './storage.js';
import type { StoredRelease } from '../types.js';

vi.mock('./release-catalog.js', () => ({ getReleaseCatalog: vi.fn() }));
vi.mock('./storage.js', () => ({
	getTimelineIndexEtag: vi.fn(), loadReleaseSnapshot: vi.fn(), publishTimelineIndex: vi.fn(), saveTimelineReport: vi.fn()
}));

const metadata = {
	generationId: '11111111-1111-4111-8111-111111111111',
	generatedAt: '2026-10-12T12:00:00.000Z', syncedAt: '2026-10-12T11:00:00.000Z'
};
function release(index: number, library = 'alz'): StoredRelease {
	return {
		tag: `platform/${library}/2026.0${index}.0`, version: `2026.0${index}.0`,
		sha: String(index).repeat(40), referenceSha: String(index).repeat(40),
		url: `https://github.com/Azure/Azure-Landing-Zones-Library/tree/platform/${library}/2026.0${index}.0`
	};
}
function files(values: Record<string, unknown>): ReleaseFiles {
	return new Map(Object.entries(values).map(([path, value]) => [path, JSON.stringify(value)]));
}
function snapshot(version = '1.0.0', effect = 'Audit', present = true) {
	return files({
		...(present ? { 'platform/alz/policy_definitions/Tags.json': {
			name: 'Tags', properties: {
				displayName: 'Required tags', metadata: { version },
				parameters: { effect: { type: 'String', defaultValue: 'Audit', allowedValues: ['Audit', 'Deny'] } },
				policyRule: { if: { field: 'tags', exists: false }, then: { effect: "[parameters('effect')]" } }
			}
		} } : {}),
		'platform/alz/policy_assignments/Tags.json': {
			name: 'Tags', properties: {
				policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/Tags',
				parameters: { effect: { value: effect } }
			}
		}
	});
}
function snapshots(values: ReleaseFiles[]) {
	return values.map((value, index) => ({ release: release(index + 1), files: value }));
}

beforeEach(() => vi.resetAllMocks());

describe('complete object histories', () => {
	it('summarizes lifecycle dates rather than treating the newest unchanged release as an update', async () => {
		const deprecated = snapshot('1.1.0');
		const path = 'platform/alz/policy_definitions/Tags.json';
		const policy = JSON.parse(deprecated.get(path)!);
		policy.properties.metadata.deprecated = true;
		deprecated.set(path, JSON.stringify(policy));
		const current = (await buildLibraryTimelines('alz', snapshots([
			snapshot(), deprecated, deprecated
		]), metadata))[0];
		expect(current).toMatchObject({ deprecatedRelease: release(2).version, lastUpdatedRelease: release(2).version });
		expect(current.removedRelease).toBeUndefined();
		const removed = (await buildLibraryTimelines('alz', snapshots([
			snapshot(), deprecated, snapshot('1.1.0', 'Audit', false), snapshot('1.1.0', 'Audit', false)
		]), metadata))[0];
		expect(removed).toMatchObject({ deprecatedRelease: release(2).version, removedRelease: release(3).version });
		expect(removed.lastUpdatedRelease).toBeUndefined();
		const unchanged = (await buildLibraryTimelines('alz', snapshots([snapshot(), snapshot()]), metadata))[0];
		expect(unchanged.lastUpdatedRelease).toBeUndefined();
	});

	it('keeps leading, consecutive, and trailing gaps without inferring changes across them', async () => {
		const report = (await buildLibraryTimelines('alz', [
			{ release: release(1), gapReason: 'Missing earliest snapshot.' },
			{ release: release(2), files: snapshot() },
			{ release: release(3), gapReason: 'Missing snapshot.' },
			{ release: release(4), gapReason: 'Missing snapshot.' },
			{ release: release(5), files: snapshot('2.0.0') },
			{ release: release(6), files: snapshot('2.0.1') },
			{ release: release(7), gapReason: 'Missing latest snapshot.' }
		], metadata))[0];
		expect(report).toMatchObject({
			firstRelease: '2026.02.0', latestRelease: '2026.07.0',
			presentInLatest: null, deprecated: false, releaseCount: 7, changeCount: 1, gapCount: 4
		});
		expect(report.entries.map((entry) => entry.status)).toEqual([
			'gap', 'modified', 'first-observed', 'gap', 'gap', 'first-observed', 'gap'
		]);
		expect(report.entries[2].change).toBeUndefined();
		expect(report.entries[0].source).toBeUndefined();
	});

	it('does not infer removal or reintroduction through a gap, but resumes adjacent comparisons', async () => {
		const report = (await buildLibraryTimelines('alz', [
			{ release: release(1), files: snapshot() },
			{ release: release(2), gapReason: 'Missing snapshot.' },
			{ release: release(3), files: snapshot('1.0.0', 'Audit', false) },
			{ release: release(4), gapReason: 'Missing snapshot.' },
			{ release: release(5), files: snapshot() },
			{ release: release(6), files: snapshot('1.0.0', 'Audit', false) }
		], metadata))[0];
		expect(report.entries.map((entry) => entry.status)).toEqual([
			'removed', 'first-observed', 'gap', 'absent', 'gap', 'first-observed'
		]);
		expect(report.changeCount).toBe(1);
		expect(report.presentInLatest).toBe(false);
	});

	it('includes gaps before first observation but does not extend back through verified absence', async () => {
		const reports = await buildLibraryTimelines('alz', [
			{ release: release(1), gapReason: 'Missing snapshot.' },
			{ release: release(2), files: snapshot('1.0.0', 'Audit', false) },
			{ release: release(3), gapReason: 'Missing snapshot.' },
			{ release: release(4), files: snapshot() },
			{ release: release(5), files: snapshot() }
		], metadata);
		expect(reports[0].firstRelease).toBe('2026.04.0');
		expect(reports[0].entries.map((entry) => entry.status)).toEqual(['unchanged', 'first-observed', 'gap']);
	});

	it('shows all releases newest first, including unchanged releases and an honest baseline', async () => {
		const reports = await buildLibraryTimelines('alz', snapshots([snapshot(), snapshot(), snapshot('1.0.1')]), metadata);
		expect(reports).toHaveLength(1);
		expect(reports[0]).toMatchObject({
			name: 'Tags', firstRelease: '2026.01.0', latestRelease: '2026.03.0',
			releaseCount: 3, changeCount: 1, presentInLatest: true
		});
		expect(reports[0].entries.map((entry) => entry.status)).toEqual(['modified', 'unchanged', 'first-observed']);
		expect(reports[0].entries[0].source).toContain(`/blob/${release(3).sha}/`);
	});

	it('stops at introduction and keeps removal, absence, and reintroduction after it', async () => {
		const report = (await buildLibraryTimelines('alz', snapshots([
			snapshot('1.0.0', 'Audit', false), snapshot(), snapshot('1.0.0', 'Audit', false),
			snapshot('1.0.0', 'Audit', false), snapshot()
		]), metadata))[0];
		expect(report.firstRelease).toBe('2026.02.0');
		expect(report.firstReleaseStatus).toBe('added');
		expect(report.entries.map((entry) => entry.status)).toEqual(['reintroduced', 'absent', 'removed', 'added']);
		expect(report.entries.at(-1)?.change?.status).toBe('added');
	});

	it('retains removed objects in the search index and distinguishes usage changes', async () => {
		const report = (await buildLibraryTimelines('alz', snapshots([
			snapshot(), snapshot('1.0.0', 'Deny'), snapshot('1.0.0', 'Deny', false)
		]), metadata))[0];
		expect(report.presentInLatest).toBe(false);
		expect(report.entries[1].changeType).toBe('usage');
		expect(report.entries[1].change?.summary).toContain('definition is unchanged');
		expect(report.entries[1].change?.assignmentsAfter[0].effect).toContain('Deny');
	});

	it('includes unchanged policy sets and archetypes, not just objects in comparisons', async () => {
		const source = files({
			'platform/alz/policy_set_definitions/Network.json': { name: 'Network', properties: { displayName: 'Network policies', policyDefinitions: [] } },
			'platform/alz/archetype_definitions/corp.json': { name: 'corp', policy_assignments: [] }
		});
		const reports = await buildLibraryTimelines('alz', snapshots([source, source]), metadata);
		expect(reports.map((report) => report.kind).sort()).toEqual(['archetype', 'initiative']);
		expect(reports.every((report) => report.changeCount === 0 && report.releaseCount === 2)).toBe(true);
	});

	it('explains policy set and archetype membership changes', async () => {
		const first = files({
			'platform/alz/policy_set_definitions/Network.json': { name: 'Network', properties: { policyDefinitions: [] } },
			'platform/alz/archetype_definitions/corp.json': { name: 'corp', policy_assignments: [] }
		});
		const second = files({
			'platform/alz/policy_set_definitions/Network.json': { name: 'Network', properties: {
				policyDefinitions: [{ policyDefinitionReferenceId: 'Tags', policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/Tags' }]
			} },
			'platform/alz/archetype_definitions/corp.json': { name: 'corp', policy_assignments: ['Tags'] }
		});
		const reports = await buildLibraryTimelines('alz', snapshots([first, second]), metadata);
		expect(reports.every((report) => report.entries[0].status === 'modified')).toBe(true);
		expect(reports.find((report) => report.kind === 'archetype')?.entries[0].change?.facts.join(' ')).toContain('added: Tags');
		expect(reports.find((report) => report.kind === 'initiative')?.entries[0].change?.facts.join(' ')).toContain('Tags');
	});

	it('compares effective SLZ inclusion without importing unrelated ALZ objects or claiming deletion from ALZ', async () => {
		const alz = snapshot();
		alz.set('platform/alz/policy_definitions/Unrelated.json', JSON.stringify({ name: 'Unrelated' }));
		const slz = (included: boolean) => files({
			'platform/slz/archetype_definitions/slz.json': { name: 'slz', policy_definitions: included ? ['Tags'] : [] }
		});
		const before = { release: release(1, 'slz'), files: slz(true), dependency: { files: alz, sha: 'a'.repeat(40) } };
		const after = { release: release(2, 'slz'), files: slz(false), dependency: { files: alz, sha: 'b'.repeat(40) } };
		const reports = await buildLibraryTimelines('slz', [before, after], metadata);
		expect(reports.some((report) => report.name === 'Unrelated')).toBe(false);
		const tags = reports.find((report) => report.name === 'Tags')!;
		expect(tags.entries[0].status).toBe('removed');
		expect(tags.entries[1].provenance).toBe('alz');
		expect(tags.entries[1].source).toContain(`/blob/${before.dependency.sha}/`);
		// Comparison evaluation deliberately keeps definitions available on both sides.
		expect(analyzeReleases(before.files, after.files, before.release.sha, after.release.sha, {
			before: before.dependency, after: after.dependency
		}).changes.find((change) => change.id === 'policy:Tags')?.status).not.toBe('removed');
	});

	it('honors SLZ overrides and their actual source commits', async () => {
		const alz = snapshot();
		const slz = files({
			'platform/slz/policy_definitions/Tags.json': { name: 'Tags', properties: { displayName: 'Sovereign tags' } }
		});
		const reports = await buildLibraryTimelines('slz', [{
			release: release(1, 'slz'), files: slz, dependency: { files: alz, sha: 'a'.repeat(40) }
		}], metadata);
		expect(reports[0].title).toBe('Sovereign tags');
		expect(reports[0].entries[0].provenance).toBe('slz');
		expect(reports[0].entries[0].source).toContain(`/blob/${release(1, 'slz').sha}/`);
	});

	it('fails invalid inventories rather than publishing partial history', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(buildLibraryTimelines('alz', snapshots([
			snapshot(), new Map([['platform/alz/policy_definitions/Tags.json', '{invalid']])
		]), metadata)).rejects.toThrow('invalid JSON');
		error.mockRestore();
	});
});

describe('separate manual publication', () => {
	function seed() {
		const alz = release(1);
		const slz = { ...release(1, 'slz'), dependency: alz };
		vi.mocked(getReleaseCatalog).mockResolvedValue({ schemaVersion: 1, syncedAt: metadata.syncedAt, releases: [alz, slz] });
		vi.mocked(getTimelineIndexEtag).mockResolvedValue('"previous"');
		vi.mocked(loadReleaseSnapshot).mockImplementation(async (_, library) => library === 'slz'
			? files({ 'platform/slz/archetype_definitions/slz.json': { name: 'slz', policy_definitions: ['Tags'] } }) : snapshot());
	}

	it('writes all independent reports before atomically publishing an index', async () => {
		seed();
		const result = await generateTimelines(() => {}, metadata.generationId);
		expect(result.reports).toHaveLength(3);
		expect(result.reports.some((report) => report.library === 'slz' && report.kind === 'policy')).toBe(true);
		expect(saveTimelineReport).toHaveBeenCalledTimes(3);
		expect(publishTimelineIndex).toHaveBeenCalledWith(result, '"previous"');
		expect(vi.mocked(publishTimelineIndex).mock.invocationCallOrder[0])
			.toBeGreaterThan(Math.max(...vi.mocked(saveTimelineReport).mock.invocationCallOrder));
		expect(result.reports[0]).not.toHaveProperty('entries');
	});

	it('publishes explicit gaps even when no snapshots are cached', async () => {
		seed();
		vi.mocked(loadReleaseSnapshot).mockResolvedValue(null);
		const log = vi.fn();
		const result = await generateTimelines(log);
		expect(result.reports).toEqual([]);
		expect(result.gaps.map((gap) => gap.release.tag)).toEqual([release(1).tag, release(1, 'slz').tag]);
		expect(log).toHaveBeenCalledWith(expect.stringContaining('Coverage gap:'));
		expect(publishTimelineIndex).toHaveBeenCalledWith(result, '"previous"');
		expect(saveTimelineReport).not.toHaveBeenCalled();
	});

	it('retains the previous publication on write or storage read errors', async () => {
		seed();
		vi.mocked(saveTimelineReport).mockRejectedValue(new Error('Blob write failed'));
		await expect(generateTimelines(() => {})).rejects.toThrow('Blob write failed');
		expect(publishTimelineIndex).not.toHaveBeenCalled();
		vi.mocked(loadReleaseSnapshot).mockRejectedValue(new Error('Storage unavailable'));
		await expect(generateTimelines(() => {})).rejects.toThrow('Storage unavailable');
		expect(publishTimelineIndex).not.toHaveBeenCalled();
	});

	it('publishes a gap for a missing pinned snapshot rather than an incomplete SLZ inventory', async () => {
		seed();
		vi.mocked(loadReleaseSnapshot).mockReset()
			.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(new Map()).mockResolvedValueOnce(null);
		const result = await generateTimelines(() => {});
		expect(result.reports).toHaveLength(1);
		expect(result.gaps).toEqual([{ library: 'slz', release: expect.objectContaining({ tag: release(1, 'slz').tag }),
			reason: expect.stringContaining('Missing cached pinned ALZ snapshot') }]);
		expect(publishTimelineIndex).toHaveBeenCalled();
	});

	it('publishes a gap for missing dependency metadata and rejects publication races', async () => {
		seed();
		vi.mocked(getReleaseCatalog).mockResolvedValue({ schemaVersion: 1, syncedAt: metadata.syncedAt,
			releases: [release(1), release(1, 'slz')] });
		const result = await generateTimelines(() => {});
		expect(result.gaps[0].reason).toContain('dependency metadata');
		seed();
		vi.mocked(publishTimelineIndex).mockClear();
		vi.mocked(publishTimelineIndex).mockRejectedValue(new Error('Concurrent publication'));
		await expect(generateTimelines(() => {})).rejects.toThrow('Concurrent publication');
	});

	it('generates reports around missing cached releases and exposes the gaps in the index', async () => {
		seed();
		const alz = [release(3), release(2), release(1)];
		vi.mocked(getReleaseCatalog).mockResolvedValue({ schemaVersion: 1, syncedAt: metadata.syncedAt,
			releases: [...alz, { ...release(1, 'slz'), dependency: alz[0] }] });
		vi.mocked(loadReleaseSnapshot).mockImplementation(async (sha, library) => library === 'slz'
			? files({ 'platform/slz/archetype_definitions/slz.json': { name: 'slz' } })
			: sha === release(2).sha ? null : snapshot(sha === release(3).sha ? '2.0.0' : '1.0.0'));
		const result = await generateTimelines(() => {});
		expect(result.gaps).toHaveLength(1);
		expect(result.reports.find((report) => report.library === 'alz')).toMatchObject({ gapCount: 1, changeCount: 0 });
		const report = vi.mocked(saveTimelineReport).mock.calls.map(([report]) => report).find((report) => report.library === 'alz')!;
		expect(report.entries.map((entry) => entry.status)).toEqual(['first-observed', 'gap', 'first-observed']);
		expect(publishTimelineIndex).toHaveBeenCalledWith(result, '"previous"');
	});
});
