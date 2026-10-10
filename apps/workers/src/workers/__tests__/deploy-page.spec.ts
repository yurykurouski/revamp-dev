import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDeployWorker, republishSavedMvp } from '../deploy.worker.js';
import { processMvpEditJob } from '../mvp-edit.worker.js';
import { Lead } from '../../models/Lead.model.js';
import { Audit } from '../../models/Audit.model.js';
import { findGenerationAudit } from '../../services/audit-lookup.js';
import { MvpProject } from '../../models/MvpProject.model.js';
import { storageService } from '../../services/storage.service.js';
import { browserService } from '../../services/browser.service.js';
import { ImageService } from '../../services/image.service.js';
import { mvpCompletenessService } from '../../services/mvp-completeness.service.js';
import { measureMvpPerformance } from '../../services/mvp-performance.js';
import { VALID } from '../../services/__tests__/fixtures/page-gen/page.js';

vi.mock('../../models/Lead.model.js');
vi.mock('../../models/Audit.model.js');
vi.mock('../../services/audit-lookup.js');
vi.mock('../../models/MvpProject.model.js');
vi.mock('../../services/storage.service.js');
vi.mock('../../services/browser.service.js');
vi.mock('../../services/image.service.js');
vi.mock('../../services/mvp-completeness.service.js');
vi.mock('../../services/mvp-performance.js');
vi.mock('../../queues/connection.js', () => ({ redisConnection: {} as any }));

let capturedProcessor: ((job: any) => Promise<any>) | null = null;
vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(function (_queue: string, processor: any) {
    capturedProcessor = processor;
    return { on: vi.fn(), close: vi.fn() };
  }),
  UnrecoverableError: class UnrecoverableError extends Error {
    constructor(message?: string) {
      super(message);
      // As bullmq does: a subclass is named after itself
      this.name = this.constructor.name;
    }
  },
}));

const LEAD_ID = '64f8a1234567890123456789';
const AUDIT_ID = '64f8a9876543210987654321';
const SLUG = 'falco-dent-456789';
const THEME = { primary: '#0a5c8a', accent: '#f2a900', bg: '#ffffff', surface: '#f5f7fa', text: '#111111', fontHeading: 'serif', fontBody: 'sans-serif' };
const GROUNDING = [{ kind: 'number', text: '15', context: 'Ponad 15 lat' }];

const lead = { _id: LEAD_ID, businessName: 'Falco-Dent', domain: 'falco-dent.pl', niche: 'dental', status: 'GENERATING', originalUrl: 'https://falco-dent.pl', toObject: () => lead };
const audit = {
  _id: AUDIT_ID,
  extractedContacts: { phone: '+48 600 100 200', address: 'ul. Długa 5, Kraków', socialLinks: [] },
  extractedServices: ['Implanty'],
  extractedBrandTokens: { primaryColor: '#0a5c8a', secondaryColor: '#ffffff', accentColor: '#f2a900', fontFamilies: [], logoUrl: 'https://falco-dent.pl/logo.png' },
  extractedContent: { language: 'pl', metaDescription: 'Gabinet stomatologiczny w Krakowie', headings: [], paragraphs: [], serviceItems: [], navItems: [], testimonials: [], images: ['https://falco-dent.pl/a.jpg'] },
  screenshotUrls: { desktopOriginal: 'http://s3/d.webp', mobileOriginal: 'http://s3/m.webp' },
  webVitals: { lcp: 3500 },
  toObject: () => audit,
};

const version = (n: number, extra: Record<string, unknown> = {}) => ({ n, kind: 'generate', storagePath: `v/${SLUG}/versions/${n}.html`, createdAt: new Date('2026-10-01'), ...extra });
const job = (data: Record<string, unknown> = {}) => ({
  id: 'job-1',
  data: {
    leadId: LEAD_ID,
    auditId: AUDIT_ID,
    page: { id: 'page-a', html: VALID, theme: THEME, grounding: GROUNDING, kind: 'generate' },
    generationSource: { provider: 'claude-cli', modelUsed: 'claude-cli:sonnet' },
    ...data,
  },
});

let existing: Record<string, unknown> | null;
const leadUpdate = vi.fn();

