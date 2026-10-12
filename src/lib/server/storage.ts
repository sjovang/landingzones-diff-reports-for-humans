import { DefaultAzureCredential } from '@azure/identity';
import { TableClient, TableServiceClient, type TableEntity } from '@azure/data-tables';
import { BlobServiceClient } from '@azure/storage-blob';
import { QueueServiceClient } from '@azure/storage-queue';
import { REPORT_SCHEMA_VERSION, type ComparisonJob, type ComparisonJobMessage, type ComparisonReport, type ComparisonStatus, type ReleaseCatalog, type StoredRelease } from '../types.js';
import { AppError } from './errors.js';
import { isLibrary, libraryForTag, libraryScope, type Library } from '../libraries.js';
import { createHash } from 'node:crypto';
import { TIMELINE_SCHEMA_VERSION, isTimelineIdentity, type TimelineIdentity, type TimelineIndex, type TimelineReport } from '../timelines.js';

const JOBS_TABLE = 'ComparisonJobs';
const CACHE_TABLE = 'ComparisonCache';
const REPORT_CONTAINER = 'reports';
const RELEASE_CONTAINER = 'releases';
const QUEUE_NAME = process.env.COMPARISON_QUEUE_NAME ?? 'report-jobs';

interface StorageClients {
	queue: QueueServiceClient;
	blobs: BlobServiceClient;
	tables: TableServiceClient;
	tableForName: (name: string) => TableClient;
}

interface StoredJob extends TableEntity {
	jobId: string;
	status: ComparisonStatus;
	cacheKey: string;
	fromTag: string;
	toTag: string;
	error?: string;
}

interface CacheEntry extends TableEntity {
	cacheKey: string;
	jobId: string;
	status: ComparisonStatus;
	blobName?: string;
	error?: string;
}

let clientsPromise: Promise<StorageClients> | undefined;

async function storageClients(): Promise<StorageClients> {
	if (!clientsPromise) {
		clientsPromise = createStorageClients();
	}
	return clientsPromise;
}

async function createStorageClients(): Promise<StorageClients> {
	const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING ?? process.env.AzureWebJobsStorage;
	if (connectionString) {
		const tables = TableServiceClient.fromConnectionString(connectionString);
		return {
			queue: QueueServiceClient.fromConnectionString(connectionString),
			blobs: BlobServiceClient.fromConnectionString(connectionString),
			tables,
			tableForName: (name) => TableClient.fromConnectionString(connectionString, name)
		};
	}

	const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
	if (!accountName) {
		throw new AppError('Storage is not configured. Set AZURE_STORAGE_CONNECTION_STRING for Azurite or AZURE_STORAGE_ACCOUNT_NAME for Azure.', 503);
	}

	const credential = new DefaultAzureCredential();
	const tableEndpoint = `https://${accountName}.table.core.windows.net`;
	return {
		queue: new QueueServiceClient(`https://${accountName}.queue.core.windows.net`, credential),
		blobs: new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, credential),
		tables: new TableServiceClient(tableEndpoint, credential),
		tableForName: (name) => new TableClient(tableEndpoint, name, credential)
	};
}

async function tableClient(name: string) {
	const clients = await storageClients();
	try {
		await clients.tables.createTable(name);
	} catch (error) {
		if ((error as { statusCode?: number }).statusCode !== 409) throw error;
	}
	return clients.tableForName(name);
}

async function getEntity<T extends TableEntity>(tableName: string, partitionKey: string, rowKey: string) {
	const client = await tableClient(tableName);
	try {
		return await client.getEntity<T>(partitionKey, rowKey);
	} catch (error) {
		if ((error as { statusCode?: number }).statusCode === 404) return null;
		throw error;
	}
}

