import { spawn, type ChildProcess } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';

const fixtures: { directory: string; child?: ChildProcess }[] = [];

async function availablePorts() {
	const servers = [];
	for (let index = 0; index < 5; index++) {
		const server = createServer();
		await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
		servers.push(server);
	}
	const ports = servers.map((server) => {
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('Expected TCP port.');
		return address.port;
	});
	await Promise.all(servers.map((server) => new Promise<void>((resolveClose) => server.close(() => resolveClose()))));
	return ports;
}

async function fixture(options: { blockedStorage?: boolean; failingSync?: boolean; slowSync?: boolean; failingWeb?: boolean; crashingWorker?: boolean } = {}) {
	const directory = await mkdtemp(join(tmpdir(), 'release-brief-dev-test-'));
	const entry = { directory, child: undefined as ChildProcess | undefined };
	fixtures.push(entry);
	for (const path of ['scripts', 'bin', 'node_modules/typescript/bin', 'node_modules/azurite/dist/src',
		'node_modules/vite/bin', 'dist-functions/scripts']) await mkdir(join(directory, path), { recursive: true });
	const ports = await availablePorts();
	let source = await readFile(new URL('../../scripts/dev-all.mjs', import.meta.url), 'utf8');
	for (const [index, port] of [10000, 10001, 10002, 7071, 5173].entries()) {
		source = source.replace(new RegExp(`\\b${port}\\b`, 'g'), String(ports[index]));
	}
	await writeFile(join(directory, 'scripts/dev-all.mjs'), source);
	await writeFile(join(directory, 'scripts/dev-ports.mjs'), await readFile(new URL('../../scripts/dev-ports.mjs', import.meta.url), 'utf8'));
	await writeFile(join(directory, '.env.example'), 'AZURE_STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true\n');
	await writeFile(join(directory, 'local.settings.example.json'), JSON.stringify({
		IsEncrypted: false, Values: { AzureWebJobsStorage: 'UseDevelopmentStorage=true', FUNCTIONS_WORKER_RUNTIME: 'node' }
	}));
	if (options.blockedStorage) await writeFile(join(directory, '.env'), 'AZURE_STORAGE_CONNECTION_STRING=not-local\n# Keep my config\n');
	await writeFile(join(directory, 'package.json'), '{"type":"module"}');
	const helper = `
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:net';
const event = name => appendFileSync('events', name + ':' + process.pid + '\\n');
function serve(name, ports) { event(name); for (const port of ports) createServer().listen(port, '127.0.0.1'); }
`;
	await writeFile(join(directory, 'node_modules/typescript/bin/tsc'), `${helper}event('build');`);
	await writeFile(join(directory, 'node_modules/azurite/dist/src/azurite.js'), `${helper}serve('storage', ${JSON.stringify(ports.slice(0, 3))});`);
	await writeFile(join(directory, 'dist-functions/scripts/sync-releases.js'), `${helper}
event('sync');
${options.failingSync ? 'process.exitCode = 7;' : options.slowSync ? 'setInterval(() => {}, 1000);' : ''}
`);
	await writeFile(join(directory, 'node_modules/vite/bin/vite.js'), `${helper}
${options.failingWeb ? "event('web'); process.exitCode = 8;" : `serve('web', [${ports[4]}]);`}
`);
	await writeFile(join(directory, 'bin/func'), `#!/usr/bin/env node
${helper}
if (process.argv.includes('--version')) console.log('4.0.0');
else {
	${options.crashingWorker ? `
	const { spawn } = await import('node:child_process');
	const child = spawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(`${helper}event('worker-child'); setInterval(() => {}, 1000);`)}], { stdio: 'inherit' });
	child.once('spawn', () => setTimeout(() => process.exit(9), 300));
	` : `serve('worker', [${ports[3]}]);`}
}
`);
	await chmod(join(directory, 'bin/func'), 0o755);
	const env = { ...process.env };
	for (const key of ['AZURE_STORAGE_CONNECTION_STRING', 'AzureWebJobsStorage', 'COMPARISON_QUEUE_NAME', 'RELEASE_SYNC_SCHEDULE']) delete env[key];
	env.PATH = `${join(directory, 'bin')}:${process.env.PATH}`;
	const child = spawn(process.execPath, ['scripts/dev-all.mjs'], { cwd: directory, env });
	entry.child = child;
	let output = '';
	child.stdout?.on('data', (chunk) => { output += chunk.toString(); });
	child.stderr?.on('data', (chunk) => { output += chunk.toString(); });
	const exited = new Promise<number | null>((resolveExit, reject) => {
		child.once('error', reject);
		child.once('exit', resolveExit);
	});
	return {
		directory, child, exited, output: () => output,
		async waitFor(text: string) {
			for (let attempt = 0; attempt < 200; attempt++) {
				if (output.includes(text)) return;
				if (child.exitCode !== null) throw new Error(`Exited before "${text}": ${output}`);
				await delay(25);
			}
			throw new Error(`Timed out waiting for "${text}": ${output}`);
		}
	};
}

