import { describe, expect, it, vi } from 'vitest';
import { MvpPerformanceSchema } from '@revamp/validation';

vi.mock('../browser.service.js', () => ({ browserService: { measurePageVitals: vi.fn() } }));
import { measureMvpPerformance } from '../mvp-performance.js';
import { NO_LCP_ENTRY } from '../vitals.service.js';

const now = new Date('2026-10-04T10:00:00Z');
const url = 'http://localhost:9000/revamp-demos/falco/index.html';

describe('measureMvpPerformance (REV-119)', () => {
  it('scores the published page as the audit scores the original', async () => {
    const result = await measureMvpPerformance(url, async () => ({ lcpMs: 3120.6, shifts: [{ startTime: 10, value: 0.15, hadRecentInput: false }] }), now);
    // LCP 3.12 s (-35) and CLS 0.15 (-15)
    expect(result).toEqual({ webVitals: { lcp: 3121, cls: 0.15 }, score: 50, host: 'localhost:9000', measuredAt: now });
    expect(MvpPerformanceSchema.safeParse(result).success).toBe(true);
  });

  it('ignores shifts after input, as the audit does', async () => {
    const result = await measureMvpPerformance(url, async () => ({ lcpMs: 800, shifts: [{ startTime: 10, value: 0.5, hadRecentInput: true }] }), now);
    expect(result.webVitals).toEqual({ lcp: 800, cls: 0 });
  });

  it('keeps CLS and says why when the page reported no LCP; no other timing stands in', async () => {
    const result = await measureMvpPerformance(url, async () => ({ lcpMs: null, shifts: [] }), now);
    expect(result).toEqual({ webVitals: { cls: 0 }, host: 'localhost:9000', measuredAt: now, error: NO_LCP_ENTRY });
  });

  it('never throws: a failed load is stored with its error and no values', async () => {
    const result = await measureMvpPerformance(url, async () => { throw new Error('page.goto: net::ERR_CONNECTION_REFUSED\n  at stack'); }, now);
    expect(result.webVitals).toEqual({});
    expect(result.score).toBeUndefined();
    expect(result.error).toContain('ERR_CONNECTION_REFUSED');
    expect(result.error).not.toContain('at stack');
    expect(MvpPerformanceSchema.safeParse(result).success).toBe(true);
  });
});