export async function getJob(jobId: string): Promise<ComparisonJob | null> {
	const entity = await getEntity<StoredJob>(JOBS_TABLE, 'jobs', jobId);
	if (!entity) return null;
	return {
		jobId: entity.jobId,
		cacheKey: entity.cacheKey,
		status: entity.status,
		fromTag: entity.fromTag,
		toTag: entity.toTag,
		...(entity.error ? { error: entity.error } : {})
	};
}

export async function getCacheEntry(cacheKey: string): Promise<CacheEntry | null> {
	return getEntity<CacheEntry>(CACHE_TABLE, 'reports', cacheKey);
}

export async function createQueuedRecords(message: ComparisonJobMessage) {
	const jobsTable = await tableClient(JOBS_TABLE);
	await jobsTable.createEntity({
		partitionKey: 'jobs',
		rowKey: message.jobId,
		jobId: message.jobId,
		cacheKey: message.cacheKey,
		fromTag: message.fromTag,
		toTag: message.toTag,
		status: 'queued'
	});
	try {
		const cacheTable = await tableClient(CACHE_TABLE);
		await cacheTable.createEntity({
			partitionKey: 'reports',
			rowKey: message.cacheKey,
			cacheKey: message.cacheKey,
			jobId: message.jobId,
			status: 'queued'
		});
	} catch (error) {
		await jobsTable.deleteEntity('jobs', message.jobId);
		throw error;
	}
}

export async function createJobRecord(message: ComparisonJobMessage) {
	const jobsTable = await tableClient(JOBS_TABLE);
	await jobsTable.createEntity({
		partitionKey: 'jobs',
		rowKey: message.jobId,
		jobId: message.jobId,
		cacheKey: message.cacheKey,
		fromTag: message.fromTag,
		toTag: message.toTag,
		status: 'queued'
	});
}

export async function deleteJob(jobId: string) {
	const client = await tableClient(JOBS_TABLE);
	try {
		await client.deleteEntity('jobs', jobId);
	} catch (error) {
		if ((error as { statusCode?: number }).statusCode !== 404) throw error;
	}
}

export async function updateJob(jobId: string, status: ComparisonStatus, error?: string) {
	const client = await tableClient(JOBS_TABLE);
	await client.upsertEntity(
		{
			partitionKey: 'jobs',
			rowKey: jobId,
			jobId,
			status,
			...(error ? { error } : { error: null })
		},
		'Merge'
	);
}

export async function updateCache(cacheKey: string, jobId: string, status: ComparisonStatus, error?: string, blobName?: string) {
	const client = await tableClient(CACHE_TABLE);
	await client.upsertEntity(
		{
			partitionKey: 'reports',
			rowKey: cacheKey,
			cacheKey,
			jobId,
			status,
			...(error ? { error } : { error: null }),
			...(blobName ? { blobName } : {})
		},
		'Merge'
	);
}

export async function enqueueComparison(message: ComparisonJobMessage) {
	const queue = (await storageClients()).queue.getQueueClient(QUEUE_NAME);
	await queue.createIfNotExists();
	await queue.sendMessage(JSON.stringify(message));
}

function reportBlobName(cacheKey: string) {
	return `${cacheKey}.json`;
}

export async function saveReport(cacheKey: string, report: ComparisonReport) {
	const container = (await storageClients()).blobs.getContainerClient(REPORT_CONTAINER);
	await container.createIfNotExists();
	const blobName = reportBlobName(cacheKey);
	const blob = container.getBlockBlobClient(blobName);
	await blob.uploadData(Buffer.from(JSON.stringify(report)), {
		blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' }
	});
	return blobName;
}

export async function loadCachedReport(cacheKey: string, blobName?: string): Promise<ComparisonReport> {
	const container = (await storageClients()).blobs.getContainerClient(REPORT_CONTAINER);
	try {
		const data = await container.getBlockBlobClient(blobName ?? reportBlobName(cacheKey)).downloadToBuffer();
		const report = JSON.parse(data.toString('utf8')) as ComparisonReport;
		if (!report || report.schemaVersion !== REPORT_SCHEMA_VERSION) {
			console.warn('Cached report uses an unsupported format.', { cacheKey });
			throw new AppError('This report uses an older format. Start a new comparison to build a human-readable report.', 409);
		}

		return report;
	} catch (error) {
		if ((error as { statusCode?: number }).statusCode === 404) {
			console.error('Cache record points to a missing report blob.', { cacheKey });
			throw new AppError('The cached report could not be found. Retry the comparison to rebuild it.', 503);
		}
		throw error;
	}
}

