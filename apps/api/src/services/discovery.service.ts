import { StartDiscoveryDto } from '@revamp/validation';
import { addDiscoveryJob, getDiscoveryJob } from '../queues/discovery.queue.js';
import { AppError } from '../middlewares/errorHandler.js';

export class DiscoveryService {
  /**
   * Enqueues a maps-provider search; the discovery worker imports results as QUEUED leads
   */
  static async startDiscovery(dto: StartDiscoveryDto) {
    const job = await addDiscoveryJob({
      provider: dto.provider,
      niche: dto.niche,
      location: dto.location,
      keyword: dto.keyword,
      limit: dto.limit,
    });
    return { jobId: job.id as string, params: job.data };
  }

  /**
   * Returns the state of a discovery job and, once finished, its import summary
   */
  static async getDiscoveryStatus(jobId: string) {
    const job = await getDiscoveryJob(jobId);
    if (!job) {
      throw new AppError('Discovery job not found', 404);
    }

    const state = await job.getState();
    return {
      jobId: job.id,
      state,
      params: job.data,
      result: job.returnvalue ?? null,
      error: state === 'failed' ? job.failedReason ?? 'Unknown error' : null,
      attemptsMade: job.attemptsMade,
      createdAt: new Date(job.timestamp).toISOString(),
      finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    };
  }
}
