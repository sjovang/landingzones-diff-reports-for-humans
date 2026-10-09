import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReleaseCatalog, StoredRelease } from '../types.js';

vi.mock('./storage.js', () => ({
	loadReleaseCatalog: vi.fn(),
	saveReleaseCatalog: vi.fn(),
	getCacheEntry: vi.fn(),
	loadCachedReport: vi.fn(),
	createQueuedRecords: vi.fn(),
	createJobRecord: vi.fn(),
	deleteJob: vi.fn(),
	enqueueComparison: vi.fn(),
	getJob: vi.fn(),
	updateCache: vi.fn(),
	updateJob: vi.fn()
}));
vi.mock('./git-report.js', () => ({ getReleaseSnapshot: vi.fn() }));

import { getReleaseCatalog, resolveStoredReleases, syncLibraryReleases } from './release-catalog.js';
import { requestComparison } from './comparisons.js';
import { getReleaseSnapshot } from './git-report.js';
import {
	loadReleaseCatalog, saveReleaseCatalog, getCacheEntry, loadCachedReport, enqueueComparison
} from './storage.js';

const releases: StoredRelease[] = [2, 1].map((version) => ({
	tag: `platform/alz/1.${version}.0`, version: `1.${version}.0`,
	url: `https://github.com/Azure/Azure-Landing-Zones-Library/tree/platform/alz/1.${version}.0`,
	sha: String(version).repeat(40), referenceSha: String(version).repeat(40)
}));
const catalog: ReleaseCatalog = { schemaVersion: 1, syncedAt: '2026-01-01T00:00:00.000Z', releases };
const stored = { catalog, etag: '"previous-revision"' };
const slzReleases = releases.map((release) => ({ ...release, tag: release.tag.replace('/alz/', '/slz/') }));

function successfulSyncFetch() {
	return vi.fn(async (url: string) => {
		if (url.includes('/contents/')) return Response.json({
			encoding: 'base64',
			content: Buffer.from(JSON.stringify({ dependencies: [{ path: 'platform/alz', ref: releases[0].version }] })).toString('base64')
		});
		const stream = url.includes('/slz/') ? slzReleases : releases;
		return Response.json(stream.map((release) => ({
			ref: `refs/tags/${release.tag}`, object: { type: 'commit', sha: release.sha }
		})));
	});
}

beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(loadReleaseCatalog).mockResolvedValue(stored);
	vi.mocked(getReleaseSnapshot).mockResolvedValue(new Map());
});
afterEach(() => vi.unstubAllGlobals());

