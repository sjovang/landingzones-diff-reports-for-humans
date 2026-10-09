import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('isomorphic-git', () => ({ default: { getRemoteInfo: vi.fn() } }));
vi.mock('isomorphic-git/http/node', () => ({ default: {} }));
import git from 'isomorphic-git';
import { discoverAlzReleases, discoverReleases, discoverSlzDependency, isAlzTag } from './github.js';
import { libraryForTag } from '../libraries.js';

const currentSha = 'a'.repeat(40);
const previousSha = 'b'.repeat(40);

interface TestRef {
	tag: string;
	sha: string;
	peeledSha?: string;
}

function remoteInfo(references: TestRef[]) {
	const tags: Record<string, unknown> = {};
	for (const reference of references) {
		const refs: Array<[string, string]> = [[reference.tag, reference.sha]];
		if (reference.peeledSha) refs.push([`${reference.tag}^{}`, reference.peeledSha]);
		for (const [tag, sha] of refs) {
			const parts = tag.trimEnd().split('/');
			let node = tags;
			for (const part of parts.slice(0, -1)) {
				node[part] ??= {};
				node = node[part] as Record<string, unknown>;
			}
			node[parts.at(-1)!] = sha;
		}
	}
	return { capabilities: [], refs: { tags } } as Awaited<ReturnType<typeof git.getRemoteInfo>>;
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe('scheduled ALZ release discovery', () => {
	it('accepts only semantic-version tags in the ALZ stream', () => {
		expect(isAlzTag('platform/alz/2026.10.0')).toBe(true);
		expect(isAlzTag('platform/alz/v2.3.4-rc.1')).toBe(true);
		expect(isAlzTag('platform/slz/2026.10.0')).toBe(false);
		expect(isAlzTag('platform/alz/not-a-version')).toBe(false);
	});

	describe('SLZ discovery', () => {
		it('accepts SLZ versions and independently sorts only the selected stream', async () => {
			vi.mocked(git.getRemoteInfo).mockResolvedValue(remoteInfo([
				{ tag: 'platform/slz/1.1.0', sha: previousSha },
				{ tag: 'platform/alz/9.0.0', sha: currentSha },
				{ tag: 'platform/slz/2.0.0', sha: currentSha },
				{ tag: 'platform/slz/main', sha: currentSha }
			]));
			expect(libraryForTag('platform/slz/2024.07.02')).toBe('slz');
			expect(libraryForTag('platform/amba/1.0.0')).toBeNull();
			expect(libraryForTag('platform/slz/1.0.0/../alz')).toBeNull();
			expect((await discoverReleases('slz')).map((release) => release.tag))
				.toEqual(['platform/slz/2.0.0', 'platform/slz/1.1.0']);
		});

		it('reads metadata at the immutable SLZ commit and rejects unsupported dependencies', async () => {
			const release = { tag: 'platform/slz/1.0.0', version: '1.0.0', sha: currentSha, referenceSha: currentSha, url: '' };
			const fetchMock = vi.fn(async () => Response.json({
				dependencies: [{ path: 'platform/alz', ref: '2024.07.02' }]
			}));
			vi.stubGlobal('fetch', fetchMock);
			expect(await discoverSlzDependency(release)).toBe('platform/alz/2024.07.02');
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining(`/${currentSha}/platform/slz/alz_library_metadata.json`),
				expect.any(Object)
			);
			for (const dependencies of [[], [{ path: 'platform/amba', ref: '1.0.0' }], [{ path: 'platform/alz', ref: 'main' }]]) {
				fetchMock.mockImplementation(async () => Response.json({ dependencies }));
				await expect(discoverSlzDependency(release)).rejects.toMatchObject({ status: 502 });
			}
		});
	});

	it('obtains commit SHAs directly from Git refs without REST API requests', async () => {
		vi.mocked(git.getRemoteInfo).mockResolvedValue(remoteInfo([
			{ tag: 'platform/alz/2025.10.0', sha: previousSha },
			{ tag: 'platform/slz/2026.10.0', sha: currentSha },
			{ tag: 'platform/alz/2026.10.0', sha: currentSha },
			{ tag: 'platform/alz/2026.10.0-rc.1', sha: previousSha }
		]));
		const releases = await discoverAlzReleases();
		expect(releases.map((release) => release.tag)).toEqual([
			'platform/alz/2026.10.0', 'platform/alz/2026.10.0-rc.1', 'platform/alz/2025.10.0'
		]);
		expect(releases[0].sha).toBe(currentSha);
		expect(git.getRemoteInfo).toHaveBeenCalledTimes(1);
	});

	it('uses peeled commit SHAs for annotated release tags', async () => {
		const tagSha = 'c'.repeat(40);
		vi.mocked(git.getRemoteInfo).mockResolvedValue(remoteInfo([
			{ tag: 'platform/alz/2026.10.0', sha: tagSha, peeledSha: currentSha }
		]));
		const first = await discoverAlzReleases();
		expect(first[0].sha).toBe(currentSha);
		expect(first[0].referenceSha).toBe(tagSha);
		vi.mocked(git.getRemoteInfo).mockResolvedValue(remoteInfo([
			{ tag: 'platform/alz/2026.10.0', sha: tagSha, peeledSha: currentSha }
		]));
		expect(await discoverAlzReleases(first)).toEqual(first);
	});

	it('updates moved tags and removes deleted tags on the next sync', async () => {
		vi.mocked(git.getRemoteInfo)
			.mockResolvedValueOnce(remoteInfo([
				{ tag: 'platform/alz/2026.10.0', sha: previousSha },
				{ tag: 'platform/alz/2025.10.0', sha: previousSha }
			]))
			.mockResolvedValueOnce(remoteInfo([{ tag: 'platform/alz/2026.10.0', sha: currentSha }]));
		const first = await discoverAlzReleases();
		const next = await discoverAlzReleases(first);
		expect(next).toHaveLength(1);
		expect(next[0].sha).toBe(currentSha);
	});

	it('reports upstream Git transport failures explicitly', async () => {
		vi.mocked(git.getRemoteInfo).mockRejectedValue(new Error('remote unavailable'));
		await expect(discoverAlzReleases()).rejects.toThrow('upstream library could not be reached');
	});

	it('does not paginate Git tag refs when there are over 100 releases', async () => {
		vi.mocked(git.getRemoteInfo).mockResolvedValue(remoteInfo(Array.from({ length: 101 }, (_, index) =>
			({ tag: `platform/alz/1.${index}.0`, sha: currentSha }))));
		expect(await discoverAlzReleases()).toHaveLength(101);
		expect(git.getRemoteInfo).toHaveBeenCalledTimes(1);
	});
});
