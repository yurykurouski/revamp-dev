import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAiWorker } from '../ai.worker.js';
import { Audit } from '../../models/Audit.model.js';
import { Lead } from '../../models/Lead.model.js';
import { MvpContentService, mvpContentService } from '../../services/mvp-content.service.js';
import { addDeployJob } from '../../queues/deploy.queue.js';

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

  it('should process AI generation job, call MvpContentService, persist to Audit, and chain the deploy job', async () => {
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
      extractedContacts: {
        phone: '+48 22 542 18 04',
        address: 'ulica Topiel 11, 00-342 Warszawa',
        workingHours: 'Pon - Pt 09:00 — 21:00',
        socialLinks: [],
      },
      extractedContent: {
        h1: 'Best dental clinic in town',
        headings: [],
        paragraphs: ['Real copy from the site.'],
        serviceItems: [{ title: 'Implants' }],
        navItems: [],
        testimonials: [],
        images: [],
      },
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
      provider: 'anthropic',
      modelUsed: 'claude-opus-5',
      requestedProvider: 'anthropic',
      requestedModel: 'claude-opus-5',
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

    // The lead stays GENERATING; the deploy worker moves it to NEEDS_APPROVAL (HITL gate) once
    // the new preview is published (REV-31)
    expect(Lead.findByIdAndUpdate).toHaveBeenCalledWith('lead-123', { status: 'GENERATING' });
    expect(Lead.findByIdAndUpdate).not.toHaveBeenCalledWith('lead-123', { status: 'NEEDS_APPROVAL' });
    expect(addDeployJob).toHaveBeenCalledWith({
      leadId: 'lead-123',
      auditId: 'audit-456',
      forceRegenerate: false,
      previousStatus: undefined,
      // No operator choice: only the actual provider/model travels on (REV-32)
      generationSource: { provider: 'anthropic', modelUsed: 'claude-opus-5' },
    });

    // REV-23: generation is grounded in the site's own content and verified contacts
    expect(mvpContentService.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        siteContent: mockAudit.extractedContent,
        contacts: {
          phone: '+48 22 542 18 04',
          email: 'info@smile.spb.ru',
          address: 'ulica Topiel 11, 00-342 Warszawa',
          workingHours: 'Pon - Pt 09:00 — 21:00',
        },
      }),
    );

    // Verify Audit persistence
    expect(Audit.findByIdAndUpdate).toHaveBeenCalledWith(
      'audit-456',
      expect.objectContaining({
        generatedContent: mockGeneratedContent,
        aiFallbackUsed: false,
      }),
    );
  });

  it('should pass forceRegenerate and previousStatus through to the deploy job, generating fresh copy (REV-31)', async () => {
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
      extractedContacts: {
        phone: '+48 22 542 18 04',
        address: 'ulica Topiel 11, 00-342 Warszawa',
        workingHours: 'Pon - Pt 09:00 — 21:00',
        socialLinks: [],
      },
      extractedContent: {
        h1: 'Best dental clinic in town',
        headings: [],
        paragraphs: ['Real copy from the site.'],
        serviceItems: [{ title: 'Implants' }],
        navItems: [],
        testimonials: [],
        images: [],
      },
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
      provider: 'anthropic',
      modelUsed: 'claude-opus-5',
      requestedProvider: 'anthropic',
      requestedModel: 'claude-opus-5',
      attempts: 1,
    });

    const job = {
      id: 'job-ai-regen',
      data: { leadId: 'lead-123', auditId: 'audit-456', forceRegenerate: true, previousStatus: 'NEEDS_APPROVAL' },
    };

    await capturedProcessor!(job);

    // The copy already stored on the audit is never reused
    expect(mvpContentService.generateContent).toHaveBeenCalledTimes(1);
    // No provider on the job: the env-default singleton is used, no per-job service (REV-32)
    expect(MvpContentService).not.toHaveBeenCalled();
    expect(addDeployJob).toHaveBeenCalledWith({
      leadId: 'lead-123',
      auditId: 'audit-456',
      forceRegenerate: true,
      previousStatus: 'NEEDS_APPROVAL',
      generationSource: { provider: 'anthropic', modelUsed: 'claude-opus-5' },
    });
  });

  it('should fail the job when the deploy job cannot be dispatched, so BullMQ retries it', async () => {
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
      extractedContacts: {
        phone: '+48 22 542 18 04',
        address: 'ulica Topiel 11, 00-342 Warszawa',
        workingHours: 'Pon - Pt 09:00 — 21:00',
        socialLinks: [],
      },
      extractedContent: {
        h1: 'Best dental clinic in town',
        headings: [],
        paragraphs: ['Real copy from the site.'],
        serviceItems: [{ title: 'Implants' }],
        navItems: [],
        testimonials: [],
        images: [],
      },
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
      provider: 'anthropic',
      modelUsed: 'claude-opus-5',
      requestedProvider: 'anthropic',
      requestedModel: 'claude-opus-5',
      attempts: 1,
    });

    vi.mocked(addDeployJob).mockRejectedValueOnce(new Error('Redis down'));

    await expect(
      capturedProcessor!({ id: 'job-ai-dispatch', data: { leadId: 'lead-123', auditId: 'audit-456' } }),
    ).rejects.toThrow('Redis down');
  });

  describe('per-job provider and model (REV-32)', () => {
    const setUpLead = () => {
      vi.mocked(Lead.findById).mockReturnValue({
        exec: vi.fn().mockResolvedValue({ _id: 'lead-123', businessName: 'Smile Dental', niche: 'dental' }),
      } as any);
      vi.mocked(Audit.findOne).mockReturnValue({
        exec: vi.fn().mockResolvedValue({ _id: 'audit-456', leadId: 'lead-123' }),
      } as any);
      vi.mocked(Lead.findByIdAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(true) } as any);
      vi.mocked(Audit.findByIdAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(true) } as any);
    };

    it.each([
      ['anthropic', 'claude-sonnet-5'],
      ['openai', 'gpt-4o-mini'],
      ['gemini', 'gemini-1.5-flash'],
      ['claude-cli', 'opus'],
    ])('builds a %s/%s content service for that job only', async (provider, model) => {
      createAiWorker();
      setUpLead();
      vi.mocked(MvpContentService).mockClear();
      vi.mocked(MvpContentService.prototype.generateContent).mockResolvedValue({
        content: { hero: {}, services: [], trustSignals: [], offerNotice: '' } as any,
        aiFallbackUsed: false,
        provider: provider as any,
        modelUsed: provider === 'claude-cli' ? `claude-cli:${model}` : model,
        requestedProvider: provider as any,
        requestedModel: provider === 'claude-cli' ? `claude-cli:${model}` : model,
        attempts: 1,
      });

      const result = await capturedProcessor!({
        id: 'job-ai-choice',
        data: { leadId: 'lead-123', auditId: 'audit-456', provider, model },
      });

      expect(MvpContentService).toHaveBeenCalledWith({ provider, model });
      expect(result.provider).toBe(provider);
      expect(addDeployJob).toHaveBeenCalledWith(
        expect.objectContaining({
          generationSource: {
            provider,
            modelUsed: provider === 'claude-cli' ? `claude-cli:${model}` : model,
            requestedProvider: provider,
            requestedModel: provider === 'claude-cli' ? `claude-cli:${model}` : model,
          },
        }),
      );
    });

    it('records both the chosen and the actual source when the chosen provider falls back', async () => {
      createAiWorker();
      setUpLead();
      vi.mocked(MvpContentService.prototype.generateContent).mockResolvedValue({
        content: { hero: {}, services: [], trustSignals: [], offerNotice: '' } as any,
        aiFallbackUsed: true,
        provider: 'deterministic',
        modelUsed: 'deterministic-fallback',
        requestedProvider: 'openai',
        requestedModel: 'gpt-4o',
        attempts: 3,
      });

      await capturedProcessor!({
        id: 'job-ai-fallback',
        data: { leadId: 'lead-123', auditId: 'audit-456', provider: 'openai', model: 'gpt-4o' },
      });

      expect(addDeployJob).toHaveBeenCalledWith(
        expect.objectContaining({
          generationSource: {
            provider: 'deterministic',
            modelUsed: 'deterministic-fallback',
            requestedProvider: 'openai',
            requestedModel: 'gpt-4o',
          },
        }),
      );
    });
  });

  it('should register a failed handler that resets the lead after the last attempt', () => {
    createAiWorker();
    expect(mockWorkerInstance.on).toHaveBeenCalledWith('failed', expect.any(Function));
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
