import { AppError } from './errors.js';
import type { LibraryRelease, StoredRelease } from '../types.js';
import { libraryForTag, libraryScope, type Library } from '../libraries.js';

const OWNER = 'Azure';
const REPOSITORY = 'Azure-Landing-Zones-Library';
const API_BASE = `https://api.github.com/repos/${OWNER}/${REPOSITORY}`;
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

interface GitReference {
	ref: string;
	object: { type: string; sha: string };
}

interface GitTag {
	object: { type: string; sha: string };
}

function parseVersion(tag: string) {
	const version = tag.slice(tag.lastIndexOf('/') + 1);
	const match = VERSION_PATTERN.exec(version);
	if (!match) return null;
	return { version, major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] };
}

function compareReleases(left: LibraryRelease, right: LibraryRelease) {
	const a = parseVersion(left.tag);
	const b = parseVersion(right.tag);
	if (!a || !b) return left.tag.localeCompare(right.tag);
	for (const key of ['major', 'minor', 'patch'] as const) {
		if (a[key] !== b[key]) return b[key] - a[key];
	}
	if (a.prerelease === b.prerelease) return 0;
	if (!a.prerelease) return -1;
	if (!b.prerelease) return 1;
	return b.prerelease.localeCompare(a.prerelease);
}

export function isAlzTag(tag: unknown): tag is string {
	return libraryForTag(tag) === 'alz';
}

function releaseUrl(tag: string) {
	return `https://github.com/${OWNER}/${REPOSITORY}/tree/${tag.split('/').map(encodeURIComponent).join('/')}`;
}

async function getJson<T>(url: string): Promise<T> {
	let response: Response;
	const token = process.env.GITHUB_TOKEN;
	try {
		response = await fetch(url, {
			headers: {
				accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				'user-agent': 'alz-library-diff',
				...(token ? { authorization: `Bearer ${token}` } : {})
			},
			signal: AbortSignal.timeout(15_000)
		});
	} catch (error) {
		console.error('GitHub request failed before a response was received.', error);
		throw new AppError('GitHub could not be reached. Check the connection and try again.', 502);
	}

	if (!response.ok) {
		const remaining = response.headers.get('x-ratelimit-remaining');
		const retryAfter = response.headers.get('retry-after');
		const rateLimited = response.status === 429 || (response.status === 403 && remaining === '0');
		const wait = retryAfter ? ` Try again in ${retryAfter} seconds.` : '';
		if (rateLimited) {
			throw new AppError(`GitHub API rate limit reached.${wait}`, 429);
		}
		if (response.status === 404) {
			throw new AppError('The requested library release was not found in the upstream repository.', 404);
		}
		throw new AppError(`GitHub returned ${response.status} while reading release data. Try again later.`, 502);
	}

	return (await response.json()) as T;
}

export async function discoverAlzReleases(previous: StoredRelease[] = []): Promise<StoredRelease[]> {
	return discoverReleases('alz', previous);
}

export async function discoverReleases(library: Library, previous: StoredRelease[] = []): Promise<StoredRelease[]> {
	// Matching refs returns all matches; this endpoint does not support pagination.
	const references = await getJson<GitReference[]>(`${API_BASE}/git/matching-refs/tags/${libraryScope(library)}`);

	const releases: StoredRelease[] = [];
	for (const reference of references) {
		const tag = reference.ref.replace(/^refs\/tags\//, '');
		if (libraryForTag(tag) !== library) continue;
		const cached = previous.find((release) => release.tag === tag && release.referenceSha === reference.object.sha);
		const sha = cached?.sha ?? await resolveReferenceCommit(tag, reference.object);
		releases.push({ tag, version: parseVersion(tag)!.version, url: releaseUrl(tag), sha, referenceSha: reference.object.sha });
	}

	return [...new Map(releases.map((release) => [release.tag, release])).values()].sort(compareReleases);
}

async function resolveReferenceCommit(tag: string, reference: GitReference['object']): Promise<string> {
	if (!libraryForTag(tag)) throw new AppError('Choose a published ALZ or SLZ release tag.', 400);

	let object = reference;
	const seen = new Set<string>();

	for (let depth = 0; object.type === 'tag'; depth += 1) {
		if (depth >= 8 || seen.has(object.sha)) {
			throw new AppError(`The upstream tag ${tag} has an invalid tag-object chain.`, 502);
		}
		seen.add(object.sha);
		const annotatedTag = await getJson<GitTag>(`${API_BASE}/git/tags/${encodeURIComponent(object.sha)}`);
		object = annotatedTag.object;
	}

	if (object.type !== 'commit' || !/^[0-9a-f]{40}$/i.test(object.sha)) {
		throw new AppError(`The upstream tag ${tag} does not point to a commit.`, 502);
	}
	return object.sha.toLowerCase();
}

export async function discoverSlzDependency(release: StoredRelease): Promise<string> {
	const file = await getJson<{ content?: string; encoding?: string }>(
		`${API_BASE}/contents/platform/slz/alz_library_metadata.json?ref=${encodeURIComponent(release.sha)}`);
	if (file.encoding !== 'base64' || typeof file.content !== 'string') {
		throw new AppError(`SLZ dependency metadata is unavailable for ${release.tag}.`, 502);
	}
	let metadata: unknown;
	try {
		metadata = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
	} catch (error) {
		console.error('Invalid SLZ dependency metadata.', { tag: release.tag, error });
		throw new AppError(`SLZ dependency metadata is invalid for ${release.tag}.`, 502);
	}
	if (!metadata || typeof metadata !== 'object' || !('dependencies' in metadata)
		|| !Array.isArray(metadata.dependencies) || metadata.dependencies.length !== 1) {
		throw new AppError(`SLZ release ${release.tag} must declare one pinned ALZ dependency.`, 502);
	}
	const dependency: unknown = metadata.dependencies[0];
	if (!dependency || typeof dependency !== 'object' || !('path' in dependency)
		|| dependency.path !== 'platform/alz' || !('ref' in dependency)
		|| typeof dependency.ref !== 'string' || !isAlzTag(`platform/alz/${dependency.ref}`)) {
		throw new AppError(`SLZ release ${release.tag} has an unsupported ALZ dependency.`, 502);
	}
	return `platform/alz/${dependency.ref}`;
}
