import { generateTimelines } from '../lib/server/timelines.js';

try {
	await generateTimelines();
} catch (error) {
	console.error('Timeline generation failed. The last published index remains available.', error);
	process.exitCode = 1;
}
