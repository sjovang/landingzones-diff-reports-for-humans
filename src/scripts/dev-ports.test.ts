import { spawn, type ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';

const { listPortProcesses, resolvePortConflicts } = await import(new URL('../../scripts/dev-ports.mjs', import.meta.url).href);
const listeners: ChildProcess[] = [];

async function listener(ignoreTerm = false, port = 0) {
	const child = spawn(process.execPath, ['--input-type=module', '-e', `
		import { createServer } from 'node:net';
		${ignoreTerm ? "process.on('SIGTERM', () => {});" : ''}
		const server = createServer();
		server.listen(${port}, '127.0.0.1', () => console.log(server.address().port));
	`], { stdio: ['ignore', 'pipe', 'pipe'] });
	listeners.push(child);
	const boundPort = await new Promise<number>((resolvePort, reject) => {
		child.once('error', reject);
		child.stdout!.once('data', (data) => resolvePort(Number(data.toString().trim())));
	});
	return { child, port: boundPort };
}

function terminal() {
	const input = new PassThrough();
	const output = new PassThrough();
	let text = '';
	output.on('data', (data) => { text += data.toString(); });
	return { input, output, interactive: true, text: () => text };
}

async function waitFor(terminalOutput: () => string, text: string) {
	for (let attempt = 0; attempt < 300; attempt++) {
		if (terminalOutput().includes(text)) return;
		await delay(25);
	}
	throw new Error(`Prompt not found: ${text}\n${terminalOutput()}`);
}

afterEach(async () => {
	for (const child of listeners.splice(0)) {
		if (child.exitCode === null && child.signalCode === null) {
			child.kill('SIGKILL');
			await new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()));
		}
	}
});

describe.skipIf(process.platform === 'win32')('development port conflicts', () => {
	it('accepts partial lsof results when a requested port is unused', async () => {
		const { child, port } = await listener();
		const server = createServer();
		await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('Expected TCP port.');
		const unusedPort = address.port;
		await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
		const owners = await listPortProcesses([port, unusedPort]);
		expect(owners).toEqual([expect.objectContaining({ pid: child.pid, ports: [port] })]);
		expect(await listPortProcesses([unusedPort])).toEqual([]);
	});

	it('lists real port owners and does not stop them in non-interactive runs', async () => {
		const { child, port } = await listener();
		const io = terminal();
		const owners = await listPortProcesses([port]);
		expect(owners).toEqual([expect.objectContaining({ pid: child.pid, ports: [port], command: expect.stringContaining('node') })]);
		await expect(resolvePortConflicts([port], { ...io, interactive: false })).rejects.toThrow('Nothing was stopped');
		expect(io.text()).toContain(`PID ${child.pid}`);
		expect(child.signalCode).toBeNull();
	});

	it('defaults to no when the user presses Enter', async () => {
		const { child, port } = await listener();
		const io = terminal();
		const result = resolvePortConflicts([port], io);
		const assertion = expect(result).rejects.toThrow('were not stopped');
		await waitFor(io.text, '[y/N]');
		io.input.write('\n');
		await assertion;
		expect(child.signalCode).toBeNull();
		expect((await listPortProcesses([port]))[0].pid).toBe(child.pid);
	});

	it('stops only the approved listener and releases the port before continuing', async () => {
		const approved = await listener();
		const unrelated = await listener();
		const io = terminal();
		const result = resolvePortConflicts([approved.port], io);
		await waitFor(io.text, '[y/N]');
		io.input.write('yes\n');
		await result;
		expect(await listPortProcesses([approved.port])).toEqual([]);
		expect((await listPortProcesses([unrelated.port]))[0].pid).toBe(unrelated.child.pid);
		expect(io.text()).toContain('Continuing startup');
	});

	it('requires a second confirmation before force-stopping a resistant process', async () => {
		const { port } = await listener(true);
		const io = terminal();
		const result = resolvePortConflicts([port], io);
		await waitFor(io.text, '[y/N]');
		io.input.write('y\n');
		await waitFor(io.text, 'Force-stop them');
		expect(await listPortProcesses([port])).toHaveLength(1);
		io.input.write('yes\n');
		await result;
		expect(await listPortProcesses([port])).toEqual([]);
	}, 20_000);

	it('cancels a pending prompt when shutdown is requested', async () => {
		const { child, port } = await listener();
		const io = terminal();
		const shutdown = new AbortController();
		const result = resolvePortConflicts([port], { ...io, signal: shutdown.signal });
		const assertion = expect(result).rejects.toThrow();
		await waitFor(io.text, '[y/N]');
		shutdown.abort();
		await assertion;
		expect(child.signalCode).toBeNull();
	});

	it('rejects a changed port owner instead of stopping a process the user did not approve', async () => {
		const original = await listener();
		const io = terminal();
		const result = resolvePortConflicts([original.port], io);
		const assertion = expect(result).rejects.toThrow('ownership changed');
		await waitFor(io.text, '[y/N]');
		original.child.kill('SIGTERM');
		await new Promise<void>((resolveExit) => original.child.once('exit', () => resolveExit()));
		const replacement = await listener(false, original.port);
		io.input.write('yes\n');
		await assertion;
		expect(replacement.child.signalCode).toBeNull();
	});

	it('treats closed confirmation input as cancellation without stopping the listener', async () => {
		const { child, port } = await listener();
		const io = terminal();
		const result = resolvePortConflicts([port], io);
		const assertion = expect(result).rejects.toThrow('input closed');
		await waitFor(io.text, '[y/N]');
		io.input.end();
		await assertion;
		expect(child.signalCode).toBeNull();
	});
});
