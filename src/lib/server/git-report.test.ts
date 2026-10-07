import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./storage.js', () => ({
	loadReleaseSnapshot: vi.fn(),
	saveReleaseSnapshot: vi.fn()
}));
import { loadReleaseSnapshot, saveReleaseSnapshot } from './storage.js';
import { generateComparisonReport, getReleaseSnapshot } from './git-report.js';

const before = { tag: 'platform/alz/1.0.0', version: '1.0.0', sha: 'a'.repeat(40), url: 'https://github.com/Azure/Azure-Landing-Zones-Library' };
const after = { ...before, tag: 'platform/alz/1.1.0', version: '1.1.0', sha: 'b'.repeat(40) };
const files = new Map([['platform/alz/README.md', 'Stored release content']]);
beforeEach(() => {
	vi.resetAllMocks();
	vi.stubEnv('GIT_EXECUTABLE', '/nonexistent-git-for-cache-test');
	vi.mocked(loadReleaseSnapshot).mockResolvedValue(files);
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe('immutable ALZ snapshot reuse', () => {
	it('reuses the stored commit snapshot across repeated reads without Git or GitHub', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		expect(await getReleaseSnapshot(before)).toEqual(files);
		expect(await getReleaseSnapshot(before)).toEqual(files);
		expect(saveReleaseSnapshot).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('shares simultaneous snapshot reads within a process', async () => {
		const results = await Promise.all([getReleaseSnapshot(before), getReleaseSnapshot(before)]);
		expect(results).toEqual([files, files]);
		expect(loadReleaseSnapshot).toHaveBeenCalledTimes(1);
	});

	it('builds new comparison reports entirely from stored contents', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const report = await generateComparisonReport({
			fromTag: before.tag, toTag: after.tag, fromSha: before.sha, toSha: after.sha
		}, { from: before, to: after });
		expect(report.totals.changed).toBe(0);
		expect(report.from.sha).toBe(before.sha);
		expect(loadReleaseSnapshot).toHaveBeenCalledTimes(2);
		expect(saveReleaseSnapshot).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects catalog drift and invalid commits before reading contents', async () => {
		await expect(generateComparisonReport({
			fromTag: before.tag, toTag: after.tag, fromSha: after.sha, toSha: after.sha
		}, { from: before, to: after })).rejects.toMatchObject({ status: 409 });
		await expect(getReleaseSnapshot({ sha: '--invalid-ref' })).rejects.toThrow('invalid release commit');
		expect(loadReleaseSnapshot).not.toHaveBeenCalled();
	});

	it('surfaces storage errors and allows later reads to retry', async () => {
		vi.mocked(loadReleaseSnapshot).mockRejectedValueOnce(new Error('Storage unavailable'));
		await expect(getReleaseSnapshot(before)).rejects.toThrow('Storage unavailable');
		expect(await getReleaseSnapshot(before)).toEqual(files);
		expect(loadReleaseSnapshot).toHaveBeenCalledTimes(2);
	});
});
