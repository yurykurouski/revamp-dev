import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAiWorker } from '../ai.worker.js';
import { Audit } from '../../models/Audit.model.js';
import { Lead } from '../../models/Lead.model.js';
import { mvpContentService } from '../../services/mvp-content.service.js';

vi.mock('../../models/Audit.model.js');
vi.mock('../../models/Lead.model.js');
vi.mock('../../services/mvp-content.service.js');
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
      businessName: 'Стоматология Улыбка',
      niche: 'dental',
      city: 'Санкт-Петербург',
      originalUrl: 'https://smile.spb.ru',
      contactPhone: '+7 812 000 11 22',
      contactEmail: 'info@smile.spb.ru',
    };

    const mockAudit = {
      _id: 'audit-456',
      leadId: 'lead-123',
      extractedServices: ['Имплантация', 'Отбеливание'],
      aiFallbackUsed: false,
    };

    const mockGeneratedContent = {
      hero: {
        badge: '✨ Акция',
        headline: 'Здоровые зубы без боли в Санкт-Петербурге',
        subheadline: 'Премиум качество с гарантией 5 лет.',
        primaryCtaText: 'Записаться',
        secondaryCtaText: 'Позвонить',
      },
      services: [
        {
          title: 'Имплантация зубов',
          description: 'Пожизненная гарантия на импланты',
          lucideIconName: 'shield-check',
        },
        {
          title: 'Отбеливание',
          description: 'Безопасное осветление эмали',
          lucideIconName: 'sparkles',
        },
        {
          title: 'Терапия',
          description: 'Лечение кариеса под микроскопом',
          lucideIconName: 'activity',
        },
      ],
      trustSignals: [
        { metric: '4.9 ★', label: 'В Яндекс Картах' },
        { metric: '10 лет', label: 'Опыта' },
        { metric: '100%', label: 'Гарантия' },
      ],
      offerNotice: 'Бесплатная консультация',
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
