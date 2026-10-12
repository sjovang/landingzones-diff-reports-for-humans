import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { TIMELINE_SCHEMA_VERSION, type TimelineIndex, type TimelineReport } from '../timelines.js';

const blobs = vi.hoisted(() => ({
	getBlockBlobClient: vi.fn(), createIfNotExists: vi.fn(), getProperties: vi.fn(),
	downloadToBuffer: vi.fn(), download: vi.fn(), uploadData: vi.fn()
}));
vi.mock('@azure/storage-blob', () => ({
	BlobServiceClient: { fromConnectionString: () => ({ getContainerClient: () => blobs }) }
}));
import { getTimelineIndexEtag, loadTimelineIndex, loadTimelineReport, publishTimelineIndex, saveTimelineReport } from './storage.js';

const summary = {
	library: 'alz' as const, kind: 'policy' as const, name: 'Audit-Tags-Mandatory', title: 'Audit for mandatory tags',
	firstRelease: '2026.01.0', latestRelease: '2026.02.0', presentInLatest: true,
	deprecated: false, releaseCount: 2, changeCount: 1, gapCount: 0
};
const index: TimelineIndex = {
	schemaVersion: TIMELINE_SCHEMA_VERSION, generationId: '11111111-1111-4111-8111-111111111111',
	generatedAt: '2026-10-12T12:00:00.000Z', syncedAt: '2026-10-12T11:00:00.000Z', reports: [summary], gaps: []
};
const report: TimelineReport = {
	...summary, ...index,
	entries: [{ release: {
		tag: 'platform/alz/2026.02.0', version: '2026.02.0',
		url: 'https://github.com/Azure/Azure-Landing-Zones-Library/tree/platform/alz/2026.02.0'
	}, status: 'unchanged' }]
};
function mockIndex(value: unknown = index) {
	blobs.download.mockImplementation(async () => ({
		etag: '"index"', readableStreamBody: Readable.from([Buffer.from(JSON.stringify(value))])
	}));
}

beforeEach(() => {
	vi.resetAllMocks();
	vi.stubEnv('AZURE_STORAGE_CONNECTION_STRING', 'UseDevelopmentStorage=true');
	blobs.getBlockBlobClient.mockReturnValue(blobs);
	mockIndex();
	blobs.downloadToBuffer.mockResolvedValue(Buffer.from(JSON.stringify(report)));
});

describe('independent timeline publication storage', () => {
	it('keeps report blobs immutable and hashes names rather than treating them as storage paths', async () => {
		await saveTimelineReport(report);
		const first = blobs.getBlockBlobClient.mock.calls.at(-1)![0];
		expect(first).toMatch(/^timelines-v1\/11111111-1111-4111-8111-111111111111\/[a-f0-9]{64}\.json$/);
		await saveTimelineReport({ ...report, name: '../same/name' });
		const second = blobs.getBlockBlobClient.mock.calls.at(-1)![0];
		expect(second).not.toBe(first);
		expect(second).not.toContain('../');
		expect(blobs.uploadData).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({ conditions: { ifNoneMatch: '*' } }));
	});

	it('uses conditional publication and reports conflicts instead of overwriting', async () => {
		await publishTimelineIndex(index);
		expect(blobs.uploadData).toHaveBeenLastCalledWith(expect.any(Buffer), expect.objectContaining({ conditions: { ifNoneMatch: '*' } }));
		await publishTimelineIndex(index, '"previous"');
		expect(blobs.uploadData).toHaveBeenLastCalledWith(expect.any(Buffer), expect.objectContaining({ conditions: { ifMatch: '"previous"' } }));
		blobs.uploadData.mockRejectedValue({ statusCode: 412 });
		await expect(publishTimelineIndex(index, '"previous"')).rejects.toThrow('Another timeline generation');
	});

	it('loads only a published generation and returns explicit missing-generation and identity errors', async () => {
		expect(await loadTimelineIndex()).toEqual({ index, etag: '"index"' });
		expect(await loadTimelineReport(summary)).toEqual(report);
		await expect(loadTimelineReport({ ...summary, name: 'Unknown' })).rejects.toMatchObject({ status: 404 });
		blobs.download.mockRejectedValue({ statusCode: 404 });
		expect(await loadTimelineIndex()).toBeNull();
		await expect(loadTimelineReport(summary)).rejects.toMatchObject({ status: 503 });
	});

	it('rejects wrong schema, mismatched identity, and missing report blobs', async () => {
		mockIndex({ ...index, schemaVersion: 0 });
		await expect(loadTimelineIndex()).rejects.toThrow('incompatible or invalid');
		mockIndex();
		blobs.downloadToBuffer.mockResolvedValue(Buffer.from(JSON.stringify({ ...report, name: 'Other' })));
		await expect(loadTimelineReport(summary)).rejects.toThrow('incompatible or invalid');
		blobs.downloadToBuffer.mockRejectedValue({ statusCode: 404 });
		await expect(loadTimelineReport(summary)).rejects.toThrow('missing its report');
	});

	it('allows regeneration of an incompatible index by reading its raw publication ETag', async () => {
		mockIndex({ schemaVersion: 0 });
		blobs.getProperties.mockResolvedValue({ etag: '"old-schema"' });
		expect(await getTimelineIndexEtag()).toBe('"old-schema"');
		expect(blobs.download).not.toHaveBeenCalled();
		blobs.getProperties.mockRejectedValue({ statusCode: 404 });
		expect(await getTimelineIndexEtag()).toBeUndefined();
		blobs.getProperties.mockRejectedValue(new Error('Forbidden'));
		await expect(getTimelineIndexEtag()).rejects.toThrow('Forbidden');
	});

	it('reads coverage gaps and an unknown latest state without rejecting the publication', async () => {
		const release = report.entries[0].release;
		const partial = { ...report, presentInLatest: null, gapCount: 1,
			entries: [{ release, status: 'gap', gapReason: 'Missing cached snapshot.' }, ...report.entries] };
		const partialIndex = { ...index, reports: [{ ...summary, presentInLatest: null, gapCount: 1 }],
			gaps: [{ library: 'alz', release, reason: 'Missing cached snapshot.' }] };
		mockIndex(partialIndex);
		blobs.downloadToBuffer.mockResolvedValue(Buffer.from(JSON.stringify(partial)));
		expect((await loadTimelineIndex())?.index).toEqual(partialIndex);
		expect(await loadTimelineReport(summary)).toEqual(partial);
		blobs.downloadToBuffer.mockResolvedValue(Buffer.from(JSON.stringify({
			...partial, entries: [{ release, status: 'gap' }]
		})));
		await expect(loadTimelineReport(summary)).rejects.toThrow('incompatible or invalid');
	});
});
