import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import { AppError } from './errors.js';
import type { LibraryRelease, StoredRelease } from '../types.js';
import { libraryForTag, type Library } from '../libraries.js';

const OWNER = 'Azure';
const REPOSITORY = 'Azure-Landing-Zones-Library';
const REPOSITORY_URL = `https://github.com/${OWNER}/${REPOSITORY}.git`;
const RAW_BASE = `https://raw.githubusercontent.com/${OWNER}/${REPOSITORY}`;
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

interface GitReference {
	tag: string;
	referenceSha: string;
	sha: string;
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

function flattenRefs(value: unknown, prefix = '', refs: Array<[string, string]> = []): Array<[string, string]> {
	if (!value || typeof value !== 'object') return refs;
	for (const [name, entry] of Object.entries(value)) {
		const ref = prefix ? `${prefix}/${name}` : name;
		if (typeof entry === 'string') refs.push([ref, entry]);
		else flattenRefs(entry, ref, refs);
	}
	return refs;
}

async function getReleaseReferences(library: Library): Promise<GitReference[]> {
	let info: Awaited<ReturnType<typeof git.getRemoteInfo>>;
	try {
		info = await git.getRemoteInfo({ http, url: REPOSITORY_URL });
	} catch (error) {
		console.error('Git could not retrieve upstream release references.', error);
		throw new AppError('The upstream library could not be reached. Check the connection and try again.', 502);
	}

	const tagRefs = flattenRefs(info.refs?.tags);
	const peeledRefs = new Map(tagRefs
		.filter(([tag]) => tag.endsWith('^{}'))
		.map(([tag, sha]) => [tag.slice(0, -3), sha]));
	const releases: GitReference[] = [];
	for (const [tag, referenceSha] of tagRefs) {
		if (tag.endsWith('^{}') || libraryForTag(tag) !== library) continue;
		const sha = peeledRefs.get(tag) ?? referenceSha;
		if (!SHA_PATTERN.test(referenceSha) || !SHA_PATTERN.test(sha)) {
			throw new AppError(`The upstream release tag ${tag} has an invalid commit reference.`, 502);
		}
		releases.push({ tag, referenceSha, sha });
	}
	return releases;
}

export async function discoverAlzReleases(previous: StoredRelease[] = []): Promise<StoredRelease[]> {
	return discoverReleases('alz', previous);
}

export async function discoverReleases(library: Library, previous: StoredRelease[] = []): Promise<StoredRelease[]> {
	const releases: StoredRelease[] = [];
	for (const reference of await getReleaseReferences(library)) {
		const cached = previous.find((release) => release.tag === reference.tag && release.referenceSha === reference.referenceSha);
		releases.push({
			tag: reference.tag,
			version: parseVersion(reference.tag)!.version,
			url: releaseUrl(reference.tag),
			sha: cached?.sha ?? reference.sha.toLowerCase(),
			referenceSha: reference.referenceSha.toLowerCase()
		});
	}

	return [...new Map(releases.map((release) => [release.tag, release])).values()].sort(compareReleases);
}

export async function discoverSlzDependency(release: StoredRelease): Promise<string> {
	if (!SHA_PATTERN.test(release.sha)) throw new AppError('The SLZ release has an invalid commit reference.', 502);
	let response: Response;
	try {
		response = await fetch(`${RAW_BASE}/${release.sha}/platform/slz/alz_library_metadata.json`, {
			headers: { 'user-agent': 'alz-library-diff' },
			signal: AbortSignal.timeout(15_000)
		});
	} catch (error) {
		console.error('GitHub request failed while reading SLZ dependency metadata.', error);
		throw new AppError('SLZ dependency metadata could not be retrieved. Try again later.', 502);
	}
	if (!response.ok) {
		throw new AppError(`SLZ dependency metadata is unavailable for ${release.tag}.`, 502);
	}

	let metadata: unknown;
	try {
		metadata = await response.json();
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
