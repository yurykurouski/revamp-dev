import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAiWorker } from '../ai.worker.js';
import { Audit } from '../../models/Audit.model.js';
import { Lead } from '../../models/Lead.model.js';
import { mvpContentService } from '../../services/mvp-content.service.js';

vi.mock('../../models/Audit.model.js');
vi.mock('../../models/Lead.model.js');
vi.mock('../../services/mvp-content.service.js');
vi.mock('../../queues/deploy.queue.js', () => ({
  addDeployJob: vi.fn().mockResolvedValue({ id: 'mock-deploy-job' }),
}));
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
    Queue: vi.fn().mockImplementation(() => ({
      add: vi.fn().mockResolvedValue({ id: 'mock-job' }),
    })),
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

describe('AiWorker (@revamp/workers)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProcessor = null;
  });

  it('should initialize worker for AI_GENERATION queue', () => {
    const worker = createAiWorker();
    expect(worker).toBeDefined();
    expect(capturedProcessor).toBeTypeOf('function');
  });

  it('should process AI generation job, call MvpContentService, persist to Audit, and set Lead to NEEDS_APPROVAL', async () => {
    createAiWorker();
    expect(capturedProcessor).not.toBeNull();

    const mockLead = {
      _id: 'lead-123',
      businessName: 'Smile Dental',
      niche: 'dental',
      city: 'Saint Petersburg',
      originalUrl: 'https://smile.spb.ru',
      contactPhone: '+7 812 000 11 22',
      contactEmail: 'info@smile.spb.ru',
    };

    const mockAudit = {
      _id: 'audit-456',
      leadId: 'lead-123',
      extractedServices: ['Implants', 'Whitening'],
      aiFallbackUsed: false,
    };

    const mockGeneratedContent = {
      hero: {
        badge: '✨ Special',
        headline: 'Healthy teeth without pain in Saint Petersburg',
        subheadline: 'Premium quality with a 5-year guarantee.',
        primaryCtaText: 'Book now',
        secondaryCtaText: 'Call us',
      },
      services: [
        {
          title: 'Dental implants',
          description: 'Lifetime guarantee on implants',
          lucideIconName: 'shield-check',
        },
        {
          title: 'Whitening',
          description: 'Safe enamel whitening',
          lucideIconName: 'sparkles',
        },
        {
          title: 'Therapy',
          description: 'Microscope-assisted cavity treatment',
          lucideIconName: 'activity',
        },
      ],
      trustSignals: [
        { metric: '4.9 ★', label: 'On Google Maps' },
        { metric: '10 yrs', label: 'Of experience' },
        { metric: '100%', label: 'Guarantee' },
      ],
      offerNotice: 'Free consultation',
    };

    vi.mocked(Lead.findById).mockReturnValue({
      exec: vi.fn().mockResolvedValue(mockLead),
    } as any);

    vi.mocked(Audit.findOne).mockReturnValue({
      exec: vi.fn().mockResolvedValue(mockAudit),
    } as any);

    vi.mocked(Lead.findByIdAndUpdate).mockReturnValue({
      exec: vi.fn().mockResolvedValue(true),
    } as any);

    vi.mocked(Audit.findByIdAndUpdate).mockReturnValue({
      exec: vi.fn().mockResolvedValue(true),
    } as any);

    vi.mocked(mvpContentService.generateContent).mockResolvedValue({
      content: mockGeneratedContent,
      aiFallbackUsed: false,
      modelUsed: 'claude-3-5-sonnet',
      attempts: 1,
    });

    const job = {
      id: 'job-ai-1',
      data: {
        leadId: 'lead-123',
        auditId: 'audit-456',
      },
    };

    const result = await capturedProcessor!(job);

    expect(result.success).toBe(true);
    expect(result.leadId).toBe('lead-123');
    expect(result.content).toEqual(mockGeneratedContent);

    // Verify status transitions: first GENERATING, then NEEDS_APPROVAL (HITL Gate)
    expect(Lead.findByIdAndUpdate).toHaveBeenCalledWith('lead-123', { status: 'GENERATING' });
    expect(Lead.findByIdAndUpdate).toHaveBeenCalledWith('lead-123', { status: 'NEEDS_APPROVAL' });

    // Verify Audit persistence
    expect(Audit.findByIdAndUpdate).toHaveBeenCalledWith(
      'audit-456',
      expect.objectContaining({
        generatedContent: mockGeneratedContent,
        aiFallbackUsed: false,
      }),
    );
  });

  it('should throw error when Lead is not found', async () => {
    createAiWorker();

    vi.mocked(Lead.findById).mockReturnValue({
      exec: vi.fn().mockResolvedValue(null),
    } as any);

    const job = {
      id: 'job-ai-err',
      data: {
        leadId: 'lead-non-existent',
        auditId: 'audit-err',
      },
    };

    await expect(capturedProcessor!(job)).rejects.toThrow('Lead lead-non-existent not found');
  });
});
