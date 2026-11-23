#!/usr/bin/env node
// `npm run stack:up`: starts the whole system in containers (REV-218, docker-compose.full.yml): MongoDB,
// Redis, MinIO, the API, the workers and the dashboard. It first makes sure .env has the generated secrets
// the stack needs, then builds the images and waits until every service is healthy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkDocker,
  ensureEnvFile,
  ensureJwtSecret,
  ensureMongoSecrets,
  ensureStackSecrets,
  fail,
  log,
  parseEnv,
  runOrFail,
  writeStackSecretFiles,
} from './lib/dev-stack.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  log.step('Checking Docker');
  checkDocker();

  log.step('Preparing .env');
  if (ensureEnvFile(root)) log.ok('Created .env from .env.example');
  const mongo = ensureMongoSecrets(root);
  if (mongo.added.length) log.ok(`Generated ${mongo.added.join(', ')} in .env`);
  if (ensureJwtSecret(root)) log.ok('Generated JWT_SECRET in .env');
  const stack = ensureStackSecrets(root);
  if (stack.length) log.ok(`Generated ${stack.join(', ')} in .env`);

  // REV-220: the API and the workers read their secrets from files, not from the environment
  const secretFiles = writeStackSecretFiles(root, parseEnv(fs.readFileSync(path.join(root, '.env'), 'utf8')));
  log.ok(`Wrote the Docker secret files ${secretFiles.join(', ')} to .stack-secrets/`);

  // `npm run stack:up -- --monitoring` also starts Prometheus; `-- --debug` adds docker-compose.debug.yml
  const flags = process.argv.slice(2);
  const monitoring = flags.includes('--monitoring');
  const debug = flags.includes('--debug');
  const files = ['-f', 'docker-compose.full.yml', ...(debug ? ['-f', 'docker-compose.debug.yml'] : [])];
  log.step('Building and starting the stack (the first build takes a few minutes)');
  runOrFail('docker', ['compose', ...files, ...(monitoring ? ['--profile', 'monitoring'] : []), 'up', '-d', '--build', '--wait'], {
    cwd: root,
    hint: 'See `docker compose -f docker-compose.full.yml logs`.',
  });

  const env = parseEnv(fs.readFileSync(path.join(root, '.env'), 'utf8'));
  log.ok(`Dashboard: http://localhost:${env.STACK_DASHBOARD_PORT || 8080}`);
  log.ok(`API:       http://localhost:${env.STACK_API_PORT || 4000}/api/v1/health`);
  if (monitoring) log.ok(`Prometheus: http://localhost:${env.STACK_PROMETHEUS_PORT || 9090}`);
  if (debug) log.ok('Debugger: api 127.0.0.1:9229, workers 127.0.0.1:9230 (docker-compose.debug.yml)');
  log.ok('Stop it with `npm run stack:down` (data stays in Docker volumes)');
} catch (error) {
  fail(error);
}
