import { syncAlzReleases } from '../lib/server/release-catalog.js';

try {
	const catalog = await syncAlzReleases();
	console.log(`Synchronized ${catalog.releases.length} ALZ releases at ${catalog.syncedAt}.`);
} catch (error) {
	console.error('ALZ release sync failed. The last stored catalog remains available.', error);
	process.exitCode = 1;
}
