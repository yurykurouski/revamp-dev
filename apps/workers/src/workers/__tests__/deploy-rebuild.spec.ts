import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ISiteSections } from '@revamp/shared-types';
import { createDeployWorker, republishSavedMvp } from '../deploy.worker.js';
import { Lead } from '../../models/Lead.model.js';
import { Audit } from '../../models/Audit.model.js';
import { findGenerationAudit } from '../../services/audit-lookup.js';
import { MvpProject } from '../../models/MvpProject.model.js';
import { bentoTemplateService } from '../../services/template.service.js';
import { RebuildUnavailable, rebuildTemplateService } from '../../services/rebuild-template.service.js';
import { storageService } from '../../services/storage.service.js';
import { browserService } from '../../services/browser.service.js';
import { ImageService } from '../../services/image.service.js';

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
vi.mock('../../services/rebuild-template.service.js', async (orig) => ({
  ...(await orig<typeof import('../../services/rebuild-template.service.js')>()),
  rebuildTemplateService: { renderFromAudit: vi.fn() },
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

const leadId = '64f8a1234567890123456789';
const auditId = '64f8a9876543210987654321';
const projectId = '64f8b1112223334445556667';

const sectionsFixture: ISiteSections = {
  sections: [
    {
      index: 1,
      role: 'hero',
      kind: 'other',
      arrangement: 'banner',
      intro: { heading: 'Witamy', text: ['Tekst'], links: [] },
      items: [],
      extra: [],
      images: [],
      embeds: [],
      style: {},
    },
  ],
  typography: {
    heading: { family: 'Lato', size: 32, weight: 700, uppercase: false },
    body: { family: 'Lato', size: 16, weight: 400 },
    button: { radius: 4, filled: true, uppercase: false, background: '#c2185b' },
  },
  skipped: [],
  coverage: { pageChars: 100, capturedChars: 98, ratio: 0.98, uncaptured: [] },
};

const lead = { _id: leadId, businessName: 'Falco-Dent', domain: 'falcodent.pl', niche: 'dental', status: 'NEEDS_APPROVAL', toObject: () => lead };

const publishMocks = () => {
  vi.mocked(storageService.uploadHtml).mockResolvedValue({ url: 'http://minio/v/falco/index.html', key: 'v/falco/index.html' });
  vi.mocked(browserService.captureHtmlScreenshot).mockResolvedValue(Buffer.from('shot'));
  vi.mocked(ImageService.createComparisonBanner).mockResolvedValue(Buffer.from('banner'));
  vi.mocked(storageService.uploadComparisonBanner).mockResolvedValue('http://minio/banners/falco.webp');
};

/** Runs a fresh deploy job for an audit with the given fields */
const runDeploy = async (auditOver: Record<string, unknown>) => {
  createDeployWorker();
  const audit: Record<string, unknown> = {
    _id: auditId,
    leadId,
    extractedBrandTokens: { primaryColor: '#4f46e5', secondaryColor: '#e0e7ff', accentColor: '#4f46e5' },
    generatedContent: { hero: { headline: 'Uśmiech' }, services: [], trustSignals: [], offerNotice: '' },
    ...auditOver,
    toObject: () => audit,
  };
  vi.mocked(Lead.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue(lead) } as any);
  vi.mocked(findGenerationAudit).mockResolvedValue(audit as any);
  publishMocks();
  vi.mocked(MvpProject.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue({ _id: projectId }) } as any);
  vi.mocked(Audit.findByIdAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(true) } as any);
  vi.mocked(Lead.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(true) } as any);
  return capturedProcessor!({ id: 'job-rebuild', data: { leadId, auditId } });
};

/** The MVP already saved for the lead before a regeneration */
const existingProject = (p: Record<string, unknown> | null) => {
  vi.mocked(MvpProject.findOne).mockReturnValue({
    select: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(p ? { previewSlug: 'falco-dent-456789', ...p } : null) }),
  } as any);
};

