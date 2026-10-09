import { createHash, randomUUID } from 'node:crypto';
import { AppError } from './errors.js';
import { resolveStoredReleases } from './release-catalog.js';
import { libraryForTag, libraryScope } from '../libraries.js';
import {
	createQueuedRecords,
	createJobRecord,
	deleteJob,
	enqueueComparison,
	getCacheEntry,
	getJob,
	loadCachedReport,
	updateCache,
	updateJob
} from './storage.js';
import { REPORT_SCHEMA_VERSION, type ComparisonJob, type ComparisonJobMessage } from '../types.js';

const REPOSITORY_ID = 'Azure/Azure-Landing-Zones-Library';

export async function requestComparison(fromTag: unknown, toTag: unknown): Promise<ComparisonJob> {
	const { from, to } = await resolveStoredReleases(fromTag, toTag);
	const library = libraryForTag(from.tag)!;
	const cacheKey = createHash('sha256')
		.update([REPOSITORY_ID, libraryScope(library), from.tag, to.tag, from.sha, to.sha,
			from.dependency?.sha ?? '', to.dependency?.sha ?? '', REPORT_SCHEMA_VERSION].join(':'))
		.digest('hex');
	const existing = await getCacheEntry(cacheKey);

	if (existing?.status === 'completed') {
		const report = await loadCachedReport(cacheKey, existing.blobName);
		return { jobId: existing.jobId, cacheKey, status: 'completed', fromTag: from.tag, toTag: to.tag, report };
	}
	if (existing && (existing.status === 'queued' || existing.status === 'running')) {
		const job = await getJob(existing.jobId);
		if (!job) throw new AppError('The comparison queue status is inconsistent. Retry the comparison.', 503);
		return job;
	}

	const message: ComparisonJobMessage = {
		jobId: randomUUID(),
		cacheKey,
		fromTag: from.tag,
		toTag: to.tag,
		fromSha: from.sha,
		toSha: to.sha,
		...(from.dependency ? { fromDependencySha: from.dependency.sha } : {}),
		...(to.dependency ? { toDependencySha: to.dependency.sha } : {})
	};

	if (!existing) {
		try {
			await createQueuedRecords(message);
		} catch (error) {
			if ((error as { statusCode?: number }).statusCode !== 409) throw error;
			const winner = await getCacheEntry(cacheKey);
			if (!winner) throw error;
			if (winner.status === 'completed') {
				const report = await loadCachedReport(cacheKey, winner.blobName);
				return { jobId: winner.jobId, cacheKey, status: 'completed', fromTag: from.tag, toTag: to.tag, report };
			}
			const job = await getJob(winner.jobId);
			if (!job) throw new AppError('The comparison queue status is inconsistent. Retry the comparison.', 503);
			return job;
		}
	} else {
		await createJobRecord(message);
		try {
			await updateCache(cacheKey, message.jobId, 'queued');
		} catch (error) {
			await deleteJob(message.jobId);
			throw error;
		}
	}

	try {
		await enqueueComparison(message);
	} catch (error) {
		const messageText = 'The report could not be queued. Check Azure Storage configuration and retry.';
		await Promise.all([
			updateCache(cacheKey, message.jobId, 'failed', messageText),
			updateJob(message.jobId, 'failed', messageText)
		]);
		throw new AppError(messageText, 503);
	}

	return { jobId: message.jobId, cacheKey, status: 'queued', fromTag: from.tag, toTag: to.tag };
}

export async function getComparison(jobId: string): Promise<ComparisonJob> {
	const job = await getJob(jobId);
	if (!job) throw new AppError('Comparison job not found.', 404);
	if (job.status !== 'completed') return job;

	const cache = await getCacheEntry(job.cacheKey);
	if (!cache) throw new AppError('The completed comparison is missing its cache record.', 503);
	return { ...job, report: await loadCachedReport(job.cacheKey, cache.blobName) };
}
