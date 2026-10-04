import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDeployWorker } from '../deploy.worker.js';
import { Lead } from '../../models/Lead.model.js';
import { Audit } from '../../models/Audit.model.js';
import { findGenerationAudit } from '../../services/audit-lookup.js';
import { MvpProject } from '../../models/MvpProject.model.js';
import { bentoTemplateService } from '../../services/template.service.js';
import { storageService } from '../../services/storage.service.js';
import { browserService } from '../../services/browser.service.js';
import { ImageService } from '../../services/image.service.js';
import { mvpCompletenessService } from '../../services/mvp-completeness.service.js';

vi.mock('../../models/Lead.model.js');
vi.mock('../../models/Audit.model.js');
vi.mock('../../services/audit-lookup.js');
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
      webVitals: { lcp: 3500 },
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

    vi.mocked(findGenerationAudit).mockResolvedValue(mockAudit as any);

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

    vi.mocked(Lead.findOneAndUpdate).mockReturnValue({
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
    expect(Lead.findOneAndUpdate).toHaveBeenCalledWith({ _id: mockLeadId, status: { $in: ['GENERATING'] } }, {
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

    // REV-54: the layout is picked from the audit, rendered, and recorded on the MvpProject.
    // No services and no photos on this site, so the short compact layout fits.
    expect(bentoTemplateService.renderFromAudit).toHaveBeenCalledWith(
      mockLead,
      mockAudit,
      mockAudit.generatedContent,
      'compact',
      undefined,
      undefined,
    );
    expect(MvpProject.findOneAndUpdate).toHaveBeenCalledWith(
      { leadId: mockLeadId },
      expect.objectContaining({
        layout: {
          variant: 'compact',
          // No sections read on this audit, so no rebuild (REV-110); no original layout either: the rules
          // chose, and the fallback is marked (REV-104)
          reasons: ['rebuild:unread', 'rule:small_brochure', 'complexity:UNKNOWN', 'niche:dental', 'images:0', 'services:0', 'site_layout:unread'],
        },
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
    vi.mocked(findGenerationAudit).mockResolvedValue(audit as any);
    vi.mocked(MvpProject.findOne).mockReturnValue({
      select: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({ previewSlug: 'smile-dental-456789', design: { hidden: ['reviews'] } }),
      }),
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
    vi.mocked(Lead.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(true) } as any);

    const result = await capturedProcessor!({
      id: 'job-deploy-regen',
      data: { leadId, auditId: 'audit-1', forceRegenerate: true, previousStatus: 'NEEDS_APPROVAL' },
    });

    // The operator's custom design survives the regeneration (REV-92)
    expect(vi.mocked(bentoTemplateService.renderFromAudit).mock.calls[0]![5]).toEqual({ hidden: ['reviews'] });
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
    expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: leadId, status: { $in: ['GENERATING'] } },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'NEEDS_APPROVAL' }) }),
    );
  });

  describe('layout derived from the original site (REV-104)', () => {
    const leadId = '64f8a1234567890123456789';
    const siteLayout = {
      sections: [{ kind: 'gallery' }, { kind: 'services' }, { kind: 'reviews' }],
      hero: { media: 'side', mediaSide: 'left', align: 'left', tone: 'light' },
      nav: { itemCount: 6, centeredLogo: true, sticky: true, hasCta: true },
      density: 'airy',
    };

    const regenerate = async (existing: Record<string, unknown> | null) => {
      createDeployWorker();
      const lead = { _id: leadId, businessName: 'Pod Lipą', domain: 'podlipa.pl', niche: 'restaurant', toObject: () => lead };
      const audit = {
        _id: 'audit-1',
        leadId,
        siteLayout,
        extractedContent: { images: ['https://podlipa.pl/1.jpg', 'https://podlipa.pl/2.jpg', 'https://podlipa.pl/3.jpg'], paragraphs: [] },
        generatedContent: { hero: { headline: 'Kuchnia polska' }, services: [{}, {}, {}, {}, {}] },
        toObject: () => audit,
      };
      vi.mocked(Lead.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue(lead) } as any);
      vi.mocked(findGenerationAudit).mockResolvedValue(audit as any);
      vi.mocked(MvpProject.findOne).mockReturnValue({ select: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(existing) }) } as any);
      vi.mocked(bentoTemplateService.renderFromAudit).mockReturnValue('<html>derived</html>');
      vi.mocked(storageService.uploadHtml).mockResolvedValue({ url: 'http://localhost:9000/revamp-demos/v/pod/index.html', key: 'v/pod/index.html' });
      vi.mocked(browserService.captureHtmlScreenshot).mockResolvedValue(Buffer.from('shot'));
      vi.mocked(ImageService.createComparisonBanner).mockResolvedValue(Buffer.from('banner'));
      vi.mocked(storageService.uploadComparisonBanner).mockResolvedValue('http://localhost:9000/revamp-assets/banners/pod.webp');
      vi.mocked(MvpProject.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue({ _id: 'mvp-1' }) } as any);
      vi.mocked(Audit.findByIdAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(true) } as any);
      vi.mocked(Lead.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(true) } as any);
      await capturedProcessor!({ id: 'job-derived', data: { leadId, auditId: 'audit-1' } });
      const saved = vi.mocked(MvpProject.findOneAndUpdate).mock.calls[0]![1] as Record<string, any>;
      return { saved, rendered: vi.mocked(bentoTemplateService.renderFromAudit).mock.calls[0]! };
    };

    const derivedDesign = {
      sectionOrder: ['gallery', 'services', 'reviews'],
      hero: { imageSide: 'left' },
      theme: { density: 'airy' },
      header: { layout: 'centered', links: true },
    };

    it('derives the layout from the audit, saves it with its design and renders it', async () => {
      const { saved, rendered } = await regenerate(null);
      expect(saved.layout.variant).toBe('split');
      // No sections read on this audit: Bento, with the rebuild's fallback reason first (REV-110)
      expect(saved.layout.reasons.slice(0, 2)).toEqual(['rebuild:unread', 'rule:derived']);
      expect(saved.layout.design).toEqual(derivedDesign);
      expect(rendered[3]).toBe('split');
      expect(rendered[5]).toEqual(derivedDesign);
    });

    it("renders the operator's design over the derived one on a regeneration", async () => {
      const { rendered } = await regenerate({ previewSlug: 'pod-lipa-1', design: { theme: { corners: 'sharp' }, header: { links: false } } });
      expect(rendered[5]).toEqual({
        ...derivedDesign,
        theme: { density: 'airy', corners: 'sharp' },
        header: { layout: 'centered', links: false },
      });
    });

    it('keeps a layout the operator picked, with the freshly derived look', async () => {
      const { saved, rendered } = await regenerate({ previewSlug: 'pod-lipa-1', layout: { variant: 'editorial', reasons: ['rule:manual'] } });
      expect(saved.layout.variant).toBe('editorial');
      expect(saved.layout.reasons[0]).toBe('rule:manual');
      expect(saved.layout.reasons).toContain('hero:side-left');
      expect(saved.layout.design).toEqual(derivedDesign);
      expect(rendered[3]).toBe('editorial');
    });

    it("renders Bento for a manual original pick that cannot be rebuilt, keeping the pick and the operator's design (REV-110)", async () => {
      const { saved, rendered } = await regenerate({
        previewSlug: 'pod-lipa-1',
        layout: { variant: 'original', reasons: ['rule:manual'] },
        design: { theme: { corners: 'sharp' } },
      });
      expect(saved.layout.variant).toBe('split');
      expect(saved.layout.reasons.slice(0, 3)).toEqual(['rule:manual', 'manual:original', 'rebuild:unread']);
      expect(saved.$unset).toEqual({ rebuild: '' });
      expect(rendered[3]).toBe('split');
      expect(rendered[5]).toEqual({ ...derivedDesign, theme: { density: 'airy', corners: 'sharp' } });
    });

    it('replaces an automatic layout with the new derivation', async () => {
      const { saved } = await regenerate({ previewSlug: 'pod-lipa-1', layout: { variant: 'compact', reasons: ['rule:small_brochure'] } });
      expect(saved.layout.variant).toBe('split');
    });
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
      vi.mocked(findGenerationAudit).mockResolvedValue(audit as any);
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
      vi.mocked(Lead.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(true) } as any);
      return { lead, audit };
    };

    const savedReport = () => (vi.mocked(MvpProject.findOneAndUpdate).mock.calls[0]?.[1] as any)?.completenessReport;

    it('checks the rendered HTML and saves the report on the MvpProject before the lead moves to NEEDS_APPROVAL', async () => {
      setUpDeploy();
      const checkSpy = vi.spyOn(mvpCompletenessService, 'assess');

      await capturedProcessor!({ id: 'job-completeness', data: { leadId, auditId: 'audit-1' } });

      expect(checkSpy).toHaveBeenCalledWith(mvpHtml, expect.objectContaining({ _id: leadId }), expect.objectContaining({ _id: 'audit-1' }));
      const report = savedReport();
      expect(report.status).toBe('verified');
      // Tests run without an LLM provider, so code judges every field
      expect(report.method).toBe('deterministic');
      expect(report.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'phone', status: 'present' }),
          expect.objectContaining({ field: 'email', status: 'missing' }),
        ]),
      );
      // The email is gone from the MVP: flagged, but the lead still reaches review (not blocked)
      expect(report.hasCriticalIssues).toBe(true);
      expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: leadId, status: { $in: ['GENERATING'] } },
        expect.objectContaining({ $set: expect.objectContaining({ status: 'NEEDS_APPROVAL' }) }),
      );

      const checkOrder = checkSpy.mock.invocationCallOrder[0]!;
      const saveOrder = vi.mocked(MvpProject.findOneAndUpdate).mock.invocationCallOrder[0]!;
      const approvalOrder = vi.mocked(Lead.findOneAndUpdate).mock.invocationCallOrder[0]!;
      expect(checkOrder).toBeLessThan(saveOrder);
      expect(saveOrder).toBeLessThan(approvalOrder);
    });

    it('leaves a lead rejected during the deploy in its status and still finishes the job (REV-62)', async () => {
      setUpDeploy();
      vi.mocked(Lead.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(null) } as any);

      const result = await capturedProcessor!({ id: 'job-rejected', data: { leadId, auditId: 'audit-1' } });

      expect(result.success).toBe(true);
      // The only lead write is guarded on GENERATING, so a REJECTED lead is not moved to review
      expect(vi.mocked(Lead.findOneAndUpdate).mock.calls).toEqual([
        [{ _id: leadId, status: { $in: ['GENERATING'] } }, expect.anything()],
      ]);
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
      vi.spyOn(mvpCompletenessService, 'evaluate').mockImplementation(() => {
        throw new Error('parser exploded');
      });
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const result = await capturedProcessor!({ id: 'job-completeness-err', data: { leadId, auditId: 'audit-1' } });

      expect(result.success).toBe(true);
      expect(savedReport()).toEqual(
        expect.objectContaining({ status: 'unverified', hasCriticalIssues: false, checks: [], error: 'parser exploded' }),
      );
      expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: leadId, status: { $in: ['GENERATING'] } },
        expect.objectContaining({ $set: expect.objectContaining({ status: 'NEEDS_APPROVAL' }) }),
      );
    });

    const savedUpdate = () => vi.mocked(MvpProject.findOneAndUpdate).mock.calls[0]?.[1] as any;

    it('stores the provider and model that wrote the copy, and the operator choice (REV-32)', async () => {
      setUpDeploy();

      await capturedProcessor!({
        id: 'job-source',
        data: {
          leadId,
          auditId: 'audit-1',
          generationSource: {
            provider: 'deterministic',
            modelUsed: 'deterministic-fallback',
            requestedProvider: 'openai',
            requestedModel: 'gpt-4o',
          },
        },
      });

      expect(savedUpdate()).toMatchObject({
        provider: 'deterministic',
        modelUsed: 'deterministic-fallback',
        requestedProvider: 'openai',
        requestedModel: 'gpt-4o',
      });
      // Only the rebuild summary of this Bento render is cleared (REV-110)
      expect(savedUpdate().$unset).toEqual({ rebuild: '' });
    });

    it('clears an earlier operator choice when the new run used the default (REV-32)', async () => {
      setUpDeploy();

      await capturedProcessor!({
        id: 'job-default',
        data: { leadId, auditId: 'audit-1', generationSource: { provider: 'claude-cli', modelUsed: 'claude-cli:sonnet' } },
      });

      expect(savedUpdate()).toMatchObject({ provider: 'claude-cli', modelUsed: 'claude-cli:sonnet' });
      expect(savedUpdate().$unset).toEqual({ requestedProvider: '', requestedModel: '', rebuild: '' });
    });

    it('leaves the source fields alone for jobs queued without one', async () => {
      setUpDeploy();

      await capturedProcessor!({ id: 'job-legacy', data: { leadId, auditId: 'audit-1' } });

      expect(savedUpdate()).not.toHaveProperty('provider');
      expect(savedUpdate()).not.toHaveProperty('$unset.requestedProvider');
      expect(savedUpdate()).not.toHaveProperty('$unset.requestedModel');
    });
  });

  describe('comparison banner: measured values only (REV-126)', () => {
    const leadId = '64f8a1234567890123456789';
    const mvpHtml = '<!doctype html><html><head><title>Smile Dental</title></head><body><h1>Smile Dental</h1></body></html>';
    const allChecks = { https: true, viewport: true, title: true, metaDescription: true, singleH1: true, favicon: true, structuredData: false, openGraph: false };

    const setUpDeploy = (auditFields: Record<string, unknown>) => {
      createDeployWorker();
      const lead = { _id: leadId, businessName: 'Smile Dental', domain: 'smile.pl', toObject: () => lead };
      const audit = { _id: 'audit-1', leadId, ...auditFields, toObject: () => audit };
      vi.mocked(Lead.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue(lead) } as any);
      vi.mocked(findGenerationAudit).mockResolvedValue(audit as any);
      vi.mocked(MvpProject.findOne).mockReturnValue({
        select: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(null) }),
      } as any);
      vi.mocked(bentoTemplateService.renderFromAudit).mockReturnValue(mvpHtml);
      vi.mocked(storageService.uploadHtml).mockResolvedValue({ url: 'http://minio/v/smile/index.html', key: 'v/smile/index.html' });
      vi.mocked(browserService.captureHtmlScreenshot).mockResolvedValue(Buffer.from('mvp-shot'));
      vi.mocked(ImageService.createComparisonBanner).mockResolvedValue(Buffer.from('banner'));
      vi.mocked(storageService.uploadComparisonBanner).mockResolvedValue('http://minio/banners/smile.webp');
      vi.mocked(MvpProject.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue({ _id: 'mvp-1' }) } as any);
      vi.mocked(Audit.findByIdAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(true) } as any);
      vi.mocked(Lead.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(true) } as any);
    };
    const bannerInput = () => vi.mocked(ImageService.createComparisonBanner).mock.calls[0]![0];
    const savedStandards = () => (vi.mocked(MvpProject.findOneAndUpdate).mock.calls[0]?.[1] as any)?.standards;

    afterEach(() => vi.unstubAllGlobals());

    it("puts the original's measured values and the published page's standards score on the banner", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(Buffer.from('original-shot'), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      setUpDeploy({
        screenshotUrls: { mobileOriginal: 'http://minio/screens/mobile.webp' },
        webVitals: { lcp: 4200, cls: 0.2 },
        a11ySummary: { violationsCount: 7 },
        standardsChecks: allChecks,
      });

      await capturedProcessor!({ id: 'job-banner', data: { leadId, auditId: 'audit-1' } });

      expect(fetchMock).toHaveBeenCalledWith('http://minio/screens/mobile.webp');
      const input = bannerInput();
      expect(input.originalMobileBuffer?.toString()).toBe('original-shot');
      expect(input.newMvpMobileBuffer.toString()).toBe('mvp-shot');
      expect(input).toMatchObject({ oldLcpSeconds: 4.2, oldA11yViolationsCount: 7, oldStandardsScore: 80 });
      // The score of the page that was published, the same one saved on the MvpProject
      expect(savedStandards()?.score).toEqual(expect.any(Number));
      expect(input.newStandardsScore).toBe(savedStandards().score);
      expect(input).not.toHaveProperty('newScore');
    });

    it('leaves out every value that was not measured, and never shows the MVP as the original', async () => {
      vi.stubGlobal('fetch', vi.fn());
      // An audit whose measurements failed (REV-100) and that was made before the SEO checks (REV-118)
      const beforeRev118 = Object.fromEntries(Object.entries(allChecks).filter(([check]) => check !== 'metaDescription' && check !== 'singleH1'));
      setUpDeploy({ screenshotUrls: {}, webVitals: { cls: 0.1 }, standardsChecks: beforeRev118 });

      await capturedProcessor!({ id: 'job-banner', data: { leadId, auditId: 'audit-1' } });

      const input = bannerInput();
      expect(input.originalMobileBuffer).toBeUndefined();
      expect(input.oldLcpSeconds).toBeUndefined();
      expect(input.oldA11yViolationsCount).toBeUndefined();
      expect(input.oldStandardsScore).toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
    });

    it("shows no original screenshot when it cannot be loaded", async () => {
      for (const fetchMock of [vi.fn().mockResolvedValue(new Response('gone', { status: 404 })), vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))]) {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', fetchMock);
        setUpDeploy({ screenshotUrls: { mobileOriginal: 'http://minio/screens/mobile.webp' } });

        await capturedProcessor!({ id: 'job-banner', data: { leadId, auditId: 'audit-1' } });

        expect(bannerInput().originalMobileBuffer).toBeUndefined();
      }
    });

    it('omits the MVP score when its standards could not be read', async () => {
      vi.stubGlobal('fetch', vi.fn());
      setUpDeploy({ screenshotUrls: {} });
      const standards = await import('../../services/mvp-standards.js');
      vi.spyOn(standards, 'checkMvpStandards').mockImplementation(() => {
        throw new Error('unparsable');
      });

      await capturedProcessor!({ id: 'job-banner', data: { leadId, auditId: 'audit-1' } });

      expect(bannerInput().newStandardsScore).toBeUndefined();
      expect(savedStandards()).toBeUndefined();
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

    vi.mocked(findGenerationAudit).mockResolvedValue(null as any);

    const job = {
      id: 'job-deploy-err2',
      data: {
        leadId: 'lead-1',
        auditId: 'missing-audit',
      },
    };

    await expect(capturedProcessor!(job)).rejects.toThrow('No completed audit found for lead lead-1');
    expect(findGenerationAudit).toHaveBeenCalledWith('lead-1', 'missing-audit');
  });

  describe('relayout jobs (REV-84)', () => {
    const leadId = '64f8a1234567890123456789';
    const auditId = '64f8a9876543210987654321';
    const projectId = '64f8b1112223334445556667';
    const lead = { _id: leadId, businessName: 'Smile Dental', status: 'NEEDS_APPROVAL', toObject: () => lead };
    const audit = { _id: auditId, screenshotUrls: {}, toObject: () => audit };
    const storedCopy = { hero: { headline: 'Stored headline', subheadline: 'Stored sub' }, services: [] };
    const project = (variant: string) => ({
      _id: projectId,
      leadId,
      auditId,
      previewSlug: 'smile-dental-456789',
      generatedContent: storedCopy,
      layout: { variant, reasons: ['rule:manual'] },
    });
    const job = { id: 'job-relayout-1', data: { leadId, auditId, mvpProjectId: projectId, mode: 'relayout' } };

    const setUp = (leadDoc: unknown = lead) => {
      createDeployWorker();
      vi.mocked(Lead.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue(leadDoc) } as any);
      vi.mocked(findGenerationAudit).mockResolvedValue(audit as any);
      vi.mocked(bentoTemplateService.renderFromAudit).mockImplementation(
        (_lead, _audit, _content, layout) => `<html>${layout}</html>`,
      );
      vi.mocked(storageService.uploadHtml).mockResolvedValue({
        url: 'http://localhost:9000/revamp-demos/v/smile-dental-456789/index.html',
        key: 'v/smile-dental-456789/index.html',
      });
      vi.mocked(browserService.captureHtmlScreenshot).mockResolvedValue(Buffer.from('shot'));
      vi.mocked(ImageService.createComparisonBanner).mockResolvedValue(Buffer.from('banner'));
      vi.mocked(storageService.uploadComparisonBanner).mockResolvedValue(
        'http://localhost:9000/revamp-assets/banners/smile-dental-456789.webp',
      );
      vi.mocked(MvpProject.findByIdAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(null) } as any);
    };

    it('re-renders the stored copy in the saved layout into the same slug, without touching the lead', async () => {
      setUp();
      const assess = vi.spyOn(mvpCompletenessService, 'assess');
      vi.mocked(MvpProject.findOne).mockReturnValue({ exec: vi.fn().mockResolvedValue(project('editorial')) } as any);
      vi.mocked(MvpProject.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue(project('editorial')) } as any);

      const result = await capturedProcessor!(job);

      expect(result).toMatchObject({ success: true, relayout: true, layout: 'editorial', mvpProjectId: projectId });
      // Deterministic render of the copy saved on the MVP; the LLM is never involved
      expect(bentoTemplateService.renderFromAudit).toHaveBeenCalledTimes(1);
      expect(bentoTemplateService.renderFromAudit).toHaveBeenCalledWith(lead, audit, storedCopy, 'editorial', { primary: undefined, secondary: undefined, accent: undefined }, undefined);
      expect(findGenerationAudit).toHaveBeenCalledWith(leadId, auditId);
      expect(storageService.uploadHtml).toHaveBeenCalledWith('smile-dental-456789', '<html>editorial</html>', expect.any(String));
      // The banner shows the new look
      expect(browserService.captureHtmlScreenshot).toHaveBeenCalledWith('<html>editorial</html>', expect.any(Object));
      expect(storageService.uploadComparisonBanner).toHaveBeenCalledWith('smile-dental-456789', expect.any(Buffer));
      // No status change, no new generation, no completeness re-check
      expect(Lead.findOneAndUpdate).not.toHaveBeenCalled();
      expect(MvpProject.findOneAndUpdate).not.toHaveBeenCalled();
      expect(assess).not.toHaveBeenCalled();
    });

    it("re-publishes the banner with the new page's standards score, the one written with the summary (REV-126)", async () => {
      setUp();
      vi.mocked(MvpProject.findOne).mockReturnValue({ exec: vi.fn().mockResolvedValue(project('editorial')) } as any);
      vi.mocked(MvpProject.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue(project('editorial')) } as any);

      await capturedProcessor!(job);

      const written = (vi.mocked(MvpProject.findByIdAndUpdate).mock.calls[0]?.[1] as any)?.$set;
      expect(written.standards.score).toEqual(expect.any(Number));
      expect(vi.mocked(ImageService.createComparisonBanner).mock.calls[0]![0]).toMatchObject({
        newStandardsScore: written.standards.score,
        originalMobileBuffer: undefined,
      });
      // The performance is still written in the same update as the standards (REV-119)
      expect(written).toHaveProperty('performance');
    });

    it('publishes Bento for an MVP saved without a layout', async () => {
      setUp();
      const legacy = { ...project('bento'), layout: undefined };
      vi.mocked(MvpProject.findOne).mockReturnValue({ exec: vi.fn().mockResolvedValue(legacy) } as any);
      vi.mocked(MvpProject.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue(legacy) } as any);

      await capturedProcessor!(job);
      expect(bentoTemplateService.renderFromAudit).toHaveBeenCalledWith(lead, audit, storedCopy, 'bento', { primary: undefined, secondary: undefined, accent: undefined }, undefined);
    });

    it('renders the palette the operator saved on the MVP (REV-90)', async () => {
      setUp();
      const recolored = {
        ...project('split'),
        colorPalette: { primary: '#059669', secondary: '#b8c4fe', accent: '#059669' },
      };
      vi.mocked(MvpProject.findOne).mockReturnValue({ exec: vi.fn().mockResolvedValue(recolored) } as any);
      vi.mocked(MvpProject.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue(recolored) } as any);

      await capturedProcessor!(job);

      expect(bentoTemplateService.renderFromAudit).toHaveBeenCalledTimes(1);
      expect(bentoTemplateService.renderFromAudit).toHaveBeenCalledWith(
        lead,
        audit,
        storedCopy,
        'split',
        { primary: '#059669', secondary: '#b8c4fe', accent: '#059669' },
        undefined,
      );
    });

    it('renders the custom design saved on the MVP (REV-92)', async () => {
      setUp();
      const design = { hidden: ['gallery'], theme: { corners: 'sharp' } };
      const designed = { ...project('bento'), design };
      vi.mocked(MvpProject.findOne).mockReturnValue({ exec: vi.fn().mockResolvedValue(designed) } as any);
      vi.mocked(MvpProject.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue(designed) } as any);

      await capturedProcessor!(job);

      expect(vi.mocked(bentoTemplateService.renderFromAudit).mock.calls[0]![5]).toEqual(design);
    });

    it("renders the operator's design over the one derived from the original site (REV-104)", async () => {
      setUp();
      const derived = { ...project('split'), layout: { variant: 'split', reasons: ['rule:derived'], design: { sectionOrder: ['gallery'], hero: { imageSide: 'behind' } } } };
      vi.mocked(MvpProject.findOne).mockReturnValue({ exec: vi.fn().mockResolvedValue({ ...derived, design: { hero: { align: 'left' } } }) } as any);
      vi.mocked(MvpProject.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue({ ...derived, design: { hero: { align: 'left' } } }) } as any);

      await capturedProcessor!(job);

      expect(vi.mocked(bentoTemplateService.renderFromAudit).mock.calls[0]![5]).toEqual({
        sectionOrder: ['gallery'],
        hero: { imageSide: 'behind', align: 'left' },
      });
    });

    it('publishes again when the custom design changed while it was publishing (REV-92)', async () => {
      setUp();
      const withDesign = (corners: string) => ({ ...project('bento'), design: { theme: { corners } } });
      vi.mocked(bentoTemplateService.renderFromAudit).mockImplementation(
        (_lead, _audit, _content, _layout, _palette, design) => `<html>${design?.theme?.corners}</html>`,
      );
      vi.mocked(MvpProject.findOne).mockReturnValue({ exec: vi.fn().mockResolvedValue(withDesign('sharp')) } as any);
      vi.mocked(MvpProject.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue(withDesign('soft')) } as any);

      await capturedProcessor!(job);

      expect(vi.mocked(storageService.uploadHtml).mock.calls.map((call) => call[1])).toEqual([
        '<html>sharp</html>',
        '<html>soft</html>',
      ]);
    });

    it('publishes again when the palette changed while it was publishing (REV-90)', async () => {
      setUp();
      const withPrimary = (primary: string) => ({
        ...project('bento'),
        colorPalette: { primary, secondary: '#b8c4fe', accent: primary },
      });
      vi.mocked(bentoTemplateService.renderFromAudit).mockImplementation(
        (_lead, _audit, _content, layout, palette) => `<html>${layout} ${palette?.primary}</html>`,
      );
      vi.mocked(MvpProject.findOne).mockReturnValue({ exec: vi.fn().mockResolvedValue(withPrimary('#111111')) } as any);
      vi.mocked(MvpProject.findById)
        .mockReturnValueOnce({ exec: vi.fn().mockResolvedValue(withPrimary('#222222')) } as any)
        .mockReturnValue({ exec: vi.fn().mockResolvedValue(withPrimary('#222222')) } as any);

      await capturedProcessor!(job);

      expect(vi.mocked(storageService.uploadHtml).mock.calls.map((call) => call[1])).toEqual([
        '<html>bento #111111</html>',
        '<html>bento #222222</html>',
      ]);
    });

    it('publishes again when the operator switched once more while it was publishing', async () => {
      setUp();
      vi.mocked(MvpProject.findOne).mockReturnValue({ exec: vi.fn().mockResolvedValue(project('split')) } as any);
      vi.mocked(MvpProject.findById)
        .mockReturnValueOnce({ exec: vi.fn().mockResolvedValue(project('compact')) } as any)
        .mockReturnValue({ exec: vi.fn().mockResolvedValue(project('compact')) } as any);

      const result = await capturedProcessor!(job);

      expect(vi.mocked(storageService.uploadHtml).mock.calls.map((call) => call[1])).toEqual([
        '<html>split</html>',
        '<html>compact</html>',
      ]);
      expect(result.layout).toBe('compact');
    });

    it('stops after a bounded number of passes when the layout keeps changing', async () => {
      setUp();
      const variants = ['split', 'compact', 'editorial', 'bento', 'split'];
      vi.mocked(MvpProject.findOne).mockReturnValue({ exec: vi.fn().mockResolvedValue(project('bento')) } as any);
      let call = 0;
      vi.mocked(MvpProject.findById).mockImplementation(
        () => ({ exec: vi.fn().mockResolvedValue(project(variants[call++]!)) }) as any,
      );

      await capturedProcessor!(job);
      expect(storageService.uploadHtml).toHaveBeenCalledTimes(3);
    });

    it.each(['GENERATING', 'SCHEDULED', 'SENT', 'REJECTED'])(
      'skips a lead that is %s: a regeneration or outreach owns the bundle now',
      async (status) => {
        setUp({ ...lead, status });
        const result = await capturedProcessor!(job);
        expect(result).toMatchObject({ success: false, skipped: true });
        expect(MvpProject.findOne).not.toHaveBeenCalled();
        expect(storageService.uploadHtml).not.toHaveBeenCalled();
      },
    );

    it('throws when the lead has no MVP', async () => {
      setUp();
      vi.mocked(MvpProject.findOne).mockReturnValue({ exec: vi.fn().mockResolvedValue(null) } as any);
      await expect(capturedProcessor!(job)).rejects.toThrow(`No MVP found for lead ${leadId}`);
      expect(storageService.uploadHtml).not.toHaveBeenCalled();
    });

    it('never resets the lead when a relayout fails for good', async () => {
      createDeployWorker();
      const onFailed = mockWorkerInstance.on.mock.calls.find(([event]) => event === 'failed')![1];
      vi.mocked(Lead.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(null) } as any);

      onFailed({ ...job, attemptsMade: 3, opts: { attempts: 3 } }, new Error('S3 down'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(Lead.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });
});