/** The MVP a re-publish reads; the same project on the re-read, so the relayout loop stops after one pass */
const savedProject = (p: Record<string, unknown>) => {
  const project = { _id: projectId, leadId, auditId, previewSlug: 'falco-dent-456789', generatedContent: { hero: { headline: 'Stored' } }, ...p };
  const audit = { _id: auditId, siteSections: sectionsFixture, screenshotUrls: {}, toObject: () => audit };
  vi.mocked(Lead.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue(lead) } as any);
  vi.mocked(MvpProject.findOne).mockReturnValue({ exec: vi.fn().mockResolvedValue(project) } as any);
  vi.mocked(MvpProject.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue(project) } as any);
  vi.mocked(findGenerationAudit).mockResolvedValue(audit as any);
  vi.mocked(MvpProject.findByIdAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(null) } as any);
  publishMocks();
};

beforeEach(() => {
  vi.clearAllMocks();
  capturedProcessor = null;
  existingProject(null);
});

describe('deploy with the rebuild (REV-110)', () => {
  it('publishes the rebuild and saves the variant, the summary and the site button color', async () => {
    vi.mocked(rebuildTemplateService.renderFromAudit).mockReturnValue({ html: '<html>REBUILD</html>', summary: { coverage: 0.98, sections: 5, omitted: [], tuning: ['alt:2'] } });
    const result = await runDeploy({ siteSections: sectionsFixture, siteLayout: undefined });
    expect(storageService.uploadHtml).toHaveBeenCalledWith(expect.any(String), '<html>REBUILD</html>', expect.anything());
    const update = vi.mocked(MvpProject.findOneAndUpdate).mock.calls[0]![1] as Record<string, any>;
    expect(update.layout).toMatchObject({ variant: 'original', reasons: expect.arrayContaining(['rule:rebuild']) });
    expect(update.rebuild).toEqual({ coverage: 0.98, sections: 5, omitted: [], tuning: ['alt:2'] });
    expect(update.colorPalette.primary).toBe('#c2185b');
    expect(result.success).toBe(true);
  });

  it('passes no palette to the rebuild, so it takes the site button color itself', async () => {
    vi.mocked(rebuildTemplateService.renderFromAudit).mockReturnValue({ html: 'R', summary: { coverage: 0.98, sections: 1, omitted: [], tuning: [] } });
    await runDeploy({ siteSections: sectionsFixture });
    expect(vi.mocked(rebuildTemplateService.renderFromAudit).mock.calls[0]![2]).toBeUndefined();
    const update = vi.mocked(MvpProject.findOneAndUpdate).mock.calls[0]![1] as Record<string, any>;
    expect(update.colorPalette).toEqual({ primary: '#c2185b', secondary: '#e0e7ff', accent: '#c2185b' });
    expect(update.$unset).toBeUndefined();
  });

  it('falls back to Bento with the reason and unsets the summary', async () => {
    vi.mocked(rebuildTemplateService.renderFromAudit).mockImplementation(() => {
      throw new RebuildUnavailable('rebuild:low_coverage', ['coverage:0.6']);
    });
    vi.mocked(bentoTemplateService.renderFromAudit).mockReturnValue('<html>BENTO</html>');
    await runDeploy({ siteSections: sectionsFixture });
    const update = vi.mocked(MvpProject.findOneAndUpdate).mock.calls[0]![1] as Record<string, any>;
    expect(update.layout.reasons.slice(0, 2)).toEqual(['rebuild:low_coverage', 'coverage:0.6']);
    expect(update.layout.variant).not.toBe('original');
    expect(update.$unset).toMatchObject({ rebuild: '' });
    expect(update).not.toHaveProperty('rebuild');
    // Bento keeps today's inputs: no palette override, and the brand colors are saved
    expect(vi.mocked(bentoTemplateService.renderFromAudit).mock.calls[0]![4]).toBeUndefined();
    expect(update.colorPalette.primary).toBe('#4f46e5');
    expect(storageService.uploadHtml).toHaveBeenCalledWith(expect.any(String), '<html>BENTO</html>', expect.anything());
  });

  it('merges the rebuild unset with the cleared operator choice into one $unset', async () => {
    vi.mocked(rebuildTemplateService.renderFromAudit).mockImplementation(() => {
      throw new RebuildUnavailable('rebuild:unread');
    });
    vi.mocked(bentoTemplateService.renderFromAudit).mockReturnValue('B');
    await runDeploy({ siteSections: sectionsFixture });
    vi.mocked(MvpProject.findOneAndUpdate).mockClear();
    await capturedProcessor!({ id: 'job-2', data: { leadId, auditId, generationSource: { provider: 'claude-cli', modelUsed: 'm' } } });
    const update = vi.mocked(MvpProject.findOneAndUpdate).mock.calls[0]![1] as Record<string, any>;
    expect(update.$unset).toEqual({ requestedProvider: '', requestedModel: '', rebuild: '' });
  });

  it('keeps a manual Bento pick over the rebuild on regeneration', async () => {
    existingProject({ layout: { variant: 'editorial', reasons: ['rule:manual'] } });
    vi.mocked(bentoTemplateService.renderFromAudit).mockReturnValue('<html>BENTO</html>');
    await runDeploy({ siteSections: sectionsFixture });
    expect(rebuildTemplateService.renderFromAudit).not.toHaveBeenCalled();
    expect((vi.mocked(MvpProject.findOneAndUpdate).mock.calls[0]![1] as any).layout.variant).toBe('editorial');
  });

  it('tries the rebuild again for a manual original that had fallen back', async () => {
    existingProject({ layout: { variant: 'split', reasons: ['rule:manual', 'manual:original', 'rebuild:unread'] } });
    vi.mocked(rebuildTemplateService.renderFromAudit).mockReturnValue({ html: 'R', summary: { coverage: 1, sections: 1, omitted: [], tuning: [] } });
    await runDeploy({ siteSections: sectionsFixture });
    expect((vi.mocked(MvpProject.findOneAndUpdate).mock.calls[0]![1] as any).layout).toMatchObject({
      variant: 'original',
      reasons: expect.arrayContaining(['rule:manual']),
    });
  });

  it("falls back from a manual original to Bento, keeping the pick marked and the operator's design", async () => {
    existingProject({ layout: { variant: 'original', reasons: ['rule:manual'] }, design: { hidden: ['reviews'] } });
    vi.mocked(rebuildTemplateService.renderFromAudit).mockImplementation(() => {
      throw new RebuildUnavailable('rebuild:no_content');
    });
    vi.mocked(bentoTemplateService.renderFromAudit).mockReturnValue('B');
    await runDeploy({ siteSections: sectionsFixture });
    const update = vi.mocked(MvpProject.findOneAndUpdate).mock.calls[0]![1] as Record<string, any>;
    expect(update.layout.variant).not.toBe('original');
    expect(update.layout.reasons.slice(0, 3)).toEqual(['rule:manual', 'manual:original', 'rebuild:no_content']);
    expect(vi.mocked(bentoTemplateService.renderFromAudit).mock.calls[0]![5]).toEqual({ hidden: ['reviews'] });
  });
});

