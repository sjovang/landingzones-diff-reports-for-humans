import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiErrorResponse } from '../../../lib/server/errors.js';
import { getReleaseCatalog } from '../../../lib/server/release-catalog.js';

export const GET: RequestHandler = async () => {
	try {
		const catalog = await getReleaseCatalog();
		return json(
			{ releases: catalog.releases, syncedAt: catalog.syncedAt },
			{ headers: { 'cache-control': 'public, max-age=300' } }
		);
	} catch (error) {
		return apiErrorResponse(error, 'Library releases could not be loaded.');
	}
};
