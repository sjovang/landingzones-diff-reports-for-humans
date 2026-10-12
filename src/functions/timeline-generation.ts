import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { generateTimelines } from '../lib/server/timelines.js';
import { enqueueTimelineGeneration, TIMELINE_QUEUE_NAME } from '../lib/server/storage.js';

export async function requestTimelineGeneration(_request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
	const generationId = randomUUID();
	try {
		await enqueueTimelineGeneration(generationId);
		context.log(`Queued timeline generation ${generationId}.`);
		return { status: 202, jsonBody: { generationId, status: 'queued' } };
	} catch (error) {
		context.error('Timeline generation could not be queued.', error);
		return { status: 503, jsonBody: { error: 'Timeline generation could not be queued. Check storage and retry.' } };
	}
}

export async function handleTimelineGeneration(message: unknown, context: InvocationContext): Promise<void> {
	if (!message || typeof message !== 'object'
		|| !('generationId' in message) || typeof message.generationId !== 'string'
		|| !/^[0-9a-f-]{36}$/i.test(message.generationId)) {
		throw new Error('Queue message is not a valid timeline generation request.');
	}
	try {
		context.log(`Starting timeline request ${message.generationId}.`);
		await generateTimelines((line) => context.log(line));
	} catch (error) {
		context.error(`Timeline generation ${message.generationId} failed. The last published index remains available.`, error);
		throw error;
	}
}

app.http('requestTimelineGeneration', {
	route: 'timelines/generate',
	methods: ['POST'],
	authLevel: 'function',
	handler: requestTimelineGeneration
});

app.storageQueue('generateTimelineReports', {
	queueName: TIMELINE_QUEUE_NAME,
	connection: 'AzureWebJobsStorage',
	handler: handleTimelineGeneration
});
