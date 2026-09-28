// Helpers for `npm run setup` and `npm run dev` (REV-95).
// Plain Node with no dependencies: setup runs before `npm install`.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export const MIN_NODE_MAJOR = 20;

/** Long-running infrastructure services; `minio-init` is a one-shot job run after them. */
export const INFRA_SERVICES = ['mongo', 'redis', 'minio'];

/** Packages the apps import from their compiled `dist`, in build order. */
export const PACKAGES = ['shared-types', 'validation', 'db'];

export const APPS = [
  { name: 'api', workspace: '@revamp/api', color: 36, port: 4000 },
  { name: 'workers', workspace: '@revamp/workers', color: 35 },
  { name: 'dashboard', workspace: '@revamp/dashboard', color: 32, port: 5173 },
];

export const LLM_KEY_VARS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'];

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
export const paint = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);

export const log = {
  step: (msg) => console.log(`\n${paint('1;34', '▸')} ${paint(1, msg)}`),
  ok: (msg) => console.log(`  ${paint(32, '✓')} ${msg}`),
  warn: (msg) => console.log(`  ${paint(33, '!')} ${msg}`),
  info: (msg) => console.log(`    ${msg}`),
};

/** Thrown for a failed check; `hint` tells the user how to fix it. */
export class SetupError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'SetupError';
    this.hint = hint;
  }
}

/** Prints a SetupError (or any error) and exits with status 1. */
export function fail(error) {
  console.error(`\n${paint('1;31', '✗')} ${paint(1, error.message)}`);
  if (error.hint) console.error(`  ${error.hint.split('\n').join('\n  ')}`);
  process.exit(1);
}

/** Throws unless `version` (e.g. `v22.1.0`) is at least MIN_NODE_MAJOR. */
export function checkNodeVersion(version) {
  const major = Number.parseInt(String(version).replace(/^v/, ''), 10);
  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
    throw new SetupError(
      `Node.js ${MIN_NODE_MAJOR}+ is required, found ${version}.`,
      'Install the current LTS from https://nodejs.org (or run `nvm install --lts`).',
    );
  }
  return major;
}

/**
 * Throws unless the Docker CLI, Docker Compose v2 and a running daemon are available.
 * `run(cmd, args)` returns `{ status, stderr }` (spawnSync-like) so tests can stub it.
 */
export function checkDocker(run = runQuiet) {
  const cli = run('docker', ['--version']);
  if (cli.error || cli.status !== 0) {
    throw new SetupError(
      'Docker is not installed.',
      'Install Docker Desktop (https://www.docker.com/products/docker-desktop) and start it.',
    );
  }
  if (run('docker', ['compose', 'version']).status !== 0) {
    throw new SetupError(
      'Docker Compose v2 (`docker compose`) is not available.',
      'Update Docker Desktop, or install the compose plugin: https://docs.docker.com/compose/install/',
    );
  }
  if (run('docker', ['info']).status !== 0) {
    throw new SetupError('Docker is installed but not running.', 'Start Docker Desktop, wait until it says it is running, then try again.');
  }
}

/** Copies `.env.example` to `.env` unless `.env` exists. Returns true when it created the file. */
export function ensureEnvFile(root) {
  const target = path.join(root, '.env');
  if (fs.existsSync(target)) return false;
  fs.copyFileSync(path.join(root, '.env.example'), target);
  return true;
}

