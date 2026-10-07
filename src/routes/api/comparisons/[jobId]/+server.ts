import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getComparison } from '../../../../lib/server/comparisons.js';
import { apiErrorResponse } from '../../../../lib/server/errors.js';

export const GET: RequestHandler = async ({ params }) => {
	try {
		return json(await getComparison(params.jobId), {
			headers: { 'cache-control': 'no-store' }
		});
	} catch (error) {
		return apiErrorResponse(error, 'Comparison status could not be loaded.');
	}
};
