import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverAlzReleases, discoverReleases, discoverSlzDependency, isAlzTag } from './github.js';
import { libraryForTag } from '../libraries.js';

const currentSha = 'a'.repeat(40);
const previousSha = 'b'.repeat(40);
function reference(tag: string, sha: string, type = 'commit') {
	return { ref: `refs/tags/${tag}`, object: { type, sha } };
}
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
			vi.stubGlobal('fetch', vi.fn(async () => Response.json([
				reference('platform/slz/1.1.0', previousSha),
				reference('platform/alz/9.0.0', currentSha),
				reference('platform/slz/2.0.0', currentSha),
				reference('platform/slz/main', currentSha)
			])));
			expect(libraryForTag('platform/slz/2024.07.02')).toBe('slz');
			expect(libraryForTag('platform/amba/1.0.0')).toBeNull();
			expect(libraryForTag('platform/slz/1.0.0/../alz')).toBeNull();
			expect((await discoverReleases('slz')).map((release) => release.tag))
				.toEqual(['platform/slz/2.0.0', 'platform/slz/1.1.0']);
		});

		it('reads metadata at the immutable SLZ commit and rejects unsupported dependencies', async () => {
			const release = { tag: 'platform/slz/1.0.0', version: '1.0.0', sha: currentSha, referenceSha: currentSha, url: '' };
			const fetchMock = vi.fn(async () => Response.json({ encoding: 'base64',
				content: Buffer.from(JSON.stringify({ dependencies: [{ path: 'platform/alz', ref: '2024.07.02' }] })).toString('base64') }));
			vi.stubGlobal('fetch', fetchMock);
			expect(await discoverSlzDependency(release)).toBe('platform/alz/2024.07.02');
			expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`ref=${currentSha}`), expect.any(Object));
			for (const dependencies of [[], [{ path: 'platform/amba', ref: '1.0.0' }], [{ path: 'platform/alz', ref: 'main' }]]) {
				fetchMock.mockImplementation(async () => Response.json({ encoding: 'base64',
					content: Buffer.from(JSON.stringify({ dependencies })).toString('base64') }));
				await expect(discoverSlzDependency(release)).rejects.toMatchObject({ status: 502 });
			}
		});
	});

	it('obtains commit SHAs directly from the tag listing without redundant per-tag requests', async () => {
		const fetchMock = vi.fn(async () => Response.json([
			reference('platform/alz/2025.10.0', previousSha),
			reference('platform/slz/2026.10.0', currentSha),
			reference('platform/alz/2026.10.0', currentSha),
			reference('platform/alz/2026.10.0-rc.1', previousSha)
		]));
		vi.stubGlobal('fetch', fetchMock);
		const releases = await discoverAlzReleases();
		expect(releases.map((release) => release.tag)).toEqual([
			'platform/alz/2026.10.0', 'platform/alz/2026.10.0-rc.1', 'platform/alz/2025.10.0'
		]);
		expect(releases[0].sha).toBe(currentSha);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('dereferences annotated tags only when new or changed', async () => {
		const tagSha = 'c'.repeat(40);
		const fetchMock = vi.fn(async (url: string) =>
			url.includes('/git/tags/') ? Response.json({ object: { type: 'commit', sha: currentSha } })
				: Response.json([reference('platform/alz/2026.10.0', tagSha, 'tag')]));
		vi.stubGlobal('fetch', fetchMock);
		const first = await discoverAlzReleases();
		expect(first[0].sha).toBe(currentSha);
		expect(first[0].referenceSha).toBe(tagSha);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		fetchMock.mockClear();
		expect(await discoverAlzReleases(first)).toEqual(first);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('updates moved tags and removes deleted tags on the next sync', async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(Response.json([
				reference('platform/alz/2026.10.0', previousSha), reference('platform/alz/2025.10.0', previousSha)
			]))
			.mockResolvedValueOnce(Response.json([reference('platform/alz/2026.10.0', currentSha)]));
		vi.stubGlobal('fetch', fetchMock);
		const first = await discoverAlzReleases();
		const next = await discoverAlzReleases(first);
		expect(next).toHaveLength(1);
		expect(next[0].sha).toBe(currentSha);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('fails explicitly when GitHub rate limits the scheduled sync', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('', {
			status: 403, headers: { 'x-ratelimit-remaining': '0' }
		})));
		await expect(discoverAlzReleases()).rejects.toThrow('rate limit');
	});

	it('does not repeat the unpaginated matching-ref request when there are over 100 releases', async () => {
		const fetchMock = vi.fn(async () => Response.json(Array.from({ length: 101 }, (_, index) =>
			reference(`platform/alz/1.${index}.0`, currentSha))));
		vi.stubGlobal('fetch', fetchMock);
		expect(await discoverAlzReleases()).toHaveLength(101);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
