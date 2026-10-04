import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuditWorker } from '../audit.worker.js';
import { Audit } from '../../models/Audit.model.js';
import { Lead } from '../../models/Lead.model.js';
import { AnalyticsEvent } from '../../models/AnalyticsEvent.model.js';
import { browserService } from '../../services/browser.service.js';
import { ImageService } from '../../services/image.service.js';
import { storageService } from '../../services/storage.service.js';
import { designCritiqueService } from '../../services/design-critique.service.js';
import { UnrecoverableError } from 'bullmq';
import { addAiGenerationJob } from '../../queues/ai.queue.js';
import { readPageSections } from '../../services/site-grouping.service.js';
import { readSiteSections } from '../../services/site-sections.service.js';
import type { ISiteSections } from '@revamp/shared-types';

vi.mock('../../models/Audit.model.js');
vi.mock('../../models/Lead.model.js');
vi.mock('../../models/AnalyticsEvent.model.js');
vi.mock('../../services/browser.service.js');
vi.mock('../../services/image.service.js');
vi.mock('../../services/storage.service.js');
vi.mock('../../services/design-critique.service.js');
vi.mock('../../services/site-grouping.service.js', () => ({ readPageSections: vi.fn() }));
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
  class UnrecoverableError extends Error {}
  return {
    UnrecoverableError,
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
    vi.mocked(ImageService.tilesForVision).mockResolvedValue([{ data: Buffer.from('t'), top: 0, bottom: 1800 }]);
    // The rules reading, as when no vision model groups the page (REV-113)
    vi.mocked(readPageSections).mockImplementation(async ({ raw, rawError, layoutBlocks }) => ({
      reading: raw ? readSiteSections(raw, layoutBlocks) : { error: rawError ?? 'No section facts' },
    }));
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
    const mockLeadExec = vi.fn().mockResolvedValue({ contactEmail: 'owner@test-dental.com' });

    vi.spyOn(Audit, 'findOneAndUpdate').mockReturnValue({
      exec: mockAuditExec,
    } as any);

    vi.spyOn(Lead, 'findOneAndUpdate').mockReturnValue({
      exec: mockLeadExec,
    } as any);

    vi.mocked(storageService.ensureBucket).mockResolvedValue(undefined);
    vi.mocked(browserService.captureFullAudit).mockResolvedValue({
      desktopBuffer: Buffer.from('raw-desktop-png'),
      siteLayout: {
        raw: {
          viewportWidth: 1440,
          viewportHeight: 900,
          pageHeight: 4000,
          blocks: [
            { top: 80, height: 700, hint: 'hero', heading: 'Test Dental', imageCount: 1, formCount: 0, mapEmbed: false, quoteCount: 0, priceCount: 0, textLength: 200, paddingY: 100 },
            { top: 780, height: 600, hint: '', heading: 'Our services', imageCount: 0, formCount: 0, mapEmbed: false, quoteCount: 0, priceCount: 0, textLength: 600, paddingY: 100 },
            { top: 1380, height: 500, hint: '', heading: 'Contact', imageCount: 0, formCount: 1, mapEmbed: true, quoteCount: 0, priceCount: 0, textLength: 200, paddingY: 100 },
          ],
          hero: { headingAlign: 'center', headingCenterX: 720, headingWidth: 500, headingColor: 'rgb(0, 0, 0)', background: 'rgb(255, 255, 255)', slider: false, backgroundMedia: false },
          header: { navLinkCount: 4, logoCenterX: 100, sticky: false, hasCta: false },
        },
      },
      siteSections: {
        raw: {
          viewportWidth: 1440,
          viewportHeight: 900,
          blocks: [
            {
              role: 'content', block: 0, box: { top: 80, left: 0, width: 1440, height: 700 },
              intro: { heading: 'Test Dental', headingLevel: 1, text: ['Smiles for everyone.'], links: [] },
              extra: [], images: [], embeds: [],
              style: { background: 'rgb(255, 255, 255)', color: 'rgb(0, 0, 0)', textAlign: 'center', paddingTop: 100, paddingBottom: 100 },
            },
          ],
          typography: {},
          pageChars: 31,
          uncaptured: [],
        },
      },
      mobileBuffer: Buffer.from('raw-mobile-png'),
      desktopFullBuffer: Buffer.from('raw-desktop-full-png'),
      mobileFullBuffer: Buffer.from('raw-mobile-full-png'),
      homeHtml: '<html><body><table><tr><td><table></table></td></tr></table></body></html>',
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
        violations: [
          {
            id: 'image-alt',
            impact: 'critical',
            description: 'Missing alt',
            help: 'Images must have alternate text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
            tags: ['wcag2a'],
            nodeCount: 1,
            nodes: [{ target: 'img', html: '<img src="a.png">' }],
          },
        ],
        errors: [],
      },
      vitalsResult: {
        lcpSeconds: 2.1,
        webVitals: { lcp: 2100, cls: 0.03 },
        standards: { https: true, viewport: true, title: true, favicon: true, structuredData: true, openGraph: true },
        performanceScore: 90,
        standardsScore: 100,
        errors: [],
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
      cookieConsent: { desktop: 'dismissed:cmp:onetrust', mobile: 'dismissed:text' },
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
    // Only a queued lead (or this job's earlier attempt) is audited (REV-62)
    expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'lead-123', status: { $in: ['QUEUED', 'AUDITING'] } },
      { $set: { status: 'AUDITING' }, $unset: { auditError: '' } },
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
        // REV-33: consent handling is stored for debugging
        cookieBannerHandled: { desktop: 'dismissed:cmp:onetrust', mobile: 'dismissed:text' },
        scores: {
          total: 85,
          design: 75,
          performance: 90,
          accessibility: 82,
          standards: 100,
        },
        webVitals: { lcp: 2100, cls: 0.03 },
        // Each standards check and every axe violation are stored with the audit (REV-102)
        standardsChecks: { https: true, viewport: true, title: true, favicon: true, structuredData: true, openGraph: true },
        axeViolations: [
          expect.objectContaining({ id: 'image-alt', impact: 'critical', nodeCount: 1 }),
        ],
        // Everything was measured, so no measurement errors (REV-100)
        measurementErrors: [],
        // The original layout, read from the page and validated (REV-104); no stale error kept
        siteLayout: {
          sections: [
            { kind: 'services', heading: 'Our services' },
            { kind: 'contact', heading: 'Contact' },
          ],
          hero: { media: 'none', align: 'center', tone: 'light' },
          nav: { itemCount: 4, centeredLogo: false, sticky: false, hasCta: false },
          density: 'comfortable',
        },
        // The original sections, read from the page and validated (REV-109); no stale error kept
        siteSections: expect.objectContaining({
          sections: [expect.objectContaining({ index: 0, role: 'hero', arrangement: 'text', intro: expect.objectContaining({ heading: 'Test Dental' }) })],
          coverage: { pageChars: 31, capturedChars: 31, ratio: 1, uncaptured: [] },
        }),
        // The home page HTML was read: the dated-site verdict is stored and no stale error kept (REV-114)
        siteEra: expect.objectContaining({ dated: true, signs: expect.arrayContaining(['table_layout', 'no_viewport']) }),
        $unset: { siteLayoutError: '', siteSectionsError: '', siteSectionsErrorReason: '', siteEraError: '' },
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
        // REV-23: verified contacts and original content are persisted for generation
        extractedContacts: expect.objectContaining({
          phone: '+1 555-1234',
          email: 'info@example.com',
          address: '123 Test St',
          socialLinks: [{ platform: 'telegram', url: 'https://t.me/test' }],
        }),
        extractedContent: expect.objectContaining({ serviceItems: [{ title: 'General Dentistry' }] }),
        // REV-38: no complexity signals were collected, so the class is unknown
        siteComplexity: { class: 'UNKNOWN', reasons: ['signals_unavailable'] },
      }),
      { new: true, sort: { createdAt: -1 } },
    );

    // Lead score and status update
    expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'lead-123', status: 'AUDITING' },
      expect.objectContaining({ status: 'AUDITED',
        totalScore: 85,
        contactPhone: '+1 555-1234',
        siteComplexity: 'UNKNOWN',
        onePageBrochure: false,
      }),
    );
    // The street address is not written into the lead's city (REV-23)
    expect(vi.mocked(Lead.findOneAndUpdate).mock.calls.some((c) => (c[1] as Record<string, unknown>)?.['city'])).toBe(false);
    // A lead with an operator-supplied email keeps it (REV-26)
    expect(vi.mocked(Lead.findOneAndUpdate).mock.calls.some((c) => (c[1] as Record<string, unknown>)?.['contactEmail'])).toBe(false);

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

  it('saves failed measurements as errors, unsets their values and scores the rest (REV-100)', async () => {
    createAuditWorker();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.spyOn(Audit, 'findOneAndUpdate').mockReturnValue({ exec: vi.fn().mockResolvedValue({ _id: 'audit-1' }) } as any);
    vi.spyOn(Lead, 'findOneAndUpdate').mockReturnValue({
      exec: vi.fn().mockResolvedValue({ businessName: 'Broken Page', contactEmail: 'a@b.lt', tags: [] }),
    } as any);
    vi.mocked(storageService.ensureBucket).mockResolvedValue(undefined);
    vi.mocked(browserService.captureFullAudit).mockResolvedValue({
      desktopBuffer: Buffer.from('d'),
      siteLayout: { error: 'Layout not collected in this test' },
      siteSections: { error: 'Sections not collected in this test' },
      mobileBuffer: Buffer.from('m'),
      desktopFullBuffer: Buffer.from('df'),
      mobileFullBuffer: Buffer.from('mf'),
      a11yResult: {
        errors: [{ measurement: 'accessibility', message: 'Target page, context or browser has been closed' }],
      },
      vitalsResult: {
        webVitals: {},
        errors: [
          { measurement: 'performance', message: 'Execution context was destroyed' },
          { measurement: 'standards', message: 'Execution context was destroyed' },
        ],
      },
      rawBrandData: { colors: ['rgb(79, 70, 229)'], fontFamilies: [], socialLinks: [], services: [] },
    } as any);
    vi.mocked(ImageService.compressToWebp).mockResolvedValue(Buffer.from('webp'));
    vi.mocked(ImageService.compressFullPageToWebp).mockResolvedValue(Buffer.from('webp-full'));
    vi.mocked(storageService.uploadScreenshot).mockResolvedValue('http://localhost:9000/shot.webp');
    vi.mocked(designCritiqueService.analyzeDesign).mockResolvedValue({
      critique: {
        visualHierarchyRating: 60,
        mobileFriendlinessRating: 70,
        primaryCtaFound: true,
        datedDesignFactors: [],
        criticalFlaws: [
          { title: 'F1', impact: 'I1', recommendation: 'R1' },
          { title: 'F2', impact: 'I2', recommendation: 'R2' },
          { title: 'F3', impact: 'I3', recommendation: 'R3' },
        ],
        quickWins: ['W1', 'W2', 'W3'],
      },
      aiFallbackUsed: false,
      modelUsed: 'test-model',
      attempts: 1,
    } as any);

    const result = await capturedProcessor!({ id: 'job-partial', data: { leadId: 'lead-partial', url: 'https://broken.lt', niche: 'other' } });

    // The design critique gets no stand-in metrics either
    expect(designCritiqueService.analyzeDesign).toHaveBeenCalledWith(
      expect.objectContaining({ a11yScore: undefined, lcpSeconds: undefined }),
    );

    const completed = vi
      .mocked(Audit.findOneAndUpdate)
      .mock.calls.map((call) => call[1] as Record<string, any>)
      .find((update) => update.status === 'COMPLETED')!;
    // Nothing from the failed scan or the unread standards is stored, and older values are cleared (REV-102)
    expect(completed.$unset).toEqual({
      a11yScore: '',
      lcp: '',
      a11ySummary: '',
      axeViolations: '',
      standardsChecks: '',
      // The original layout was not read either: its reason is stored instead (REV-104)
      siteLayout: '',
      siteSections: '',
      // The page was not read, so there is no model failure to name (REV-132)
      siteSectionsErrorReason: '',
      // No home page HTML was captured, so the verdict is unset (REV-114)
      siteEra: '',
    });
    expect(completed.siteEraError).toBe('home page HTML not read');
    expect(completed).not.toHaveProperty('siteEra');
    expect(completed.siteLayoutError).toBe('Layout not collected in this test');
    // The sections were not read either: the reason is stored and an earlier audit's sections are cleared (REV-109, Review Focus 5)
    expect(completed.siteSectionsError).toBe('Sections not collected in this test');
    expect(completed).not.toHaveProperty('siteSections');
    expect(completed).not.toHaveProperty('axeViolations');
    expect(completed).not.toHaveProperty('standardsChecks');
    expect(completed).not.toHaveProperty('a11yScore');
    expect(completed).not.toHaveProperty('lcp');
    expect(completed).not.toHaveProperty('a11ySummary');
    expect(completed.webVitals).toEqual({});
    // Only the design pillar was measured: total = design = (60 + 70) / 2
    expect(completed.scores).toEqual({ total: 65, design: 65 });
    expect(completed.measurementErrors).toEqual([
      { measurement: 'performance', message: 'Execution context was destroyed' },
      { measurement: 'standards', message: 'Execution context was destroyed' },
      { measurement: 'accessibility', message: 'Target page, context or browser has been closed' },
    ]);

    expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'lead-partial', status: 'AUDITING' },
      expect.objectContaining({ status: 'AUDITED', totalScore: 65 }),
    );
    expect(result).toEqual(expect.objectContaining({ success: true, totalScore: 65, a11yScore: undefined, lcp: undefined }));
    expect(warn).toHaveBeenCalledWith(
      '[AuditWorker] accessibility not measured for lead lead-partial: Target page, context or browser has been closed',
    );
    warn.mockRestore();
  });

  describe('templated design critique (REV-101)', () => {
    const mockCapture = (measured: boolean) => {
      vi.spyOn(Audit, 'findOneAndUpdate').mockReturnValue({ exec: vi.fn().mockResolvedValue({ _id: 'audit-1' }) } as any);
      vi.spyOn(Lead, 'findOneAndUpdate').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ businessName: 'Fallback Clinic', contactEmail: 'a@b.lt', tags: [] }),
      } as any);
      vi.mocked(storageService.ensureBucket).mockResolvedValue(undefined);
      vi.mocked(browserService.captureFullAudit).mockResolvedValue({
        desktopBuffer: Buffer.from('d'),
        siteLayout: { error: 'Layout not collected in this test' },
        siteSections: { error: 'Sections not collected in this test' },
        mobileBuffer: Buffer.from('m'),
        desktopFullBuffer: Buffer.from('df'),
        mobileFullBuffer: Buffer.from('mf'),
        a11yResult: measured
          ? { a11yScore: 60, summary: { violationsCount: 4, contrastIssuesCount: 0, missingAltCount: 0, criticalViolations: [] }, violations: [], errors: [] }
          : { errors: [{ measurement: 'accessibility', message: 'axe failed' }] },
        vitalsResult: measured
          ? { lcpSeconds: 3.2, webVitals: { lcp: 3200 }, performanceScore: 40, standardsScore: 100, errors: [] }
          : {
              webVitals: {},
              errors: [
                { measurement: 'performance', message: 'vitals failed' },
                { measurement: 'standards', message: 'vitals failed' },
              ],
            },
        rawBrandData: { colors: ['rgb(79, 70, 229)'], fontFamilies: [], socialLinks: [], services: [] },
      } as any);
      vi.mocked(ImageService.compressToWebp).mockResolvedValue(Buffer.from('webp'));
      vi.mocked(ImageService.compressFullPageToWebp).mockResolvedValue(Buffer.from('webp-full'));
      vi.mocked(storageService.uploadScreenshot).mockResolvedValue('http://localhost:9000/shot.webp');
      vi.mocked(designCritiqueService.analyzeDesign).mockResolvedValue({
        critique: {
          visualHierarchyRating: 85,
          mobileFriendlinessRating: 85,
          primaryCtaFound: true,
          datedDesignFactors: [],
          criticalFlaws: [
            { title: 'F1', impact: 'I1', recommendation: 'R1' },
            { title: 'F2', impact: 'I2', recommendation: 'R2' },
            { title: 'F3', impact: 'I3', recommendation: 'R3' },
          ],
          quickWins: ['W1', 'W2', 'W3'],
        },
        aiFallbackUsed: true,
        fallbackReason: 'The Vision model (anthropic) gave no valid critique in 3 attempts (last error: overloaded). The critique shown is a template and is not scored',
        modelUsed: 'anthropic-fallback',
        attempts: 3,
      } as any);
    };

    it('leaves the fallback ratings out of the score and lists the design as not measured', async () => {
      createAuditWorker();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockCapture(true);

      const result = await capturedProcessor!({ id: 'job-fb', data: { leadId: 'lead-fb', url: 'https://fb.lt', niche: 'dental' } });

      const completed = vi
        .mocked(Audit.findOneAndUpdate)
        .mock.calls.map((call) => call[1] as Record<string, any>)
        .find((update) => update.status === 'COMPLETED')!;
      // (0.25*40 + 0.20*60 + 0.20*100) / 0.65 = 42 / 0.65 = 64.6 -> 65; the template's 85 is not counted
      expect(completed.scores).toEqual({ total: 65, performance: 40, accessibility: 60, standards: 100 });
      expect(completed.measurementErrors).toEqual([
        { measurement: 'design', message: expect.stringContaining('gave no valid critique in 3 attempts') },
      ]);
      // The template is still saved so the operator can read it, marked by the design measurement error
      expect(completed.designCritique.criticalFlaws).toHaveLength(3);
      expect(completed.aiFallbackUsed).toBe(true);
      expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'lead-fb', status: 'AUDITING' },
        expect.objectContaining({ status: 'AUDITED', totalScore: 65 }),
      );
      expect(result).toEqual(expect.objectContaining({ totalScore: 65 }));
    });

    it('fails the audit when nothing was measured and the critique is a template', async () => {
      createAuditWorker();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockCapture(false);

      await expect(
        capturedProcessor!({ id: 'job-none', data: { leadId: 'lead-none', url: 'https://none.lt', niche: 'other' } }),
      ).rejects.toThrow('No part of the audit could be measured');

      const updates = vi.mocked(Audit.findOneAndUpdate).mock.calls.map((call) => call[1] as Record<string, any>);
      expect(updates.some((update) => update.status === 'COMPLETED')).toBe(false);
      expect(updates).toContainEqual(expect.objectContaining({ status: 'FAILED' }));
      expect(Lead.findOneAndUpdate).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'AUDITED' }),
      );
    });
  });

  it('should replace a guessed email on discovered leads with the email found on the site (REV-26)', async () => {
    createAuditWorker();

    vi.spyOn(Audit, 'findOneAndUpdate').mockReturnValue({ exec: vi.fn().mockResolvedValue({ _id: 'audit-1' }) } as any);
    vi.spyOn(Lead, 'findOneAndUpdate').mockReturnValue({
      exec: vi.fn().mockResolvedValue({
        businessName: 'Found Clinic',
        contactEmail: 'info@found-clinic.lt',
        tags: ['discovered', 'source:osm', 'email-guessed'],
      }),
    } as any);
    vi.mocked(storageService.ensureBucket).mockResolvedValue(undefined);
    vi.mocked(browserService.captureFullAudit).mockResolvedValue({
      desktopBuffer: Buffer.from('d'),
      siteLayout: { error: 'Layout not collected in this test' },
      siteSections: { error: 'Sections not collected in this test' },
      mobileBuffer: Buffer.from('m'),
      desktopFullBuffer: Buffer.from('df'),
      mobileFullBuffer: Buffer.from('mf'),
      a11yResult: {
        a11yScore: 80,
        summary: { violationsCount: 0, contrastIssuesCount: 0, missingAltCount: 0, criticalViolations: [] },
        violations: [],
        errors: [],
      },
      vitalsResult: {
        lcpSeconds: 2,
        webVitals: { lcp: 2000, cls: 0.01 },
        standards: { https: true, viewport: true, title: true, favicon: true, structuredData: true, openGraph: true },
        performanceScore: 90,
        standardsScore: 100,
        errors: [],
      },
      rawBrandData: {
        colors: ['rgb(79, 70, 229)'],
        fontFamilies: ['Inter'],
        email: 'reception@found-clinic.lt',
        socialLinks: [],
        services: [],
      },
    } as any);
    vi.mocked(ImageService.compressToWebp).mockResolvedValue(Buffer.from('webp'));
    vi.mocked(ImageService.compressFullPageToWebp).mockResolvedValue(Buffer.from('webp-full'));
    vi.mocked(storageService.uploadScreenshot).mockResolvedValue('http://localhost:9000/shot.webp');
    vi.mocked(designCritiqueService.analyzeDesign).mockResolvedValue({
      critique: {
        visualHierarchyRating: 60,
        mobileFriendlinessRating: 60,
        primaryCtaFound: false,
        datedDesignFactors: [],
        criticalFlaws: [
          { title: 'F1', impact: 'I1', recommendation: 'R1' },
          { title: 'F2', impact: 'I2', recommendation: 'R2' },
          { title: 'F3', impact: 'I3', recommendation: 'R3' },
        ],
        quickWins: ['W1', 'W2', 'W3'],
      },
      aiFallbackUsed: true,
      modelUsed: 'fallback',
      attempts: 1,
    } as any);

    await capturedProcessor!({ id: 'job-disc', data: { leadId: 'lead-disc', url: 'https://found-clinic.lt', niche: 'dental' } });

    expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'lead-disc', status: 'AUDITING' },
      expect.objectContaining({ status: 'AUDITED',
        contactEmail: 'reception@found-clinic.lt',
        $pull: { tags: 'email-guessed' },
      }),
    );
  });

  it('should fill in the email found on the site for a lead created without one (REV-45)', async () => {
    createAuditWorker();

    vi.spyOn(Audit, 'findOneAndUpdate').mockReturnValue({ exec: vi.fn().mockResolvedValue({ _id: 'audit-1' }) } as any);
    vi.spyOn(Lead, 'findOneAndUpdate').mockReturnValue({
      exec: vi.fn().mockResolvedValue({
        businessName: 'Found Clinic',
        tags: [],
      }),
    } as any);
    vi.mocked(storageService.ensureBucket).mockResolvedValue(undefined);
    vi.mocked(browserService.captureFullAudit).mockResolvedValue({
      desktopBuffer: Buffer.from('d'),
      siteLayout: { error: 'Layout not collected in this test' },
      siteSections: { error: 'Sections not collected in this test' },
      mobileBuffer: Buffer.from('m'),
      desktopFullBuffer: Buffer.from('df'),
      mobileFullBuffer: Buffer.from('mf'),
      a11yResult: {
        a11yScore: 80,
        summary: { violationsCount: 0, contrastIssuesCount: 0, missingAltCount: 0, criticalViolations: [] },
        violations: [],
        errors: [],
      },
      vitalsResult: {
        lcpSeconds: 2,
        webVitals: { lcp: 2000, cls: 0.01 },
        standards: { https: true, viewport: true, title: true, favicon: true, structuredData: true, openGraph: true },
        performanceScore: 90,
        standardsScore: 100,
        errors: [],
      },
      rawBrandData: {
        colors: ['rgb(79, 70, 229)'],
        fontFamilies: ['Inter'],
        email: 'reception@found-clinic.lt',
        socialLinks: [],
        services: [],
      },
    } as any);
    vi.mocked(ImageService.compressToWebp).mockResolvedValue(Buffer.from('webp'));
    vi.mocked(ImageService.compressFullPageToWebp).mockResolvedValue(Buffer.from('webp-full'));
    vi.mocked(storageService.uploadScreenshot).mockResolvedValue('http://localhost:9000/shot.webp');
    vi.mocked(designCritiqueService.analyzeDesign).mockResolvedValue({
      critique: {
        visualHierarchyRating: 60,
        mobileFriendlinessRating: 60,
        primaryCtaFound: false,
        datedDesignFactors: [],
        criticalFlaws: [
          { title: 'F1', impact: 'I1', recommendation: 'R1' },
          { title: 'F2', impact: 'I2', recommendation: 'R2' },
          { title: 'F3', impact: 'I3', recommendation: 'R3' },
        ],
        quickWins: ['W1', 'W2', 'W3'],
      },
      aiFallbackUsed: true,
      modelUsed: 'fallback',
      attempts: 1,
    } as any);

    await capturedProcessor!({ id: 'job-disc', data: { leadId: 'lead-disc', url: 'https://found-clinic.lt', niche: 'dental' } });

    expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'lead-disc', status: 'AUDITING' },
      expect.objectContaining({ status: 'AUDITED', contactEmail: 'reception@found-clinic.lt' }),
    );
    const audited = vi.mocked(Lead.findOneAndUpdate).mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)?.['status'] === 'AUDITED',
    );
    expect(audited?.[1]).not.toHaveProperty('$pull');
  });

  it('should classify site complexity and flag one-page brochure sites on the audit and the lead (REV-38)', async () => {
    createAuditWorker();

    vi.spyOn(Audit, 'findOneAndUpdate').mockReturnValue({ exec: vi.fn().mockResolvedValue({ _id: 'audit-1' }) } as any);
    vi.spyOn(Lead, 'findOneAndUpdate').mockReturnValue({
      exec: vi.fn().mockResolvedValue({ businessName: 'Brochure Dental', contactPhone: '+48 1', tags: [] }),
    } as any);
    vi.mocked(storageService.ensureBucket).mockResolvedValue(undefined);
    vi.mocked(browserService.captureFullAudit).mockResolvedValue({
      desktopBuffer: Buffer.from('d'),
      siteLayout: { error: 'Layout not collected in this test' },
      siteSections: { error: 'Sections not collected in this test' },
      mobileBuffer: Buffer.from('m'),
      desktopFullBuffer: Buffer.from('df'),
      mobileFullBuffer: Buffer.from('mf'),
      a11yResult: {
        a11yScore: 80,
        summary: { violationsCount: 0, contrastIssuesCount: 0, missingAltCount: 0, criticalViolations: [] },
        violations: [],
        errors: [],
      },
      vitalsResult: {
        lcpSeconds: 2,
        webVitals: { lcp: 2000, cls: 0.01 },
        standards: { https: true, viewport: true, title: true, favicon: true, structuredData: true, openGraph: true },
        performanceScore: 90,
        standardsScore: 100,
        errors: [],
      },
      rawBrandData: { colors: ['rgb(79, 70, 229)'], fontFamilies: ['Inter'], socialLinks: [], services: [] },
      complexitySignals: {
        pageUrl: 'https://brochure-dental.pl/',
        links: [
          'https://brochure-dental.pl/#services',
          'https://brochure-dental.pl/#contact',
          'tel:+48123456789',
          'https://brochure-dental.pl/polityka-prywatnosci',
          'https://facebook.com/brochure-dental',
        ],
        hasEcommerce: false,
        hasBooking: false,
        hasLogin: false,
        hasSearch: false,
        hasAppShell: false,
        sectionCount: 6,
        pageHeight: 5200,
      },
    } as any);
    vi.mocked(ImageService.compressToWebp).mockResolvedValue(Buffer.from('webp'));
    vi.mocked(ImageService.compressFullPageToWebp).mockResolvedValue(Buffer.from('webp-full'));
    vi.mocked(storageService.uploadScreenshot).mockResolvedValue('http://localhost:9000/shot.webp');
    vi.mocked(designCritiqueService.analyzeDesign).mockResolvedValue({
      critique: {
        visualHierarchyRating: 60,
        mobileFriendlinessRating: 60,
        primaryCtaFound: false,
        datedDesignFactors: [],
        criticalFlaws: [
          { title: 'F1', impact: 'I1', recommendation: 'R1' },
          { title: 'F2', impact: 'I2', recommendation: 'R2' },
          { title: 'F3', impact: 'I3', recommendation: 'R3' },
        ],
        quickWins: ['W1', 'W2', 'W3'],
      },
      aiFallbackUsed: true,
      modelUsed: 'fallback',
      attempts: 1,
    } as any);

    const result = await capturedProcessor!({
      id: 'job-brochure',
      data: { leadId: 'lead-brochure', url: 'https://brochure-dental.pl', niche: 'dental' },
    });

    expect(Audit.findOneAndUpdate).toHaveBeenCalledWith(
      { leadId: 'lead-brochure' },
      expect.objectContaining({
        status: 'COMPLETED',
        siteComplexity: expect.objectContaining({
          class: 'ONE_PAGE_BROCHURE',
          signals: expect.objectContaining({ internalPageCount: 0, sectionCount: 6, pageHeight: 5200 }),
        }),
      }),
      { new: true, sort: { createdAt: -1 } },
    );
    expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'lead-brochure', status: 'AUDITING' },
      expect.objectContaining({ status: 'AUDITED',
        siteComplexity: 'ONE_PAGE_BROCHURE',
        onePageBrochure: true,
      }),
    );
    expect(result.siteComplexity.class).toBe('ONE_PAGE_BROCHURE');
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

    vi.spyOn(Lead, 'findOneAndUpdate').mockReturnValue({
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

  describe('failed audits (REV-44)', () => {
    const failingJob = (error: Error, attemptsMade: number, attempts = 3) => {
      createAuditWorker();
      vi.spyOn(Audit, 'findOneAndUpdate').mockReturnValue({ exec: vi.fn().mockResolvedValue({}) } as any);
            vi.spyOn(Lead, 'findOneAndUpdate').mockReturnValue({ exec: vi.fn().mockResolvedValue({}) } as any);
      vi.mocked(storageService.ensureBucket).mockResolvedValue(undefined);
      vi.mocked(browserService.captureFullAudit).mockRejectedValue(error);
      return {
        id: 'job-fail',
        data: { leadId: 'lead-fail', url: 'https://broken.example', niche: 'dental' },
        attemptsMade,
        opts: { attempts },
      };
    };

    it('keeps the lead in AUDITING while a transient failure still has retries left', async () => {
      const job = failingJob(new Error('page.goto: Timeout 30000ms exceeded.'), 0);

      const error = await capturedProcessor!(job).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(UnrecoverableError);
      expect(Lead.findOneAndUpdate).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ $set: expect.objectContaining({ status: 'AUDIT_FAILED' }) }),
      );
      expect(Audit.findOneAndUpdate).toHaveBeenCalledWith(
        { leadId: 'lead-fail' },
        { status: 'FAILED', errorMessage: 'page.goto: Timeout 30000ms exceeded.' },
        { sort: { createdAt: -1 } },
      );
    });

    it('marks the lead AUDIT_FAILED with a one-line reason after the last attempt', async () => {
      const crash = new Error(
        'browserContext.close: Target page, context or browser has been closed\nBrowser logs:\n\n<launching> /chromium --headless',
      );
      const job = failingJob(crash, 2);

      await expect(capturedProcessor!(job)).rejects.toBe(crash);

      const reason = 'browserContext.close: Target page, context or browser has been closed';
      expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'lead-fail', status: { $in: ['AUDITING'] } },
        { $set: { status: 'AUDIT_FAILED', auditError: reason } },
      );
      expect(Audit.findOneAndUpdate).toHaveBeenCalledWith(
        { leadId: 'lead-fail' },
        { status: 'FAILED', errorMessage: reason },
        { sort: { createdAt: -1 } },
      );
    });

    it('fails a permanent navigation error at once, without retries, and strips ANSI codes', async () => {
      const job = failingJob(
        new Error('page.goto: net::ERR_NAME_NOT_RESOLVED at https://ekomyj.com/\nCall log:\n\x1B[2m  - navigating to "https://ekomyj.com/"\x1B[22m'),
        0,
      );

      const error = await capturedProcessor!(job).catch((err: unknown) => err);

      const reason = 'page.goto: net::ERR_NAME_NOT_RESOLVED at https://ekomyj.com/';
      expect(error).toBeInstanceOf(UnrecoverableError);
      expect((error as Error).message).toBe(reason);
      expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'lead-fail', status: { $in: ['AUDITING'] } },
        { $set: { status: 'AUDIT_FAILED', auditError: reason } },
      );
    });
  });

  describe('lead status guards (REV-62)', () => {
    it('skips a lead that is no longer queued, without crawling it', async () => {
      createAuditWorker();
      vi.spyOn(Lead, 'findOneAndUpdate').mockReturnValue({ exec: vi.fn().mockResolvedValue(null) } as any);
      vi.spyOn(Audit, 'findOneAndUpdate').mockReturnValue({ exec: vi.fn().mockResolvedValue({}) } as any);

      const result = await capturedProcessor!({ id: 'job-x', data: { leadId: 'lead-x', url: 'https://x.example', niche: 'dental' } });

      expect(result).toMatchObject({ success: false, skipped: true, leadId: 'lead-x' });
      expect(browserService.captureFullAudit).not.toHaveBeenCalled();
      expect(Audit.findOneAndUpdate).toHaveBeenCalledWith(
        { leadId: 'lead-x' },
        { status: 'FAILED', errorMessage: expect.stringContaining('no longer waiting for an audit') },
        { sort: { createdAt: -1 } },
      );
    });

    it('does not mark AUDITED or start generation for a lead rejected during the audit', async () => {
      createAuditWorker();
      vi.spyOn(Audit, 'findOneAndUpdate').mockReturnValue({ exec: vi.fn().mockResolvedValue({ _id: 'audit-1' }) } as any);
      vi.spyOn(Lead, 'findOneAndUpdate')
        .mockReturnValueOnce({ exec: vi.fn().mockResolvedValue({ businessName: 'Found Clinic', tags: [] }) } as any)
        .mockReturnValueOnce({ exec: vi.fn().mockResolvedValue(null) } as any);
      vi.mocked(storageService.ensureBucket).mockResolvedValue(undefined);
      vi.mocked(browserService.captureFullAudit).mockResolvedValue({
        desktopBuffer: Buffer.from('d'),
        siteLayout: { error: 'Layout not collected in this test' },
        siteSections: { error: 'Sections not collected in this test' },
        mobileBuffer: Buffer.from('m'),
        desktopFullBuffer: Buffer.from('df'),
        mobileFullBuffer: Buffer.from('mf'),
        a11yResult: {
          a11yScore: 80,
          summary: { violationsCount: 0, contrastIssuesCount: 0, missingAltCount: 0, criticalViolations: [] },
          violations: [],
          errors: [],
        },
        vitalsResult: {
          lcpSeconds: 2,
          webVitals: { lcp: 2000, cls: 0.01 },
          standards: { https: true, viewport: true, title: true, favicon: true, structuredData: true, openGraph: true },
          performanceScore: 90,
          standardsScore: 100,
          errors: [],
        },
        rawBrandData: {
          colors: ['rgb(79, 70, 229)'],
          fontFamilies: ['Inter'],
          email: 'reception@found-clinic.lt',
          socialLinks: [],
          services: [],
        },
      } as any);
      vi.mocked(ImageService.compressToWebp).mockResolvedValue(Buffer.from('webp'));
      vi.mocked(ImageService.compressFullPageToWebp).mockResolvedValue(Buffer.from('webp-full'));
      vi.mocked(storageService.uploadScreenshot).mockResolvedValue('http://localhost:9000/shot.webp');
      vi.mocked(designCritiqueService.analyzeDesign).mockResolvedValue({
        critique: {
          visualHierarchyRating: 60,
          mobileFriendlinessRating: 60,
          primaryCtaFound: false,
          datedDesignFactors: [],
          criticalFlaws: [
            { title: 'F1', impact: 'I1', recommendation: 'R1' },
            { title: 'F2', impact: 'I2', recommendation: 'R2' },
            { title: 'F3', impact: 'I3', recommendation: 'R3' },
          ],
          quickWins: ['W1', 'W2', 'W3'],
        },
        aiFallbackUsed: true,
        modelUsed: 'fallback',
        attempts: 1,
      } as any);


      const result = await capturedProcessor!({ id: 'job-disc', data: { leadId: 'lead-disc', url: 'https://found-clinic.lt', niche: 'dental' } });

      expect(result.success).toBe(true);
      expect(Lead.findOneAndUpdate).toHaveBeenLastCalledWith(
        { _id: 'lead-disc', status: 'AUDITING' },
        expect.objectContaining({ status: 'AUDITED' }),
      );
      expect(addAiGenerationJob).not.toHaveBeenCalled();
    });
  });

  describe('section grouping by the vision model (REV-113)', () => {
    const llmReading: ISiteSections = {
      sections: [
        {
          index: 0,
          role: 'hero',
          kind: 'other',
          arrangement: 'text',
          intro: { heading: 'Gabinet', headingLevel: 1, text: ['Witamy.'], links: [] },
          items: [],
          extra: [],
          images: [],
          embeds: [],
          style: {},
        },
      ],
      skipped: [],
      coverage: { pageChars: 14, capturedChars: 14, ratio: 1, uncaptured: [] },
      source: 'llm',
    } as unknown as ISiteSections;

    const runJob = async () => {
      createAuditWorker();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(Audit, 'findOneAndUpdate').mockReturnValue({ exec: vi.fn().mockResolvedValue({ _id: 'audit-1' }) } as any);
      vi.spyOn(Lead, 'findOneAndUpdate').mockReturnValue({ exec: vi.fn().mockResolvedValue({ businessName: 'Gabinet', contactEmail: 'a@b.pl', tags: [] }) } as any);
      vi.mocked(storageService.ensureBucket).mockResolvedValue(undefined);
      vi.mocked(browserService.captureFullAudit).mockResolvedValue({
        desktopBuffer: Buffer.from('d'),
        siteLayout: { error: 'Layout not collected in this test' },
        siteSections: { raw: { viewportWidth: 1440, viewportHeight: 900, blocks: [], typography: {}, pageChars: 14, uncaptured: [] } },
        homeHtml: '<html><head><meta name="viewport" content="width=device-width"></head><body><p>Gabinet</p></body></html>',
        mobileBuffer: Buffer.from('m'),
        desktopFullBuffer: Buffer.from('df'),
        mobileFullBuffer: Buffer.from('mf'),
        a11yResult: { a11yScore: 90, errors: [] },
        vitalsResult: { webVitals: {}, errors: [], performanceScore: 80, standardsScore: 70 },
        rawBrandData: { colors: ['rgb(79, 70, 229)'], fontFamilies: [], socialLinks: [], services: [] },
      } as any);
      vi.mocked(ImageService.compressToWebp).mockResolvedValue(Buffer.from('webp'));
      vi.mocked(ImageService.compressFullPageToWebp).mockResolvedValue(Buffer.from('webp-full'));
      vi.mocked(storageService.uploadScreenshot).mockResolvedValue('http://localhost:9000/shot.webp');
      vi.mocked(designCritiqueService.analyzeDesign).mockResolvedValue({
        critique: { visualHierarchyRating: 60, mobileFriendlinessRating: 70, primaryCtaFound: true, datedDesignFactors: [], criticalFlaws: [], quickWins: [] },
        aiFallbackUsed: false,
        modelUsed: 'test-model',
        attempts: 1,
      } as any);
      await capturedProcessor!({ id: 'job-sections', data: { leadId: 'lead-sections', url: 'https://example.com', niche: 'dental' } });
      return vi
        .mocked(Audit.findOneAndUpdate)
        .mock.calls.map((call) => call[1] as Record<string, any>)
        .find((update) => update.status === 'COMPLETED')!;
    };

    it('stores the model-grouped sections and logs the grouping tokens', async () => {
      vi.mocked(readPageSections).mockResolvedValue({
        reading: { sections: llmReading },
        modelUsed: 'stub',
        usage: { promptTokens: 20000, completionTokens: 900, totalTokens: 20900 },
      });
      const completed = await runJob();
      expect(ImageService.tilesForVision).toHaveBeenCalledWith(Buffer.from('df'));
      expect(readPageSections).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://example.com', niche: 'dental', tiles: [expect.objectContaining({ top: 0 })], layoutBlocks: [] }),
      );
      expect((completed.siteSections as ISiteSections).source).toBe('llm');
      expect(completed.measurementErrors).toEqual([]);
      expect(AnalyticsEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          leadId: 'lead-sections',
          eventType: 'token_usage',
          metadata: expect.objectContaining({ model: 'stub', stage: 'audit_section_grouping', totalTokens: 20900 }),
        }),
      );
    });

    it('stores the model failure with its reason and no sections, never the rules reading (REV-132)', async () => {
      for (const reason of ['not_configured', 'call_failed', 'invalid_answer', 'ineligible'] as const) {
        vi.mocked(Audit.findOneAndUpdate).mockClear();
        vi.mocked(readPageSections).mockResolvedValue({
          reading: { error: `Grouping failed: ${reason}` },
          reason,
          measurementError: { measurement: 'sections', message: `Grouping failed: ${reason}` },
        });
        const completed = await runJob();
        expect(completed).not.toHaveProperty('siteSections');
        expect(completed.$unset).toEqual(expect.objectContaining({ siteSections: '' }));
        expect(completed.siteSectionsError).toBe(`Grouping failed: ${reason}`);
        expect(completed.siteSectionsErrorReason).toBe(reason);
        expect(completed.measurementErrors).toContainEqual({ measurement: 'sections', message: `Grouping failed: ${reason}` });
        // The grouping is not scored
        expect(completed.scores).toEqual(expect.objectContaining({ total: expect.any(Number), design: 65 }));
      }
    });

    it("reads the dated site's body font from the page, not from the model's sections (REV-132)", async () => {
      vi.mocked(readPageSections).mockResolvedValue({
        reading: { error: 'No vision model' },
        reason: 'not_configured',
        measurementError: { measurement: 'sections', message: 'No vision model' },
        typography: { heading: { family: 'Times New Roman', size: 24, weight: 700, uppercase: false }, body: { family: 'Times New Roman', size: 16, weight: 400 } },
      });
      const completed = await runJob();
      expect(completed.siteEra.signs).toContain('default_font');
    });

    it("clears an earlier audit's grouping failure when the model groups the page (REV-132)", async () => {
      vi.mocked(readPageSections).mockResolvedValue({ reading: { sections: llmReading } });
      const completed = await runJob();
      expect(completed).not.toHaveProperty('siteSectionsErrorReason');
      expect(completed.$unset).toEqual(expect.objectContaining({ siteSectionsError: '', siteSectionsErrorReason: '' }));
    });

    it('still groups the page from the outline when the screenshot cannot be cut into tiles', async () => {
      vi.mocked(ImageService.tilesForVision).mockRejectedValue(new Error('bad png'));
      await runJob();
      expect(readPageSections).toHaveBeenCalledWith(expect.objectContaining({ tiles: [] }));
    });
  });
});
