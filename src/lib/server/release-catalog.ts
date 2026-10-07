import { discoverAlzReleases, isAlzTag } from './github.js';
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

export async function resolveStoredAlzReleases(fromTag: unknown, toTag: unknown) {
	if (!isAlzTag(fromTag) || !isAlzTag(toTag)) throw new AppError('Choose two published ALZ release tags.', 400);
	if (fromTag === toTag) throw new AppError('Choose two different release tags to compare.', 400);
	const catalog = await getReleaseCatalog();
	const from = catalog.releases.find((release) => release.tag === fromTag);
	const to = catalog.releases.find((release) => release.tag === toTag);
	if (!from || !to) throw new AppError('One or both selected tags are not in the synchronized ALZ release catalog.', 400);
	return { from, to };
}

export async function syncAlzReleases(): Promise<ReleaseCatalog> {
	const previous = await loadReleaseCatalog();
	const releases = await discoverAlzReleases(previous?.catalog.releases);
	if (!releases.length) throw new AppError('GitHub returned no ALZ releases; the previous catalog has been retained.', 502);
	const catalog: ReleaseCatalog = { schemaVersion: 1, syncedAt: new Date().toISOString(), releases };
	// Warm the default comparison; older releases are persisted on first use.
	for (const release of releases.slice(0, 2)) await getReleaseSnapshot(release);
	await saveReleaseCatalog(catalog, previous?.etag);
	return catalog;
}
