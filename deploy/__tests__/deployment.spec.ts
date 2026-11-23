import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  checkApiKeys,
  checkJwtSecret,
  checkMongoDB,
  checkRedis,
  checkS3Storage,
} from '../../scripts/verify-production-env.js';

describe('Production Deployment & Infrastructure Verification (REV-20)', () => {
  const rootDir = path.resolve(__dirname, '../..');

  describe('Multi-Stage Dockerfiles Integrity', () => {
    it('apps/api/Dockerfile should implement multi-stage build, healthcheck, and non-root user', () => {
      const filePath = path.join(rootDir, 'apps/api/Dockerfile');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('FROM node:22-alpine AS builder');
      expect(content).toContain('FROM node:22-alpine AS runner');
      expect(content).toContain('USER node');
      expect(content).toContain('EXPOSE 4000');
      expect(content).toContain('HEALTHCHECK');
      expect(content).toContain('/api/v1/health');
      expect(content).toContain('npm prune --production');
    });

    it('apps/workers/Dockerfile should use a slim Node base with one Chromium, run as non-root and report health (REV-217)', () => {
      const filePath = path.join(rootDir, 'apps/workers/Dockerfile');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('FROM node:22-bookworm-slim AS builder');
      expect(content).toContain('FROM node:22-bookworm-slim AS runner');
      // The browser is installed once, by the installed Playwright version, and the apt lists are removed
      expect(content).toContain('playwright/cli.js install --with-deps --only-shell chromium');
      expect(content.match(/playwright[^\n]*install/g)).toHaveLength(1);
      expect(content).toContain('rm -rf /var/lib/apt/lists/*');
      expect(content).not.toContain('mcr.microsoft.com/playwright');
      expect(content).toContain('USER node');
      expect(content).toContain('HEALTHCHECK');
      expect(content).toContain('/tmp/revamp-workers-heartbeat');
      expect(content).toContain('apps/workers/dist/index.js');
    });

    it.each(['apps/api/Dockerfile', 'apps/workers/Dockerfile'])(
      '%s should build and ship the shared @revamp/db models (REV-48)',
      (dockerfile) => {
        const content = fs.readFileSync(path.join(rootDir, dockerfile), 'utf-8');
        expect(content).toContain('COPY packages/db ./packages/db');
        expect(content).toContain('npm run build --workspace=@revamp/db');
        expect(content).toMatch(/--from=builder \/app\/packages\/db\/dist \.\/packages\/db\/dist/);
      },
    );

    it('apps/dashboard/Dockerfile should build Vite SPA and serve through Nginx Alpine', () => {
      const filePath = path.join(rootDir, 'apps/dashboard/Dockerfile');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('FROM node:22-alpine AS builder');
      expect(content).toContain('FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner');
      expect(content).toContain('/etc/nginx/conf.d/default.conf');
      expect(content).toContain('/usr/share/nginx/html');
      expect(content).toContain('USER nginx');
      expect(content).toContain('EXPOSE 8080');
      expect(content).toContain('HEALTHCHECK');
    });

    it('every app image runs as a non-root user and the API image ships no curl (REV-217)', () => {
      for (const app of ['api', 'workers', 'dashboard']) {
        const content = fs.readFileSync(path.join(rootDir, `apps/${app}/Dockerfile`), 'utf-8');
        expect(content, `${app} sets a USER`).toMatch(/^USER (node|nginx)$/m);
      }
      const api = fs.readFileSync(path.join(rootDir, 'apps/api/Dockerfile'), 'utf-8');
      expect(api).not.toContain('curl');
    });

    it('the dashboard listens on the unprivileged port its image exposes and nginx proxies to it (REV-217)', () => {
      expect(fs.readFileSync(path.join(rootDir, 'apps/dashboard/nginx.conf'), 'utf-8')).toContain('listen 8080;');
      expect(fs.readFileSync(path.join(rootDir, 'deploy/nginx/conf.d/revamp.conf'), 'utf-8')).toContain(
        'server dashboard:8080;',
      );
    });
  });

  describe('Nginx Reverse Proxy & Dashboard Server Configuration', () => {
    it('apps/dashboard/nginx.conf should configure SPA fallback routing and security headers', () => {
      const filePath = path.join(rootDir, 'apps/dashboard/nginx.conf');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('try_files $uri $uri/ /index.html;');
      expect(content).toContain('gzip on;');
      expect(content).toContain('X-Content-Type-Options "nosniff"');
      expect(content).toContain('X-Frame-Options "SAMEORIGIN"');
      expect(content).toContain('Cache-Control "public, max-age=31536000, immutable"');
    });

    it('deploy/nginx/nginx.conf should configure rate limiting and worker performance', () => {
      const filePath = path.join(rootDir, 'deploy/nginx/nginx.conf');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('worker_processes auto;');
      expect(content).toContain('worker_connections 1024;');
      expect(content).toContain('limit_req_zone $binary_remote_addr zone=api_limit:10m rate=20r/s;');
      expect(content).toContain('server_tokens off;');
      expect(content).toContain('include /etc/nginx/conf.d/*.conf;');
    });

    it('deploy/nginx/conf.d/revamp.conf should configure SSL, HSTS, zero-cache telemetry, and API proxy', () => {
      const filePath = path.join(rootDir, 'deploy/nginx/conf.d/revamp.conf');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      // HTTP -> HTTPS redirect
      expect(content).toContain('return 301 https://$host$request_uri;');
      expect(content).toContain('.well-known/acme-challenge/');

      // HTTPS & SSL
      expect(content).toContain('listen 443 ssl;');
      expect(content).toContain('http2 on;');
      expect(content).toContain('ssl_protocols TLSv1.2 TLSv1.3;');
      expect(content).toContain('Strict-Transport-Security "max-age=31536000; includeSubDomains"');

      // Rate limiting & Proxy
      expect(content).toContain('limit_req zone=api_limit burst=30 nodelay;');
      expect(content).toContain('proxy_pass http://api_backend;');

      // Telemetry route with no-cache
      expect(content).toContain('location /api/v1/track/');
      expect(content).toContain('Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"');
    });
  });

  describe('Cloudflare Pages SPA Deployment', () => {
    it('apps/dashboard/public/_redirects should exist with SPA edge fallback rule', () => {
      const filePath = path.join(rootDir, 'apps/dashboard/public/_redirects');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content.trim()).toMatch(/\/\*\s+\/index\.html\s+200/);
    });
  });

  describe('Local MongoDB service (docker-compose.yml, REV-198)', () => {
    const compose = parseYaml(fs.readFileSync(path.join(rootDir, 'docker-compose.yml'), 'utf-8'));
    const mongo = compose.services.mongo;
    const command = [].concat(mongo.command ?? []).join(' ');

    it('runs mongod as the rs0 replica set with a keyFile, reachable from the host', () => {
      expect(command).toContain('--replSet rs0');
      expect(command).toContain('--keyFile /data/configdb/keyfile');
      expect(command).toContain('--bind_ip_all');
    });

    it('keeps the keyFile in a named volume and mounts the setup scripts read-only', () => {
      expect(mongo.volumes).toEqual(
        expect.arrayContaining(['mongo_config:/data/configdb', './scripts/mongo:/revamp-scripts:ro']),
      );
      expect(compose.volumes).toHaveProperty('mongo_config');
    });

    it('creates no users through MONGO_INITDB_* (setup creates them, REV-198)', () => {
      const environment = JSON.stringify(mongo.environment ?? {});
      expect(environment).not.toContain('MONGO_INITDB_ROOT');
    });
  });

  describe('.dockerignore (REV-217)', () => {
    const lines = fs
      .readFileSync(path.join(rootDir, '.dockerignore'), 'utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));

    it.each(['**/node_modules', '**/dist', '.git', '.env', '.env.*', '**/__tests__'])('excludes %s', (pattern) => {
      expect(lines).toContain(pattern);
    });

    it('lets the sample environment files through', () => {
      expect(lines).toContain('!.env.example');
    });
  });

  describe('Image versions (REV-217)', () => {
    it.each(['docker-compose.yml', 'docker-compose.prod.yml', 'docker-compose.full.yml'])('%s uses no `latest` image tag', (file) => {
      const content = fs.readFileSync(path.join(rootDir, file), 'utf-8');
      expect(content).not.toMatch(/image:\s*\S+:latest/);
      // An image without a tag or digest is `latest` too
      const images = [...content.matchAll(/^\s*image:\s*(\S+)/gm)].map((match) => match[1] ?? '');
      for (const image of images) expect(image, image).toMatch(/[:@]/);
    });

    it('versions the images it builds with the commit deploy.sh deploys', () => {
      const compose = fs.readFileSync(path.join(rootDir, 'docker-compose.prod.yml'), 'utf-8');
      for (const name of ['api', 'workers', 'dashboard']) {
        expect(compose).toContain(`image: revamp-${name}:` + '${IMAGE_TAG:-local}');
      }
      expect(fs.readFileSync(path.join(rootDir, 'deploy/deploy.sh'), 'utf-8')).toContain('export IMAGE_TAG=');
    });
  });

  describe('Container stack (docker-compose.full.yml, REV-218)', () => {
    const content = fs.readFileSync(path.join(rootDir, 'docker-compose.full.yml'), 'utf-8');
    const dev = fs.readFileSync(path.join(rootDir, 'docker-compose.yml'), 'utf-8');
    /** The text of one top-level service: from its `  name:` line to the next service */
    const service = (name: string): string => {
      const start = content.indexOf(`\n  ${name}:\n`);
      expect(start, `service ${name}`).toBeGreaterThan(-1);
      const rest = content.slice(start + 1);
      const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n|\n[a-z#]/);
      return next === -1 ? rest : rest.slice(0, next + 1);
    };

    it('defines the data services, the one-shot initialisers and the three apps', () => {
      for (const name of ['mongo', 'mongo-init', 'redis', 'minio', 'minio-init', 'api', 'workers', 'dashboard']) {
        expect(() => service(name)).not.toThrow();
      }
      expect(content).toContain('name: revamp-stack');
    });

    it('publishes only the API, the dashboard and Prometheus, and only on 127.0.0.1', () => {
      for (const name of ['mongo', 'mongo-init', 'redis', 'minio', 'minio-init', 'workers']) {
        expect(service(name), `${name} publishes no port`).not.toMatch(/^\s+ports:/m);
      }
      const published = [...content.matchAll(/^\s+- "([^"]*:\d+)"$/gm)].map((match) => match[1] ?? '');
      // The API, the dashboard and, in the optional `monitoring` profile, Prometheus (REV-220)
      expect(published).toHaveLength(3);
      for (const port of published) expect(port).toMatch(/^127\.0\.0\.1:/);
    });

    it('uses a frontend and a backend network: the data services are backend only', () => {
      expect(content).toMatch(/^networks:\n {2}frontend:\n {2}backend:/m);
      for (const name of ['mongo', 'redis', 'minio', 'workers']) {
        expect(service(name)).toContain('networks: [backend]');
        expect(service(name)).not.toContain('frontend');
      }
      expect(service('api')).toContain('networks: [frontend, backend]');
      expect(service('dashboard')).toContain('networks: [frontend]');
    });

    it('starts in dependency order: users and buckets exist before the API, the API is healthy before the rest', () => {
      const api = service('api');
      expect(api).toMatch(/mongo-init:\n\s+condition: service_completed_successfully/);
      expect(api).toMatch(/minio-init:\n\s+condition: service_completed_successfully/);
      expect(api).toMatch(/redis:\n\s+condition: service_healthy/);
      for (const name of ['workers', 'dashboard']) {
        expect(service(name)).toMatch(/api:\n\s+condition: service_healthy/);
      }
      expect(service('mongo-init')).toContain('network_mode: "service:mongo"');
    });

    it('limits memory and CPU of every long-running service and restarts them on failure', () => {
      for (const name of ['mongo', 'redis', 'minio', 'api', 'workers', 'dashboard']) {
        expect(service(name), `${name} limits`).toMatch(/limits: \{ cpus: "[\d.]+", memory: \w+ \}/);
        expect(service(name), `${name} restart`).toContain('restart: unless-stopped');
      }
    });

    it('takes every secret from .env and writes no credential or default password in the file', () => {
      expect(content).not.toContain('minioadmin');
      expect(content).toContain('${STACK_S3_SECRET_KEY:?');
      expect(content).toContain('${MONGO_ROOT_PASSWORD:?');
      // The JWT secret, the MongoDB URI and the S3 secret are Docker secret files, not environment values (REV-220)
      expect(content).not.toContain('${JWT_SECRET');
      expect(content).toContain('JWT_SECRET_FILE: /run/secrets/jwt_secret');
      expect(content).not.toMatch(/password:?\s*["']?[^$\s"'][\w-]{5,}/i);
    });

    it('keeps the dev infrastructure file from hardcoding the MinIO root credentials (REV-218)', () => {
      expect(dev).toContain('MINIO_ROOT_USER: ${S3_ACCESS_KEY:-minioadmin}');
      expect(dev).toContain('MINIO_ROOT_PASSWORD: ${S3_SECRET_KEY:-minioadmin}');
      expect(dev).not.toMatch(/MINIO_ROOT_(USER|PASSWORD): minioadmin/);
    });

    it('has stack npm scripts and sample variables', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8')) as { scripts: Record<string, string> };
      expect(pkg.scripts['stack:up']).toBe('node scripts/stack-up.mjs');
      expect(pkg.scripts['stack:down']).toContain('docker-compose.full.yml');
      const env = fs.readFileSync(path.join(rootDir, '.env.example'), 'utf-8');
      for (const name of ['STACK_S3_ACCESS_KEY=', 'STACK_S3_SECRET_KEY=', 'STACK_API_PORT=', 'STACK_DASHBOARD_PORT=']) {
        expect(env).toContain(name);
      }
    });
  });

  describe('Maximum level: logs, metrics, secrets, overrides, debug (REV-220)', () => {
    const read = (file: string): string => fs.readFileSync(path.join(rootDir, file), 'utf-8');

    it('builds every image with a BuildKit cache mount for npm ci', () => {
      for (const app of ['api', 'workers', 'dashboard']) {
        const content = read(`apps/${app}/Dockerfile`);
        expect(content.startsWith('# syntax=docker/dockerfile:1')).toBe(true);
        expect(content).toContain('RUN --mount=type=cache,target=/root/.npm npm ci');
      }
    });

    it('mounts the JWT secret, the MongoDB URI and the S3 secret into the API and the workers of the full stack as files', () => {
      const compose = read('docker-compose.full.yml');
      expect(compose).toMatch(/secrets:\n {2}jwt_secret:\n {4}file: \.\/\.stack-secrets\/jwt_secret/);
      for (const name of ['jwt_secret', 'mongodb_uri', 's3_secret_key']) expect(compose).toContain(`file: ./.stack-secrets/${name}`);
      expect(compose.match(/secrets: \[jwt_secret, mongodb_uri, s3_secret_key\]/g)).toHaveLength(2);
      for (const name of ['JWT_SECRET', 'MONGODB_URI', 'S3_SECRET_KEY']) {
        // The root .env value is hidden by an empty one, and the file fills it
        expect(compose).toContain(`${name}: ""`);
        expect(compose).toContain(`${name}_FILE: /run/secrets/`);
      }
      // The passwords of the data services sit in the same .env: the apps get them blanked
      for (const name of ['MONGO_ROOT_PASSWORD', 'MONGO_APP_PASSWORD', 'MONGO_READ_PASSWORD', 'MONGO_ADMIN_PASSWORD', 'STACK_S3_SECRET_KEY']) {
        expect(compose).toContain(`  ${name}: ""`);
      }
      expect(read('.gitignore')).toContain('.stack-secrets/');
    });

    it('offers Prometheus as an optional profile that scrapes the API and the workers', () => {
      const compose = read('docker-compose.full.yml');
      expect(compose).toMatch(/prometheus:\n\s+profiles: \[monitoring\]\n\s+image: prom\/prometheus:v\d+\.\d+\.\d+/);
      expect(compose).toContain('127.0.0.1:${STACK_PROMETHEUS_PORT:-9090}:9090');
      const config = read('deploy/prometheus/prometheus.yml');
      expect(config).toContain('api:4000');
      expect(config).toContain('workers:9101');
      expect(config.match(/metrics_path: \/metrics/g)).toHaveLength(2);
    });

    it('has a debug override that opens the inspector and the data ports on 127.0.0.1 only', () => {
      const debug = read('docker-compose.debug.yml');
      expect(debug).toContain('--inspect=0.0.0.0:9229');
      const published = [...debug.matchAll(/^\s+- "([^"]*:\d+)"$/gm)].map((match) => match[1] ?? '');
      expect(published.length).toBeGreaterThanOrEqual(5);
      for (const port of published) expect(port).toMatch(/^127\.0\.0\.1:/);
      expect(debug).toContain('LOG_FORMAT: text');
    });

    it('gives the production API and workers the same secrets as files and keeps the file mounts out of the environment', () => {
      const compose = read('docker-compose.prod.yml');
      for (const name of ['jwt_secret', 'mongodb_uri', 's3_secret_key', 'redis_url', 'redis_password']) {
        expect(compose).toContain(`file: ` + '${SECRETS_DIR:-./.secrets}/' + name);
        expect(compose).toContain(`${name.toUpperCase()}_FILE: /run/secrets/${name}`);
      }
      expect(compose.match(/secrets: \[jwt_secret, mongodb_uri, s3_secret_key, redis_url, redis_password\]/g)).toHaveLength(2);
    });

    it('prepares the secrets in deploy.sh before it builds or replaces anything, and hands compose the env file without them', () => {
      const script = read('deploy/deploy.sh');
      const prepare = script.indexOf('prepare-secrets.sh');
      expect(prepare).toBeGreaterThan(-1);
      expect(prepare).toBeGreaterThan(script.indexOf('JWT_SECRET'));
      expect(prepare).toBeLessThan(script.indexOf('docker compose -f docker-compose.prod.yml build'));
      expect(prepare).toBeLessThan(script.indexOf('up -d'));
      expect(script).toContain('export ENV_FILE="${PROJECT_ROOT}/.env.production.runtime"');
      expect(read('.gitignore')).toContain('.secrets/');
      expect(read('.gitignore')).toContain('.env.production.runtime');
    });

    describe('deploy/prepare-secrets.sh', () => {
      const run = (envText: string) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev220-'));
        const envFile = path.join(dir, 'env');
        fs.writeFileSync(envFile, envText);
        const result = spawnSync('bash', [path.join(rootDir, 'deploy/prepare-secrets.sh'), envFile, path.join(dir, 'secrets'), path.join(dir, 'runtime')], { encoding: 'utf-8' });
        const secret = (name: string): string => fs.readFileSync(path.join(dir, 'secrets', name), 'utf-8');
        return { dir, result, secret, runtime: fs.existsSync(path.join(dir, 'runtime')) ? fs.readFileSync(path.join(dir, 'runtime'), 'utf-8') : '' };
      };

      it('writes one file per secret (last assignment wins, quotes removed) and an env file without them', () => {
        const { dir, result, secret, runtime } = run(
          ['PORT=4000', 'JWT_SECRET="first"', 'export MONGODB_URI=mongodb+srv://u:p%40@x/db?a=b', 'S3_SECRET_KEY=s3', 'REDIS_URL=', 'CORS_ORIGIN=https://a', "JWT_SECRET='final secret'", ''].join('\n'),
        );
        try {
          expect(result.status, result.stderr).toBe(0);
          expect(secret('jwt_secret')).toBe('final secret\n');
          expect(secret('mongodb_uri')).toBe('mongodb+srv://u:p%40@x/db?a=b\n');
          expect(secret('s3_secret_key')).toBe('s3\n');
          // An unset secret is an empty file, which the apps read as "not set"
          expect(secret('redis_url')).toBe('\n');
          expect(secret('redis_password')).toBe('\n');
          expect(runtime).toBe('PORT=4000\nCORS_ORIGIN=https://a\n');
          expect(fs.statSync(path.join(dir, 'secrets')).mode & 0o777).toBe(0o700);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      });

      it('fails when the env file does not exist', () => {
        const result = spawnSync('bash', [path.join(rootDir, 'deploy/prepare-secrets.sh'), '/nonexistent/env', os.tmpdir(), os.tmpdir()], { encoding: 'utf-8' });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('env file not found');
      });
    });
  });

  describe('Production Orchestration (docker-compose.prod.yml)', () => {
    it('should define all required services, networks, resource limits, and log rotations', () => {
      const filePath = path.join(rootDir, 'docker-compose.prod.yml');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('container_name: revamp-prod-api');
      expect(content).toContain('container_name: revamp-prod-workers');
      expect(content).toContain('container_name: revamp-prod-dashboard');
      expect(content).toContain('container_name: revamp-prod-nginx');
      expect(content).toContain('container_name: revamp-prod-certbot');

      // Workers 2GB RAM limit
      expect(content).toContain('memory: 2048M');

      // Network
      expect(content).toContain('revamp-prod-net:');

      // Log rotation
      expect(content).toContain('driver: "json-file"');
      expect(content).toContain('max-size: "20m"');
      expect(content).toContain('max-file: "5"');

      // Healthcheck dependency
      expect(content).toContain('condition: service_healthy');
    });
  });

  describe('Deployment Automation Script (deploy/deploy.sh)', () => {

    it('refuses to deploy without a JWT_SECRET of 32+ characters, before it builds or replaces containers (REV-206)', () => {
      const script = fs.readFileSync(path.join(rootDir, 'deploy/deploy.sh'), 'utf-8');
      const check = script.indexOf('JWT_SECRET');
      expect(check, 'deploy.sh checks JWT_SECRET').toBeGreaterThan(-1);
      expect(check).toBeLessThan(script.indexOf('docker compose -f docker-compose.prod.yml build'));
      expect(check).toBeLessThan(script.indexOf('up -d'));
      expect(script).toMatch(/JWT_SECRET[\s\S]{0,400}exit 1/);
    });
    it('should have bash strict mode and executable preflight and healthcheck loop', () => {
      const filePath = path.join(rootDir, 'deploy/deploy.sh');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('#!/usr/bin/env bash');
      expect(content).toContain('set -euo pipefail');
      expect(content).toContain('.env.production');
      expect(content).toContain('docker compose -f docker-compose.prod.yml build');
      expect(content).toContain('docker compose -f docker-compose.prod.yml up -d --remove-orphans');
      expect(content).toContain('http://localhost:4000/api/v1/health');
      expect(content).toContain('docker image prune -f');
    });
  });

  describe('Environment Configuration Template (.env.production.example)', () => {
    it('should contain all required production configuration keys without exposed secrets', () => {
      const filePath = path.join(rootDir, '.env.production.example');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('MONGODB_URI=mongodb+srv://');
      expect(content).toContain('REDIS_URL=rediss://');
      expect(content).toContain('REDIS_TLS=true');
      expect(content).toContain('S3_ENDPOINT=');
      expect(content).toContain('S3_FORCE_PATH_STYLE=false');
      expect(content).toContain('PREVIEW_DOMAIN=preview.revamp.io');
      expect(content).toContain('CORS_ORIGIN=https://app.revamp.io');
      expect(content).toContain('ANTHROPIC_API_KEY=');
      expect(content).toContain('JWT_SECRET=');
      expect(content).toContain('RESEND_API_KEY=');
      expect(content).toContain('TRACKING_BASE_URL=');

      // No plain passwords
      expect(content).not.toContain('password123');
      expect(content).not.toContain('supersecret');
    });
  });

  describe('Preflight Diagnostics Script (scripts/verify-production-env.ts)', () => {
    it('checkApiKeys should return diagnostic details', () => {
      const result = checkApiKeys();
      expect(result).toHaveProperty('service', 'API Keys & Secrets');
      expect(['SUCCESS', 'WARNING', 'FAILED']).toContain(result.status);
      expect(result).toHaveProperty('details');
    });

    it('checkJwtSecret fails when the sign-in secret is missing or shorter than 32 characters (REV-206)', () => {
      const original = process.env.JWT_SECRET;
      try {
        delete process.env.JWT_SECRET;
        expect(checkJwtSecret()).toMatchObject({ service: 'JWT secret', status: 'FAILED' });
        process.env.JWT_SECRET = 'x'.repeat(31);
        expect(checkJwtSecret().status).toBe('FAILED');
        process.env.JWT_SECRET = 'x'.repeat(32);
        expect(checkJwtSecret().status).toBe('SUCCESS');
      } finally {
        if (original === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = original;
      }
    });

    it('checkJwtSecret never prints the secret (REV-206)', () => {
      const original = process.env.JWT_SECRET;
      process.env.JWT_SECRET = 'super-secret-value-that-is-long-enough-123';
      try {
        expect(JSON.stringify(checkJwtSecret())).not.toContain('super-secret-value');
      } finally {
        if (original === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = original;
      }
    });

    it('checkMongoDB should fail gracefully when connection is invalid', async () => {
      const originalUri = process.env.MONGODB_URI;
      process.env.MONGODB_URI = 'mongodb://127.0.0.1:29999/nonexistent';

      const result = await checkMongoDB();
      expect(result.service).toBe('MongoDB Atlas');
      expect(result.status).toBe('FAILED');
      expect(result.message).toBeDefined();

      process.env.MONGODB_URI = originalUri;
    }, 10000);

    it('checkRedis should fail gracefully when connection is invalid', async () => {
      const originalUrl = process.env.REDIS_URL;
      const originalHost = process.env.REDIS_HOST;
      const originalPort = process.env.REDIS_PORT;

      process.env.REDIS_URL = 'redis://127.0.0.1:29999';

      const result = await checkRedis();
      expect(result.service).toBe('Redis / Upstash');
      expect(result.status).toBe('FAILED');

      process.env.REDIS_URL = originalUrl;
      process.env.REDIS_HOST = originalHost;
      process.env.REDIS_PORT = originalPort;
    });

    it('checkS3Storage should return warning when credentials are not configured', async () => {
      const originalEndpoint = process.env.S3_ENDPOINT;
      delete process.env.S3_ENDPOINT;

      const result = await checkS3Storage();
      expect(result.service).toBe('S3 / Cloudflare R2');
      expect(result.status).toBe('WARNING');

      process.env.S3_ENDPOINT = originalEndpoint;
    });
  });
});
