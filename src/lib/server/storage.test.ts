import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

const blobs = vi.hoisted(() => ({
	getBlockBlobClient: vi.fn(), createIfNotExists: vi.fn(),
	downloadToBuffer: vi.fn(), download: vi.fn(), uploadData: vi.fn()
}));
vi.mock('@azure/storage-blob', () => ({
	BlobServiceClient: {
		fromConnectionString: () => ({ getContainerClient: () => blobs })
	}
}));

import { loadReleaseCatalog, loadReleaseSnapshot, saveReleaseSnapshot } from './storage.js';

beforeEach(() => {
	vi.resetAllMocks();
	vi.stubEnv('AZURE_STORAGE_CONNECTION_STRING', 'UseDevelopmentStorage=true');
	blobs.getBlockBlobClient.mockReturnValue(blobs);
});

describe('scoped snapshot storage', () => {
	it('keeps legacy ALZ blob names and separates SLZ snapshots at the same SHA', async () => {
		const sha = 'a'.repeat(40);
		const alz = new Map([['platform/alz/README.md', 'ALZ']]);
		const slz = new Map([['platform/slz/README.md', 'SLZ']]);
		await saveReleaseSnapshot(sha, alz, 'alz');
		await saveReleaseSnapshot(sha, slz, 'slz');
		expect(blobs.getBlockBlobClient.mock.calls.map(([name]) => name))
			.toEqual([`snapshots-v1/${sha}.json`, `snapshots-v2/slz/${sha}.json`]);
		expect(blobs.uploadData).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({
			conditions: { ifNoneMatch: '*' }
		}));
		blobs.downloadToBuffer.mockResolvedValue(Buffer.from(JSON.stringify([...slz])));
		expect(await loadReleaseSnapshot(sha, 'slz')).toEqual(slz);
		await expect(loadReleaseSnapshot(sha, 'alz')).rejects.toThrow('snapshot is invalid');
	});

	it('accepts an existing ALZ-only catalog and validates SLZ dependency records', async () => {
		const release = { tag: 'platform/alz/1.0.0', version: '1.0.0', sha: 'a'.repeat(40),
			referenceSha: 'a'.repeat(40), url: 'https://github.com/Azure/Azure-Landing-Zones-Library' };
		const catalog = { schemaVersion: 1, syncedAt: '2026-01-01T00:00:00.000Z', releases: [release] };
		const mockCatalog = (value: unknown) => blobs.download.mockImplementation(async () => ({
			etag: '"etag"', readableStreamBody: Readable.from([Buffer.from(JSON.stringify(value))])
		}));
		mockCatalog(catalog);
		expect((await loadReleaseCatalog())?.catalog).toEqual(catalog);
		const slz = { ...release, tag: 'platform/slz/1.0.0' };
		mockCatalog({ ...catalog, releases: [release, slz] });
		await expect(loadReleaseCatalog()).rejects.toThrow('catalog is invalid');
		mockCatalog({ ...catalog, releases: [release, { ...slz, dependency: release }] });
		expect((await loadReleaseCatalog())?.catalog.releases).toHaveLength(2);
	});
});