async function processEvents(directory: string) {
	return (await readFile(join(directory, 'events'), 'utf8')).trim().split('\n').map((event) => {
		const [name, pid] = event.split(':');
		return { name, pid: Number(pid) };
	});
}

function isAlive(pid: number) {
	try { process.kill(pid, 0); return true; }
	catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
		throw error;
	}
}

afterEach(async () => {
	for (const { directory, child } of fixtures.splice(0)) {
		if (child && child.exitCode === null && child.signalCode === null) {
			child.kill('SIGTERM');
			await new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()));
		}
		await rm(directory, { recursive: true, force: true });
	}
});

describe.skipIf(process.platform === 'win32')('one-terminal development supervisor', () => {
	it('starts services in order, copies missing config, and stops every service on Ctrl+C', async () => {
		const app = await fixture();
		await app.waitFor('All services are running');
		expect((await processEvents(app.directory)).map(({ name }) => name))
			.toEqual(['build', 'storage', 'sync', 'worker', 'web']);
		expect(await readFile(join(app.directory, '.env'), 'utf8')).toContain('UseDevelopmentStorage=true');
		expect(JSON.parse(await readFile(join(app.directory, 'local.settings.json'), 'utf8')).Values.FUNCTIONS_WORKER_RUNTIME).toBe('node');
		app.child.kill('SIGINT');
		expect(await app.exited).toBe(0);
		expect((await processEvents(app.directory)).every(({ pid }) => !isAlive(pid))).toBe(true);
	});

	it('preserves existing configuration and rejects nonlocal storage before starting services', async () => {
		const app = await fixture({ blockedStorage: true });
		expect(await app.exited).toBe(1);
		expect(app.output()).toContain('must be UseDevelopmentStorage=true');
		expect(await readFile(join(app.directory, '.env'), 'utf8')).toBe('AZURE_STORAGE_CONNECTION_STRING=not-local\n# Keep my config\n');
	});

	it('stops storage and exits nonzero if release sync fails', async () => {
		const app = await fixture({ failingSync: true });
		expect(await app.exited).toBe(1);
		const events = await processEvents(app.directory);
		expect(events.map(({ name }) => name)).toEqual(['build', 'storage', 'sync']);
		expect(events.every(({ pid }) => !isAlive(pid))).toBe(true);
		expect(app.output()).toContain('code 7');
	});

	it('interrupts an in-progress sync immediately and cleans up its processes', async () => {
		const app = await fixture({ slowSync: true });
		await app.waitFor('Starting release synchronization');
		await delay(100);
		app.child.kill('SIGINT');
		expect(await app.exited).toBe(0);
		expect((await processEvents(app.directory)).every(({ pid }) => !isAlive(pid))).toBe(true);
	});

	it('stops the other services if the web app fails to start', async () => {
		const app = await fixture({ failingWeb: true });
		expect(await app.exited).toBe(1);
		expect(app.output()).toContain('web app exited with code 8');
		expect((await processEvents(app.directory)).every(({ pid }) => !isAlive(pid))).toBe(true);
	});

	it('cleans up worker descendants even when the host process crashes', async () => {
		const app = await fixture({ crashingWorker: true });
		expect(await app.exited).toBe(1);
		expect(app.output()).toContain('Functions worker exited with code 9');
		const events = await processEvents(app.directory);
		expect(events.map(({ name }) => name)).toContain('worker-child');
		for (let attempt = 0; attempt < 50 && events.some(({ pid }) => isAlive(pid)); attempt++) await delay(20);
		expect(events.every(({ pid }) => !isAlive(pid))).toBe(true);
	});
});
