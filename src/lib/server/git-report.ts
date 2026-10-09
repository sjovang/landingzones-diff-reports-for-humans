import fs from 'node:fs';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError } from './errors.js';
import { analyzeReleases, summarizeChanges, type ReleaseFiles } from './analysis.js';
import { REPORT_SCHEMA_VERSION, type ComparisonReport, type ComparisonJobMessage, type ReleaseDependency } from '../types.js';
import { libraryForTag, libraryScope, type Library } from '../libraries.js';
import { loadReleaseSnapshot, saveReleaseSnapshot } from './storage.js';

const REPOSITORY_URL = 'https://github.com/Azure/Azure-Landing-Zones-Library.git';
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const MAX_SNAPSHOT_SIZE = 128 * 1024 * 1024;
const SNAPSHOT_FETCH_CONCURRENCY = 16;

interface Release {
	tag: string;
	version: string;
	sha: string;
	url: string;
	dependency?: ReleaseDependency;
}

async function releaseTree(directory: string, treeOid: string, library: Library, path = ''): Promise<Map<string, string>> {
	const prefix = libraryScope(library);
	const { tree } = await git.readTree({ fs, dir: directory, oid: treeOid });
	const files = new Map<string, string>();
	for (const entry of tree) {
		const entryPath = path ? `${path}/${entry.path}` : entry.path;
		if (entry.type === 'tree') {
			if (prefix.startsWith(`${entryPath}/`) || entryPath.startsWith(prefix)) {
				for (const [filePath, oid] of await releaseTree(directory, entry.oid, library, entryPath)) {
					files.set(filePath, oid);
				}
			}
		} else if (entryPath.startsWith(prefix)) {
			if (entry.type !== 'blob') throw new AppError('The release contains an unsupported source entry.', 502);
			files.set(entryPath, entry.oid);
		}
	}
	return files;
}

