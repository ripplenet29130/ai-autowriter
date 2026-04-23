import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const viteCli = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const currentMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const run = (command, args, useShell = false) => {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: useShell,
  });

  if (result.error) {
    console.error(`[build] Failed to start "${command}":`, result.error);
    process.exit(1);
  }

  if (typeof result.status === 'number') {
    process.exit(result.status);
  }

  process.exit(1);
};

if (Number.isFinite(currentMajor) && currentMajor >= 20 && currentMajor < 24) {
  run(process.execPath, [viteCli, 'build', '--outDir', 'build']);
}

console.warn(
  `[build] Detected Node ${process.versions.node}. ` +
  'Vite build is unstable on this project outside the supported 20-23 range, ' +
  'so the build step will run under Node 22.'
);

if (process.platform === 'win32') {
  run(
    `npx -y node@22 "${viteCli}" build --outDir build`,
    [],
    true
  );
}

run(npxCommand, ['-y', 'node@22', viteCli, 'build', '--outDir', 'build']);
