import { syncLibraryReleases } from '../lib/server/release-catalog.js';

try {
	const catalog = await syncLibraryReleases();
	console.log(`Synchronized ${catalog.releases.length} ALZ and SLZ releases at ${catalog.syncedAt}.`);
} catch (error) {
	console.error('Library release sync failed. The last stored catalog remains available.', error);
	process.exitCode = 1;
}
