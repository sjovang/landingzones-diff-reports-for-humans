import { AppError } from './errors.js';
import type { AlzRelease, StoredRelease } from '../types.js';

const OWNER = 'Azure';
const REPOSITORY = 'Azure-Landing-Zones-Library';
const API_BASE = `https://api.github.com/repos/${OWNER}/${REPOSITORY}`;
const ALZ_TAG_PREFIX = 'platform/alz/';
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

interface GitReference {
	ref: string;
	object: { type: string; sha: string };
}

interface GitTag {
	object: { type: string; sha: string };
}

function parseVersion(tag: string) {
	const version = tag.slice(ALZ_TAG_PREFIX.length);
	const match = VERSION_PATTERN.exec(version);
	if (!match) return null;
	return { version, major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] };
}

function compareReleases(left: AlzRelease, right: AlzRelease) {
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
	return typeof tag === 'string' && tag.startsWith(ALZ_TAG_PREFIX) && parseVersion(tag) !== null;
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
			throw new AppError('The requested ALZ release tag was not found in the upstream repository.', 404);
		}
		throw new AppError(`GitHub returned ${response.status} while reading release data. Try again later.`, 502);
	}

	return (await response.json()) as T;
}

export async function discoverAlzReleases(previous: StoredRelease[] = []): Promise<StoredRelease[]> {
	// Matching refs returns all matches; this endpoint does not support pagination.
	const references = await getJson<GitReference[]>(`${API_BASE}/git/matching-refs/tags/${ALZ_TAG_PREFIX}`);

	const releases: StoredRelease[] = [];
	for (const reference of references) {
		const tag = reference.ref.replace(/^refs\/tags\//, '');
		if (!isAlzTag(tag)) continue;
		const cached = previous.find((release) => release.tag === tag && release.referenceSha === reference.object.sha);
		const sha = cached?.sha ?? await resolveReferenceCommit(tag, reference.object);
		releases.push({ tag, version: parseVersion(tag)!.version, url: releaseUrl(tag), sha, referenceSha: reference.object.sha });
	}

	return [...new Map(releases.map((release) => [release.tag, release])).values()].sort(compareReleases);
}

async function resolveReferenceCommit(tag: string, reference: GitReference['object']): Promise<string> {
	if (!isAlzTag(tag)) throw new AppError('Choose a published ALZ release tag.', 400);

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
