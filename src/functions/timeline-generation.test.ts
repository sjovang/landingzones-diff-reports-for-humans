import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { requestTimelineGeneration, handleTimelineGeneration } from './timeline-generation.js';
import { enqueueTimelineGeneration } from '../lib/server/storage.js';
import { generateTimelines } from '../lib/server/timelines.js';

vi.mock('../lib/server/storage.js', () => ({ enqueueTimelineGeneration: vi.fn(), TIMELINE_QUEUE_NAME: 'timeline-jobs' }));
vi.mock('../lib/server/timelines.js', () => ({ generateTimelines: vi.fn() }));
vi.mock('@azure/functions', async (importOriginal) => ({
	...await importOriginal<typeof import('@azure/functions')>(),
	app: { http: vi.fn(), storageQueue: vi.fn() }
}));

beforeEach(() => vi.resetAllMocks());

describe('manual timeline Function', () => {
	it('returns a queued request without running generation in the HTTP request', async () => {
		const context = new InvocationContext();
		const result = await requestTimelineGeneration(new HttpRequest({ url: 'http://localhost/api/timelines/generate', method: 'POST' }), context);
		expect(result.status).toBe(202);
		expect(result.jsonBody).toMatchObject({ status: 'queued', generationId: expect.any(String) });
		expect(enqueueTimelineGeneration).toHaveBeenCalledOnce();
		expect(generateTimelines).not.toHaveBeenCalled();
	});

	it('runs the independent generator from its dedicated queue and rejects invalid work', async () => {
		const context = new InvocationContext();
		await handleTimelineGeneration({ generationId: '11111111-1111-4111-8111-111111111111' }, context);
		expect(generateTimelines).toHaveBeenCalledWith(expect.any(Function));
		await expect(handleTimelineGeneration({ generationId: '../invalid' }, context)).rejects.toThrow('not a valid');
	});

	it('logs failures and fails requests or retries the worker explicitly', async () => {
		const context = new InvocationContext();
		const log = vi.spyOn(context, 'error').mockImplementation(() => {});
		vi.mocked(enqueueTimelineGeneration).mockRejectedValue(new Error('Storage unavailable'));
		const result = await requestTimelineGeneration(new HttpRequest({ url: 'http://localhost/', method: 'POST' }), context);
		expect(result.status).toBe(503);
		vi.mocked(generateTimelines).mockRejectedValue(new Error('Missing snapshot'));
		await expect(handleTimelineGeneration({ generationId: '11111111-1111-4111-8111-111111111111' }, context)).rejects.toThrow('Missing snapshot');
		expect(log).toHaveBeenCalledTimes(2);
	});
});
