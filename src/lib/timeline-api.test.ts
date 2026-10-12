import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestTimelineApi } from './timeline-api.js';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('timeline reads', () => {
	it('makes read-only requests and preserves actionable server errors', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ reports: [] }), { status: 200 }));
		vi.stubGlobal('fetch', fetch);
		const signal = new AbortController().signal;
		expect(await requestTimelineApi('/api/timelines', signal)).toEqual({ reports: [] });
		expect(fetch).toHaveBeenCalledWith('/api/timelines', { signal: expect.any(AbortSignal) });
		fetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Generate timelines first.' }), { status: 503 }));
		await expect(requestTimelineApi('/api/timelines', signal)).rejects.toThrow('Generate timelines first.');
	});

	it('explains unreadable responses and connection failures', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response('<html>Unavailable</html>', { status: 503 }));
		vi.stubGlobal('fetch', fetch);
		await expect(requestTimelineApi('/api/timelines', new AbortController().signal)).rejects.toThrow('unreadable response');
		fetch.mockRejectedValue(new TypeError('Failed to fetch'));
		await expect(requestTimelineApi('/api/timelines', new AbortController().signal)).rejects.toThrow('Check your connection');
	});

	it('bounds a stalled read and leaves an explicit retry action', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('fetch', vi.fn().mockImplementation((_, { signal }) => new Promise((_, reject) => {
			signal.addEventListener('abort', () => reject(signal.reason), { once: true });
		})));
		const pending = requestTimelineApi('/api/timelines', new AbortController().signal);
		const result = expect(pending).rejects.toThrow('timed out');
		await vi.advanceTimersByTimeAsync(15_000);
		await result;
	});
});
