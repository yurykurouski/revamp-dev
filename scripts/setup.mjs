#!/usr/bin/env node
// `npm run setup`: takes a fresh clone to a state where `npm run dev` works (REV-95).
// Safe to re-run: every step is idempotent and an existing .env is never overwritten.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkDocker,
  checkNodeVersion,
  commandExists,
  ensureEnvFile,
  fail,
  llmAdvice,
  log,
  npm,
  paint,
  parseEnv,
  runOrFail,
  startInfrastructure,
} from './lib/dev-stack.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  log.step('Checking prerequisites');
  const major = checkNodeVersion(process.version);
  log.ok(`Node.js ${process.version} (${major} ≥ 20)`);
  checkDocker();
  log.ok('Docker is running');

  log.step('Installing dependencies (npm install)');
  runOrFail(npm, ['install'], { cwd: root, hint: 'See the npm error above (network access, free disk space, permissions), then re-run `npm run setup`.' });
  log.ok('Dependencies installed');

  log.step('Installing Chromium for Playwright (used by the site audit)');
  runOrFail(npm, ['exec', '--workspace=@revamp/workers', '--', 'playwright', 'install', 'chromium'], {
    cwd: root,
    hint: 'Re-run `npm run setup`, or run `npx playwright install chromium` yourself.',
  });
  log.ok('Chromium installed');

  log.step('Creating .env');
  if (ensureEnvFile(root)) log.ok('Created .env from .env.example');
  else log.ok('.env already exists, left unchanged');

  log.step('Starting MongoDB, Redis and MinIO in Docker');
  startInfrastructure(root);
  log.ok('Infrastructure is healthy and the MinIO buckets exist');

  log.step('Building the shared packages');
  runOrFail(npm, ['run', 'build:packages'], { cwd: root, hint: 'Fix the TypeScript errors above and re-run `npm run setup`.' });
  log.ok('Packages built');

  const env = parseEnv(fs.readFileSync(path.join(root, '.env'), 'utf8'));
  const { providers, warnings } = llmAdvice(env, commandExists(env.CLAUDE_CLI_PATH || 'claude'));

  console.log(`\n${paint('1;32', '✓ Setup complete.')} Start the app with:\n\n    ${paint(1, 'npm run dev')}\n`);
  console.log(`  Dashboard  http://localhost:5173`);
  console.log(`  API        http://localhost:4000/api/v1`);
  console.log(`  MinIO      http://localhost:9001 (minioadmin / minioadmin)\n`);
  if (providers.length) log.ok(`LLM providers available: ${providers.join(', ')}`);
  if (warnings.length) {
    log.warn(warnings[0]);
    for (const line of warnings.slice(1)) log.info(line);
  }
  console.log('');
} catch (error) {
  fail(error);
}
