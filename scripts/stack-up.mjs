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

  log.step('Building and starting the stack (the first build takes a few minutes)');
  runOrFail('docker', ['compose', '-f', 'docker-compose.full.yml', 'up', '-d', '--build', '--wait'], {
    cwd: root,
    hint: 'See `docker compose -f docker-compose.full.yml logs`.',
  });

  const env = parseEnv(fs.readFileSync(path.join(root, '.env'), 'utf8'));
  log.ok(`Dashboard: http://localhost:${env.STACK_DASHBOARD_PORT || 8080}`);
  log.ok(`API:       http://localhost:${env.STACK_API_PORT || 4000}/api/v1/health`);
  log.ok('Stop it with `npm run stack:down` (data stays in Docker volumes)');
} catch (error) {
  fail(error);
}
