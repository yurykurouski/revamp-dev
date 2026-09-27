import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import type { CorsOptions } from 'cors';
import { createCorsOptionsDelegate, getPreviewOrigins } from '../cors.js';

const env = {
  CORS_ORIGIN: 'http://localhost:5173',
  API_PREFIX: '/api/v1',
  S3_ENDPOINT: 'http://localhost:9000/',
  PREVIEW_DOMAIN: 'preview.revampdemo.com',
};

const resolve = (url: string, origin?: string): CorsOptions => {
  let options: CorsOptions | undefined;
  const req = { url, originalUrl: url, method: 'POST', headers: origin ? { origin } : {} } as unknown as Request;
  createCorsOptionsDelegate(env)(req, (err, opts) => {
    if (err) throw err;
    options = opts;
  });
  return options!;
};

describe('CORS options (REV-52)', () => {
  it('derives the preview origins from S3_ENDPOINT and PREVIEW_DOMAIN', () => {
    expect(getPreviewOrigins(env)).toEqual(['http://localhost:9000', 'https://preview.revampdemo.com']);
  });

  it('skips a preview origin that cannot be parsed', () => {
    expect(getPreviewOrigins({ ...env, S3_ENDPOINT: 'not a url' })).toEqual(['https://preview.revampdemo.com']);
  });

  it('lets preview origins call /track routes, with credentials for sendBeacon', () => {
    expect(resolve('/api/v1/track/mvp-event', 'http://localhost:9000')).toEqual({
      origin: ['http://localhost:5173', 'http://localhost:9000', 'https://preview.revampdemo.com'],
      credentials: true,
    });
  });

  it('keeps the dashboard-only policy for every other route', () => {
    expect(resolve('/api/v1/leads', 'http://localhost:9000')).toEqual({
      origin: 'http://localhost:5173',
      credentials: true,
    });
  });
});
