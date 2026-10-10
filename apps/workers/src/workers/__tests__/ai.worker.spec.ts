import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAiWorker } from '../ai.worker.js';
import { findGenerationAudit } from '../../services/audit-lookup.js';
import { Lead } from '../../models/Lead.model.js';
import { MvpPageGenerator, defaultPageGenerator } from '../../services/mvp-page-generator.js';
import { addDeployJob } from '../../queues/deploy.queue.js';

vi.mock('../../services/audit-lookup.js');
vi.mock('../../models/Lead.model.js');
vi.mock('../../services/mvp-page-generator.js', () => ({
  MvpPageGenerator: vi.fn(),
  defaultPageGenerator: vi.fn(),
}));
vi.mock('../../queues/deploy.queue.js', () => ({
  addDeployJob: vi.fn().mockResolvedValue({ id: 'mock-deploy-job' }),
}));
vi.mock('../../queues/connection.js', () => ({
  redisConnection: {} as any,
}));

let capturedProcessor: ((job: any) => Promise<any>) | null = null;
const mockWorkerInstance = { on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };

vi.mock('bullmq', () => {
  class UnrecoverableError extends Error {
    constructor(message?: string) {
      super(message);
      // As bullmq does: a subclass is named after itself
      this.name = this.constructor.name;
    }
  }
  return {
    UnrecoverableError,
    Worker: vi.fn().mockImplementation(function (queueName: string, processor: any, opts: any) {
      capturedProcessor = processor;
      return { ...mockWorkerInstance, queueName, opts };
    }),
  };
});

const PHONE = '+48 22 542 18 04';
const EMAIL = 'info@smile.pl';
const THEME = { primary: '#0a5c8a', accent: '#f2a900', bg: '#ffffff', surface: '#f5f7fa', text: '#111111', fontHeading: 'serif', fontBody: 'sans-serif' };
const PAGE = '<!DOCTYPE html><html lang="pl"></html>';

const lead = {
  _id: 'lead-123',
  businessName: 'Smile Dental',
  niche: 'dental',
  city: 'Warszawa',
  originalUrl: 'https://smile.pl',
  contactEmail: EMAIL,
  status: 'GENERATING',
};
const audit = {
  _id: 'audit-456',
  leadId: 'lead-123',
  extractedServices: ['Implanty'],
  extractedContacts: { phone: PHONE, address: 'ul. Topiel 11, Warszawa', socialLinks: [] },
  extractedBrandTokens: { primaryColor: '#0a5c8a', secondaryColor: '#ffffff', accentColor: '#f2a900', fontFamilies: [] },
  extractedContent: { language: 'pl', h1: 'Gabinet', headings: [], paragraphs: ['Leczymy z troską.'], serviceItems: [], navItems: [], testimonials: [], images: [] },
  screenshotUrls: { desktopOriginal: 'http://s3/desktop.webp', mobileOriginal: 'http://s3/mobile.webp', desktopFull: 'http://s3/desktop-full.webp' },
};

const okResult = {
  ok: true,
  page: PAGE,
  theme: THEME,
  grounding: [{ kind: 'number', text: '15', context: '15 lat' }],
  attempts: 1,
  answers: [PAGE],
  modelUsed: 'claude-cli:sonnet',
  provider: 'claude-cli',
};

const generate = vi.fn();
const job = (data: Record<string, unknown> = {}) => ({ id: 'job-1', data: { leadId: 'lead-123', auditId: 'audit-456', ...data } });

