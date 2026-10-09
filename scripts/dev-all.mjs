import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { resolvePortConflicts } from './dev-ports.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = new Set();
const services = new Set();
const shutdown = new AbortController();
let stopping = false;
let failed = false;

function stop() {
	if (stopping) return;
	stopping = true;
	shutdown.abort();
}

function fail(message) {
	if (!stopping) {
		console.error(`[dev] ${message}`);
		failed = true;
		stop();
	}
}

function start(name, command, args) {
	console.log(`[dev] Starting ${name}.`);
	const child = spawn(command, args, {
		cwd: root,
		env: process.env,
		stdio: 'inherit',
		detached: process.platform !== 'win32',
		shell: process.platform === 'win32' && command === 'func'
	});
	children.add(child);
	const completed = new Promise((resolveCompletion, reject) => {
		child.once('error', (error) => {
			children.delete(child);
			fail(`${name} could not start: ${error.message}`);
			reject(error);
		});
		child.once('exit', (code, signal) => {
			children.delete(child);
			if (code === 0) resolveCompletion();
			else {
				const error = new Error(`${name} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`);
				fail(error.message);
				reject(error);
			}
		});
	});
	// Services may fail while startup is awaiting another process.
	void completed.catch(() => {});
	return { child, completed };
}

async function run(name, command, args) {
	shutdown.signal.throwIfAborted();
	const result = start(name, command, args);
	let abort;
	try {
		await Promise.race([
			result.completed,
			new Promise((_, reject) => {
				abort = () => reject(shutdown.signal.reason);
				shutdown.signal.addEventListener('abort', abort, { once: true });
			})
		]);
	} finally {
		shutdown.signal.removeEventListener('abort', abort);
	}
	shutdown.signal.throwIfAborted();
}

function service(name, command, args) {
	shutdown.signal.throwIfAborted();
	const result = start(name, command, args);
	services.add(result.child);
	void result.completed.then(() => fail(`${name} stopped unexpectedly.`), () => {});
	return result.child;
}

function portIsOpen(port) {
	return new Promise((resolveOpen) => {
		const socket = createConnection({ host: '127.0.0.1', port });
		const finish = (open) => {
			socket.destroy();
			resolveOpen(open);
		};
		socket.once('connect', () => finish(true));
		socket.once('error', () => finish(false));
		socket.setTimeout(500, () => finish(false));
	});
}

async function waitForPorts(name, ports) {
	for (let attempt = 0; attempt < 120; attempt++) {
		shutdown.signal.throwIfAborted();
		if ((await Promise.all(ports.map(portIsOpen))).every(Boolean)) {
			console.log(`[dev] ${name} is ready.`);
			return;
		}
		await delay(500, undefined, { signal: shutdown.signal });
	}
	throw new Error(`${name} did not become ready. Check its output above.`);
}

async function ensureFile(example, destination) {
	try {
		await copyFile(resolve(root, example), resolve(root, destination), constants.COPYFILE_EXCL);
		console.log(`[dev] Created ${destination} from ${example}.`);
	} catch (error) {
		if (error.code !== 'EEXIST') throw error;
	}
}

async function prepareConfiguration() {
	await ensureFile('.env.example', '.env');
	await ensureFile('local.settings.example.json', 'local.settings.json');
	loadEnvFile(resolve(root, '.env'));
	const settings = JSON.parse(await readFile(resolve(root, 'local.settings.json'), 'utf8'));
	if (settings.IsEncrypted || !settings.Values || typeof settings.Values !== 'object' || Array.isArray(settings.Values)) {
		throw new Error('local.settings.json must contain unencrypted local Functions Values.');
	}
	for (const key of ['AZURE_STORAGE_CONNECTION_STRING', 'AzureWebJobsStorage']) {
		const values = [process.env[key], settings.Values[key]].filter((value) => value !== undefined);
		if (values.some((value) => value !== 'UseDevelopmentStorage=true')) {
			throw new Error(`${key} must be UseDevelopmentStorage=true for dev:all. Use the individual commands for other storage configurations.`);
		}
	}
	if (settings.Values.FUNCTIONS_WORKER_RUNTIME !== 'node') {
		throw new Error('Set FUNCTIONS_WORKER_RUNTIME to node in local.settings.json.');
	}
	for (const key of ['COMPARISON_QUEUE_NAME', 'RELEASE_SYNC_SCHEDULE']) {
		if (process.env[key] && settings.Values[key] && process.env[key] !== settings.Values[key]) {
			throw new Error(`${key} differs between the environment/.env and local.settings.json. Set them to the same value.`);
		}
	}
	process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
	process.env.AzureWebJobsStorage = 'UseDevelopmentStorage=true';
	process.env.COMPARISON_QUEUE_NAME ??= settings.Values.COMPARISON_QUEUE_NAME ?? 'report-jobs';
	process.env.RELEASE_SYNC_SCHEDULE ??= settings.Values.RELEASE_SYNC_SCHEDULE ?? '0 0 * * * *';
}

async function terminateChildren() {
	const active = [...new Set([...children, ...services])];
	function signal(child, force) {
		if (!child.pid) return;
		if (process.platform === 'win32') {
			const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', ...(force ? ['/F'] : [])], { stdio: 'ignore' });
			killer.once('error', (error) => {
				console.error(`[dev] Could not stop process ${child.pid}: ${error.message}`);
				failed = true;
			});
		} else {
			try {
				process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
			} catch (error) {
				if (error.code !== 'ESRCH') {
					console.error(`[dev] Could not stop process ${child.pid}: ${error.message}`);
					failed = true;
				}
			}
		}
	}
	for (const child of active) signal(child, false);
	for (let attempt = 0; attempt < 50 && children.size; attempt++) await delay(100);
	for (const child of active) signal(child, true);
	if (children.size) await Promise.all([...children].map((child) => new Promise((resolveExit) => child.once('exit', resolveExit))));
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

try {
	await prepareConfiguration();
	await run('Git prerequisite check', 'git', ['--version']);
	await run('Azure Functions Core Tools prerequisite check (install v4 if missing)', 'func', ['--version']);
	const ports = [10000, 10001, 10002, 7071, 5173];
	await resolvePortConflicts(ports, { signal: shutdown.signal });
	await run('Functions build', process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.functions.json']);
	service('Azurite', process.execPath, ['node_modules/azurite/dist/src/azurite.js', '--silent', '--location', '.azurite', '--skipApiVersionCheck']);
	await waitForPorts('Azurite', [10000, 10001, 10002]);
	await run('release synchronization (the first run can take a while)', process.execPath, ['dist-functions/scripts/sync-releases.js']);
	service('Functions worker', 'func', ['start', '--port', '7071']);
	await waitForPorts('Functions worker', [7071]);
	service('web app', process.execPath, ['node_modules/vite/bin/vite.js', 'dev', '--host', '127.0.0.1', '--port', '5173', '--strictPort']);
	await waitForPorts('web app', [5173]);
	console.log('[dev] Open http://127.0.0.1:5173. All services are running in this terminal. Press Ctrl+C to stop them.');
	await new Promise((resolveStop) => {
		if (shutdown.signal.aborted) resolveStop();
		else shutdown.signal.addEventListener('abort', resolveStop, { once: true });
	});
} catch (error) {
	if (!stopping) {
		console.error(`[dev] ${error.message}`);
		failed = true;
	}
} finally {
	stop();
	console.log('[dev] Stopping local services.');
	await terminateChildren();
	process.exitCode = failed ? 1 : 0;
}
