import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { MetricsRegistry, createLogger } from '@revamp/db';
import { createObservability, metricsHandler, routeLabel } from '../observability.js';

const setup = () => {
  const lines: Array<Record<string, unknown>> = [];
  const logger = createLogger({ service: 'api', format: 'json', write: (_level, line) => lines.push(JSON.parse(line)) });
  const registry = new MetricsRegistry();
  const { requestLogger } = createObservability({ logger, registry });
  const app = express();
  app.use(requestLogger);
  app.get('/metrics', metricsHandler(registry));
  const api = express.Router();
  api.get('/leads/:id', (req, res) => {
    res.json({ id: req.params.id, requestId: res.locals.requestId });
  });
  api.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  api.get('/broken', (_req, res) => {
    res.status(500).json({ success: false });
  });
  app.use('/api/v1', api);
  return { app, lines, registry };
};

describe('request logging (REV-220)', () => {
  it('writes one JSON line per request with the request id, route, status and duration', async () => {
    const { app, lines } = setup();
    const res = await request(app).get('/api/v1/leads/abc123?secret=1').set('X-Request-Id', 'trace-42');
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBe('trace-42');
    expect(res.body.requestId).toBe('trace-42');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'info',
      service: 'api',
      msg: 'request',
      requestId: 'trace-42',
      method: 'GET',
      path: '/api/v1/leads/abc123',
      route: '/api/v1/leads/:id',
      status: 200,
    });
    expect(typeof lines[0]!.durationMs).toBe('number');
    // The query string can carry tokens: it is never logged
    expect(JSON.stringify(lines[0])).not.toContain('secret');
  });

  it('generates an id when the caller sends none or an unsafe one', async () => {
    const { app } = setup();
    const none = await request(app).get('/api/v1/leads/1');
    expect(none.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const unsafe = await request(app).get('/api/v1/leads/1').set('X-Request-Id', 'bad id with spaces');
    expect(unsafe.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('logs a 5xx as error and an unmatched path as warn with a bounded route label', async () => {
    const { app, lines } = setup();
    await request(app).get('/api/v1/broken');
    await request(app).get('/nope/with/ids/123');
    expect(lines[0]).toMatchObject({ level: 'error', status: 500, route: '/api/v1/broken' });
    expect(lines[1]).toMatchObject({ level: 'warn', status: 404, route: 'unmatched' });
  });

  it('does not log the health probe or the metrics scrape line by line', async () => {
    const { app, lines } = setup();
    await request(app).get('/api/v1/health');
    await request(app).get('/metrics');
    expect(lines).toEqual([]);
  });

  it('labels a request with its route pattern, or unmatched', () => {
    expect(routeLabel({ baseUrl: '/api/v1', route: { path: '/leads/:id' } } as never)).toBe('/api/v1/leads/:id');
    expect(routeLabel({ baseUrl: '', route: undefined } as never)).toBe('unmatched');
  });
});

describe('GET /metrics (REV-220)', () => {
  it('serves the Prometheus text format with HTTP and process metrics', async () => {
    const { app } = setup();
    await request(app).get('/api/v1/leads/1');
    await request(app).get('/api/v1/broken');
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain; version=0.0.4');
    expect(res.text).toContain('# TYPE revamp_http_requests_total counter');
    expect(res.text).toContain('revamp_http_requests_total{method="GET",route="/api/v1/leads/:id",status="200"} 1');
    expect(res.text).toContain('revamp_http_requests_total{method="GET",route="/api/v1/broken",status="500"} 1');
    expect(res.text).toContain('revamp_http_request_duration_seconds_count{method="GET",route="/api/v1/leads/:id"} 1');
    expect(res.text).toContain('revamp_process_resident_memory_bytes{service="api"}');
  });

  it('is not part of the guarded API routes: the real app serves it outside the API prefix', async () => {
    const { createApp } = await import('../../app.js');
    const res = await request(createApp()).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('revamp_http_requests_total');
    const underPrefix = await request(createApp()).get('/api/v1/metrics');
    expect(underPrefix.status).toBe(404);
  });
});
