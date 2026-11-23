import { describe, expect, it } from 'vitest';
import { Counter, Histogram, MetricsRegistry, registerProcessMetrics } from '../src/observability/metrics.js';

describe('MetricsRegistry (REV-220)', () => {
  it('renders a counter in the Prometheus text format with sorted, escaped labels', async () => {
    const registry = new MetricsRegistry();
    const counter = registry.counter('revamp_jobs_total', 'Jobs finished', ['queue', 'status']);
    counter.inc({ queue: 'audit', status: 'completed' });
    counter.inc({ queue: 'audit', status: 'completed' }, 2);
    counter.inc({ queue: 'a"b\\c\nd', status: 'failed' });
    const text = await registry.render();
    expect(text).toContain('# HELP revamp_jobs_total Jobs finished\n# TYPE revamp_jobs_total counter\n');
    expect(text).toContain('revamp_jobs_total{queue="audit",status="completed"} 3\n');
    expect(text).toContain('revamp_jobs_total{queue="a\\"b\\\\c\\nd",status="failed"} 1\n');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('refuses a decrement, an unknown label and a bad name', () => {
    const counter = new Counter('revamp_x_total', 'x', ['a']);
    expect(() => counter.inc({ a: '1' }, -1)).toThrow('only goes up');
    expect(() => counter.inc({ b: '1' })).toThrow('Unexpected label b');
    expect(() => new Counter('bad name', 'x')).toThrow('Invalid metric name');
    expect(() => new Counter('ok', 'x', ['__reserved'])).toThrow('Invalid label name');
  });

  it('renders a histogram with cumulative buckets, +Inf, sum and count', async () => {
    const registry = new MetricsRegistry();
    const histogram = registry.histogram('revamp_http_request_duration_seconds', 'Latency', ['route'], [0.1, 1]);
    histogram.observe({ route: '/leads' }, 0.05);
    histogram.observe({ route: '/leads' }, 0.5);
    histogram.observe({ route: '/leads' }, 5);
    const text = await registry.render();
    expect(text).toContain('revamp_http_request_duration_seconds_bucket{le="0.1",route="/leads"} 1');
    expect(text).toContain('revamp_http_request_duration_seconds_bucket{le="1",route="/leads"} 2');
    expect(text).toContain('revamp_http_request_duration_seconds_bucket{le="+Inf",route="/leads"} 3');
    expect(text).toContain('revamp_http_request_duration_seconds_sum{route="/leads"} 5.55');
    expect(text).toContain('revamp_http_request_duration_seconds_count{route="/leads"} 3');
  });

  it('collects gauges at scrape time and survives a failing collector', async () => {
    const registry = new MetricsRegistry();
    let depth = 4;
    registry.gauge('revamp_queue_jobs', 'Jobs waiting', ['queue'], (g) => g.set({ queue: 'audit' }, depth));
    registry.gauge('revamp_broken', 'Always fails', [], () => {
      throw new Error('redis down');
    });
    expect(await registry.render()).toContain('revamp_queue_jobs{queue="audit"} 4');
    depth = 9;
    expect(await registry.render()).toContain('revamp_queue_jobs{queue="audit"} 9');
  });

  it('rejects a duplicate metric name', () => {
    const registry = new MetricsRegistry();
    registry.counter('revamp_a_total', 'a');
    expect(() => registry.counter('revamp_a_total', 'a')).toThrow('already registered');
  });

  it('registers process metrics with the service label', async () => {
    const registry = new MetricsRegistry();
    registerProcessMetrics(registry, 'api');
    const text = await registry.render();
    for (const name of ['revamp_process_uptime_seconds', 'revamp_process_resident_memory_bytes', 'revamp_process_heap_used_bytes', 'revamp_process_cpu_seconds_total', 'revamp_eventloop_delay_p99_seconds']) {
      expect(text).toMatch(new RegExp(`^${name}\\{service="api"\\} [0-9.e+-]+$`, 'm'));
    }
  });

  it('keeps Histogram usable on its own', () => {
    expect(new Histogram('revamp_h', 'h').render()).toEqual(['# HELP revamp_h h', '# TYPE revamp_h histogram']);
  });
});
