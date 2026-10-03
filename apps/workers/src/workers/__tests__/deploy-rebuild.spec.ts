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
import { rebuildModernizeService } from '../../services/rebuild-modernize.service.js';
import { AnalyticsEvent } from '../../models/AnalyticsEvent.model.js';

vi.mock('../../models/Lead.model.js');
vi.mock('../../models/Audit.model.js');
vi.mock('../../services/audit-lookup.js');
vi.mock('../../models/MvpProject.model.js');
vi.mock('../../services/template.service.js');
vi.mock('../../services/storage.service.js');
vi.mock('../../services/browser.service.js');
vi.mock('../../services/image.service.js');
vi.mock('../../models/AnalyticsEvent.model.js');
vi.mock('../../services/rebuild-modernize.service.js', () => ({ rebuildModernizeService: { choose: vi.fn() } }));
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
  return project as Record<string, unknown>;
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
    expect(update.rebuild).toEqual({ coverage: 0.98, sections: 5, omitted: [], tuning: ['alt:2'], level: 'faithful' });
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
    expect(rebuildTemplateService.renderFromAudit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ primary: '#00ff00' }), undefined, undefined);
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
    // Bento before and after: no renderer switch; the only other write is the re-checked completeness (REV-111)
    expect(vi.mocked(MvpProject.findByIdAndUpdate).mock.calls.map((call) => Object.keys((call[1] as any).$set))).toEqual([['completenessReport']]);
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

describe('the rebuild edit and completeness (REV-111)', () => {
  const edit = { auditId, hidden: ['s-2'] };

  it('re-publishes with the saved edit and saves a fresh code-only completeness report', async () => {
    savedProject({ layout: { variant: 'original', reasons: ['rule:rebuild'] }, rebuild: { coverage: 1, sections: 1, omitted: [], tuning: [] }, rebuildEdit: edit });
    vi.mocked(rebuildTemplateService.renderFromAudit).mockReturnValue({ html: '<html><body>Falco-Dent</body></html>', summary: { coverage: 1, sections: 1, omitted: [], tuning: [] } });
    await republishSavedMvp(leadId);
    expect(vi.mocked(rebuildTemplateService.renderFromAudit).mock.calls[0]![3]).toEqual(edit);
    const reports = vi.mocked(MvpProject.findByIdAndUpdate).mock.calls.map((call) => (call[1] as any)?.$set?.completenessReport).filter(Boolean);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ method: 'deterministic' });
    expect(reports[0].checks.find((c: any) => c.field === 'businessName')).toMatchObject({ status: 'present' });
  });

  it('re-checks completeness on a Bento re-publish too', async () => {
    savedProject({ layout: { variant: 'bento', reasons: ['rule:manual'] } });
    vi.mocked(bentoTemplateService.renderFromAudit).mockReturnValue('<html><body>Bento</body></html>');
    await republishSavedMvp(leadId);
    const reports = vi.mocked(MvpProject.findByIdAndUpdate).mock.calls.map((call) => (call[1] as any)?.$set?.completenessReport).filter(Boolean);
    expect(reports).toHaveLength(1);
  });

  it('keeps an edit made for the audit a regeneration renders', async () => {
    existingProject({ layout: { variant: 'original', reasons: ['rule:rebuild'] }, rebuildEdit: edit });
    vi.mocked(rebuildTemplateService.renderFromAudit).mockReturnValue({ html: 'R', summary: { coverage: 1, sections: 1, omitted: [], tuning: [] } });
    await runDeploy({ siteSections: sectionsFixture });
    expect(vi.mocked(rebuildTemplateService.renderFromAudit).mock.calls[0]![3]).toEqual(edit);
    const update = vi.mocked(MvpProject.findOneAndUpdate).mock.calls[0]![1] as any;
    expect(update.$unset?.rebuildEdit).toBeUndefined();
  });

  it('drops an edit made for another audit when a regeneration reads a newer one', async () => {
    existingProject({ layout: { variant: 'original', reasons: ['rule:rebuild'] }, rebuildEdit: { ...edit, auditId: 'ffffffffffffffffffffffff' } });
    vi.mocked(rebuildTemplateService.renderFromAudit).mockReturnValue({ html: 'R', summary: { coverage: 1, sections: 1, omitted: [], tuning: [] } });
    await runDeploy({ siteSections: sectionsFixture });
    expect(vi.mocked(rebuildTemplateService.renderFromAudit).mock.calls[0]![3]).toBeUndefined();
    const update = vi.mocked(MvpProject.findOneAndUpdate).mock.calls[0]![1] as any;
    expect(update.$unset).toMatchObject({ rebuildEdit: '' });
  });
});

