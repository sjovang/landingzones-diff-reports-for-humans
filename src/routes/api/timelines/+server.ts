import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiErrorResponse, AppError } from '../../../lib/server/errors.js';
import { loadTimelineIndex } from '../../../lib/server/storage.js';

export const GET: RequestHandler = async () => {
	try {
		const stored = await loadTimelineIndex();
		if (!stored) throw new AppError('Timelines have not been generated yet. Run npm run timelines:generate or invoke the timeline generation Function.', 503);
		return json(stored.index, { headers: { 'cache-control': 'private, no-cache' } });
	} catch (error) {
		return apiErrorResponse(error, 'The timeline overview could not be loaded. Retry in a moment.');
	}
};
