export class AppError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
		this.name = 'AppError';
	}
}

export function apiErrorResponse(error: unknown, fallbackMessage: string) {
	if (error instanceof AppError) {
		return Response.json({ error: error.message }, { status: error.status });
	}

	console.error(fallbackMessage, error);
	return Response.json({ error: fallbackMessage }, { status: 500 });
}
