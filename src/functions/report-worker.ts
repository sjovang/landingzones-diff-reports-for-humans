import { app, type InvocationContext } from '@azure/functions';
import { generateComparisonReport } from '../lib/server/git-report.js';
import { resolveStoredReleases } from '../lib/server/release-catalog.js';
import { AppError } from '../lib/server/errors.js';
import { saveReport, updateCache, updateJob } from '../lib/server/storage.js';
import type { ComparisonJobMessage } from '../lib/types.js';

const queueName = process.env.COMPARISON_QUEUE_NAME ?? 'report-jobs';

function isJobMessage(value: unknown): value is ComparisonJobMessage {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.jobId === 'string' &&
		typeof candidate.cacheKey === 'string' &&
		typeof candidate.fromTag === 'string' &&
		typeof candidate.toTag === 'string' &&
		typeof candidate.fromSha === 'string' &&
		typeof candidate.toSha === 'string' &&
		(candidate.fromDependencySha === undefined || typeof candidate.fromDependencySha === 'string') &&
		(candidate.toDependencySha === undefined || typeof candidate.toDependencySha === 'string')
	);
}

export async function handleReportMessage(message: unknown, context: InvocationContext) {
	if (!isJobMessage(message)) throw new Error('Queue message is not a valid library comparison job.');
	const job = message;

	await Promise.all([
		updateJob(job.jobId, 'running'),
		updateCache(job.cacheKey, job.jobId, 'running')
	]);

	try {
		const releases = await resolveStoredReleases(job.fromTag, job.toTag);
		const report = await generateComparisonReport(job, releases);
		const blobName = await saveReport(job.cacheKey, report);
		await updateCache(job.cacheKey, job.jobId, 'completed', undefined, blobName);
		await updateJob(job.jobId, 'completed');
		context.log(`Completed ${report.scope} comparison ${job.jobId} (${report.totals.changed} semantic library changes).`);
	} catch (error) {
		const messageText =
			error instanceof AppError ? error.message : 'The report worker failed while generating the library comparison.';
		context.error(`Library report job ${job.jobId} failed: ${messageText}`, error);
		await Promise.all([
			updateCache(job.cacheKey, job.jobId, 'failed', messageText),
			updateJob(job.jobId, 'failed', messageText)
		]);
		throw error;
	}
}

app.storageQueue<ComparisonJobMessage>('generateAlzComparisonReport', {
	queueName,
	connection: 'AzureWebJobsStorage',
	handler: handleReportMessage
});
