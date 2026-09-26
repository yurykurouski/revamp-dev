import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiscoveryService } from '../discovery.service.js';
import { addDiscoveryJob, getDiscoveryJob } from '../../queues/discovery.queue.js';
import { AppError } from '../../middlewares/errorHandler.js';

vi.mock('../../queues/discovery.queue.js', () => ({
  addDiscoveryJob: vi.fn(),
  getDiscoveryJob: vi.fn(),
}));

const params = { provider: 'google' as const, niche: 'legal' as const, location: 'Warsaw', keyword: 'notary', limit: 15 };

describe('DiscoveryService (API)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('startDiscovery should enqueue a job with only the known fields', async () => {
    vi.mocked(addDiscoveryJob).mockResolvedValue({ id: 'disc-9', data: params } as any);

    const result = await DiscoveryService.startDiscovery({ ...params, extra: 'ignored' } as any);

    expect(addDiscoveryJob).toHaveBeenCalledWith(params);
    expect(result).toEqual({ jobId: 'disc-9', params });
  });

  it('getDiscoveryStatus should throw 404 when the job does not exist', async () => {
    vi.mocked(getDiscoveryJob).mockResolvedValue(undefined);
    const error = await DiscoveryService.getDiscoveryStatus('nope').catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(404);
  });

  it('getDiscoveryStatus should report a completed job with its result', async () => {
    const summary = { found: 2, created: 2, skippedNoWebsite: 0, skippedDuplicate: 0, skippedInvalid: 0, leadIds: ['a', 'b'] };
    vi.mocked(getDiscoveryJob).mockResolvedValue({
      id: 'disc-9',
      data: params,
      returnvalue: summary,
      failedReason: undefined,
      attemptsMade: 1,
      timestamp: Date.UTC(2026, 8, 26, 10, 0, 0),
      finishedOn: Date.UTC(2026, 8, 26, 10, 0, 30),
      getState: vi.fn().mockResolvedValue('completed'),
    } as any);

    expect(await DiscoveryService.getDiscoveryStatus('disc-9')).toEqual({
      jobId: 'disc-9',
      state: 'completed',
      params,
      result: summary,
      error: null,
      attemptsMade: 1,
      createdAt: '2026-09-26T10:00:00.000Z',
      finishedAt: '2026-09-26T10:00:30.000Z',
    });
  });

  it('getDiscoveryStatus should report pending and failed jobs', async () => {
    const job = {
      id: 'disc-10',
      data: params,
      returnvalue: null,
      failedReason: 'GOOGLE_PLACES_API_KEY is not configured',
      attemptsMade: 1,
      timestamp: Date.UTC(2026, 8, 26),
      finishedOn: undefined,
      getState: vi.fn().mockResolvedValue('waiting'),
    };
    vi.mocked(getDiscoveryJob).mockResolvedValue(job as any);

    const waiting = await DiscoveryService.getDiscoveryStatus('disc-10');
    expect(waiting).toMatchObject({ state: 'waiting', result: null, error: null, finishedAt: null });

    job.getState.mockResolvedValue('failed');
    const failed = await DiscoveryService.getDiscoveryStatus('disc-10');
    expect(failed).toMatchObject({ state: 'failed', error: 'GOOGLE_PLACES_API_KEY is not configured' });
  });
});