async function releaseContainer() {
	const container = (await storageClients()).blobs.getContainerClient(RELEASE_CONTAINER);
	await container.createIfNotExists();
	return container;
}

function isStoredRelease(value: unknown): value is StoredRelease {
	if (!value || typeof value !== 'object') return false;
	const release = value as Record<string, unknown>;
	const library = libraryForTag(release.tag);
	const dependency = release.dependency;
	const validDependency = library === 'alz' ? dependency === undefined : (dependency !== null && typeof dependency === 'object'
		&& 'tag' in dependency && libraryForTag(dependency.tag) === 'alz'
		&& 'sha' in dependency && typeof dependency.sha === 'string' && /^[0-9a-f]{40}$/i.test(dependency.sha)
		&& 'version' in dependency && typeof dependency.version === 'string'
		&& 'url' in dependency && typeof dependency.url === 'string');
	return Boolean(library) && validDependency && typeof release.version === 'string'
		&& typeof release.url === 'string' && typeof release.sha === 'string'
		&& typeof release.referenceSha === 'string'
		&& /^[0-9a-f]{40}$/i.test(release.sha) && /^[0-9a-f]{40}$/i.test(release.referenceSha);
}

function isReleaseCatalog(value: unknown): value is ReleaseCatalog {
	if (!value || typeof value !== 'object') return false;
	const catalog = value as Record<string, unknown>;
	return catalog.schemaVersion === 1 && typeof catalog.syncedAt === 'string'
		&& Number.isFinite(Date.parse(catalog.syncedAt)) && Array.isArray(catalog.releases)
		&& catalog.releases.length > 0 && catalog.releases.every(isStoredRelease)
		&& new Set(catalog.releases.map((release) => release.tag)).size === catalog.releases.length;
}

export async function loadReleaseCatalog(): Promise<{ catalog: ReleaseCatalog; etag: string } | null> {
	try {
		const blob = (await storageClients()).blobs.getContainerClient(RELEASE_CONTAINER).getBlockBlobClient('catalog-v1.json');
		const response = await blob.download();
		const chunks: Buffer[] = [];
		if (!response.readableStreamBody || !response.etag) throw new AppError('Stored release catalog response is incomplete.', 503);
		for await (const chunk of response.readableStreamBody) chunks.push(Buffer.from(chunk));
		const catalog: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
		if (!isReleaseCatalog(catalog)) {
			throw new AppError('The stored release catalog is invalid. Run the release sync to repair it.', 503);
		}
		return { catalog, etag: response.etag };
	} catch (error) {
		if ((error as { statusCode?: number }).statusCode === 404) return null;
		throw error;
	}
}

export async function saveReleaseCatalog(catalog: ReleaseCatalog, etag?: string) {
	const blob = (await releaseContainer()).getBlockBlobClient('catalog-v1.json');
	await blob.uploadData(Buffer.from(JSON.stringify(catalog)), {
		blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' },
		conditions: etag ? { ifMatch: etag } : { ifNoneMatch: '*' }
	});
}

function snapshotName(sha: string, library: Library) {
	if (!/^[0-9a-f]{40}$/i.test(sha)) throw new AppError('Invalid release snapshot commit.', 400);
	return library === 'alz' ? `snapshots-v1/${sha.toLowerCase()}.json` : `snapshots-v2/slz/${sha.toLowerCase()}.json`;
}