describe('AiWorker on the model-designed page (REV-138)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProcessor = null;
    createAiWorker();
    vi.mocked(Lead.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue(lead) } as any);
    vi.mocked(Lead.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(lead) } as any);
    vi.mocked(findGenerationAudit).mockResolvedValue(audit as any);
    generate.mockResolvedValue(okResult);
    vi.mocked(defaultPageGenerator).mockReturnValue({ generate } as any);
    vi.mocked(MvpPageGenerator).mockImplementation(function () {
      return { generate } as any;
    } as any);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers the worker and a failed handler', () => {
    expect(capturedProcessor).toBeTypeOf('function');
    expect(mockWorkerInstance.on).toHaveBeenCalledWith('failed', expect.any(Function));
  });

  it('asks the model for the page with the brief and the full desktop capture, then dispatches the deploy job with it', async () => {
    const result = await capturedProcessor!(job({ forceRegenerate: true, previousStatus: 'NEEDS_APPROVAL' }));

    expect(fetch).toHaveBeenCalledWith('http://s3/desktop-full.webp', { signal: expect.any(AbortSignal) });
    const input = generate.mock.calls[0]![0];
    expect(input.screenshot).toEqual(Buffer.from([1, 2, 3]));
    expect(input.brief.business).toMatchObject({ name: 'Smile Dental', niche: 'dental', city: 'Warszawa' });
    expect(input.brief.placeholders).toEqual(['phone', 'email', 'address', 'booking']);
    const prompt = JSON.stringify(input.brief);
    for (const contact of [PHONE, EMAIL, 'ul. Topiel 11']) expect(prompt).not.toContain(contact);

    expect(addDeployJob).toHaveBeenCalledWith({
      leadId: 'lead-123',
      auditId: 'audit-456',
      forceRegenerate: true,
      previousStatus: 'NEEDS_APPROVAL',
      page: { id: expect.stringMatching(/^[0-9a-f-]{36}$/), html: PAGE, theme: THEME, grounding: okResult.grounding, kind: 'generate' },
      generationSource: { provider: 'claude-cli', modelUsed: 'claude-cli:sonnet' },
    });
    expect(result).toMatchObject({ success: true, attempts: 1 });
  });

  it('moves the lead to GENERATING through the state machine', async () => {
    await capturedProcessor!(job());
    expect(vi.mocked(Lead.findOneAndUpdate).mock.calls[0]![0]).toMatchObject({ _id: 'lead-123', status: { $in: expect.arrayContaining(['AUDITED']) } });
  });

  it('generates text-only when the capture cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await capturedProcessor!(job());
    expect(generate.mock.calls[0]![0].screenshot).toBeUndefined();
    expect(addDeployJob).toHaveBeenCalled();
  });

  it("builds a generator for the operator's provider and model and records both", async () => {
    await capturedProcessor!(job({ provider: 'anthropic', model: 'claude-opus-5-5' }));
    expect(MvpPageGenerator).toHaveBeenCalledWith({ provider: 'anthropic', model: 'claude-opus-5-5' });
    expect(defaultPageGenerator).not.toHaveBeenCalled();
    expect(vi.mocked(addDeployJob).mock.calls[0]![0].generationSource).toEqual({
      provider: 'claude-cli',
      modelUsed: 'claude-cli:sonnet',
      requestedProvider: 'anthropic',
      requestedModel: 'claude-opus-5-5',
    });
  });

  it.each(['invalid_page', 'not_configured'] as const)('fails for good with MVP_PAGE_UNAVAILABLE on %s', async (reason) => {
    generate.mockResolvedValue({ ok: false, reason, message: `the model said no (${reason})`, answers: [], modelUsed: 'm' });
    const error = await capturedProcessor!(job()).catch((e: unknown) => e);
    expect(error).toMatchObject({
      name: 'MvpPageUnavailableError',
      failure: { code: 'MVP_PAGE_UNAVAILABLE', reason, message: `the model said no (${reason})` },
    });
    expect((error as { failure: { at: unknown } }).failure.at).toBeInstanceOf(Date);
    expect(addDeployJob).not.toHaveBeenCalled();
  });

  it('throws a plain error on call_failed, so BullMQ tries the job again', async () => {
    generate.mockResolvedValue({ ok: false, reason: 'call_failed', message: 'timed out', answers: [], modelUsed: 'm' });
    const error = await capturedProcessor!(job()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).not.toBe('UnrecoverableError');
    expect((error as Error).message).toContain('timed out');
  });

  it('skips a lead that was rejected or moved on, without calling the model (REV-62)', async () => {
    vi.mocked(Lead.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(null) } as any);
    const result = await capturedProcessor!(job());
    expect(result).toMatchObject({ success: false, skipped: true });
    expect(generate).not.toHaveBeenCalled();
  });

  it('fails when the lead is missing or has no completed audit (REV-55)', async () => {
    vi.mocked(findGenerationAudit).mockResolvedValue(null as any);
    await expect(capturedProcessor!(job())).rejects.toThrow('No completed audit found for lead lead-123');
    vi.mocked(Lead.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue(null) } as any);
    await expect(capturedProcessor!(job())).rejects.toThrow('Lead lead-123 not found');
  });

  it('fails the job when the deploy job cannot be dispatched, so BullMQ retries it', async () => {
    vi.mocked(addDeployJob).mockRejectedValueOnce(new Error('Redis down'));
    await expect(capturedProcessor!(job())).rejects.toThrow('Redis down');
  });
});
