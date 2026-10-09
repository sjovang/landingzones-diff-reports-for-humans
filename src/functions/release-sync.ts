import { app, type InvocationContext, type Timer } from '@azure/functions';
import { syncLibraryReleases } from '../lib/server/release-catalog.js';

export async function handleReleaseSync(timer: Timer, context: InvocationContext): Promise<void> {
	if (timer.isPastDue) context.warn('The library release sync is running late.');
	try {
		const catalog = await syncLibraryReleases();
		context.log(`Synchronized ${catalog.releases.length} ALZ and SLZ releases at ${catalog.syncedAt}.`);
	} catch (error) {
		context.error('Library release sync failed. The last stored catalog remains available.', error);
		throw error;
	}
}

app.timer('syncAlzReleases', {
	schedule: process.env.RELEASE_SYNC_SCHEDULE ?? '0 0 * * * *',
	runOnStartup: false,
	useMonitor: true,
	handler: handleReleaseSync
});
