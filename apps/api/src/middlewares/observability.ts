import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { MetricsRegistry, METRICS_CONTENT_TYPE, acceptRequestId, registerProcessMetrics, type Logger } from '@revamp/db';
import { logger as defaultLogger } from '../logger.js';

/** Paths the load balancer and Prometheus call every few seconds: counted, but not logged line by line */
const QUIET_PATHS = new Set(['/health', '/metrics']);

export interface Observability {
  registry: MetricsRegistry;
  requestLogger: RequestHandler;
}

/** The route pattern of a finished request (`/api/v1/leads/:id`), or `unmatched`: a bounded label, never a raw path with ids */
export function routeLabel(req: Pick<Request, 'baseUrl' | 'route'>): string {
  const route = req.route as { path?: unknown } | undefined;
  return typeof route?.path === 'string' ? `${req.baseUrl}${route.path}` : 'unmatched';
}

/**
 * Gives every request an id (the caller's `X-Request-Id` when it is safe, else a new UUID), echoes it in the
 * response header, writes one log line when the response ends and counts it for Prometheus (REV-220).
 */
export function createObservability({ logger = defaultLogger, registry = new MetricsRegistry() }: { logger?: Logger; registry?: MetricsRegistry } = {}): Observability {
  registerProcessMetrics(registry, 'api');
  const requests = registry.counter('revamp_http_requests_total', 'HTTP requests by method, route and status', ['method', 'route', 'status']);
  const duration = registry.histogram('revamp_http_request_duration_seconds', 'HTTP request duration in seconds', ['method', 'route']);

  const requestLogger: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    const requestId = acceptRequestId(req.header('x-request-id'), randomUUID);
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      const route = routeLabel(req);
      requests.inc({ method: req.method, route, status: res.statusCode });
      duration.observe({ method: req.method, route }, seconds);
      const path = (req.originalUrl ?? req.url).split('?')[0] ?? '';
      if (QUIET_PATHS.has(path.replace(/^.*(?=\/(health|metrics)$)/, ''))) return;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      logger.log(level, 'request', { requestId, method: req.method, path, route, status: res.statusCode, durationMs: Math.round(seconds * 1000 * 100) / 100 });
    });
    next();
  };
  return { registry, requestLogger };
}

/**
 * The handler of `GET /metrics`, the Prometheus text format. It is mounted on the app itself, outside the API
 * prefix and its router, so the reverse proxy (which forwards only the prefix) never exposes it.
 */
export function metricsHandler(registry: MetricsRegistry): RequestHandler {
  return async (_req, res, next) => {
    try {
      const text = await registry.render();
      // `end`, not `send`: Express would append a second charset to the exposition format's content type
      res.status(200).setHeader('Content-Type', METRICS_CONTENT_TYPE);
      res.end(text);
    } catch (error) {
      next(error);
    }
  };
}
