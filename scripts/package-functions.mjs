import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, '.azure-build', 'functions');
const packageManager = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, cwd) {
	const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

await rm(join(root, 'dist-functions'), { recursive: true, force: true });
run(packageManager, ['run', 'build:functions'], root);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(root, 'dist-functions'), join(output, 'dist-functions'), { recursive: true });
await cp(join(root, 'host.json'), join(output, 'host.json'));
await cp(join(root, '.funcignore'), join(output, '.funcignore'));

const rootPackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const functionPackage = {
	name: `${rootPackage.name}-functions`,
	version: rootPackage.version,
	type: 'module',
	main: rootPackage.main,
	dependencies: rootPackage.dependencies
};

await writeFile(join(output, 'package.json'), `${JSON.stringify(functionPackage, null, 2)}\n`);
run(packageManager, ['install', '--package-lock-only', '--omit=dev', '--ignore-scripts'], output);
run(packageManager, ['ci', '--omit=dev', '--ignore-scripts'], output);
