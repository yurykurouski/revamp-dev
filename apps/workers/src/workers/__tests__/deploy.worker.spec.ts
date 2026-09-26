import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDeployWorker } from '../deploy.worker.js';
import { Lead } from '../../models/Lead.model.js';
import { Audit } from '../../models/Audit.model.js';
import { MvpProject } from '../../models/MvpProject.model.js';
import { bentoTemplateService } from '../../services/template.service.js';
import { storageService } from '../../services/storage.service.js';
import { browserService } from '../../services/browser.service.js';
import { ImageService } from '../../services/image.service.js';
import { mvpCompletenessService } from '../../services/mvp-completeness.service.js';

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
    vi.restoreAllMocks();
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
      businessName: 'Smile Dental',
      domain: 'smile.spb.ru',
      niche: 'dental',
      contactPhone: '+7 (812) 123-45-67',
      contactEmail: 'info@smile.spb.ru',
      city: 'Saint Petersburg',
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
          badge: '✨ Special',
          headline: 'The smile of your dreams',
          subheadline: 'Pain-free',
          primaryCtaText: 'Book now',
          secondaryCtaText: 'Call us',
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

    // First deploy for this lead: no existing project
    vi.mocked(MvpProject.findOne).mockReturnValue({
      select: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(null) }),
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
      expect.stringContaining('smile-dental'),
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

    // Assert Lead transitioned to NEEDS_APPROVAL (HITL constraint) with previewUrl and comparisonBannerUrl
    expect(Lead.findByIdAndUpdate).toHaveBeenCalledWith(mockLeadId, {
      $set: {
        status: 'NEEDS_APPROVAL',
        previewUrl: 'http://localhost:9000/revamp-demos/v/stomatologiya-ulybka-456789/index.html',
        comparisonBannerUrl: 'http://localhost:9000/revamp-assets/banners/stomatologiya-ulybka-456789.webp',
        mvpGeneratedAt: expect.any(Date),
      },
      $unset: { generationError: '' },
    });

    // REV-31: one MvpProject per lead, stamped with the generation time and run count
    expect(MvpProject.findOneAndUpdate).toHaveBeenCalledWith(
      { leadId: mockLeadId },
      expect.objectContaining({
        $inc: { generationCount: 1 },
        generatedAt: expect.any(Date),
        previewSlug: expect.stringContaining('smile-dental'),
      }),
      { upsert: true, new: true },
    );

    // Assert Audit updated with comparisonBanner
    expect(Audit.findByIdAndUpdate).toHaveBeenCalledWith(
      mockAuditId,
      expect.objectContaining({
        'screenshotUrls.comparisonBanner': expect.stringContaining('.webp'),
      }),
    );
  });

  it('should redeploy a regenerated MVP to the existing previewSlug, overwriting it in place (REV-31)', async () => {
    createDeployWorker();
    const leadId = '64f8a1234567890123456789';
    const lead = { _id: leadId, businessName: 'Renamed Clinic', domain: 'smile.pl', toObject: () => lead };
    const audit = { _id: 'audit-1', leadId, generatedContent: { hero: { headline: 'New copy' } }, toObject: () => audit };

    vi.mocked(Lead.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue(lead) } as any);
    vi.mocked(Audit.findOne).mockReturnValue({ exec: vi.fn().mockResolvedValue(audit) } as any);
    vi.mocked(MvpProject.findOne).mockReturnValue({
      select: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue({ previewSlug: 'smile-dental-456789' }) }),
    } as any);
    vi.mocked(bentoTemplateService.renderFromAudit).mockReturnValue('<html>v2</html>');
    vi.mocked(storageService.uploadHtml).mockResolvedValue({
      url: 'http://localhost:9000/revamp-demos/v/smile-dental-456789/index.html',
      key: 'v/smile-dental-456789/index.html',
    });
    vi.mocked(browserService.captureHtmlScreenshot).mockResolvedValue(Buffer.from('shot'));
    vi.mocked(ImageService.createComparisonBanner).mockResolvedValue(Buffer.from('banner'));
    vi.mocked(storageService.uploadComparisonBanner).mockResolvedValue('http://localhost:9000/revamp-assets/banners/smile-dental-456789.webp');
    vi.mocked(MvpProject.findOneAndUpdate).mockReturnValue({
      exec: vi.fn().mockResolvedValue({ _id: 'mvp-1' }),
    } as any);
    vi.mocked(Audit.findByIdAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(true) } as any);
    vi.mocked(Lead.findByIdAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(true) } as any);

    const result = await capturedProcessor!({
      id: 'job-deploy-regen',
      data: { leadId, auditId: 'audit-1', forceRegenerate: true, previousStatus: 'NEEDS_APPROVAL' },
    });

    // Same slug even though the business was renamed, so the shared preview URL keeps working
    expect(result.previewSlug).toBe('smile-dental-456789');
    expect(storageService.uploadHtml).toHaveBeenCalledWith('smile-dental-456789', '<html>v2</html>', expect.any(String));
    expect(storageService.uploadComparisonBanner).toHaveBeenCalledWith('smile-dental-456789', expect.any(Buffer));
    // Updated in place, not duplicated
    expect(MvpProject.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(MvpProject.findOneAndUpdate).toHaveBeenCalledWith(
      { leadId },
      expect.objectContaining({ previewSlug: 'smile-dental-456789', generatedContent: audit.generatedContent }),
      { upsert: true, new: true },
    );
    expect(Lead.findByIdAndUpdate).toHaveBeenCalledWith(
      leadId,
      expect.objectContaining({ $set: expect.objectContaining({ status: 'NEEDS_APPROVAL' }) }),
    );
  });

  describe('MVP completeness check (REV-36)', () => {
    const leadId = '64f8a1234567890123456789';
    const mvpHtml =
      '<html><body><h1>Smile Dental</h1><footer><a href="tel:+48221234567">+48 22 123 45 67</a></footer></body></html>';

    const setUpDeploy = () => {
      createDeployWorker();
      const lead = { _id: leadId, businessName: 'Smile Dental', domain: 'smile.pl', toObject: () => lead };
      const audit = {
        _id: 'audit-1',
        leadId,
        extractedContacts: { phone: '+48 22 123 45 67', email: 'info@smile.pl', socialLinks: [] },
        toObject: () => audit,
      };
      vi.mocked(Lead.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue(lead) } as any);
      vi.mocked(Audit.findOne).mockReturnValue({ exec: vi.fn().mockResolvedValue(audit) } as any);
      vi.mocked(MvpProject.findOne).mockReturnValue({
        select: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(null) }),
      } as any);
      vi.mocked(bentoTemplateService.renderFromAudit).mockReturnValue(mvpHtml);
      vi.mocked(storageService.uploadHtml).mockResolvedValue({ url: 'http://minio/v/smile/index.html', key: 'v/smile/index.html' });
      vi.mocked(browserService.captureHtmlScreenshot).mockResolvedValue(Buffer.from('shot'));
      vi.mocked(ImageService.createComparisonBanner).mockResolvedValue(Buffer.from('banner'));
      vi.mocked(storageService.uploadComparisonBanner).mockResolvedValue('http://minio/banners/smile.webp');
      vi.mocked(MvpProject.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue({ _id: 'mvp-1' }) } as any);
      vi.mocked(Audit.findByIdAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(true) } as any);
      vi.mocked(Lead.findByIdAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(true) } as any);
      return { lead, audit };
    };

    const savedReport = () => (vi.mocked(MvpProject.findOneAndUpdate).mock.calls[0]?.[1] as any)?.completenessReport;

    it('checks the rendered HTML and saves the report on the MvpProject before the lead moves to NEEDS_APPROVAL', async () => {
      setUpDeploy();
      const checkSpy = vi.spyOn(mvpCompletenessService, 'check');

      await capturedProcessor!({ id: 'job-completeness', data: { leadId, auditId: 'audit-1' } });

      expect(checkSpy).toHaveBeenCalledWith(mvpHtml, expect.objectContaining({ _id: leadId }), expect.objectContaining({ _id: 'audit-1' }));
      const report = savedReport();
      expect(report.status).toBe('verified');
      expect(report.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'phone', status: 'present' }),
          expect.objectContaining({ field: 'email', status: 'missing' }),
        ]),
      );
      // The email is gone from the MVP: flagged, but the lead still reaches review (not blocked)
      expect(report.hasCriticalIssues).toBe(true);
      expect(Lead.findByIdAndUpdate).toHaveBeenCalledWith(
        leadId,
        expect.objectContaining({ $set: expect.objectContaining({ status: 'NEEDS_APPROVAL' }) }),
      );

      const checkOrder = checkSpy.mock.invocationCallOrder[0]!;
      const saveOrder = vi.mocked(MvpProject.findOneAndUpdate).mock.invocationCallOrder[0]!;
      const approvalOrder = vi.mocked(Lead.findByIdAndUpdate).mock.invocationCallOrder[0]!;
      expect(checkOrder).toBeLessThan(saveOrder);
      expect(saveOrder).toBeLessThan(approvalOrder);
    });

    it('recomputes the report on every regeneration', async () => {
      setUpDeploy();
      await capturedProcessor!({ id: 'job-1', data: { leadId, auditId: 'audit-1' } });
      const first = savedReport();

      vi.mocked(MvpProject.findOneAndUpdate).mockClear();
      vi.mocked(bentoTemplateService.renderFromAudit).mockReturnValue(
        '<html><body><h1>Smile Dental</h1><a href="mailto:info@smile.pl">info@smile.pl</a><a href="tel:+48221234567">+48 22 123 45 67</a></body></html>',
      );
      await capturedProcessor!({ id: 'job-2', data: { leadId, auditId: 'audit-1', forceRegenerate: true } });
      const second = savedReport();

      expect(first.hasCriticalIssues).toBe(true);
      expect(second.hasCriticalIssues).toBe(false);
      expect(new Date(second.checkedAt).getTime()).toBeGreaterThanOrEqual(new Date(first.checkedAt).getTime());
    });

    it('saves an unverified report and still deploys when the comparison fails', async () => {
      setUpDeploy();
      vi.spyOn(mvpCompletenessService, 'compare').mockImplementation(() => {
        throw new Error('parser exploded');
      });
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const result = await capturedProcessor!({ id: 'job-completeness-err', data: { leadId, auditId: 'audit-1' } });

      expect(result.success).toBe(true);
      expect(savedReport()).toEqual(
        expect.objectContaining({ status: 'unverified', hasCriticalIssues: false, checks: [], error: 'parser exploded' }),
      );
      expect(Lead.findByIdAndUpdate).toHaveBeenCalledWith(
        leadId,
        expect.objectContaining({ $set: expect.objectContaining({ status: 'NEEDS_APPROVAL' }) }),
      );
    });
  });

  it('should register a failed handler that resets the lead after the last attempt', () => {
    createDeployWorker();
    expect(mockWorkerInstance.on).toHaveBeenCalledWith('failed', expect.any(Function));
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
