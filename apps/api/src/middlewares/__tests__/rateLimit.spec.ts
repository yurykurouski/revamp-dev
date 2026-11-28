import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../errorHandler.js';
import { createTenantRateLimiter, redisRateLimitStore, type RateLimitStore } from '../rateLimit.js';

const memoryStore = (): RateLimitStore => {
  const counts = new Map<string, number>();
  return {
    async hit(key) {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return n;
    },
  };
};

const call = async (mw: ReturnType<typeof createTenantRateLimiter>, org = 'orgA') => {
  const headers: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string | number) => void (headers[k] = String(v)) } as unknown as Response;
  const req = { auth: { userId: 'u', organizationId: org, role: 'owner' } } as unknown as Request;
  const error = await new Promise<unknown>((resolve) => {
    mw(req, res, ((e?: unknown) => resolve(e)) as NextFunction);
  });
  return { headers, error };
};

afterEach(() => vi.useRealTimers());

describe('createTenantRateLimiter (REV-233)', () => {
  it('allows `limit` requests, sets the rate headers, then answers 429 with Retry-After', async () => {
    const t = { ms: 1_000_000_000 + 10_000 }; // 10 s into a 60 s window
    const mw = createTenantRateLimiter({ name: 'lots', limit: 3, windowSeconds: 60, store: memoryStore(), now: () => t.ms });
    const remaining: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { headers, error } = await call(mw);
      expect(error).toBeUndefined();
      expect(headers['RateLimit-Limit']).toBe('3');
      remaining.push(headers['RateLimit-Remaining']!);
    }
    expect(remaining).toEqual(['2', '1', '0']);
    const { headers, error } = await call(mw);
    expect(error).toBeInstanceOf(AppError);
    const e = error as AppError;
    expect(e.statusCode).toBe(429);
    expect(e.code).toBe('RATE_LIMITED');
    const retry = (e.details as { retryAfterSeconds: number }).retryAfterSeconds;
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(headers['Retry-After']).toBe(String(retry));
  });

  it('separates studios and rolls over with the window', async () => {
    const t = { ms: 120_000 };
    const mw = createTenantRateLimiter({ name: 'lots', limit: 1, windowSeconds: 60, store: memoryStore(), now: () => t.ms });
    expect((await call(mw, 'A')).error).toBeUndefined();
    expect(((await call(mw, 'A')).error as AppError).statusCode).toBe(429);
    expect((await call(mw, 'B')).error).toBeUndefined();
    t.ms += 60_000;
    expect((await call(mw, 'A')).error).toBeUndefined();
  });

  it('refuses with 503 LISTINGS_UNAVAILABLE when the store throws', async () => {
    const mw = createTenantRateLimiter({ name: 'lots', limit: 1, windowSeconds: 60, store: { hit: async () => { throw new Error('down'); } } });
    const { error } = await call(mw);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(503);
    expect((error as AppError).code).toBe('LISTINGS_UNAVAILABLE');
  });

  it('refuses with 503 when the store never answers (500 ms)', async () => {
    vi.useFakeTimers();
    const mw = createTenantRateLimiter({ name: 'lots', limit: 1, windowSeconds: 60, store: { hit: () => new Promise<number>(() => {}) }, timeoutMs: 500 });
    const pending = call(mw);
    await vi.advanceTimersByTimeAsync(500);
    const { error } = await pending;
    expect((error as AppError).code).toBe('LISTINGS_UNAVAILABLE');
  });
});

describe('redisRateLimitStore (REV-233)', () => {
  it('rejects without touching Redis while the connection is not ready', async () => {
    const multi = vi.fn();
    const store = redisRateLimitStore({ status: 'connecting', multi } as never, 500);
    await expect(store.hit('k', 60)).rejects.toThrow();
    expect(multi).not.toHaveBeenCalled();
  });

  it('runs INCR and a plain EXPIRE (Redis 6 has no NX) in one MULTI and returns the count', async () => {
    const exec = vi.fn().mockResolvedValue([[null, 4], [null, 0]]);
    const expire = vi.fn(() => ({ exec }));
    const incr = vi.fn(() => ({ expire }));
    const store = redisRateLimitStore({ status: 'ready', multi: () => ({ incr }) } as never, 500);
    expect(await store.hit('rl:k', 60)).toBe(4);
    expect(incr).toHaveBeenCalledWith('rl:k');
    expect(expire).toHaveBeenCalledWith('rl:k', 60);
  });

  it('rejects when the transaction reports an error', async () => {
    const exec = vi.fn().mockResolvedValue([[new Error('boom'), null], [null, 0]]);
    const store = redisRateLimitStore({ status: 'ready', multi: () => ({ incr: () => ({ expire: () => ({ exec }) }) }) } as never, 500);
    await expect(store.hit('k', 60)).rejects.toThrow();
  });
});