describe('the rebuild level and the modern design (REV-114)', () => {
  const design = { theme: { typeScale: 'modern' as const } };
  const summary = (level?: 'faithful' | 'modern') => ({ coverage: 1, sections: 1, omitted: [], tuning: [], ...(level ? { level } : {}) });
  const dated = { siteSections: sectionsFixture, siteEra: { dated: true, score: 7, signs: ['table_layout', 'frames', 'default_font'] } };
  const lastUpsert = () => vi.mocked(MvpProject.findOneAndUpdate).mock.calls.at(-1)![1] as Record<string, any>;
  const modernizeWrites = () =>
    vi.mocked(MvpProject.findByIdAndUpdate).mock.calls.filter(([, update]) => (update as any)?.$set?.modernize).map(([, update]) => (update as any).$set.modernize);

  beforeEach(() => {
    vi.mocked(rebuildTemplateService.renderFromAudit).mockReturnValue({ html: 'R', summary: summary() });
    vi.mocked(rebuildModernizeService.choose).mockResolvedValue({ source: 'llm', design });
    vi.mocked(MvpProject.findByIdAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(null) } as any);
  });

  describe('generation', () => {
    it('modernizes a dated site: one model call, the design saved for this audit, the level and its reasons', async () => {
      await runDeploy(dated);
      expect(rebuildModernizeService.choose).toHaveBeenCalledTimes(1);
      expect(rebuildModernizeService.choose).toHaveBeenCalledWith({ siteSections: sectionsFixture, brandColors: ['#c2185b', '#4f46e5', '#e0e7ff'] });
      expect(vi.mocked(rebuildTemplateService.renderFromAudit).mock.calls[0]![4]).toEqual(design);
      const update = lastUpsert();
      expect(update.modernize).toEqual({ auditId, source: 'llm', design });
      expect(update.layout).toMatchObject({ variant: 'original', rebuildLevel: 'modern' });
      expect(update.layout.reasons.slice(0, 3)).toEqual(['rule:rebuild', 'modernize:dated', 'dated:7']);
      expect(update.rebuild.level).toBe('modern');
      expect(update.$unset).toBeUndefined();
    });

    it('saves the design on an existing MVP before it renders', async () => {
      existingProject({ _id: projectId, layout: { variant: 'original', reasons: ['rule:rebuild'] } });
      await runDeploy(dated);
      expect(modernizeWrites()).toEqual([{ auditId, source: 'llm', design }]);
      const saved = vi.mocked(MvpProject.findByIdAndUpdate).mock.invocationCallOrder[0]!;
      expect(saved).toBeLessThan(vi.mocked(rebuildTemplateService.renderFromAudit).mock.invocationCallOrder[0]!);
    });

    it('reuses a design stored for the same audit without a call', async () => {
      existingProject({ layout: { variant: 'original', reasons: ['rule:rebuild'] }, modernize: { auditId, source: 'llm', design } });
      await runDeploy(dated);
      expect(rebuildModernizeService.choose).not.toHaveBeenCalled();
      expect(vi.mocked(rebuildTemplateService.renderFromAudit).mock.calls[0]![4]).toEqual(design);
      const update = lastUpsert();
      expect(update).not.toHaveProperty('modernize');
      expect(update.$unset?.modernize).toBeUndefined();
    });

    it('recomputes a design stored for an older audit', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      existingProject({ layout: { variant: 'original', reasons: ['rule:rebuild'] }, modernize: { auditId: 'ffffffffffffffffffffffff', source: 'llm', design } });
      await runDeploy(dated);
      expect(rebuildModernizeService.choose).toHaveBeenCalledTimes(1);
      const update = lastUpsert();
      expect(update.modernize).toEqual({ auditId, source: 'llm', design });
      expect(update.$unset?.modernize).toBeUndefined();
    });

    it('unsets a design stored for an older audit when the new one is not dated, without a call', async () => {
      existingProject({ layout: { variant: 'original', reasons: ['rule:rebuild'] }, modernize: { auditId: 'ffffffffffffffffffffffff', source: 'llm', design } });
      await runDeploy({ siteSections: sectionsFixture, siteEra: { dated: false, score: 1, signs: ['old_jquery'] } });
      expect(rebuildModernizeService.choose).not.toHaveBeenCalled();
      const update = lastUpsert();
      expect(update.$unset).toMatchObject({ modernize: '' });
      expect(update).not.toHaveProperty('modernize');
      expect(update.layout.rebuildLevel).toBe('faithful');
      expect(update.layout.reasons[0]).toBe('rule:rebuild');
      expect(update.layout.reasons.some((r: string) => r.startsWith('modernize:') || r.startsWith('dated:'))).toBe(false);
      expect(update.rebuild.level).toBe('faithful');
    });

    it('makes no call for an undated site', async () => {
      await runDeploy({ siteSections: sectionsFixture });
      expect(rebuildModernizeService.choose).not.toHaveBeenCalled();
      expect(vi.mocked(rebuildTemplateService.renderFromAudit).mock.calls[0]![4]).toBeUndefined();
    });

    it("keeps the operator's faithful pick on a dated site", async () => {
      existingProject({ layout: { variant: 'original', rebuildLevel: 'faithful', reasons: ['rule:manual', 'modernize:manual'] } });
      await runDeploy(dated);
      expect(rebuildModernizeService.choose).not.toHaveBeenCalled();
      const layout = lastUpsert().layout;
      expect(layout).toMatchObject({ variant: 'original', rebuildLevel: 'faithful' });
      expect(layout.reasons.slice(0, 2)).toEqual(['rule:manual', 'modernize:manual']);
      expect(layout.reasons).not.toContain('modernize:dated');
    });

    it('makes no call and stores no design for a dated site that cannot be rebuilt', async () => {
      await runDeploy({ ...dated, siteSectionsError: 'the page did not load' });
      expect(rebuildModernizeService.choose).not.toHaveBeenCalled();
      expect(modernizeWrites()).toEqual([]);
      expect(lastUpsert()).not.toHaveProperty('modernize');
    });

    it.each(['call_failed: timeout', 'not_configured'])('asks again for a default stored after a temporary failure (%s)', async (error) => {
      existingProject({ _id: projectId, layout: { variant: 'original', reasons: ['rule:rebuild'] }, modernize: { auditId, source: 'default', design: {}, error } });
      await runDeploy(dated);
      expect(rebuildModernizeService.choose).toHaveBeenCalledTimes(1);
      expect(lastUpsert().modernize).toEqual({ auditId, source: 'llm', design });
    });

    it('reuses a default stored after an invalid answer without a call', async () => {
      const stored = { auditId, source: 'default', design, error: 'invalid: s-9: unknown section' };
      existingProject({ layout: { variant: 'original', reasons: ['rule:rebuild'] }, modernize: stored });
      await runDeploy(dated);
      expect(rebuildModernizeService.choose).not.toHaveBeenCalled();
      expect(vi.mocked(rebuildTemplateService.renderFromAudit).mock.calls[0]![4]).toEqual(design);
      expect(lastUpsert()).not.toHaveProperty('modernize');
    });

    it('marks the default design on the layout and records the tokens the model used', async () => {
      vi.mocked(rebuildModernizeService.choose).mockResolvedValue({
        source: 'default',
        design,
        error: 'invalid: s-9: unknown section',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        model: 'claude-test',
      });
      await runDeploy(dated);
      const update = lastUpsert();
      expect(update.modernize).toEqual({ auditId, source: 'default', design, error: 'invalid: s-9: unknown section' });
      expect(update.layout.reasons.slice(0, 4)).toEqual(['rule:rebuild', 'modernize:dated', 'dated:7', 'modernize:default']);
      expect(AnalyticsEvent.create).toHaveBeenCalledWith({
        leadId,
        eventType: 'token_usage',
        metadata: { model: 'claude-test', promptTokens: 10, completionTokens: 5, totalTokens: 15, stage: 'mvp_modernize' },
      });
    });
  });

  describe('re-publish', () => {
    const modernLayout = { variant: 'original', rebuildLevel: 'modern', reasons: ['rule:manual', 'modernize:manual'] };
    const faithfulLayout = { variant: 'original', rebuildLevel: 'faithful', reasons: ['rule:manual', 'modernize:manual'] };
    const editedAtWrites = () => vi.mocked(MvpProject.findByIdAndUpdate).mock.calls.filter(([, update]) => (update as any)?.$set?.editedAt);

    it('a first switch to modern computes and stores the design, and marks the page edited', async () => {
      const project = savedProject({ layout: modernLayout, rebuild: summary('faithful') });
      // The saved design comes back on the re-read
      vi.mocked(MvpProject.findByIdAndUpdate).mockImplementation(((_id: unknown, update: any) => {
        if (update.$set?.modernize) project.modernize = update.$set.modernize;
        return { exec: vi.fn().mockResolvedValue(null) };
      }) as any);
      await republishSavedMvp(leadId);
      expect(rebuildModernizeService.choose).toHaveBeenCalledTimes(1);
      expect(modernizeWrites()).toEqual([{ auditId, source: 'llm', design }]);
      expect(vi.mocked(rebuildTemplateService.renderFromAudit).mock.calls[0]![4]).toEqual(design);
      expect(editedAtWrites()).toHaveLength(1);
      expect((editedAtWrites()[0]![1] as any).$set.rebuild.level).toBe('modern');
      expect(storageService.uploadHtml).toHaveBeenCalledTimes(1);
    });

    it('reuses the stored design on a later re-publish, and leaves editedAt alone at the same level', async () => {
      savedProject({ layout: modernLayout, rebuild: summary('modern'), modernize: { auditId, source: 'llm', design } });
      await republishSavedMvp(leadId);
      expect(rebuildModernizeService.choose).not.toHaveBeenCalled();
      expect(vi.mocked(rebuildTemplateService.renderFromAudit).mock.calls[0]![4]).toEqual(design);
      expect(editedAtWrites()).toHaveLength(0);
    });

    it('switching back to faithful keeps the stored design and marks the page edited', async () => {
      savedProject({ layout: faithfulLayout, rebuild: summary('modern'), modernize: { auditId, source: 'llm', design } });
      await republishSavedMvp(leadId);
      expect(rebuildModernizeService.choose).not.toHaveBeenCalled();
      expect(vi.mocked(rebuildTemplateService.renderFromAudit).mock.calls[0]![4]).toBeUndefined();
      expect(editedAtWrites()).toHaveLength(1);
      const unsets = vi.mocked(MvpProject.findByIdAndUpdate).mock.calls.map(([, update]) => (update as any)?.$unset ?? {});
      expect(unsets.every((u) => !('modernize' in u))).toBe(true);
    });

    it('treats a summary saved before the level as faithful', async () => {
      savedProject({ layout: modernLayout, rebuild: summary(), modernize: { auditId, source: 'llm', design } });
      await republishSavedMvp(leadId);
      expect(editedAtWrites()).toHaveLength(1);
    });

    it('makes no call on a re-publish of a page that cannot be rebuilt', async () => {
      savedProject({ layout: modernLayout, rebuild: summary('faithful') });
      const unread = { _id: auditId, siteSections: sectionsFixture, siteSectionsError: 'the page did not load', screenshotUrls: {}, toObject: () => unread };
      vi.mocked(findGenerationAudit).mockResolvedValue(unread as any);
      await republishSavedMvp(leadId);
      expect(rebuildModernizeService.choose).not.toHaveBeenCalled();
      expect(modernizeWrites()).toEqual([]);
    });

    it('asks again once per job for a default stored after a failed call', async () => {
      const failed = { auditId, source: 'default', design, error: 'call_failed: timeout' };
      vi.mocked(rebuildModernizeService.choose).mockResolvedValue({ source: 'default', design, error: 'call_failed: again' });
      savedProject({ layout: modernLayout, rebuild: summary('modern'), modernize: failed });
      // A second pass (the palette changed meanwhile) re-reads the design the first pass stored
      const changed = { _id: projectId, leadId, auditId, previewSlug: 'falco-dent-456789', layout: modernLayout, colorPalette: { primary: '#00ff00' }, rebuild: summary('modern') };
      vi.mocked(MvpProject.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue({ ...changed, modernize: { ...failed, error: 'call_failed: again' } }) } as any);
      await republishSavedMvp(leadId);
      expect(storageService.uploadHtml).toHaveBeenCalledTimes(2);
      expect(rebuildModernizeService.choose).toHaveBeenCalledTimes(1);
    });

    it('never calls the model twice for the same audit in one job', async () => {
      savedProject({ layout: modernLayout, rebuild: summary('modern') });
      // The operator changes the palette during the upload: a second pass, re-read without the design (as a stale read)
      const changed = { _id: projectId, leadId, auditId, previewSlug: 'falco-dent-456789', layout: modernLayout, colorPalette: { primary: '#00ff00' }, rebuild: summary('modern') };
      vi.mocked(MvpProject.findById)
        .mockReturnValueOnce({ exec: vi.fn().mockResolvedValue(changed) } as any)
        .mockReturnValue({ exec: vi.fn().mockResolvedValue({ ...changed, modernize: { auditId, source: 'llm', design } }) } as any);
      await republishSavedMvp(leadId);
      expect(storageService.uploadHtml).toHaveBeenCalledTimes(2);
      expect(rebuildModernizeService.choose).toHaveBeenCalledTimes(1);
      expect(vi.mocked(rebuildTemplateService.renderFromAudit).mock.calls.map((call) => call[4])).toEqual([design, design]);
    });
  });
});
