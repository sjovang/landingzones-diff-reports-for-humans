import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requestComparison } from '../../../lib/server/comparisons.js';
import { apiErrorResponse, AppError } from '../../../lib/server/errors.js';

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return apiErrorResponse(new AppError('Request body must be valid JSON.', 400), 'Comparison request failed.');
	}
	if (!body || typeof body !== 'object') {
		return apiErrorResponse(new AppError('Request body must include fromTag and toTag.', 400), 'Comparison request failed.');
	}

	const { fromTag, toTag } = body as { fromTag?: unknown; toTag?: unknown };
	try {
		const result = await requestComparison(fromTag, toTag);
		return json(result, { status: result.status === 'completed' ? 200 : 202 });
	} catch (error) {
		return apiErrorResponse(error, 'Comparison request failed.');
	}
};