/** Minimal dotenv parser: KEY=value lines, optional quotes, `#` comments. */
export function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    const quoted = value.match(/^(['"])(.*)\1$/);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, '');
    env[match[1]] = value;
  }
  return env;
}

/**
 * Which LLM providers the workers can use: API keys set in `env`, and the Claude Code CLI when
 * `cliFound`. Audits need at least one (the design critique), so setup warns when there is none.
 */
export function llmProviders(env, cliFound) {
  const providers = LLM_KEY_VARS.filter((key) => env[key]).map((key) => key.replace('_API_KEY', '').toLowerCase());
  if (cliFound) providers.push('claude-cli');
  return providers;
}

/** True when `cmd` resolves on PATH (or is an existing file path). */
export function commandExists(cmd) {
  if (!cmd) return false;
  if (cmd.includes('/') || cmd.includes('\\')) return fs.existsSync(cmd);
  const probe = process.platform === 'win32' ? runQuiet('where', [cmd]) : runQuiet('sh', ['-c', `command -v "${cmd}"`]);
  return probe.status === 0;
}

function newestMtime(dir) {
  let newest = 0;
  if (!fs.existsSync(dir)) return newest;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const mtime = entry.isDirectory() ? newestMtime(full) : fs.statSync(full).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

/**
 * Names of the packages whose `dist` is missing or older than their `src` or `package.json`,
 * so `npm run dev` rebuilds them only when needed (e.g. after a `git pull`).
 */
export function stalePackages(root, packages = PACKAGES) {
  return packages.filter((name) => {
    const dir = path.join(root, 'packages', name);
    const entry = path.join(dir, 'dist', 'index.js');
    if (!fs.existsSync(entry)) return true;
    const built = fs.statSync(entry).mtimeMs;
    return newestMtime(path.join(dir, 'src')) > built || fs.statSync(path.join(dir, 'package.json')).mtimeMs > built;
  });
}

/** Resolves true when something accepts TCP connections on `port` at localhost (IPv4 or IPv6). */
export function isPortInUse(port, timeoutMs = 500) {
  const probe = (host) =>
    new Promise((resolve) => {
      const socket = net.connect({ port, host });
      const done = (busy) => {
        socket.destroy();
        resolve(busy);
      };
      socket.setTimeout(timeoutMs, () => done(false));
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
    });
  return Promise.all([probe('127.0.0.1'), probe('::1')]).then((results) => results.some(Boolean));
}

/**
 * Splits a stream chunk into complete lines, each prefixed with `prefix`.
 * Returns the prefixed text and the unfinished tail to carry into the next chunk.
 */
export function prefixLines(prefix, chunk, carry = '') {
  const lines = (carry + chunk).split(/\r?\n/);
  const rest = lines.pop();
  return { text: lines.map((line) => `${prefix} ${line}\n`).join(''), rest };
}

/** `name` padded to the longest app name, colored, in brackets: `[api      ]`. */
export function appPrefix(app, apps = APPS) {
  const width = Math.max(...apps.map((a) => a.name.length));
  return paint(app.color, `[${app.name.padEnd(width)}]`);
}

export function runQuiet(cmd, args, options = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', shell: process.platform === 'win32', ...options });
}

/** Runs a command with inherited output; throws a SetupError with `hint` when it fails. */
export function runOrFail(cmd, args, { cwd, hint } = {}) {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error || result.status !== 0) {
    throw new SetupError(`\`${[cmd, ...args].join(' ')}\` failed.`, hint);
  }
}

export const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** Starts MongoDB, Redis and MinIO, waits until they are healthy, then creates the MinIO buckets. */
export function startInfrastructure(root) {
  const portsHint =
    'Check that Docker is running and that ports 27017, 6379, 9000 and 9001 are free\n' +
    '(another MongoDB/Redis on this machine will clash). See `docker compose logs`.';
  runOrFail('docker', ['compose', 'up', '-d', '--wait', ...INFRA_SERVICES], { cwd: root, hint: portsHint });
  const init = runQuiet('docker', ['compose', 'run', '--rm', 'minio-init'], { cwd: root });
  if (init.status !== 0) {
    throw new SetupError('Could not create the MinIO buckets.', `${(init.stderr || '').trim()}\nRun \`docker compose run --rm minio-init\` to see the full output.`);
  }
}

/** Spawns an app's dev server in its own process group so the whole tree can be stopped. */
export function spawnApp(app, root) {
  return spawn(npm, ['run', 'dev', `--workspace=${app.workspace}`], {
    cwd: root,
    // Output is piped for the prefixes; keep the apps' colors anyway.
    env: process.env.NO_COLOR ? process.env : { ...process.env, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    shell: process.platform === 'win32',
  });
}

/** Stops a child started by spawnApp together with its descendants (npm → tsx → node). */
export function stopProcessTree(child, signal = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else process.kill(-child.pid, signal);
  } catch {
    // Already gone.
  }
}
