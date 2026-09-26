import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import { createDiscoveryWorker } from '../discovery.worker.js';
import { runDiscovery } from '../../services/discovery.service.js';

vi.mock('../../services/discovery.service.js', async (importOriginal) => ({
  countByStatus: (await importOriginal<typeof import('../../services/discovery.service.js')>()).countByStatus,
  runDiscovery: vi.fn(),
}));
vi.mock('../../queues/connection.js', () => ({
  redisConnection: {} as any,
}));

let capturedProcessor: ((job: any) => Promise<any>) | null = null;
let capturedOptions: any = null;

vi.mock('bullmq', () => {
  class UnrecoverableError extends Error {}
  return {
    UnrecoverableError,
    Worker: vi.fn().mockImplementation(function (queueName: string, processor: any, opts: any) {
      capturedProcessor = processor;
      capturedOptions = opts;
      return { queueName, on: vi.fn(), close: vi.fn() };
    }),
  };
});

const job = {
  id: 'discovery-1',
  data: { provider: 'osm', niche: 'dental', location: 'Vilnius', limit: 5 },
};

describe('DiscoveryWorker (@revamp/workers)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProcessor = null;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should listen on the discovery queue with concurrency 1', () => {
    const worker = createDiscoveryWorker() as any;
    expect(worker.queueName).toBe('discovery-queue');
    expect(capturedOptions.concurrency).toBe(1);
    expect(worker.on).toHaveBeenCalledWith('failed', expect.any(Function));
  });

  it('should run discovery and return the import summary', async () => {
    const summary = {
      found: 2,
      candidates: [
        { provider: 'osm' as const, externalId: 'node/1', name: 'A', status: 'new' as const },
        { provider: 'osm' as const, externalId: 'node/2', name: 'B', status: 'no_website' as const },
      ],
    };
    vi.mocked(runDiscovery).mockResolvedValue(summary);
    createDiscoveryWorker();

    await expect(capturedProcessor!(job)).resolves.toEqual(summary);
    expect(runDiscovery).toHaveBeenCalledWith(job.data);
  });

  it.each([
    'GOOGLE_PLACES_API_KEY is not configured',
    'Location not found: Atlantis',
    'Google Places request failed with HTTP 403: key invalid',
  ])('should mark "%s" as unrecoverable', async (message) => {
    vi.mocked(runDiscovery).mockRejectedValue(new Error(message));
    createDiscoveryWorker();

    const error = await capturedProcessor!(job).catch((e) => e);
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect(error.message).toBe(message);
  });

  it('should rethrow transient errors so BullMQ retries them', async () => {
    const transient = new Error('Overpass request failed with HTTP 504');
    vi.mocked(runDiscovery).mockRejectedValue(transient);
    createDiscoveryWorker();

    const error = await capturedProcessor!(job).catch((e) => e);
    expect(error).toBe(transient);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
  });
});
