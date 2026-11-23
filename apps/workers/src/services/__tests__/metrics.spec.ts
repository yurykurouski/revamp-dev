import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Worker } from 'bullmq';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkerMetrics, startMetricsServer } from '../metrics.js';

const fakeWorker = (name: string) => Object.assign(new EventEmitter(), { name }) as unknown as Worker;

describe('worker job metrics (REV-220)', () => {
  it('counts completed and failed jobs per queue and times them', async () => {
    const { registry, track } = createWorkerMetrics();
    const worker = fakeWorker('audit-queue');
    track(worker);
    worker.emit('completed', { processedOn: 1_000, finishedOn: 3_500 });
    worker.emit('completed', { processedOn: undefined, finishedOn: undefined });
    worker.emit('failed', { processedOn: 2_000, finishedOn: 2_100 }, new Error('x'));
    worker.emit('failed', undefined, new Error('job gone'));
    const text = await registry.render();
    expect(text).toContain('revamp_jobs_total{queue="audit-queue",status="completed"} 2');
    expect(text).toContain('revamp_jobs_total{queue="audit-queue",status="failed"} 2');
    // Only the jobs BullMQ stamped are timed: 2.5 s and 0.1 s
    expect(text).toContain('revamp_job_duration_seconds_count{queue="audit-queue"} 2');
    expect(text).toContain('revamp_job_duration_seconds_sum{queue="audit-queue"} 2.6');
    expect(text).toContain('revamp_process_uptime_seconds{service="workers"}');
  });
});

describe('startMetricsServer (REV-220)', () => {
  const open: Server[] = [];
  afterEach(async () => {
    await Promise.all(open.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  });

  it('serves /metrics in the Prometheus format and 404 elsewhere', async () => {
    const { registry } = createWorkerMetrics();
    const server = (await startMetricsServer(registry, 18_101, '127.0.0.1'))!;
    open.push(server);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ok = await fetch(`${base}/metrics`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('version=0.0.4');
    expect(await ok.text()).toContain('# TYPE revamp_jobs_total counter');
    expect((await fetch(`${base}/other`)).status).toBe(404);
    expect((await fetch(`${base}/metrics`, { method: 'POST' })).status).toBe(404);
  });

  it('is off when the port is 0, and never throws when the port is taken', async () => {
    const { registry } = createWorkerMetrics();
    expect(await startMetricsServer(registry, 0)).toBeNull();
    const first = (await startMetricsServer(registry, 18_102, '127.0.0.1'))!;
    open.push(first);
    expect(await startMetricsServer(registry, 18_102, '127.0.0.1')).toBeNull();
  });
});
