import { discoverReleases, discoverSlzDependency } from './github.js';
import { LIBRARIES, libraryForTag } from '../libraries.js';
import { AppError } from './errors.js';
import { loadReleaseCatalog, saveReleaseCatalog } from './storage.js';
import { getReleaseSnapshot } from './git-report.js';
import type { ReleaseCatalog } from '../types.js';

export async function getReleaseCatalog(): Promise<ReleaseCatalog> {
	const stored = await loadReleaseCatalog();
	if (!stored) {
		throw new AppError('Releases have not been synchronized yet. Run the release sync or wait for the scheduled sync.', 503);
	}
	return stored.catalog;
}

export async function resolveStoredReleases(fromTag: unknown, toTag: unknown) {
	const library = libraryForTag(fromTag);
	if (!library || !libraryForTag(toTag)) throw new AppError('Choose two published ALZ or SLZ release tags.', 400);
	if (libraryForTag(toTag) !== library) throw new AppError('ALZ and SLZ releases cannot be compared. Choose two releases from the same library.', 400);
	if (fromTag === toTag) throw new AppError('Choose two different release tags to compare.', 400);
	const catalog = await getReleaseCatalog();
	const from = catalog.releases.find((release) => release.tag === fromTag);
	const to = catalog.releases.find((release) => release.tag === toTag);
	if (!from || !to) throw new AppError(`One or both selected tags are not in the synchronized ${library.toUpperCase()} release catalog.`, 400);
	if (library === 'slz' && (!from.dependency || !to.dependency)) {
		throw new AppError('SLZ dependency information is missing. Run the release sync before comparing.', 503);
	}
	return { from, to };
}

export async function syncLibraryReleases(): Promise<ReleaseCatalog> {
	const previous = await loadReleaseCatalog();
	const streams = await Promise.all(LIBRARIES.map((library) => discoverReleases(library, previous?.catalog.releases)));
	for (const [index, releases] of streams.entries()) {
		if (!releases.length) throw new AppError(`GitHub returned no ${LIBRARIES[index].toUpperCase()} releases; the previous catalog has been retained.`, 502);
	}
	const [alz, slz] = streams;
	for (const release of slz) {
		const cached = previous?.catalog.releases.find((candidate) => candidate.tag === release.tag && candidate.sha === release.sha);
		const tag = cached?.dependency?.tag ?? await discoverSlzDependency(release);
		const dependency = alz.find((candidate) => candidate.tag === tag);
		if (!dependency) throw new AppError(`The pinned ALZ dependency ${tag} for ${release.tag} is unavailable; the previous catalog has been retained.`, 502);
		release.dependency = { tag, version: dependency.version, url: dependency.url, sha: dependency.sha };
	}
	const releases = streams.flat();
	const catalog: ReleaseCatalog = { schemaVersion: 1, syncedAt: new Date().toISOString(), releases };
	// Warm the default comparison; older releases are persisted on first use.
	for (const stream of streams) {
		for (const release of stream.slice(0, 2)) {
			await getReleaseSnapshot(release);
			if (release.dependency) await getReleaseSnapshot(release.dependency);
		}
	}
	await saveReleaseCatalog(catalog, previous?.etag);
	return catalog;
}
