import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';

const execute = promisify(execFile);

async function commandOutput(command, args, signal) {
	try {
		return (await execute(command, args, { signal, timeout: 10_000, maxBuffer: 1024 * 1024 })).stdout.trim();
	} catch (error) {
		// lsof and ps use exit code 1 when the listener/process has disappeared.
		if (error.code === 1 && !error.stdout?.trim() && !error.stderr?.trim()) return '';
		throw new Error(`Could not inspect port owners using ${command}: ${error.message}`, { cause: error });
	}
}

export async function listPortProcesses(ports, signal) {
	if (!ports.every((port) => Number.isInteger(port) && port > 0 && port <= 65535)) {
		throw new Error('Invalid development port.');
	}
	if (process.platform === 'win32') {
		const output = await commandOutput('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference = 'Stop'
$ports = @(${ports.join(',')})
$listeners = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in $ports })
$result = @($listeners | Group-Object OwningProcess | ForEach-Object {
  $owner = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $_.Name)
  if ($null -eq $owner) { throw "Cannot identify process $($_.Name)" }
  [PSCustomObject]@{
    pid = [int]$_.Name
    ports = @($_.Group.LocalPort | Sort-Object -Unique)
    command = $owner.CommandLine
    identity = "$($owner.CreationDate.ToString('o')) $($owner.CommandLine)"
  }
})
ConvertTo-Json -InputObject $result -Compress
`], signal);
		return output ? JSON.parse(output) : [];
	}
	const output = await commandOutput('lsof', [
		'-nP', ...ports.map((port) => `-iTCP:${port}`), '-sTCP:LISTEN', '-Fpn'
	], signal);
	const owners = new Map();
	let owner;
	for (const line of output.split('\n')) {
		if (line.startsWith('p')) {
			const pid = Number(line.slice(1));
			if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('lsof returned an invalid process ID.');
			owner = owners.get(pid) ?? { pid, ports: new Set() };
			owners.set(pid, owner);
		} else if (line.startsWith('n') && owner) {
			const port = Number(/:(\d+)$/.exec(line)?.[1]);
			if (ports.includes(port)) owner.ports.add(port);
		}
	}
	const result = [];
	for (const { pid, ports: ownedPorts } of owners.values()) {
		if (!ownedPorts.size) continue;
		const identity = await commandOutput('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'command='], signal);
		if (!identity) continue;
		const command = await commandOutput('ps', ['-p', String(pid), '-o', 'command='], signal);
		if (command) result.push({ pid, ports: [...ownedPorts].sort((a, b) => a - b), command, identity });
	}
	return result;
}

async function confirm(question, { input, output, signal }) {
	const prompt = createInterface({ input, output });
	let onClose;
	try {
		const answer = await Promise.race([
			prompt.question(`[dev] ${question} [y/N] `, { signal }),
			new Promise((_, reject) => {
				onClose = () => reject(new Error('Confirmation input closed. No additional processes will be stopped.'));
				prompt.once('close', onClose);
			})
		]);
		return /^(y|yes)$/i.test(answer.trim());
	} finally {
		prompt.removeListener('close', onClose);
		prompt.close();
	}
}

async function stopOwners(approved, ports, force, signal) {
	const current = await listPortProcesses(ports, signal);
	for (const owner of current) {
		if (!approved.some((previous) => previous.pid === owner.pid && previous.identity === owner.identity)) {
			throw new Error(`Port ownership changed (PID ${owner.pid}). No new owner will be stopped. Run dev:all again to review it.`);
		}
	}
	for (const owner of current) {
		signal?.throwIfAborted();
		if (owner.pid === process.pid || owner.pid === process.ppid) {
			throw new Error(`Refusing to stop the development launcher or its parent (PID ${owner.pid}).`);
		}
		try {
			if (process.platform === 'win32') {
				await execute('taskkill', ['/PID', String(owner.pid), ...(force ? ['/F'] : [])], { signal, timeout: 10_000 });
			} else {
				process.kill(owner.pid, force ? 'SIGKILL' : 'SIGTERM');
			}
		} catch (error) {
			if (error.code !== 'ESRCH') throw new Error(`Could not stop PID ${owner.pid}: ${error.message}`, { cause: error });
		}
	}
}

export async function resolvePortConflicts(ports, options = {}) {
	const { input = process.stdin, output = process.stdout, signal, interactive = Boolean(input.isTTY) } = options;
	const owners = await listPortProcesses(ports, signal);
	if (!owners.length) return;
	output.write('[dev] These processes are using the required ports:\n');
	for (const owner of owners) {
		output.write(`[dev] PID ${owner.pid} | ports ${owner.ports.join(', ')} | ${owner.command.replace(/[\r\n\x1b]/g, ' ')}\n`);
	}
	if (!interactive) {
		throw new Error('Port conflicts require confirmation in an interactive terminal. Stop the listed processes yourself, then run dev:all again. Nothing was stopped.');
	}
	if (!await confirm('Stop the listed processes and continue? This may interrupt another local instance.', { input, output, signal })) {
		throw new Error('Startup cancelled. The listed processes were not stopped.');
	}
	await stopOwners(owners, ports, false, signal);
	const gracefulDeadline = Date.now() + 5_000;
	while (Date.now() < gracefulDeadline) {
		signal?.throwIfAborted();
		await delay(200, undefined, { signal });
		if (!(await listPortProcesses(ports, signal)).length) {
			output.write('[dev] Required ports are free. Continuing startup.\n');
			return;
		}
	}
	const remaining = await listPortProcesses(ports, signal);
	if (remaining.some((owner) => !owners.some((approved) => approved.pid === owner.pid && approved.identity === owner.identity))) {
		throw new Error('A new process acquired a required port. Run dev:all again to review it.');
	}
	if (!await confirm('Some approved processes did not stop. Force-stop them and continue?', { input, output, signal })) {
		throw new Error('Required ports are still in use. Startup cancelled without force-stopping processes.');
	}
	await stopOwners(remaining, ports, true, signal);
	const forceDeadline = Date.now() + 5_000;
	while (Date.now() < forceDeadline) {
		await delay(200, undefined, { signal });
		if (!(await listPortProcesses(ports, signal)).length) {
			output.write('[dev] Required ports are free. Continuing startup.\n');
			return;
		}
	}
	throw new Error('Required ports are still in use after stopping the approved processes.');
}
