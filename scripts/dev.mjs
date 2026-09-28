#!/usr/bin/env node
// `npm run dev`: infrastructure + API, workers and dashboard in one terminal (REV-95).
// Ctrl+C stops the three apps; the Docker containers keep running (`npm run docker:down` stops them).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPS,
  SetupError,
  appPrefix,
  checkDocker,
  fail,
  isPortInUse,
  log,
  npm,
  paint,
  prefixLines,
  runOrFail,
  spawnApp,
  stalePackages,
  startInfrastructure,
  stopProcessTree,
} from './lib/dev-stack.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function preflight() {
  if (!fs.existsSync(path.join(root, 'node_modules')) || !fs.existsSync(path.join(root, '.env'))) {
    throw new SetupError('The project is not set up yet.', 'Run `npm run setup` first.');
  }
  for (const app of APPS.filter((a) => a.port)) {
    if (await isPortInUse(app.port)) {
      throw new SetupError(
        `Port ${app.port} (${app.name}) is already in use.`,
        `Another copy of the app may be running. Stop it, or find the process with \`lsof -i :${app.port}\`.`,
      );
    }
  }

  log.step('Starting MongoDB, Redis and MinIO');
  checkDocker();
  startInfrastructure(root);
  log.ok('Infrastructure is healthy');

  const stale = stalePackages(root);
  if (stale.length) {
    log.step(`Building shared packages (${stale.join(', ')} changed)`);
    runOrFail(npm, ['run', 'build:packages'], { cwd: root, hint: 'Fix the TypeScript errors above and try again.' });
  }
}

function runApps() {
  log.step('Starting the API, workers and dashboard (Ctrl+C to stop)');
  console.log(`    Dashboard  ${paint(1, 'http://localhost:5173')}`);
  console.log(`    API        http://localhost:4000/api/v1\n`);

  let stopping = false;
  let exitCode = 0;
  const children = APPS.map((app) => {
    const child = spawnApp(app, root);
    const prefix = appPrefix(app);
    for (const [stream, out] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ]) {
      let carry = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        const { text, rest } = prefixLines(prefix, chunk, carry);
        carry = rest;
        out.write(text);
      });
      stream.on('end', () => carry && out.write(`${prefix} ${carry}\n`));
    }
    child.on('exit', (code, signal) => {
      if (!stopping) {
        console.error(`\n${prefix} exited (${signal ?? `code ${code}`}). Stopping the other apps.`);
        exitCode = code || 1;
        stopAll();
      }
      if (children.every((c) => c.exitCode !== null || c.signalCode !== null)) process.exit(exitCode);
    });
    return child;
  });

  function stopAll() {
    stopping = true;
    for (const child of children) stopProcessTree(child);
    // Force-kill anything that ignores SIGTERM.
    setTimeout(() => {
      for (const child of children) stopProcessTree(child, 'SIGKILL');
      process.exit(exitCode);
    }, 5000).unref();
  }

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      if (stopping) return;
      console.log(`\n${paint(1, 'Stopping…')} (the Docker containers keep running; \`npm run docker:down\` stops them)`);
      stopAll();
    });
  }
}

try {
  await preflight();
  runApps();
} catch (error) {
  fail(error);
}
