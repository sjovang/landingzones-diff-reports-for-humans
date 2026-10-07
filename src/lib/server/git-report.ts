import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppError } from './errors.js';
import { analyzeReleases, summarizeChanges, type ReleaseFiles } from './analysis.js';
import { REPORT_SCHEMA_VERSION, type ComparisonReport } from '../types.js';
import { loadReleaseSnapshot, saveReleaseSnapshot } from './storage.js';

const execFileAsync = promisify(execFile);
const REPOSITORY_URL = 'https://github.com/Azure/Azure-Landing-Zones-Library.git';
const ALZ_PREFIX = 'platform/alz/';
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const MAX_COMMAND_OUTPUT = 32 * 1024 * 1024;

interface Release {
	tag: string;
	version: string;
	sha: string;
	url: string;
}

async function git(directory: string, args: string[]) {
	try {
		const result = await execFileAsync(
			process.env.GIT_EXECUTABLE ?? 'git',
			['-C', directory, ...args],
			{ encoding: 'utf8', maxBuffer: MAX_COMMAND_OUTPUT, timeout: 120_000 }
		);
		return result.stdout;
	} catch (error) {
		const cause = error instanceof Error ? error.message : 'Unknown Git process error';
		if (cause.includes('ENOENT')) {
			throw new AppError('The report worker requires Git to retrieve a complete, path-scoped diff.', 503);
		}
		console.error('Git could not produce a complete ALZ release diff.', error);
		throw new AppError('The report worker could not retrieve a complete ALZ release diff. Try again later.', 502);
	}
}

async function releaseTree(directory: string, sha: string): Promise<Map<string, string>> {
	const output = await git(directory, ['ls-tree', '-r', '-z', sha, '--', ALZ_PREFIX]);
	const paths = new Map<string, string>();
	for (const entry of output.split('\0').filter(Boolean)) {
		const match = /^\d+ blob ([0-9a-f]{40})\t([\s\S]+)$/.exec(entry);
		if (!match || !match[2].startsWith(ALZ_PREFIX)) {
			throw new AppError('The release contains an unsupported source entry.', 502);
		}
		paths.set(match[2], match[1]);
	}
	return paths;
}

async function readBlobs(directory: string, ids: string[]): Promise<Map<string, string>> {
	const output = await new Promise<Buffer>((resolve, reject) => {
		const child = spawn(process.env.GIT_EXECUTABLE ?? 'git', ['-C', directory, 'cat-file', '--batch']);
		const chunks: Buffer[] = [];
		let bytes = 0;
		let stderr = '';
		const timer = setTimeout(() => {
			child.kill();
			reject(new AppError('Reading release policy context timed out. Try again later.', 502));
		}, 120_000);
		child.stdout.on('data', (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > 128 * 1024 * 1024) {
				child.kill();
				reject(new AppError('The release exceeds the supported policy-context size.', 502));
			} else chunks.push(chunk);
		});
		child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
		child.on('error', (error) => { clearTimeout(timer); reject(error); });
		child.stdin.on('error', (error) => { clearTimeout(timer); reject(error); });
		child.on('close', (code) => {
			clearTimeout(timer);
			if (code !== 0) {
				console.error('Git could not read release policy context.', { code, stderr });
				reject(new AppError('The report worker could not read the full release policy context.', 502));
			} else resolve(Buffer.concat(chunks));
		});
		child.stdin.end(`${ids.join('\n')}\n`);
	});
	const blobs = new Map<string, string>();
	let offset = 0;
	for (const id of ids) {
		const end = output.indexOf(10, offset);
		const header = output.subarray(offset, end).toString();
		const match = /^([0-9a-f]{40}) blob (\d+)$/.exec(header);
		if (end < 0 || !match || match[1] !== id) {
			throw new AppError('Git returned incomplete release policy context.', 502);
		}
		const length = Number(match[2]);
		offset = end + 1;
		if (offset + length >= output.length || output[offset + length] !== 10) {
			throw new AppError('Git returned incomplete release file contents.', 502);
		}
		blobs.set(id, output.subarray(offset, offset + length).toString('utf8'));
		offset += length + 1;
	}
	return blobs;
}

function snapshot(tree: Map<string, string>, blobs: Map<string, string>): ReleaseFiles {
	return new Map([...tree].map(([path, id]) => {
		const content = blobs.get(id);
		if (content === undefined) throw new AppError(`Missing release context for ${path}.`, 502);
		return [path, content];
	}));
}

async function fetchReleaseSnapshot(sha: string): Promise<ReleaseFiles> {
	const directory = await mkdtemp(join(tmpdir(), 'alz-release-diff-'));
	try {
		await git(directory, ['init', '--quiet']);
		await git(directory, ['remote', 'add', 'origin', REPOSITORY_URL]);
		await git(directory, [
			'fetch',
			'--quiet',
			'--depth=1',
			'origin',
			sha
		]);
		const fetched = (await git(directory, ['rev-parse', 'FETCH_HEAD^{commit}'])).trim().toLowerCase();
		if (fetched !== sha) throw new AppError('The upstream release snapshot does not match the synchronized commit.', 502);
		const tree = await releaseTree(directory, sha);
		if (!tree.size) throw new AppError('The synchronized commit contains no ALZ source files.', 502);
		const blobs = await readBlobs(directory, [...new Set(tree.values())]);
		return snapshot(tree, blobs);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

const snapshotRequests = new Map<string, Promise<ReleaseFiles>>();

export async function getReleaseSnapshot(release: Pick<Release, 'sha'>): Promise<ReleaseFiles> {
	if (!SHA_PATTERN.test(release.sha)) throw new AppError('The worker received an invalid release commit.', 502);
	const sha = release.sha.toLowerCase();
	const pending = snapshotRequests.get(sha);
	if (pending) return pending;
	const request = (async () => {
		const stored = await loadReleaseSnapshot(sha);
		if (stored) return stored;
		const files = await fetchReleaseSnapshot(sha);
		await saveReleaseSnapshot(sha, files);
		return files;
	})();
	snapshotRequests.set(sha, request);
	try {
		return await request;
	} finally {
		snapshotRequests.delete(sha);
	}
}

export async function generateComparisonReport(
	message: { fromTag: string; toTag: string; fromSha: string; toSha: string },
	releases: { from: Release; to: Release }
): Promise<ComparisonReport> {
	if (message.fromSha !== releases.from.sha || message.toSha !== releases.to.sha) {
		throw new AppError('The selected ALZ tags changed in the synchronized catalog after the request was queued. Start a new comparison.', 409);
	}
	const [before, after] = await Promise.all([
		getReleaseSnapshot(releases.from), getReleaseSnapshot(releases.to)
	]);
	const { changes, sourceFilesChanged } = analyzeReleases(before, after, message.fromSha, message.toSha);
	const { totals, summary } = summarizeChanges(changes);
	return {
		schemaVersion: REPORT_SCHEMA_VERSION,
		scope: 'platform/alz/',
		complete: true,
		generatedAt: new Date().toISOString(),
		from: releases.from,
		to: releases.to,
		totals,
		summary,
		changes,
		coverage: {
			sourceFilesChanged,
			explanation: 'Definitions are analyzed with the full stored ALZ release context, including initiatives, assignments, archetypes, and architectures. Unsupported logic and unavailable built-in definitions are identified explicitly.'
		}
	};
}
