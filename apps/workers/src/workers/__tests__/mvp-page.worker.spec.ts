import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyControlsUpdate, processMvpPageJob, PUBLISH_MARGIN_MS } from '../mvp-page.worker.js';
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
vi.mock('bullmq', () => ({ Worker: vi.fn().mockImplementation(() => ({ on: vi.fn(), close: vi.fn() })) }));

const LEAD_ID = '64f8a1234567890123456789';
const AUDIT_ID = '64f8a9876543210987654321';
const SLUG = 'falco-dent-456789';
const THEME = { primary: '#0a5c8a', accent: '#f2a900', bg: '#ffffff', surface: '#f5f7fa', text: '#111111', fontHeading: 'serif', fontBody: 'sans-serif' };
const NEW_PAGE = VALID.replace('</h1>', ' – nowocześnie</h1>');
const NOW = 1_800_000_000_000;
const DEADLINE = NOW + 400_000;

const lead = { _id: LEAD_ID, businessName: 'Falco-Dent', domain: 'falco-dent.pl', niche: 'dental', status: 'NEEDS_APPROVAL', originalUrl: 'https://falco-dent.pl', toObject: () => lead };
const audit = {
  _id: AUDIT_ID,
  extractedContacts: { phone: '+48 600 100 200', address: 'ul. Długa 5, Kraków', socialLinks: [] },
  extractedServices: ['Implanty'],
  extractedBrandTokens: { primaryColor: '#0a5c8a', secondaryColor: '#ffffff', accentColor: '#f2a900', fontFamilies: [], logoUrl: 'https://falco-dent.pl/logo.png' },
  extractedContent: { language: 'pl', headings: [], paragraphs: [], serviceItems: [], navItems: [], testimonials: [], images: ['https://falco-dent.pl/a.jpg', 'https://falco-dent.pl/b.jpg', 'https://falco-dent.pl/b@2x.jpg'] },
  screenshotUrls: { desktopOriginal: 'http://s3/d.webp', mobileOriginal: 'http://s3/m.webp', desktopFull: 'http://s3/full.webp' },
  toObject: () => audit,
};
const version = (n: number, extra: Record<string, unknown> = {}) => ({ n, kind: 'generate', storagePath: `v/${SLUG}/versions/${n}.html`, createdAt: new Date('2026-10-01'), ...extra });

let project: Record<string, any>;
const change = vi.fn();
const job = (data: Record<string, unknown>) => ({ mvpProjectId: 'mvp-1', deadline: DEADLINE, ...data }) as any;
const run = (data: Record<string, unknown>, now: () => number = () => NOW) => processMvpPageJob(job(data), { generator: { change }, now });
const update = () => vi.mocked(MvpProject.findByIdAndUpdate).mock.calls[0]?.[1] as Record<string, any>;
const published = () => vi.mocked(storageService.uploadHtml).mock.calls[0]?.[1] as string;

beforeEach(() => {
  vi.clearAllMocks();
  project = {
    _id: 'mvp-1',
    leadId: LEAD_ID,
    auditId: AUDIT_ID,
    previewSlug: SLUG,
    page: VALID,
    theme: THEME,
    grounding: [],
    versions: [version(1), version(2, { kind: 'change', instruction: 'ciemniej' })],
  };
  vi.mocked(MvpProject.findById).mockImplementation((() => ({ exec: vi.fn().mockResolvedValue({ ...project, toObject: () => project }) })) as any);
  vi.mocked(MvpProject.findByIdAndUpdate).mockImplementation(((_id: unknown, u: Record<string, any>) => {
    const pushed = u.$push?.versions;
    const versions = pushed ? [...project.versions, ...pushed.$each].slice(pushed.$slice) : project.versions;
    return { exec: vi.fn().mockResolvedValue({ ...project, versions }) };
  }) as any);
  vi.mocked(Lead.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue(lead) } as any);
  vi.mocked(findGenerationAudit).mockResolvedValue(audit as any);
  vi.mocked(Audit.findByIdAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(audit) } as any);
  vi.mocked(storageService.uploadPageVersion).mockImplementation(async (slug: string, n: number) => `v/${slug}/versions/${n}.html`);
  vi.mocked(storageService.readPageVersion).mockResolvedValue(VALID.replace('</h1>', ' (v1)</h1>'));
  vi.mocked(storageService.uploadHtml).mockResolvedValue({ url: `http://s3/revamp-demos/v/${SLUG}/index.html`, key: `v/${SLUG}/index.html` });
  vi.mocked(storageService.uploadComparisonBanner).mockResolvedValue('http://s3/banner.webp');
  vi.mocked(storageService.deleteObject).mockResolvedValue(undefined);
  vi.mocked(browserService.captureHtmlScreenshot).mockResolvedValue(Buffer.from('png'));
  vi.mocked(ImageService.createComparisonBanner).mockResolvedValue(Buffer.from('banner'));
  vi.mocked(mvpCompletenessService.check).mockReturnValue({ status: 'verified', checks: [] } as any);
  vi.mocked(measureMvpPerformance).mockResolvedValue({ host: 's3', webVitals: { lcp: 900, cls: 0 } } as any);
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer }) as any;
  change.mockResolvedValue({ ok: true, page: NEW_PAGE, theme: THEME, grounding: [{ kind: 'number', text: '20', context: '20 lat' }], attempts: 1, answers: [], modelUsed: 'claude-cli:sonnet', provider: 'claude-cli' });
});

