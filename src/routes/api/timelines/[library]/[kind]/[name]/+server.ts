import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiErrorResponse, AppError } from '../../../../../../lib/server/errors.js';
import { loadTimelineReport } from '../../../../../../lib/server/storage.js';
import { isTimelineIdentity } from '../../../../../../lib/timelines.js';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const identity = { library: params.library, kind: params.kind, name: params.name };
		if (!isTimelineIdentity(identity)) throw new AppError('Choose an ALZ or SLZ policy, policy set, or archetype timeline.', 400);
		return json(await loadTimelineReport(identity), { headers: { 'cache-control': 'private, no-cache' } });
	} catch (error) {
		return apiErrorResponse(error, 'The timeline could not be loaded. Retry in a moment.');
	}
};
