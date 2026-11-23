import http, { type Server } from 'node:http';
import type { Worker } from 'bullmq';
import { MetricsRegistry, METRICS_CONTENT_TYPE, registerProcessMetrics } from '@revamp/db';

/** Registry of this process: process metrics plus one counter and one histogram for the jobs the workers run (REV-220) */
export function createWorkerMetrics(registry = new MetricsRegistry()) {
  registerProcessMetrics(registry, 'workers');
  const jobs = registry.counter('revamp_jobs_total', 'Finished BullMQ jobs by queue and outcome', ['queue', 'status']);
  const duration = registry.histogram('revamp_job_duration_seconds', 'BullMQ job duration in seconds', ['queue'], [0.1, 0.5, 1, 5, 15, 30, 60, 120, 300, 600]);

  /** Counts every job a worker finishes or fails, and times the ones BullMQ stamped */
  const track = (worker: Worker): void => {
    worker.on('completed', (job) => {
      jobs.inc({ queue: worker.name, status: 'completed' });
      if (job.processedOn && job.finishedOn) duration.observe({ queue: worker.name }, (job.finishedOn - job.processedOn) / 1000);
    });
    worker.on('failed', (job) => {
      jobs.inc({ queue: worker.name, status: 'failed' });
      if (job?.processedOn && job.finishedOn) duration.observe({ queue: worker.name }, (job.finishedOn - job.processedOn) / 1000);
    });
  };
  return { registry, track };
}

/**
 * Serves `GET /metrics` on its own port: the workers have no HTTP server otherwise. Resolves to the server, or to null
 * when the port is 0 (switched off) or taken (another worker process on the same machine): metrics must never stop the workers.
 */
export function startMetricsServer(registry: MetricsRegistry, port: number, host = '0.0.0.0'): Promise<Server | null> {
  if (!port) return Promise.resolve(null);
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'GET' || (req.url ?? '').split('?')[0] !== '/metrics') {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found\n');
        return;
      }
      registry
        .render()
        .then((text) => res.writeHead(200, { 'Content-Type': METRICS_CONTENT_TYPE }).end(text))
        .catch((error: Error) => res.writeHead(500, { 'Content-Type': 'text/plain' }).end(`${error.message}\n`));
    });
    server.once('error', (error: NodeJS.ErrnoException) => {
      console.warn(`[Workers] Metrics server is off: cannot listen on ${host}:${port} (${error.code ?? error.message})`);
      resolve(null);
    });
    server.listen(port, host, () => {
      console.log(`[Workers] Metrics on http://${host}:${port}/metrics`);
      resolve(server);
    });
  });
}