export async function loadReleaseSnapshot(sha: string, library: Library = 'alz'): Promise<Map<string, string> | null> {
	try {
		const blob = (await storageClients()).blobs.getContainerClient(RELEASE_CONTAINER).getBlockBlobClient(snapshotName(sha, library));
		const contents = await blob.downloadToBuffer();
		const entries: unknown = JSON.parse(contents.toString('utf8'));
		if (!Array.isArray(entries) || entries.length === 0 || !entries.every((entry) =>
			Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string'
			&& entry[0].startsWith(libraryScope(library)) && typeof entry[1] === 'string')
			|| new Set(entries.map((entry) => entry[0])).size !== entries.length) {
			throw new AppError('Stored release snapshot is invalid. Source context cannot be analyzed reliably.', 503);
		}
		return new Map(entries);
	} catch (error) {
		if ((error as { statusCode?: number }).statusCode === 404) return null;
		throw error;
	}
}

export async function saveReleaseSnapshot(sha: string, files: Map<string, string>, library: Library = 'alz') {
	const blob = (await releaseContainer()).getBlockBlobClient(snapshotName(sha, library));
	try {
		await blob.uploadData(Buffer.from(JSON.stringify([...files])), {
			blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' },
			conditions: { ifNoneMatch: '*' }
		});
	} catch (error) {
		if ((error as { statusCode?: number }).statusCode !== 412) throw error;
		// Another worker has already persisted this immutable commit snapshot.
	}
}

const TIMELINE_INDEX_BLOB = 'timelines-v1/index.json';
export const TIMELINE_QUEUE_NAME = 'timeline-jobs';

async function timelineContainer() {
	const container = (await storageClients()).blobs.getContainerClient(REPORT_CONTAINER);
	await container.createIfNotExists();
	return container;
}

function timelineBlobName(generationId: string, identity: TimelineIdentity) {
	if (!/^[0-9a-f-]{36}$/i.test(generationId) || !isTimelineIdentity(identity)) {
		throw new AppError('Invalid timeline identity or generation.', 400);
	}
	const key = createHash('sha256').update(JSON.stringify([identity.library, identity.kind, identity.name])).digest('hex');
	return `timelines-v1/${generationId}/${key}.json`;
}

export async function loadTimelineIndex(): Promise<{ index: TimelineIndex; etag: string } | null> {
	try {
		const blob = (await storageClients()).blobs.getContainerClient(REPORT_CONTAINER).getBlockBlobClient(TIMELINE_INDEX_BLOB);
		const response = await blob.download();
		if (!response.readableStreamBody || !response.etag) throw new AppError('Stored timeline index is unreadable. Regenerate timelines.', 503);
		const chunks: Buffer[] = [];
		for await (const chunk of response.readableStreamBody) chunks.push(Buffer.from(chunk));
		const index: TimelineIndex = JSON.parse(Buffer.concat(chunks).toString('utf8'));
		if (!index || index.schemaVersion !== TIMELINE_SCHEMA_VERSION
			|| typeof index.generationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(index.generationId)
			|| typeof index.generatedAt !== 'string' || typeof index.syncedAt !== 'string'
			|| !Array.isArray(index.gaps) || !index.gaps.every((gap) => gap && isLibrary(gap.library)
				&& gap.release && libraryForTag(gap.release.tag) === gap.library && typeof gap.reason === 'string')
			|| !Array.isArray(index.reports) || !index.reports.every((report) =>
				isTimelineIdentity(report) && typeof report.title === 'string'
				&& typeof report.firstRelease === 'string' && typeof report.latestRelease === 'string'
				&& (typeof report.presentInLatest === 'boolean' || report.presentInLatest === null) && typeof report.deprecated === 'boolean'
				&& typeof report.releaseCount === 'number' && typeof report.changeCount === 'number'
				&& Number.isInteger(report.gapCount) && report.gapCount >= 0)) {
			throw new AppError('Stored timeline index is incompatible or invalid. Regenerate timelines.', 503);
		}
		return { index, etag: response.etag };
	} catch (error) {
		if ((error as { statusCode?: number }).statusCode === 404) return null;
		throw error;
	}
}

