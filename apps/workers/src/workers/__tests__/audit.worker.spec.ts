import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuditWorker } from '../audit.worker.js';
import { Audit } from '../../models/Audit.model.js';
import { Lead } from '../../models/Lead.model.js';

vi.mock('../../models/Audit.model.js');
vi.mock('../../models/Lead.model.js');
vi.mock('../../queues/connection.js', () => ({
  redisConnection: {} as any,
}));

let capturedProcessor: ((job: any) => Promise<any>) | null = null;
const mockWorkerInstance = {
  on: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('bullmq', () => {
  return {
    Worker: vi.fn().mockImplementation(function (queueName: string, processor: any, opts: any) {
      capturedProcessor = processor;
      return {
        ...mockWorkerInstance,
        queueName,
        opts,
      };
    }),
  };
});

describe('AuditWorker (@revamp/workers)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProcessor = null;
  });

  it('should initialize worker for AUDIT queue', () => {
    const worker = createAuditWorker();
    expect(worker).toBeDefined();
    expect(capturedProcessor).toBeTypeOf('function');
  });

  it('should process job, update Lead to AUDITING, and update Audit to PROCESSING', async () => {
    createAuditWorker();
    expect(capturedProcessor).not.toBeNull();

    const mockJob = {
      id: 'job-123',
      data: {
        leadId: 'lead-abc',
        url: 'https://test-business.com',
        niche: 'auto',
      },
    };

    const mockAuditExec = vi.fn().mockResolvedValue({});
    const mockLeadExec = vi.fn().mockResolvedValue({});

    vi.spyOn(Audit, 'findOneAndUpdate').mockReturnValue({
      exec: mockAuditExec,
    } as any);

    vi.spyOn(Lead, 'findByIdAndUpdate').mockReturnValue({
      exec: mockLeadExec,
    } as any);

    const result = await capturedProcessor!(mockJob);

    expect(Audit.findOneAndUpdate).toHaveBeenCalledWith(
      { leadId: 'lead-abc' },
      { status: 'PROCESSING' },
      { new: true },
    );

    expect(Lead.findByIdAndUpdate).toHaveBeenCalledWith(
      'lead-abc',
      { status: 'AUDITING' },
      { new: true },
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        leadId: 'lead-abc',
        url: 'https://test-business.com',
      }),
    );
  });
});
