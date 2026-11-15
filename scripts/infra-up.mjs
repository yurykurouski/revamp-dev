#!/usr/bin/env node
// `npm run docker:up`: starts MongoDB, Redis and MinIO without the apps. Goes through the same
// startInfrastructure as setup and dev, so the MongoDB users and replica set exist (REV-198).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SetupError, checkDocker, fail, log, startInfrastructure } from './lib/dev-stack.mjs';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  if (!fs.existsSync(path.join(root, '.env'))) {
    throw new SetupError('The project is not set up yet.', 'Run `npm run setup` first.');
  }
  log.step('Starting MongoDB, Redis and MinIO');
  checkDocker();
  startInfrastructure(root);
  log.ok('Infrastructure is healthy');
} catch (error) {
  fail(error);
}