describe('re-publish with the rebuild (REV-110)', () => {
  it('re-renders the rebuild with the saved palette and marks a renderer switch as edited', async () => {
    savedProject({ layout: { variant: 'original', reasons: ['rule:manual'] }, colorPalette: { primary: '#00ff00' }, rebuild: undefined });
    vi.mocked(rebuildTemplateService.renderFromAudit).mockReturnValue({ html: 'R', summary: { coverage: 1, sections: 1, omitted: [], tuning: [] } });
    await republishSavedMvp(leadId);
    expect(rebuildTemplateService.renderFromAudit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ primary: '#00ff00' }), undefined);
    expect(MvpProject.findByIdAndUpdate).toHaveBeenCalledWith(
      projectId,
      expect.objectContaining({ $set: expect.objectContaining({ editedAt: expect.any(Date), rebuild: expect.anything() }) }),
    );
  });

  it('does not touch editedAt when the renderer stays the same', async () => {
    savedProject({ layout: { variant: 'bento', reasons: ['rule:manual'] }, rebuild: undefined });
    vi.mocked(bentoTemplateService.renderFromAudit).mockReturnValue('B');
    await republishSavedMvp(leadId);
    const calls = vi.mocked(MvpProject.findByIdAndUpdate).mock.calls;
    expect(calls.every(([, update]) => !(update as any)?.$set?.editedAt)).toBe(true);
  });

  it('switches back to Bento: unsets the summary and marks the switch', async () => {
    savedProject({ layout: { variant: 'split', reasons: ['rule:manual'] }, rebuild: { coverage: 1, sections: 1, omitted: [], tuning: [] } });
    vi.mocked(bentoTemplateService.renderFromAudit).mockReturnValue('B');
    await republishSavedMvp(leadId);
    const update = vi.mocked(MvpProject.findByIdAndUpdate).mock.calls[0]![1] as Record<string, any>;
    expect(update.$unset).toEqual({ rebuild: '' });
    expect(update.$set).toEqual({ editedAt: expect.any(Date) });
  });

  it('records a fallback of a manual original once and does not publish twice', async () => {
    savedProject({ layout: { variant: 'original', reasons: ['rule:manual'] }, rebuild: undefined });
    vi.mocked(rebuildTemplateService.renderFromAudit).mockImplementation(() => {
      throw new RebuildUnavailable('rebuild:too_large');
    });
    vi.mocked(bentoTemplateService.renderFromAudit).mockReturnValue('B');
    // The layout is still the one rendered from, so the write lands and the re-read returns it
    vi.mocked(MvpProject.findOneAndUpdate).mockImplementation(((_filter: unknown, update: any) => {
      vi.mocked(MvpProject.findById).mockReturnValue({
        exec: vi.fn().mockResolvedValue({ _id: projectId, previewSlug: 'falco-dent-456789', layout: update.$set.layout }),
      } as any);
      return { exec: vi.fn().mockResolvedValue({ _id: projectId }) };
    }) as any);
    const result = await republishSavedMvp(leadId);
    const [filter, update] = vi.mocked(MvpProject.findOneAndUpdate).mock.calls[0]! as [Record<string, any>, Record<string, any>];
    expect(filter).toEqual({ _id: projectId, layout: { variant: 'original', reasons: ['rule:manual'] } });
    expect(update.$set.layout.reasons.slice(0, 3)).toEqual(['rule:manual', 'manual:original', 'rebuild:too_large']);
    // Bento before and after: no renderer switch, nothing else to write
    expect(MvpProject.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(storageService.uploadHtml).toHaveBeenCalledTimes(1);
    expect(result.layout).toBe(update.$set.layout.variant);
  });

  it("never overwrites a layout the operator picked while the fallback published, and renders that pick", async () => {
    savedProject({ layout: { variant: 'original', reasons: ['rule:manual'] }, rebuild: undefined });
    vi.mocked(rebuildTemplateService.renderFromAudit).mockImplementation(() => {
      throw new RebuildUnavailable('rebuild:too_large');
    });
    vi.mocked(bentoTemplateService.renderFromAudit).mockImplementation((_lead, _audit, _content, variant) => `<html>${variant}</html>`);
    // The operator picked Compact during the upload: the guarded write matches nothing
    const picked = { _id: projectId, previewSlug: 'falco-dent-456789', layout: { variant: 'compact', reasons: ['rule:manual'] } };
    vi.mocked(MvpProject.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(null) } as any);
    vi.mocked(MvpProject.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue(picked) } as any);

    const result = await republishSavedMvp(leadId);

    const uploads = vi.mocked(storageService.uploadHtml).mock.calls.map((call) => call[1]);
    expect(uploads).toHaveLength(2);
    expect(uploads[1]).toBe('<html>compact</html>');
    // Only the first pass tried to record its fallback, guarded on the layout it rendered from
    expect(MvpProject.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(MvpProject.findOneAndUpdate).mock.calls[0]![0]).toMatchObject({ layout: { variant: 'original' } });
    expect(result.layout).toBe('compact');
  });
});
