import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuditWorker } from '../audit.worker.js';
import { Audit } from '../../models/Audit.model.js';
import { Lead } from '../../models/Lead.model.js';
import { AnalyticsEvent } from '../../models/AnalyticsEvent.model.js';
import { browserService } from '../../services/browser.service.js';
import { ImageService } from '../../services/image.service.js';
import { storageService } from '../../services/storage.service.js';
import { designCritiqueService } from '../../services/design-critique.service.js';

vi.mock('../../models/Audit.model.js');
vi.mock('../../models/Lead.model.js');
vi.mock('../../models/AnalyticsEvent.model.js');
vi.mock('../../services/browser.service.js');
vi.mock('../../services/image.service.js');
vi.mock('../../services/storage.service.js');
vi.mock('../../services/design-critique.service.js');
vi.mock('../../queues/ai.queue.js', () => ({
  addAiGenerationJob: vi.fn().mockResolvedValue({ id: 'mock-ai-job' }),
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

  it('should capture full audit, compress to WebP, run Vision LLM critique, calculate composite score, and update MongoDB', async () => {
    createAuditWorker();
    expect(capturedProcessor).not.toBeNull();

    const mockJob = {
      id: 'job-456',
      data: {
        leadId: 'lead-123',
        url: 'https://test-dental.com',
        niche: 'dental',
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

    vi.mocked(storageService.ensureBucket).mockResolvedValue(undefined);
    vi.mocked(browserService.captureFullAudit).mockResolvedValue({
      desktopBuffer: Buffer.from('raw-desktop-png'),
      mobileBuffer: Buffer.from('raw-mobile-png'),
      desktopFullBuffer: Buffer.from('raw-desktop-full-png'),
      mobileFullBuffer: Buffer.from('raw-mobile-full-png'),
      a11yResult: {
        a11yScore: 82,
        summary: {
          violationsCount: 3,
          contrastIssuesCount: 2,
          missingAltCount: 1,
          criticalViolations: [
            { id: 'image-alt', description: 'Missing alt', impact: 'critical', selector: 'img' },
          ],
        },
        rawViolations: [],
      },
      vitalsResult: {
        lcpSeconds: 2.1,
        lighthouseMetrics: { lcp: 2100, cls: 0.03, speedIndex: 1900 },
        standards: { hasSsl: true, hasViewport: true, hasTitle: true },
        performanceScore: 90,
        standardsScore: 100,
      },
      rawBrandData: {
        colors: ['rgb(79, 70, 229)', 'rgb(255, 255, 255)'],
        fontFamilies: ['Inter'],
        faviconUrl: 'https://example.com/favicon.ico',
        logoUrl: 'https://example.com/logo.png',
        phone: '+1 555-1234',
        email: 'info@example.com',
        address: '123 Test St',
        workingHours: '9-18',
        socialLinks: [{ platform: 'telegram', url: 'https://t.me/test' }],
        services: ['General Dentistry'],
      },
    });

    vi.mocked(ImageService.compressToWebp)
      .mockResolvedValueOnce(Buffer.from('webp-desktop'))
      .mockResolvedValueOnce(Buffer.from('webp-mobile'));
    vi.mocked(ImageService.compressFullPageToWebp)
      .mockResolvedValueOnce(Buffer.from('webp-desktop-full'))
      .mockResolvedValueOnce(Buffer.from('webp-mobile-full'));
    vi.mocked(storageService.uploadScreenshot)
      .mockResolvedValueOnce('http://localhost:9000/revamp-assets/screenshots/lead-123/desktop.webp')
      .mockResolvedValueOnce('http://localhost:9000/revamp-assets/screenshots/lead-123/mobile.webp')
      .mockResolvedValueOnce('http://localhost:9000/revamp-assets/screenshots/lead-123/desktop-full.webp')
      .mockResolvedValueOnce('http://localhost:9000/revamp-assets/screenshots/lead-123/mobile-full.webp');

    vi.mocked(designCritiqueService.analyzeDesign).mockResolvedValue({
      critique: {
        visualHierarchyRating: 70,
        mobileFriendlinessRating: 80,
        primaryCtaFound: true,
        datedDesignFactors: ['cluttered-header'],
        criticalFlaws: [
          { title: 'Flaw 1', impact: 'Impact 1', recommendation: 'Rec 1' },
          { title: 'Flaw 2', impact: 'Impact 2', recommendation: 'Rec 2' },
          { title: 'Flaw 3', impact: 'Impact 3', recommendation: 'Rec 3' },
        ],
        quickWins: ['Win 1', 'Win 2', 'Win 3'],
      },
      aiFallbackUsed: false,
      modelUsed: 'claude-3-5-sonnet-20241022',
      attempts: 1,
      tokenUsage: {
        promptTokens: 450,
        completionTokens: 180,
        totalTokens: 630,
      },
    });

    const result = await capturedProcessor!(mockJob);

    // Initial status transitions
    expect(Audit.findOneAndUpdate).toHaveBeenCalledWith(
      { leadId: 'lead-123' },
      { status: 'PROCESSING' },
      { new: true, sort: { createdAt: -1 } },
    );
    expect(Lead.findByIdAndUpdate).toHaveBeenCalledWith(
      'lead-123',
      { status: 'AUDITING' },
      { new: true },
    );

    // Browser capture and WebP compression
    expect(browserService.captureFullAudit).toHaveBeenCalledWith('https://test-dental.com');
    expect(ImageService.compressToWebp).toHaveBeenCalledTimes(2);
    // Full-page captures keep native width (REV-21)
    expect(ImageService.compressFullPageToWebp).toHaveBeenCalledWith(Buffer.from('raw-desktop-full-png'), {
      maxWidth: 1440,
    });
    expect(ImageService.compressFullPageToWebp).toHaveBeenCalledWith(Buffer.from('raw-mobile-full-png'), {
      maxWidth: 750,
    });
    expect(storageService.uploadScreenshot).toHaveBeenCalledWith('lead-123', 'desktop-full', Buffer.from('webp-desktop-full'));
    expect(storageService.uploadScreenshot).toHaveBeenCalledWith('lead-123', 'mobile-full', Buffer.from('webp-mobile-full'));

    // Vision LLM must still receive the above-the-fold shots, not the tall full-page ones
    expect(designCritiqueService.analyzeDesign).toHaveBeenCalledWith(
      expect.objectContaining({
        desktopScreenshotWebp: Buffer.from('webp-desktop'),
        mobileScreenshotWebp: Buffer.from('webp-mobile'),
      }),
    );

    // S3 upload
    expect(storageService.uploadScreenshot).toHaveBeenCalledWith(
      'lead-123',
      'desktop',
      expect.any(Buffer),
    );
    expect(storageService.uploadScreenshot).toHaveBeenCalledWith(
      'lead-123',
      'mobile',
      expect.any(Buffer),
    );

    // Design critique service invocation
    expect(designCritiqueService.analyzeDesign).toHaveBeenCalledWith({
      mobileScreenshotWebp: expect.any(Buffer),
      desktopScreenshotWebp: expect.any(Buffer),
      niche: 'dental',
      a11yScore: 82,
      lcpSeconds: 2.1,
      originalUrl: 'https://test-dental.com',
    });

    // Scoring calculation:
    // Design: (70 + 80)/2 = 75
    // Composite: 0.35 * 75 + 0.25 * 90 + 0.20 * 82 + 0.20 * 100
    // = 26.25 + 22.5 + 16.4 + 20 = 85.15 -> 85
    expect(Audit.findOneAndUpdate).toHaveBeenCalledWith(
      { leadId: 'lead-123' },
      expect.objectContaining({
        status: 'COMPLETED',
        desktopScreenshotUrl: 'http://localhost:9000/revamp-assets/screenshots/lead-123/desktop.webp',
        mobileScreenshotUrl: 'http://localhost:9000/revamp-assets/screenshots/lead-123/mobile.webp',
        screenshotUrls: {
          desktopOriginal: 'http://localhost:9000/revamp-assets/screenshots/lead-123/desktop.webp',
          mobileOriginal: 'http://localhost:9000/revamp-assets/screenshots/lead-123/mobile.webp',
          desktopFull: 'http://localhost:9000/revamp-assets/screenshots/lead-123/desktop-full.webp',
          mobileFull: 'http://localhost:9000/revamp-assets/screenshots/lead-123/mobile-full.webp',
        },
        a11yScore: 82,
        lcp: 2.1,
        aiFallbackUsed: false,
        scores: {
          total: 85,
          design: 75,
          performance: 90,
          accessibility: 82,
          standards: 100,
        },
        lighthouseMetrics: { lcp: 2100, cls: 0.03, speedIndex: 1900 },
        designCritique: expect.objectContaining({
          visualHierarchyRating: 70,
          mobileFriendlinessRating: 80,
          criticalFlaws: expect.any(Array),
        }),
        extractedBrandTokens: expect.objectContaining({
          primaryColor: expect.any(String),
          secondaryColor: expect.any(String),
          accentColor: expect.any(String),
        }),
      }),
      { new: true, sort: { createdAt: -1 } },
    );

    // Lead score and status update
    expect(Lead.findByIdAndUpdate).toHaveBeenCalledWith(
      'lead-123',
      expect.objectContaining({
        status: 'AUDITED',
        totalScore: 85,
        contactPhone: '+1 555-1234',
        city: '123 Test St',
      }),
    );

    // Analytics token usage event logging
    expect(AnalyticsEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'lead-123',
        eventType: 'token_usage',
        metadata: {
          model: 'claude-3-5-sonnet-20241022',
          promptTokens: 450,
          completionTokens: 180,
          totalTokens: 630,
          stage: 'audit_vision_critique',
        },
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        leadId: 'lead-123',
        url: 'https://test-dental.com',
        a11yScore: 82,
        lcp: 2.1,
        totalScore: 85,
        aiFallbackUsed: false,
        extractedBrandTokens: expect.any(Object),
        contacts: expect.objectContaining({ phone: '+1 555-1234' }),
      }),
    );
  });

  it('should record errorMessage and FAILED status on Audit and throw error when pipeline fails', async () => {
    createAuditWorker();
    expect(capturedProcessor).not.toBeNull();

    const mockJob = {
      id: 'job-err',
      data: {
        leadId: 'lead-err',
        url: 'https://invalid-site.xyz',
        niche: 'other',
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

    vi.mocked(storageService.ensureBucket).mockResolvedValue(undefined);
    vi.mocked(browserService.captureFullAudit).mockRejectedValue(
      new Error('ERR_CONNECTION_REFUSED'),
    );

    await expect(capturedProcessor!(mockJob)).rejects.toThrow('ERR_CONNECTION_REFUSED');

    expect(Audit.findOneAndUpdate).toHaveBeenCalledWith(
      { leadId: 'lead-err' },
      {
        status: 'FAILED',
        errorMessage: 'ERR_CONNECTION_REFUSED',
      },
      // Re-audits create a new Audit doc; the latest one must be marked FAILED
      { sort: { createdAt: -1 } },
    );
  });
});
