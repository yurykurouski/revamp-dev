import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Redis } from 'ioredis';
import { AppError } from './errorHandler.js';

// REV-233: a fixed-window request limit per studio. The store is Redis at runtime; tests inject their own.

export interface RateLimitStore {
  /** Counts one request in the window and returns how many were counted so far, this one included */
  hit(key: string, windowSeconds: number): Promise<number>;
}

export interface TenantRateLimiterOptions {
  name: string;
  limit: number;
  windowSeconds: number;
  store: RateLimitStore;
  now?: () => number;
  /** How long to wait for the store before refusing the request (default 500 ms) */
  timeoutMs?: number;
}

const UNAVAILABLE = 'Listings are temporarily unavailable';

const withDeadline = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('rate limit store timed out')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

/**
 * Express middleware: `limit` requests per studio (`req.auth.organizationId`) per `windowSeconds`. Over the limit it
 * answers `429 RATE_LIMITED` with `Retry-After`. It fails closed: when the store errors or does not answer in time
 * the request is refused with `503 LISTINGS_UNAVAILABLE`, because the limit is the anti-scraping control.
 */
export function createTenantRateLimiter(options: TenantRateLimiterOptions): RequestHandler {
  const { name, limit, windowSeconds, store } = options;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 500;

  return (req: Request, res: Response, next: NextFunction): void => {
    const organizationId = req.auth?.organizationId;
    if (!organizationId) {
      next(new AppError(401, 'UNAUTHENTICATED', 'Sign in to use the API'));
      return;
    }
    const nowSec = Math.floor(now() / 1000);
    const windowIndex = Math.floor(nowSec / windowSeconds);
    const key = `rl:${name}:${organizationId}:${windowIndex}`;
    withDeadline(store.hit(key, windowSeconds), timeoutMs).then(
      (count) => {
        res.setHeader('RateLimit-Limit', limit);
        res.setHeader('RateLimit-Remaining', Math.max(0, limit - count));
        if (count > limit) {
          const retryAfterSeconds = Math.max(1, (windowIndex + 1) * windowSeconds - nowSec);
          res.setHeader('Retry-After', retryAfterSeconds);
          next(new AppError(429, 'RATE_LIMITED', 'Too many requests, try again later', { retryAfterSeconds }));
          return;
        }
        next();
      },
      () => next(new AppError(503, 'LISTINGS_UNAVAILABLE', UNAVAILABLE)),
    );
  };
}

/** The runtime store: one MULTI (INCR, EXPIRE; the key holds the window index, so a repeated EXPIRE is harmless and Redis 6 works) per request; refuses at once while Redis is not ready */
export function redisRateLimitStore(connection: Pick<Redis, 'status' | 'multi'>, timeoutMs: number): RateLimitStore {
  return {
    async hit(key, windowSeconds) {
      if (connection.status !== 'ready') throw new Error('Redis is not ready');
      const results = await withDeadline(connection.multi().incr(key).expire(key, windowSeconds).exec(), timeoutMs);
      const [incr] = results ?? [];
      if (!incr || incr[0]) throw incr?.[0] ?? new Error('Redis returned no count');
      return Number(incr[1]);
    },
  };
}