export async function saveTimelineReport(report: TimelineReport) {
	const blob = (await timelineContainer()).getBlockBlobClient(timelineBlobName(report.generationId, report));
	await blob.uploadData(Buffer.from(JSON.stringify(report)), {
		blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' },
		conditions: { ifNoneMatch: '*' }
	});
}

export async function getTimelineIndexEtag(): Promise<string | undefined> {
	try {
		const blob = (await storageClients()).blobs.getContainerClient(REPORT_CONTAINER).getBlockBlobClient(TIMELINE_INDEX_BLOB);
		const properties = await blob.getProperties();
		if (!properties.etag) throw new AppError('Stored timeline index has no publication version. Check storage and retry.', 503);
		return properties.etag;
	} catch (error) {
		if ((error as { statusCode?: number }).statusCode === 404) return undefined;
		throw error;
	}
}

export async function publishTimelineIndex(index: TimelineIndex, etag?: string) {
	const blob = (await timelineContainer()).getBlockBlobClient(TIMELINE_INDEX_BLOB);
	try {
		await blob.uploadData(Buffer.from(JSON.stringify(index)), {
			blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' },
			conditions: etag ? { ifMatch: etag } : { ifNoneMatch: '*' }
		});
	} catch (error) {
		if ((error as { statusCode?: number }).statusCode === 412) {
			throw new AppError('Another timeline generation was published during this run. Its index was retained; retry generation if needed.', 409);
		}
		throw error;
	}
}

export async function loadTimelineReport(identity: TimelineIdentity): Promise<TimelineReport> {
	if (!isTimelineIdentity(identity)) throw new AppError('Invalid timeline identity.', 400);
	const stored = await loadTimelineIndex();
	if (!stored) throw new AppError('Timelines have not been generated yet. Run npm run timelines:generate or invoke the timeline generation Function.', 503);
	if (!stored.index.reports.some((report) => report.library === identity.library
		&& report.kind === identity.kind && report.name === identity.name)) {
		throw new AppError('This object has no published timeline. Check its identity or regenerate timelines after synchronizing releases.', 404);
	}
	try {
		const blob = (await storageClients()).blobs.getContainerClient(REPORT_CONTAINER)
			.getBlockBlobClient(timelineBlobName(stored.index.generationId, identity));
		const report: TimelineReport = JSON.parse((await blob.downloadToBuffer()).toString('utf8'));
		if (!report || report.schemaVersion !== TIMELINE_SCHEMA_VERSION || report.generationId !== stored.index.generationId
			|| report.library !== identity.library || report.kind !== identity.kind || report.name !== identity.name
			|| typeof report.title !== 'string' || !Array.isArray(report.entries) || !report.entries.length
			|| !Number.isInteger(report.gapCount) || report.gapCount < 0
			|| (typeof report.presentInLatest !== 'boolean' && report.presentInLatest !== null)
			|| !report.entries.every((entry) => entry && typeof entry === 'object'
				&& entry.release && libraryForTag(entry.release.tag) === identity.library
				&& ['first-observed', 'added', 'reintroduced', 'modified', 'removed', 'unchanged', 'absent', 'gap'].includes(entry.status)
				&& (entry.status !== 'gap' || typeof entry.gapReason === 'string'))) {
			throw new AppError('Stored timeline report is incompatible or invalid. Regenerate timelines.', 503);
		}
		return report;
	} catch (error) {
		if ((error as { statusCode?: number }).statusCode === 404) {
			throw new AppError('The published timeline is missing its report. Regenerate timelines.', 503);
		}
		throw error;
	}
}

export async function enqueueTimelineGeneration(generationId: string) {
	const queue = (await storageClients()).queue.getQueueClient(TIMELINE_QUEUE_NAME);
	await queue.createIfNotExists();
	await queue.sendMessage(JSON.stringify({ generationId }));
}