function arrange() {
  vi.mocked(Lead.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue(lead) } as any);
  vi.mocked(Lead.findOneAndUpdate).mockImplementation(((...args: unknown[]) => ({ exec: vi.fn().mockResolvedValue(leadUpdate(...args)) })) as any);
  leadUpdate.mockReturnValue(lead);
  vi.mocked(findGenerationAudit).mockResolvedValue(audit as any);
  vi.mocked(Audit.findByIdAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(audit) } as any);
  vi.mocked(MvpProject.findOne).mockReturnValue({ select: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(existing) }) } as any);
  vi.mocked(MvpProject.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue({ _id: 'mvp-1' }) } as any);
  vi.mocked(storageService.uploadPageVersion).mockImplementation(async (slug: string, n: number) => `v/${slug}/versions/${n}.html`);
  vi.mocked(storageService.uploadHtml).mockResolvedValue({ url: `http://s3/revamp-demos/v/${SLUG}/index.html`, key: `v/${SLUG}/index.html` });
  vi.mocked(storageService.uploadComparisonBanner).mockResolvedValue('http://s3/banner.webp');
  vi.mocked(storageService.deleteObject).mockResolvedValue(undefined);
  vi.mocked(browserService.captureHtmlScreenshot).mockResolvedValue(Buffer.from('png'));
  vi.mocked(ImageService.createComparisonBanner).mockResolvedValue(Buffer.from('banner'));
  vi.mocked(mvpCompletenessService.assess).mockResolvedValue({ status: 'verified', checks: [] } as any);
  vi.mocked(measureMvpPerformance).mockResolvedValue({ host: 's3', webVitals: { lcp: 900, cls: 0 } } as any);
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any;
}

const projectUpdate = () => vi.mocked(MvpProject.findOneAndUpdate).mock.calls[0]![1] as Record<string, any>;

