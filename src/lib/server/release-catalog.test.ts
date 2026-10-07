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

import { getReleaseCatalog, resolveStoredAlzReleases, syncAlzReleases } from './release-catalog.js';
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
			expect(await resolveStoredAlzReleases(releases[1].tag, releases[0].tag))
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
		await expect(resolveStoredAlzReleases('platform/slz/1.0.0', releases[0].tag)).rejects.toMatchObject({ status: 400 });
		await expect(resolveStoredAlzReleases(releases[0].tag, releases[0].tag)).rejects.toMatchObject({ status: 400 });
		await expect(resolveStoredAlzReleases('platform/alz/9.0.0', releases[0].tag)).rejects.toMatchObject({ status: 400 });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('warms the newest two snapshots and atomically replaces the complete catalog', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => Response.json(releases.map((release) => ({
			ref: `refs/tags/${release.tag}`, object: { type: 'commit', sha: release.sha }
		})))));
		const next = await syncAlzReleases();
		expect(next.releases).toEqual(releases);
		expect(next.syncedAt).not.toBe(catalog.syncedAt);
		expect(getReleaseSnapshot).toHaveBeenCalledTimes(2);
		expect(saveReleaseCatalog).toHaveBeenCalledWith(next, stored.etag);
		expect(vi.mocked(getReleaseSnapshot).mock.invocationCallOrder[1])
			.toBeLessThan(vi.mocked(saveReleaseCatalog).mock.invocationCallOrder[0]);
	});

	it('retains the last catalog on rate limits, empty discovery, or snapshot failure', async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(new Response('', { status: 429 }))
			.mockResolvedValueOnce(Response.json([]))
			.mockResolvedValueOnce(Response.json(releases.map((release) => ({
				ref: `refs/tags/${release.tag}`, object: { type: 'commit', sha: release.sha }
			}))));
		vi.stubGlobal('fetch', fetchMock);
		await expect(syncAlzReleases()).rejects.toThrow('rate limit');
		await expect(syncAlzReleases()).rejects.toThrow('no ALZ releases');
		vi.mocked(getReleaseSnapshot).mockRejectedValueOnce(new Error('Git unavailable'));
		await expect(syncAlzReleases()).rejects.toThrow('Git unavailable');
		expect(saveReleaseCatalog).not.toHaveBeenCalled();
		expect(await getReleaseCatalog()).toEqual(catalog);
	});

	it('does not publish partial results when an annotated tag cannot be resolved', async () => {
		vi.stubGlobal('fetch', vi.fn()
			.mockResolvedValueOnce(Response.json([
				{ ref: `refs/tags/${releases[0].tag}`, object: { type: 'commit', sha: releases[0].sha } },
				{ ref: `refs/tags/${releases[1].tag}`, object: { type: 'tag', sha: 'a'.repeat(40) } }
			]))
			.mockResolvedValueOnce(new Response('', { status: 429 })));
		await expect(syncAlzReleases()).rejects.toThrow('rate limit');
		expect(saveReleaseCatalog).not.toHaveBeenCalled();
		expect(getReleaseSnapshot).not.toHaveBeenCalled();
	});

	it('surfaces concurrent catalog update conflicts rather than overwriting newer data', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => Response.json(releases.map((release) => ({
			ref: `refs/tags/${release.tag}`, object: { type: 'commit', sha: release.sha }
		})))));
		vi.mocked(saveReleaseCatalog).mockRejectedValueOnce(Object.assign(new Error('ETag changed'), { statusCode: 412 }));
		await expect(syncAlzReleases()).rejects.toThrow('ETag changed');
		expect(saveReleaseCatalog).toHaveBeenCalledTimes(1);
	});
});
