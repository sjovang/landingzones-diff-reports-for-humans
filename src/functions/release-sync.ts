import { app, type InvocationContext, type Timer } from '@azure/functions';
import { syncAlzReleases } from '../lib/server/release-catalog.js';

export async function handleReleaseSync(timer: Timer, context: InvocationContext): Promise<void> {
	if (timer.isPastDue) context.warn('The ALZ release sync is running late.');
	try {
		const catalog = await syncAlzReleases();
		context.log(`Synchronized ${catalog.releases.length} ALZ releases at ${catalog.syncedAt}.`);
	} catch (error) {
		context.error('ALZ release sync failed. The last stored catalog remains available.', error);
		throw error;
	}
}

app.timer('syncAlzReleases', {
	schedule: process.env.RELEASE_SYNC_SCHEDULE ?? '0 0 * * * *',
	runOnStartup: false,
	useMonitor: true,
	handler: handleReleaseSync
});
