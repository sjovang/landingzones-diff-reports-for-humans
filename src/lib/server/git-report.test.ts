import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import git from 'isomorphic-git';

vi.mock('isomorphic-git', () => ({
	default: {
		init: vi.fn(),
		addRemote: vi.fn(),
		fetch: vi.fn(),
		readCommit: vi.fn(),
		readTree: vi.fn(),
		readBlob: vi.fn()
	}
}));
vi.mock('isomorphic-git/http/node', () => ({ default: {} }));
vi.mock('./storage.js', () => ({
	loadReleaseSnapshot: vi.fn(),
	saveReleaseSnapshot: vi.fn()
}));
import { loadReleaseSnapshot, saveReleaseSnapshot } from './storage.js';
import { generateComparisonReport, getReleaseSnapshot } from './git-report.js';

const before = { tag: 'platform/alz/1.0.0', version: '1.0.0', sha: 'a'.repeat(40), url: 'https://github.com/Azure/Azure-Landing-Zones-Library' };
const after = { ...before, tag: 'platform/alz/1.1.0', sha: 'b'.repeat(40) };
const files = new Map([['platform/alz/README.md', 'Stored release content']]);

function prepareGitSnapshot(commitSha = before.sha, content = 'ALZ source') {
	vi.mocked(git.init).mockResolvedValue(undefined);
	vi.mocked(git.addRemote).mockResolvedValue(undefined);
	vi.mocked(git.fetch).mockResolvedValue({
		defaultBranch: 'refs/heads/main',
		fetchHead: commitSha,
		fetchHeadDescription: before.tag
	});
	vi.mocked(git.readCommit).mockResolvedValue({
		oid: commitSha,
		commit: { tree: 'root-tree' }
	} as Awaited<ReturnType<typeof git.readCommit>>);
	vi.mocked(git.readTree).mockImplementation(async ({ oid }) => {
		const entries = oid === 'root-tree'
			? [{ mode: '040000', path: 'platform', oid: 'platform-tree', type: 'tree' }]
			: oid === 'platform-tree'
				? [
					{ mode: '040000', path: 'alz', oid: 'alz-tree', type: 'tree' },
					{ mode: '040000', path: 'slz', oid: 'slz-tree', type: 'tree' }
				]
				: oid === 'alz-tree'
					? [{ mode: '100644', path: 'README.md', oid: 'readme-blob', type: 'blob' }]
					: [];
		return { oid, tree: entries } as Awaited<ReturnType<typeof git.readTree>>;
	});
	vi.mocked(git.readBlob).mockImplementation(async ({ oid }) => ({
		oid,
		blob: Buffer.from(content)
	}) as Awaited<ReturnType<typeof git.readBlob>>);
}

beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(loadReleaseSnapshot).mockResolvedValue(files);
});
afterEach(() => vi.unstubAllGlobals());