describe('durable ALZ release catalog', () => {
	it('serves repeated catalog and release resolution reads without contacting GitHub', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		for (let count = 0; count < 3; count++) {
			expect(await getReleaseCatalog()).toEqual(catalog);
			expect(await resolveStoredReleases(releases[1].tag, releases[0].tag))
				.toEqual({ from: releases[1], to: releases[0] });
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns completed comparisons without GitHub calls or queue work', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		vi.mocked(getCacheEntry).mockResolvedValue({
			partitionKey: 'reports', rowKey: 'cached', cacheKey: 'cached', jobId: 'cached-job',
			status: 'completed', blobName: 'cached.json'
		});
		for (let count = 0; count < 3; count++) {
			const job = await requestComparison(releases[1].tag, releases[0].tag);
			expect(job.status).toBe('completed');
			expect(job.jobId).toBe('cached-job');
		}
		expect(loadCachedReport).toHaveBeenCalledTimes(3);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(enqueueComparison).not.toHaveBeenCalled();
	});

	it('queues uncached comparisons with stored commit SHAs without GitHub calls', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		vi.mocked(getCacheEntry).mockResolvedValue(null);
		expect((await requestComparison(releases[1].tag, releases[0].tag)).status).toBe('queued');
		expect(enqueueComparison).toHaveBeenCalledWith(expect.objectContaining({
			fromSha: releases[1].sha, toSha: releases[0].sha
		}));
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('has an actionable cold-start error and never falls back to live discovery', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		vi.mocked(loadReleaseCatalog).mockResolvedValue(null);
		await expect(getReleaseCatalog()).rejects.toThrow('Run the release sync');
		await expect(requestComparison(releases[1].tag, releases[0].tag)).rejects.toMatchObject({ status: 503 });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects invalid and unavailable selections without live discovery', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		await expect(resolveStoredReleases('platform/slz/1.0.0', releases[0].tag)).rejects.toMatchObject({ status: 400 });
		await expect(resolveStoredReleases(releases[0].tag, releases[0].tag)).rejects.toMatchObject({ status: 400 });
		await expect(resolveStoredReleases('platform/alz/9.0.0', releases[0].tag)).rejects.toMatchObject({ status: 400 });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('warms the newest two snapshots and atomically replaces the complete catalog', async () => {
		vi.stubGlobal('fetch', successfulSyncFetch());
		const next = await syncLibraryReleases();
		expect(next.releases).toHaveLength(4);
		expect(next.releases.slice(0, 2)).toEqual(releases);
		expect(next.releases[2].dependency).toEqual({
			tag: releases[0].tag, version: releases[0].version, url: releases[0].url, sha: releases[0].sha
		});
		expect(next.syncedAt).not.toBe(catalog.syncedAt);
		expect(getReleaseSnapshot).toHaveBeenCalledTimes(6);
		expect(saveReleaseCatalog).toHaveBeenCalledWith(next, stored.etag);
		expect(vi.mocked(getReleaseSnapshot).mock.invocationCallOrder[5])
			.toBeLessThan(vi.mocked(saveReleaseCatalog).mock.invocationCallOrder[0]);
	});

	it('retains the last catalog on rate limits, empty discovery, or snapshot failure', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
		await expect(syncLibraryReleases()).rejects.toThrow('rate limit');
		vi.stubGlobal('fetch', vi.fn(async () => Response.json([])));
		await expect(syncLibraryReleases()).rejects.toThrow('no ALZ releases');
		vi.stubGlobal('fetch', successfulSyncFetch());
		vi.mocked(getReleaseSnapshot).mockRejectedValueOnce(new Error('Git unavailable'));
		await expect(syncLibraryReleases()).rejects.toThrow('Git unavailable');
		expect(saveReleaseCatalog).not.toHaveBeenCalled();
		expect(await getReleaseCatalog()).toEqual(catalog);
	});

	it('does not publish partial results when an annotated tag cannot be resolved', async () => {
		vi.stubGlobal('fetch', vi.fn(async (url: string) => {
			if (url.includes('/git/tags/')) return new Response('', { status: 429 });
			if (url.includes('/slz/')) return Response.json([]);
			return Response.json([
				{ ref: `refs/tags/${releases[0].tag}`, object: { type: 'commit', sha: releases[0].sha } },
				{ ref: `refs/tags/${releases[1].tag}`, object: { type: 'tag', sha: 'a'.repeat(40) } }
			]);
		}));
		await expect(syncLibraryReleases()).rejects.toThrow('rate limit');
		expect(saveReleaseCatalog).not.toHaveBeenCalled();
		expect(getReleaseSnapshot).not.toHaveBeenCalled();
	});

	it('surfaces concurrent catalog update conflicts rather than overwriting newer data', async () => {
		vi.stubGlobal('fetch', successfulSyncFetch());
		vi.mocked(saveReleaseCatalog).mockRejectedValueOnce(Object.assign(new Error('ETag changed'), { statusCode: 412 }));
		await expect(syncLibraryReleases()).rejects.toThrow('ETag changed');
		expect(saveReleaseCatalog).toHaveBeenCalledTimes(1);
	});

	it('reuses dependency metadata for unchanged SLZ commits but refreshes dependency SHAs', async () => {
		vi.stubGlobal('fetch', successfulSyncFetch());
		const first = await syncLibraryReleases();
		vi.mocked(loadReleaseCatalog).mockResolvedValue({ catalog: first, etag: '"next"' });
		const fetchMock = successfulSyncFetch();
		const success = fetchMock.getMockImplementation()!;
		fetchMock.mockImplementation(async (url) => url.includes('/alz/')
			? Response.json(releases.map((release, index) => ({
				ref: `refs/tags/${release.tag}`, object: { type: 'commit', sha: index === 0 ? '3'.repeat(40) : release.sha }
			}))) : success(url));
		vi.stubGlobal('fetch', fetchMock);
		const next = await syncLibraryReleases();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls.every(([url]) => !url.includes('/contents/'))).toBe(true);
		expect(next.releases[2].dependency?.sha).toBe('3'.repeat(40));
	});

	it('retains the catalog when a pinned dependency cannot be resolved or metadata is invalid', async () => {
		const fetchMock = successfulSyncFetch();
		const success = fetchMock.getMockImplementation()!;
		fetchMock.mockImplementation(async (url) => url.includes('/contents/')
			? Response.json({ encoding: 'base64', content: Buffer.from(JSON.stringify({
				dependencies: [{ path: 'platform/alz', ref: '9.0.0' }]
			})).toString('base64') }) : success(url));
		vi.stubGlobal('fetch', fetchMock);
		await expect(syncLibraryReleases()).rejects.toThrow('pinned ALZ dependency');
		expect(saveReleaseCatalog).not.toHaveBeenCalled();
		fetchMock.mockImplementation(async (url) => url.includes('/contents/')
			? Response.json({ encoding: 'base64', content: Buffer.from('invalid').toString('base64') }) : success(url));
		await expect(syncLibraryReleases()).rejects.toThrow('metadata is invalid');
		expect(saveReleaseCatalog).not.toHaveBeenCalled();
	});

	it('resolves SLZ comparisons without live discovery and isolates same-SHA cache keys', async () => {
		const slz = slzReleases.map((release) => ({ ...release, dependency: {
			tag: releases[0].tag, version: releases[0].version, url: releases[0].url, sha: releases[0].sha
		} }));
		vi.mocked(loadReleaseCatalog).mockResolvedValue({ catalog: { ...catalog, releases: [...releases, ...slz] }, etag: stored.etag });
		vi.mocked(getCacheEntry).mockResolvedValue(null);
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const alz = await requestComparison(releases[1].tag, releases[0].tag);
		const job = await requestComparison(slz[1].tag, slz[0].tag);
		expect(job.cacheKey).not.toBe(alz.cacheKey);
		expect(enqueueComparison).toHaveBeenLastCalledWith(expect.objectContaining({
			fromTag: slz[1].tag, toTag: slz[0].tag,
			fromDependencySha: releases[0].sha, toDependencySha: releases[0].sha
		}));
		await expect(requestComparison(slz[1].tag, releases[0].tag)).rejects.toThrow('cannot be compared');
		expect(enqueueComparison).toHaveBeenCalledTimes(2);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
