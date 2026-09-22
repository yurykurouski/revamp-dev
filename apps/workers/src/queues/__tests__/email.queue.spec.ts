import { describe, it, expect, vi } from 'vitest';
import {
  calculateJitter,
  calculateDispatchDelay,
  emailQueue,
  addEmailDispatchJob,
} from '../email.queue.js';
import { QUEUE_NAMES } from '../queue.constants.js';

vi.mock('../connection.js', () => ({
  redisConnection: {} as any,
}));

describe('EmailQueue & Throttling Pacing Helpers (@revamp/workers)', () => {
  describe('calculateJitter', () => {
    it('should generate random jitter within the default range [15, 45] seconds', () => {
      for (let i = 0; i < 50; i++) {
        const jitter = calculateJitter(15, 45);
        expect(jitter).toBeGreaterThanOrEqual(15);
        expect(jitter).toBeLessThanOrEqual(45);
      }
    });

    it('should respect custom min and max jitter parameters', () => {
      for (let i = 0; i < 20; i++) {
        const jitter = calculateJitter(5, 10);
        expect(jitter).toBeGreaterThanOrEqual(5);
        expect(jitter).toBeLessThanOrEqual(10);
      }
    });
  });

  describe('calculateDispatchDelay', () => {
    it('should compute delay with jitter for first job (index 0) between 15s and 45s (15000ms - 45000ms)', () => {
      const delay = calculateDispatchDelay(0, 180, 15, 45);
      expect(delay).toBeGreaterThanOrEqual(15000);
      expect(delay).toBeLessThanOrEqual(45000);
    });

    it('should compute 180s interval + jitter for second job (index 1) between 195s and 225s', () => {
      const delay = calculateDispatchDelay(1, 180, 15, 45);
      expect(delay).toBeGreaterThanOrEqual(195000); // (180 + 15) * 1000
      expect(delay).toBeLessThanOrEqual(225000);   // (180 + 45) * 1000
    });

    it('should scale linearly for nth queued job to pace cold outreach', () => {
      const delay = calculateDispatchDelay(5, 180, 15, 45);
      const minExpected = (5 * 180 + 15) * 1000; // 915,000 ms (~15.25 min)
      const maxExpected = (5 * 180 + 45) * 1000; // 945,000 ms (~15.75 min)
      expect(delay).toBeGreaterThanOrEqual(minExpected);
      expect(delay).toBeLessThanOrEqual(maxExpected);
    });
  });

  describe('emailQueue configuration', () => {
    it('should be configured with correct name and default job options', () => {
      expect(emailQueue.name).toBe(QUEUE_NAMES.EMAIL_DISPATCH);
      expect(emailQueue.defaultJobOptions?.attempts).toBe(3);
    });

    it('should add dispatch job with specified data and options', async () => {
      const addSpy = vi.spyOn(emailQueue, 'add').mockResolvedValue({ id: 'job-123' } as any);

      const jobData = {
        campaignId: 'camp-123',
        leadId: 'lead-456',
      };

      const job = await addEmailDispatchJob(jobData, { delay: 25000 });

      expect(addSpy).toHaveBeenCalledWith('dispatch-email', jobData, { delay: 25000 });
      expect(job.id).toBe('job-123');

      addSpy.mockRestore();
    });
  });
});
