import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  checkApiKeys,
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

    it('apps/workers/Dockerfile should use official Playwright runtime base and install chromium', () => {
      const filePath = path.join(rootDir, 'apps/workers/Dockerfile');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('FROM node:22-bookworm-slim AS builder');
      expect(content).toContain('FROM mcr.microsoft.com/playwright:v1.49.0-noble AS runner');
      expect(content).toContain('npx playwright install chromium');
      expect(content).toContain('apps/workers/dist/index.js');
    });

    it('apps/dashboard/Dockerfile should build Vite SPA and serve through Nginx Alpine', () => {
      const filePath = path.join(rootDir, 'apps/dashboard/Dockerfile');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('FROM node:22-alpine AS builder');
      expect(content).toContain('FROM nginx:1.27-alpine AS runner');
      expect(content).toContain('/etc/nginx/conf.d/default.conf');
      expect(content).toContain('/usr/share/nginx/html');
      expect(content).toContain('EXPOSE 80');
      expect(content).toContain('HEALTHCHECK');
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