const nothingPublished = () => {
  expect(storageService.uploadPageVersion).not.toHaveBeenCalled();
  expect(storageService.uploadHtml).not.toHaveBeenCalled();
  expect(MvpProject.findByIdAndUpdate).not.toHaveBeenCalled();
};

describe('a free-text change (REV-139)', () => {
  it('asks the model with the stored page and publishes its page as the next version', async () => {
    project.controls = { primary: '#222222' };
    const result = await run({ action: 'change', instruction: 'Krótszy nagłówek' });

    const input = change.mock.calls[0]![0];
    expect(input).toMatchObject({ currentPage: VALID, instruction: 'Krótszy nagłówek', deadline: DEADLINE - PUBLISH_MARGIN_MS });
    expect(input.screenshot).toEqual(Buffer.from([1, 2]));
    expect(JSON.stringify(input.brief)).not.toContain('600 100 200');
    expect(storageService.uploadPageVersion).toHaveBeenCalledWith(SLUG, 3, NEW_PAGE);
    expect(published()).toContain('nowocześnie');
    expect(published()).toContain('tel:+48600100200');
    expect(published()).toContain('--rv-color-primary:#222222');

    const u = update();
    expect(u.$set).toMatchObject({ page: NEW_PAGE, theme: THEME, grounding: [{ kind: 'number', text: '20', context: '20 lat' }], controls: { primary: '#222222' } });
    expect(u.$set.editedAt).toBeInstanceOf(Date);
    expect(u.$push.versions.$each[0]).toMatchObject({ n: 3, kind: 'change', instruction: 'Krótszy nagłówek', provider: 'claude-cli', model: 'claude-cli:sonnet', storagePath: `v/${SLUG}/versions/3.html` });
    expect(u.$push.versions.$slice).toBe(-20);
    expect(u.$inc).toBeUndefined();
    expect(mvpCompletenessService.check).toHaveBeenCalled();
    expect(Lead.findOneAndUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({ applied: true, version: 3 });
  });

  it('publishes nothing when the model fails, and says why', async () => {
    const problems = [{ code: 'page:script', message: 'a script' }];
    change.mockResolvedValue({ ok: false, reason: 'invalid_page', message: 'rejected twice', problems, answers: [], modelUsed: 'm' });
    expect(await run({ action: 'change', instruction: 'x' })).toEqual({ applied: false, reason: 'invalid_page', message: 'rejected twice', problems });
    nothingPublished();
  });

  it('counts nothing when the model returns the same page', async () => {
    change.mockResolvedValue({ ok: true, page: VALID, theme: THEME, grounding: [], attempts: 1, answers: [], modelUsed: 'm' });
    expect(await run({ action: 'change', instruction: 'x' })).toEqual({ applied: false, reason: 'unchanged' });
    nothingPublished();
  });

  it('publishes nothing when the answer comes after the operator stopped waiting', async () => {
    let t = NOW;
    change.mockImplementation(async () => {
      t = DEADLINE + 1;
      return { ok: true, page: NEW_PAGE, theme: THEME, grounding: [], attempts: 1, answers: [], modelUsed: 'm' };
    });
    await expect(run({ action: 'change', instruction: 'x' }, () => t)).rejects.toThrow('stopped waiting');
    nothingPublished();
  });

  it('publishes nothing when the lead moved on while the model worked', async () => {
    vi.mocked(Lead.findById)
      .mockReturnValueOnce({ exec: vi.fn().mockResolvedValue(lead) } as any)
      .mockReturnValueOnce({ exec: vi.fn().mockResolvedValue({ ...lead, status: 'GENERATING' }) } as any);
    await expect(run({ action: 'change', instruction: 'x' })).rejects.toThrow('GENERATING');
    nothingPublished();
  });

  it('refuses a job that already missed its deadline, before any work', async () => {
    await expect(run({ action: 'change', instruction: 'x' }, () => DEADLINE + 1)).rejects.toThrow('stopped waiting');
    expect(change).not.toHaveBeenCalled();
  });
});

describe('palette and fonts (REV-139)', () => {
  const colors = { primary: '#0a5c8a', accent: '#f2a900', bg: '#ffffff', surface: '#ffffff', text: '#222222' };

  it('applies a group given, clears one set to null and keeps one left out', () => {
    const current = { primary: '#111111', fontHeading: 'Lora', fontBody: 'Lato' };
    expect(applyControlsUpdate(current, { colors, fonts: null })).toEqual(colors);
    expect(applyControlsUpdate(current, { fonts: { heading: 'Poppins', body: 'Inter' } })).toEqual({ primary: '#111111', fontHeading: 'Poppins', fontBody: 'Inter' });
    expect(applyControlsUpdate(current, { colors: null })).toEqual({ fontHeading: 'Lora', fontBody: 'Lato' });
  });

  it('re-finishes the stored page with the new controls; no model call, no version', async () => {
    project.controls = { primary: '#111111', fontHeading: 'Lora', fontBody: 'Lato' };
    const result = await run({ action: 'controls', controls: { colors, fonts: null } });

    expect(change).not.toHaveBeenCalled();
    expect(storageService.uploadPageVersion).not.toHaveBeenCalled();
    expect(published()).toContain('--rv-color-text:#222222');
    expect(published()).not.toContain('Lora');
    const u = update();
    expect(u.$set.controls).toEqual(colors);
    expect(u.$set.page).toBe(VALID);
    expect(u.$set.editedAt).toBeInstanceOf(Date);
    expect(u.$push).toBeUndefined();
    expect(result).toEqual({ applied: true });
  });

  it('unsets the controls when every group is cleared', async () => {
    project.controls = { fontHeading: 'Lora', fontBody: 'Lato' };
    await run({ action: 'controls', controls: { fonts: null } });
    expect(update().$unset).toMatchObject({ controls: '' });
    expect(update().$set.controls).toBeUndefined();
    expect(published()).not.toContain('rv-controls');
  });

  it('counts nothing when the controls do not change', async () => {
    project.controls = { fontHeading: 'Lora', fontBody: 'Lato' };
    expect(await run({ action: 'controls', controls: { fonts: { heading: 'Lora', body: 'Lato' } } })).toEqual({ applied: false, reason: 'unchanged' });
    nothingPublished();
  });
});

describe('restoring a version (REV-139)', () => {
  it('re-checks the stored page and publishes it as a new version that names its source', async () => {
    project.controls = { primary: '#222222' };
    const result = await run({ action: 'restore', version: 1 });

    expect(storageService.readPageVersion).toHaveBeenCalledWith(`v/${SLUG}/versions/1.html`);
    const raw = VALID.replace('</h1>', ' (v1)</h1>');
    expect(storageService.uploadPageVersion).toHaveBeenCalledWith(SLUG, 3, raw);
    expect(published()).toContain('--rv-color-primary:#222222');
    const u = update();
    expect(u.$set.page).toBe(raw);
    expect(u.$set.theme).toMatchObject({ primary: expect.any(String), fontBody: expect.any(String) });
    expect(Array.isArray(u.$set.grounding)).toBe(true);
    expect(u.$push.versions.$each[0]).toMatchObject({ n: 3, kind: 'restore', from: 1 });
    expect(result).toEqual({ applied: true, version: 3 });
  });

  it("refuses a version that uses a contact the audit no longer has, and publishes nothing", async () => {
    vi.mocked(storageService.readPageVersion).mockResolvedValue(VALID.replace('</h1>', ' {{hours}}</h1>'));
    const result = await run({ action: 'restore', version: 1 });
    expect(result).toMatchObject({ applied: false, reason: 'unusable_version' });
    expect(result.applied === false && 'problems' in result && result.problems?.map((p) => p.code)).toContain('page:placeholder');
    nothingPublished();
  });

  it('counts nothing when the version is the current page', async () => {
    vi.mocked(storageService.readPageVersion).mockResolvedValue(VALID);
    expect(await run({ action: 'restore', version: 2 })).toEqual({ applied: false, reason: 'unchanged' });
    nothingPublished();
  });

  it('fails when the version file is missing from storage', async () => {
    vi.mocked(storageService.readPageVersion).mockRejectedValue(new Error('The specified key does not exist.'));
    await expect(run({ action: 'restore', version: 1 })).rejects.toThrow('does not exist');
    nothingPublished();
  });

  it('fails for a version that is not listed', async () => {
    await expect(run({ action: 'restore', version: 9 })).rejects.toThrow('Version 9 not found');
    nothingPublished();
  });

  it('keeps 20 versions and deletes the file of the one that fell off', async () => {
    project.versions = Array.from({ length: 20 }, (_, i) => version(i + 1));
    await run({ action: 'restore', version: 5 });
    expect(storageService.uploadPageVersion).toHaveBeenCalledWith(SLUG, 21, expect.any(String));
    expect(update().$push.versions.$slice).toBe(-20);
    expect(storageService.deleteObject).toHaveBeenCalledWith(`v/${SLUG}/versions/1.html`);
    expect(storageService.deleteObject).toHaveBeenCalledTimes(1);
  });
});

describe('an MVP of the previous generator (REV-139)', () => {
  it.each([
    { action: 'change', instruction: 'x' },
    { action: 'controls', controls: { fonts: null } },
    { action: 'restore', version: 1 },
  ])('refuses $action: only a regeneration applies', async (data) => {
    delete project.page;
    await expect(run(data)).rejects.toThrow('previous generator');
    nothingPublished();
  });
});
