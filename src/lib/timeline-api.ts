export async function requestTimelineApi<T>(url: string, signal: AbortSignal): Promise<T> {
	const timeout = new AbortController();
	const timer = setTimeout(() => timeout.abort(new DOMException('Request timed out.', 'TimeoutError')), 15_000);
	try {
		const response = await fetch(url, { signal: AbortSignal.any([signal, timeout.signal]) });
		let payload: T;
		try {
			payload = await response.json();
		} catch (error) {
			if (error instanceof SyntaxError) throw new Error('The server returned an unreadable response. Retry loading timelines.');
			throw error;
		}
		if (!response.ok) {
			throw new Error(payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
				? payload.error : 'The timeline request could not be completed. Retry in a moment.');
		}
		return payload;
	} catch (error) {
		if (timeout.signal.aborted && !signal.aborted) throw new Error('The timeline request timed out. Retry in a moment.');
		if (error instanceof TypeError) throw new Error('The timeline server could not be reached. Check your connection and retry.');
		throw error;
	} finally {
		clearTimeout(timer);
	}
}