describe('DeployWorker publishes the model-designed page (REV-138)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existing = { previewSlug: SLUG, versions: [] };
    createDeployWorker();
    arrange();
  });

  it('stores the raw page as version 1, publishes the finished page and writes the project in one update', async () => {
    const result = await capturedProcessor!(job());

    expect(storageService.uploadPageVersion).toHaveBeenCalledWith(SLUG, 1, VALID);
    const published = vi.mocked(storageService.uploadHtml).mock.calls[0]![1];
    expect(published).toContain('tel:+48600100200');
    expect(published).not.toContain('{{');
    expect(published).toContain('id="booking"');
    expect(vi.mocked(storageService.uploadPageVersion).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(storageService.uploadHtml).mock.invocationCallOrder[0]!);

    expect(MvpProject.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(MvpProject.findOneAndUpdate).mock.calls[0]![0]).toEqual({ leadId: LEAD_ID });
    const update = projectUpdate();
    expect(update.$set).toMatchObject({
      page: VALID,
      theme: THEME,
      grounding: GROUNDING,
      previewSlug: SLUG,
      fullPreviewUrl: `http://s3/revamp-demos/v/${SLUG}/index.html`,
      comparisonBannerUrl: 'http://s3/banner.webp',
      isPublished: true,
      provider: 'claude-cli',
      modelUsed: 'claude-cli:sonnet',
      performance: { host: 's3', webVitals: { lcp: 900, cls: 0 } },
      completenessReport: { status: 'verified', checks: [] },
    });
    expect(update.$set.standards.score).toBeGreaterThan(0);
    expect(update.$push).toEqual({
      versions: {
        $each: [expect.objectContaining({ n: 1, kind: 'generate', jobId: 'page-a', provider: 'claude-cli', model: 'claude-cli:sonnet', storagePath: `v/${SLUG}/versions/1.html` })],
        $slice: -20,
      },
    });
    expect(update.$inc).toEqual({ generationCount: 1 });
    expect(Object.keys(update.$unset)).toEqual(
      expect.arrayContaining(['generatedContent', 'colorPalette', 'layout', 'design', 'rebuild', 'rebuildEdit', 'modernize', 'renderFailure', 'controls', 'editedAt', 'requestedProvider', 'requestedModel']),
    );

    const [filter, leadSet] = leadUpdate.mock.calls[0]!;
    expect(filter).toMatchObject({ _id: LEAD_ID, status: { $in: expect.arrayContaining(['GENERATING']) } });
    expect(leadSet).toMatchObject({ $set: { status: 'NEEDS_APPROVAL' }, $unset: { generationError: '', generationFailure: '' } });
    expect(result).toMatchObject({ success: true, version: 1 });
  });

  it('numbers the next version after the highest stored one and drops the oldest past 20, deleting its file', async () => {
    existing = { previewSlug: SLUG, versions: Array.from({ length: 20 }, (_, i) => version(i + 3)) };
    arrange();
    await capturedProcessor!(job());
    expect(storageService.uploadPageVersion).toHaveBeenCalledWith(SLUG, 23, VALID);
    expect(projectUpdate().$push.versions.$slice).toBe(-20);
    expect(storageService.deleteObject).toHaveBeenCalledTimes(1);
    expect(storageService.deleteObject).toHaveBeenCalledWith(`v/${SLUG}/versions/3.html`);
  });

  it('still publishes when the old file cannot be deleted', async () => {
    existing = { previewSlug: SLUG, versions: Array.from({ length: 20 }, (_, i) => version(i + 1)) };
    arrange();
    vi.mocked(storageService.deleteObject).mockRejectedValue(new Error('S3 down'));
    await expect(capturedProcessor!(job())).resolves.toMatchObject({ success: true });
  });

  it('reuses the version a retried job already stored, instead of adding another', async () => {
    existing = { previewSlug: SLUG, versions: [version(1), version(2, { jobId: 'page-a' })] };
    arrange();
    await capturedProcessor!(job());
    expect(storageService.uploadPageVersion).toHaveBeenCalledWith(SLUG, 2, VALID);
    expect(projectUpdate().$push).toBeUndefined();
    expect(projectUpdate().$inc).toBeUndefined();
    expect(storageService.deleteObject).not.toHaveBeenCalled();
  });

  it('takes a version stored by another page with the same BullMQ id (Redis reset) as a new version (review)', async () => {
    existing = { previewSlug: SLUG, versions: [version(1, { jobId: 'job-1' })] };
    arrange();
    await capturedProcessor!(job());
    expect(storageService.uploadPageVersion).toHaveBeenCalledWith(SLUG, 2, VALID);
    expect(projectUpdate().$push.versions.$each[0]).toMatchObject({ n: 2, jobId: 'page-a' });
  });

  it('deletes only files no kept version references, as Mongo kept them (review)', async () => {
    existing = { previewSlug: SLUG, versions: Array.from({ length: 20 }, (_, i) => version(i + 1)) };
    arrange();
    // Another deploy pushed meanwhile: Mongo kept 3..20, the other's 21 and this 22; version 2's file is still referenced
    const kept = [...Array.from({ length: 18 }, (_, i) => version(i + 3)), version(21), version(22, { jobId: 'page-a' })];
    vi.mocked(MvpProject.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue({ _id: 'mvp-1', versions: kept }) } as any);
    await capturedProcessor!(job());
    expect(vi.mocked(storageService.deleteObject).mock.calls.map((c) => c[0]).sort()).toEqual([`v/${SLUG}/versions/1.html`, `v/${SLUG}/versions/2.html`]);
  });

  it("leaves a lead that was rejected meanwhile, and its MVP, untouched", async () => {
    vi.mocked(Lead.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue({ ...lead, status: 'REJECTED' }) } as any);
    const result = await capturedProcessor!(job());
    expect(result).toMatchObject({ success: false, skipped: true });
    expect(storageService.uploadHtml).not.toHaveBeenCalled();
    expect(MvpProject.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('starts a new slug for a lead without an MVP', async () => {
    existing = null;
    arrange();
    await capturedProcessor!(job());
    expect(vi.mocked(storageService.uploadPageVersion).mock.calls[0]![0]).toMatch(/^falco-dent-456789$/);
  });
});

describe('the old layout tools refuse a model-designed MVP (REV-138)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arrange();
  });

  it('relayout leaves the page published and says why', async () => {
    vi.mocked(Lead.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue({ ...lead, status: 'NEEDS_APPROVAL' }) } as any);
    vi.mocked(MvpProject.findOne).mockReturnValue({ exec: vi.fn().mockResolvedValue({ _id: 'mvp-1', page: VALID }) } as any);
    await expect(republishSavedMvp(LEAD_ID)).rejects.toThrow('designed by the model');
    expect(storageService.uploadHtml).not.toHaveBeenCalled();
  });

  it('the free-text change worker refuses it', async () => {
    vi.mocked(MvpProject.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue({ _id: 'mvp-1', leadId: LEAD_ID, page: VALID }) } as any);
    vi.mocked(Lead.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue({ ...lead, status: 'NEEDS_APPROVAL' }) } as any);
    await expect(processMvpEditJob({ mvpProjectId: 'mvp-1', action: 'edit', instruction: 'x', deadline: Date.now() + 60_000 } as any)).rejects.toThrow('designed by the model');
  });
});
