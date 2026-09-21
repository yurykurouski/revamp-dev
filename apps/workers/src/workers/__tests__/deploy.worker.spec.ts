import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDeployWorker } from '../deploy.worker.js';
import { Lead } from '../../models/Lead.model.js';
import { Audit } from '../../models/Audit.model.js';
import { MvpProject } from '../../models/MvpProject.model.js';
import { bentoTemplateService } from '../../services/template.service.js';
import { storageService } from '../../services/storage.service.js';
import { browserService } from '../../services/browser.service.js';
import { ImageService } from '../../services/image.service.js';

vi.mock('../../models/Lead.model.js');
vi.mock('../../models/Audit.model.js');
vi.mock('../../models/MvpProject.model.js');
vi.mock('../../services/template.service.js');
vi.mock('../../services/storage.service.js');
vi.mock('../../services/browser.service.js');
vi.mock('../../services/image.service.js');
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

describe('DeployWorker (@revamp/workers)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProcessor = null;
  });

  it('should initialize worker for DEPLOY queue', () => {
    const worker = createDeployWorker();
    expect(worker).toBeDefined();
    expect(capturedProcessor).toBeTypeOf('function');
  });

  it('should execute complete deployment pipeline, upload HTML, capture screenshot, create comparison banner, and update MongoDB', async () => {
    createDeployWorker();
    expect(capturedProcessor).not.toBeNull();

    const mockLeadId = '64f8a1234567890123456789';
    const mockAuditId = '64f8a9876543210987654321';
    const mockMvpProjectId = '64f8b1112223334445556667';

    const mockLead = {
      _id: mockLeadId,
      businessName: 'Стоматология Улыбка',
      domain: 'smile.spb.ru',
      niche: 'dental',
      contactPhone: '+7 (812) 123-45-67',
      contactEmail: 'info@smile.spb.ru',
      city: 'Санкт-Петербург',
      toObject: () => mockLead,
    };

    const mockAudit = {
      _id: mockAuditId,
      leadId: mockLeadId,
      extractedBrandTokens: {
        primaryColor: '#4f46e5',
        secondaryColor: '#e0e7ff',
        accentColor: '#4f46e5',
      },
      screenshotUrls: {
        desktopOriginal: 'http://localhost:9000/revamp-assets/screenshots/lead/desktop.webp',
        mobileOriginal: 'http://localhost:9000/revamp-assets/screenshots/lead/mobile.webp',
      },
      lighthouseMetrics: { lcp: 3500 },
      a11ySummary: { violationsCount: 12 },
      generatedContent: {
        hero: {
          badge: '✨ Акция',
          headline: 'Улыбка вашей мечты',
          subheadline: 'Без боли',
          primaryCtaText: 'Записаться',
          secondaryCtaText: 'Позвонить',
        },
        services: [],
        trustSignals: [],
        offerNotice: '',
      },
      toObject: () => mockAudit,
    };

    const mockMvpProjectDoc = {
      _id: mockMvpProjectId,
      previewSlug: 'stomatologiya-ulybka-456789',
      fullPreviewUrl: 'http://localhost:9000/revamp-demos/v/stomatologiya-ulybka-456789/index.html',
    };

    vi.mocked(Lead.findById).mockReturnValue({
      exec: vi.fn().mockResolvedValue(mockLead),
    } as any);

    vi.mocked(Audit.findOne).mockReturnValue({
      exec: vi.fn().mockResolvedValue(mockAudit),
    } as any);

    vi.mocked(bentoTemplateService.renderFromAudit).mockReturnValue('<!DOCTYPE html><html>Bento MVP</html>');

    vi.mocked(storageService.uploadHtml).mockResolvedValue({
      url: 'http://localhost:9000/revamp-demos/v/stomatologiya-ulybka-456789/index.html',
      key: 'v/stomatologiya-ulybka-456789/index.html',
    });

    const dummyMvpBuffer = Buffer.from('mock-mvp-mobile-buffer');
    vi.mocked(browserService.captureHtmlScreenshot).mockResolvedValue(dummyMvpBuffer);

    const dummyBannerBuffer = Buffer.from('mock-comparison-banner-buffer');
    vi.mocked(ImageService.createComparisonBanner).mockResolvedValue(dummyBannerBuffer);

    vi.mocked(storageService.uploadComparisonBanner).mockResolvedValue(
      'http://localhost:9000/revamp-assets/banners/stomatologiya-ulybka-456789.webp',
    );

    vi.mocked(MvpProject.findOneAndUpdate).mockReturnValue({
      exec: vi.fn().mockResolvedValue(mockMvpProjectDoc),
    } as any);

    vi.mocked(Audit.findByIdAndUpdate).mockReturnValue({
      exec: vi.fn().mockResolvedValue(true),
    } as any);

    vi.mocked(Lead.findByIdAndUpdate).mockReturnValue({
      exec: vi.fn().mockResolvedValue(true),
    } as any);

    const job = {
      id: 'job-deploy-1',
      data: {
        leadId: mockLeadId,
        auditId: mockAuditId,
      },
    };

    const result = await capturedProcessor!(job);

    expect(result.success).toBe(true);
    expect(result.mvpProjectId).toBe(mockMvpProjectId);
    expect(result.fullPreviewUrl).toContain('stomatologiya-ulybka-456789');
    expect(result.comparisonBannerUrl).toContain('stomatologiya-ulybka-456789.webp');

    // Assert S3 HTML upload called with proper key & html
    expect(storageService.uploadHtml).toHaveBeenCalledWith(
      expect.stringContaining('stomatologiya-ulybka'),
      '<!DOCTYPE html><html>Bento MVP</html>',
      expect.any(String),
    );

    // Assert mobile screenshot capture called
    expect(browserService.captureHtmlScreenshot).toHaveBeenCalledWith(
      '<!DOCTYPE html><html>Bento MVP</html>',
      expect.objectContaining({ width: 375, height: 812 }),
    );

    // Assert comparison banner created
    expect(ImageService.createComparisonBanner).toHaveBeenCalled();

    // Assert Lead transitioned to NEEDS_APPROVAL (HITL constraint)
    expect(Lead.findByIdAndUpdate).toHaveBeenCalledWith(mockLeadId, { status: 'NEEDS_APPROVAL' });

    // Assert Audit updated with comparisonBanner
    expect(Audit.findByIdAndUpdate).toHaveBeenCalledWith(
      mockAuditId,
      expect.objectContaining({
        'screenshotUrls.comparisonBanner': expect.stringContaining('.webp'),
      }),
    );
  });

  it('should throw error when lead is not found', async () => {
    createDeployWorker();

    vi.mocked(Lead.findById).mockReturnValue({
      exec: vi.fn().mockResolvedValue(null),
    } as any);

    const job = {
      id: 'job-deploy-err',
      data: {
        leadId: 'missing-lead',
        auditId: 'audit-1',
      },
    };

    await expect(capturedProcessor!(job)).rejects.toThrow('Lead missing-lead not found');
  });

  it('should throw error when audit is not found', async () => {
    createDeployWorker();

    vi.mocked(Lead.findById).mockReturnValue({
      exec: vi.fn().mockResolvedValue({ _id: 'lead-1', businessName: 'Biz' }),
    } as any);

    vi.mocked(Audit.findOne).mockReturnValue({
      exec: vi.fn().mockResolvedValue(null),
    } as any);

    const job = {
      id: 'job-deploy-err2',
      data: {
        leadId: 'lead-1',
        auditId: 'missing-audit',
      },
    };

    await expect(capturedProcessor!(job)).rejects.toThrow('Audit missing-audit not found');
  });
});