async function fetchReleaseSnapshot(sha: string, tag: string, library: Library): Promise<ReleaseFiles> {
	const directory = await mkdtemp(join(tmpdir(), 'alz-release-diff-'));
	try {
		await git.init({ fs, dir: directory });
		await git.addRemote({
			fs,
			dir: directory,
			remote: 'origin',
			url: REPOSITORY_URL
		});
		const result = await git.fetch({
			fs,
			http,
			dir: directory,
			remote: 'origin',
			ref: `refs/tags/${tag}`,
			remoteRef: `refs/tags/${tag}`,
			depth: 1,
			singleBranch: true,
			tags: false
		});
		const fetchedSha = result.fetchHead?.toLowerCase();
		if (fetchedSha !== sha) throw new AppError('The upstream release snapshot does not match the synchronized commit.', 502);
		const { commit } = await git.readCommit({ fs, dir: directory, oid: fetchedSha });
		const tree = await releaseTree(directory, commit.tree, library);
		if (!tree.size) throw new AppError(`The synchronized commit contains no ${library.toUpperCase()} source files.`, 502);

		const snapshot: ReleaseFiles = new Map();
		let totalSize = 0;
		const entries = [...tree];
		for (let offset = 0; offset < entries.length; offset += SNAPSHOT_FETCH_CONCURRENCY) {
			const batch = entries.slice(offset, offset + SNAPSHOT_FETCH_CONCURRENCY);
			const contents = await Promise.all(batch.map(async ([path, oid]) => {
				const result = await git.readBlob({ fs, dir: directory, oid });
				return [path, Buffer.from(result.blob)] as const;
			}));
			for (const [path, content] of contents) {
				totalSize += content.length;
				if (totalSize > MAX_SNAPSHOT_SIZE) {
					throw new AppError('The release exceeds the supported policy-context size.', 502);
				}
				snapshot.set(path, content.toString('utf8'));
			}
		}
		return snapshot;
	} catch (error) {
		if (error instanceof AppError) throw error;
		console.error('Git could not produce a complete, path-scoped release snapshot.', error);
		throw new AppError('The report worker could not retrieve a complete library release snapshot. Try again later.', 502);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

const snapshotRequests = new Map<string, Promise<ReleaseFiles>>();

export async function getReleaseSnapshot(release: Pick<Release, 'sha' | 'tag'>): Promise<ReleaseFiles> {
	if (!SHA_PATTERN.test(release.sha)) throw new AppError('The worker received an invalid release commit.', 502);
	const library = libraryForTag(release.tag);
	if (!library) throw new AppError('The worker received an invalid library release tag.', 502);
	const sha = release.sha.toLowerCase();
	const key = `${library}:${sha}`;
	const pending = snapshotRequests.get(key);
	if (pending) return pending;
	const request = (async () => {
		const stored = await loadReleaseSnapshot(sha, library);
		if (stored) return stored;
		const files = await fetchReleaseSnapshot(sha, release.tag, library);
		await saveReleaseSnapshot(sha, files, library);
		return files;
	})();
	snapshotRequests.set(key, request);
	try {
		return await request;
	} finally {
		snapshotRequests.delete(key);
	}
}

export async function generateComparisonReport(
	message: Pick<ComparisonJobMessage, 'fromTag' | 'toTag' | 'fromSha' | 'toSha' | 'fromDependencySha' | 'toDependencySha'>,
	releases: { from: Release; to: Release }
): Promise<ComparisonReport> {
	const library = libraryForTag(releases.from.tag);
	if (!library || libraryForTag(releases.to.tag) !== library) {
		throw new AppError('ALZ and SLZ releases cannot be compared. Choose two releases from the same library.', 400);
	}
	if (message.fromTag !== releases.from.tag || message.toTag !== releases.to.tag
		|| message.fromTag === message.toTag
		|| message.fromSha !== releases.from.sha || message.toSha !== releases.to.sha
		|| message.fromDependencySha !== releases.from.dependency?.sha
		|| message.toDependencySha !== releases.to.dependency?.sha) {
		throw new AppError('The selected library tags or dependencies changed in the synchronized catalog after the request was queued. Start a new comparison.', 409);
	}
	if (library === 'slz' && (!releases.from.dependency || !releases.to.dependency)) {
		throw new AppError('SLZ dependency information is missing. Run the release sync before comparing.', 503);
	}
	if (library === 'slz' && (libraryForTag(releases.from.dependency!.tag) !== 'alz'
		|| libraryForTag(releases.to.dependency!.tag) !== 'alz')) {
		throw new AppError('SLZ releases must reference pinned ALZ dependencies. Run the release sync before comparing.', 503);
	}
	const [before, after] = await Promise.all([
		getReleaseSnapshot(releases.from), getReleaseSnapshot(releases.to)
	]);
	const dependencies = releases.from.dependency && releases.to.dependency ? {
		before: { files: await getReleaseSnapshot(releases.from.dependency), sha: releases.from.dependency.sha },
		after: { files: await getReleaseSnapshot(releases.to.dependency), sha: releases.to.dependency.sha }
	} : undefined;
	const { changes, sourceFilesChanged } = analyzeReleases(before, after, message.fromSha, message.toSha, dependencies);
	const { totals, summary } = summarizeChanges(changes);
	return {
		schemaVersion: REPORT_SCHEMA_VERSION,
		scope: libraryScope(library),
		complete: true,
		generatedAt: new Date().toISOString(),
		from: releases.from,
		to: releases.to,
		totals,
		summary,
		changes,
		coverage: {
			sourceFilesChanged,
			explanation: library === 'slz'
				? `SLZ changes include relevant inherited definitions from pinned ALZ dependencies ${releases.from.dependency!.version} to ${releases.to.dependency!.version}. Source-file counts cover SLZ files only. Assignments and scopes use the effective SLZ library context; unrelated ALZ changes are excluded. Unsupported logic and unavailable built-in definitions are identified explicitly.`
				: 'Definitions are analyzed with the full stored ALZ release context, including initiatives, assignments, archetypes, and architectures. Unsupported logic and unavailable built-in definitions are identified explicitly.'
		}
	};
}