describe('immutable ALZ snapshot reuse', () => {
	it('reuses the stored commit snapshot without contacting GitHub', async () => {
		expect(await getReleaseSnapshot(before)).toEqual(files);
		expect(await getReleaseSnapshot(before)).toEqual(files);
		expect(saveReleaseSnapshot).not.toHaveBeenCalled();
		expect(git.fetch).not.toHaveBeenCalled();
	});

	it('shares simultaneous snapshot reads within a process', async () => {
		const results = await Promise.all([getReleaseSnapshot(before), getReleaseSnapshot(before)]);
		expect(results).toEqual([files, files]);
		expect(loadReleaseSnapshot).toHaveBeenCalledTimes(1);
	});

	it('fetches only the selected release tree over Git transport without using the REST API', async () => {
		vi.mocked(loadReleaseSnapshot).mockResolvedValue(null);
		prepareGitSnapshot();

		await expect(getReleaseSnapshot(before)).resolves.toEqual(new Map([['platform/alz/README.md', 'ALZ source']]));
		expect(git.addRemote).toHaveBeenCalledWith(expect.objectContaining({
			url: 'https://github.com/Azure/Azure-Landing-Zones-Library.git'
		}));
		expect(git.fetch).toHaveBeenCalledWith(expect.objectContaining({
			ref: `refs/tags/${before.tag}`,
			remoteRef: `refs/tags/${before.tag}`,
			depth: 1,
			singleBranch: true
		}));
		expect(saveReleaseSnapshot).toHaveBeenCalledWith(
			before.sha,
			new Map([['platform/alz/README.md', 'ALZ source']]),
			'alz'
		);
	});

	it('rejects a fetched release tag if it no longer resolves to the synchronized commit', async () => {
		vi.mocked(loadReleaseSnapshot).mockResolvedValue(null);
		prepareGitSnapshot('c'.repeat(40));

		await expect(getReleaseSnapshot(before)).rejects.toThrow('does not match the synchronized commit');
		expect(saveReleaseSnapshot).not.toHaveBeenCalled();
	});

	it('does not share snapshots between libraries at the same commit', async () => {
		const slz = { ...before, tag: 'platform/slz/1.0.0' };
		vi.mocked(loadReleaseSnapshot).mockImplementation(async (_sha, library) => new Map([
			[`platform/${library}/README.md`, library ?? 'alz']
		]));
		const results = await Promise.all([getReleaseSnapshot(before), getReleaseSnapshot(slz)]);
		expect(loadReleaseSnapshot).toHaveBeenCalledWith(before.sha, 'alz');
		expect(loadReleaseSnapshot).toHaveBeenCalledWith(before.sha, 'slz');
		expect(results[0]).not.toEqual(results[1]);
	});

	it('builds new comparison reports entirely from stored contents', async () => {
		const report = await generateComparisonReport({
			fromTag: before.tag, toTag: after.tag, fromSha: before.sha, toSha: after.sha
		}, { from: before, to: after });
		expect(report.totals.changed).toBe(0);
		expect(report.from.sha).toBe(before.sha);
		expect(loadReleaseSnapshot).toHaveBeenCalledTimes(2);
		expect(saveReleaseSnapshot).not.toHaveBeenCalled();
	});

	it('rejects catalog drift and invalid commits before reading contents', async () => {
		await expect(generateComparisonReport({
			fromTag: before.tag, toTag: after.tag, fromSha: after.sha, toSha: after.sha
		}, { from: before, to: after })).rejects.toMatchObject({ status: 409 });
		await expect(getReleaseSnapshot({ tag: before.tag, sha: '--invalid-ref' })).rejects.toThrow('invalid release commit');
		expect(loadReleaseSnapshot).not.toHaveBeenCalled();
	});

	it('surfaces storage errors and allows later reads to retry', async () => {
		vi.mocked(loadReleaseSnapshot).mockRejectedValueOnce(new Error('Storage unavailable'));
		await expect(getReleaseSnapshot(before)).rejects.toThrow('Storage unavailable');
		await expect(getReleaseSnapshot(before)).resolves.toEqual(files);
		expect(loadReleaseSnapshot).toHaveBeenCalledTimes(2);
	});

	it('rejects mixed libraries and queued dependency drift before reading snapshots', async () => {
		const dependency = { ...before };
		const slzBefore = { ...before, tag: 'platform/slz/1.0.0', dependency };
		const slzAfter = { ...after, tag: 'platform/slz/1.1.0', dependency };
		await expect(generateComparisonReport({
			fromTag: slzBefore.tag, toTag: after.tag, fromSha: before.sha, toSha: after.sha
		}, { from: slzBefore, to: after })).rejects.toThrow('cannot be compared');
		await expect(generateComparisonReport({
			fromTag: slzBefore.tag, toTag: slzAfter.tag, fromSha: before.sha, toSha: after.sha,
			fromDependencySha: 'c'.repeat(40), toDependencySha: dependency.sha
		}, { from: slzBefore, to: slzAfter })).rejects.toMatchObject({ status: 409 });
		expect(loadReleaseSnapshot).not.toHaveBeenCalled();
	});

	it('builds SLZ reports from both scoped snapshots and pinned dependencies', async () => {
		const dependency = { ...before };
		const from = { ...before, tag: 'platform/slz/1.0.0', dependency };
		const to = { ...after, tag: 'platform/slz/1.1.0', dependency: { ...dependency, sha: after.sha } };
		vi.mocked(loadReleaseSnapshot).mockImplementation(async (_sha, library) => new Map([
			[`platform/${library}/README.md`, 'Readme']
		]));
		const report = await generateComparisonReport({
			fromTag: from.tag, toTag: to.tag, fromSha: from.sha, toSha: to.sha,
			fromDependencySha: from.dependency.sha, toDependencySha: to.dependency.sha
		}, { from, to });
		expect(report.scope).toBe('platform/slz/');
		expect(report.coverage.explanation).toContain('pinned ALZ dependencies');
		expect(loadReleaseSnapshot).toHaveBeenCalledTimes(4);
	});
});
