import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuditWorker } from '../audit.worker.js';
import { Audit } from '../../models/Audit.model.js';
import { Lead } from '../../models/Lead.model.js';
import { Business } from '../../models/Business.model.js';
import { AnalyticsEvent } from '../../models/AnalyticsEvent.model.js';
import { measureSite } from '../../services/site-audit.js';
import { addAiGenerationJob } from '../../queues/ai.queue.js';
import { STALLED_AUDIT_MESSAGE, handleAuditJobFailed } from '../audit-failure.js';

const AUDIT_ID = '5eed00000000000000000a01';
const BUSINESS_ID = '5eed00000000000000000b01';

vi.mock('../../models/Audit.model.js');
vi.mock('../../models/Lead.model.js');
vi.mock('../../models/Business.model.js');
vi.mock('../../models/AnalyticsEvent.model.js');
vi.mock('../../services/site-audit.js');
vi.mock('../../queues/ai.queue.js', () => ({ addAiGenerationJob: vi.fn() }));
vi.mock('../../queues/connection.js', () => ({ redisConnection: {} as any }));

let capturedProcessor: ((job: any) => Promise<any>) | null = null;
vi.mock('bullmq', () => {
  class UnrecoverableError extends Error {}
  return {
    UnrecoverableError,
    Queue: vi.fn(),
    Worker: vi.fn().mockImplementation(function (_name: string, processor: any) {
      capturedProcessor = processor;
      return { on: vi.fn(), close: vi.fn() };
    }),
  };
});

const exec = (value: unknown) => ({ exec: vi.fn().mockResolvedValue(value) }) as any;
const platformJob = (extra: Record<string, unknown> = {}) => ({
  id: 'pj-1',
  name: 'platform-audit',
  attemptsMade: 0,
  opts: { attempts: 3 },
  data: { auditId: AUDIT_ID, businessId: BUSINESS_ID, url: 'https://biz.example', niche: 'dental' },
  ...extra,
});

const measured = (over: Record<string, unknown> = {}) => ({
  update: { status: 'COMPLETED', scores: { total: 70 }, $unset: { siteEra: '' } },
  unmeasured: ['siteEra'],
  scores: { total: 70 },
  siteComplexity: { class: 'simple', reasons: [] },
  extractedContacts: {},
  measurementErrors: [{ measurement: 'standards', message: 'not read' }],
  summary: 'summary',
  screenshotUrls: {},
  ...over,
});

describe('platform audit job (REV-232)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProcessor = null;
    vi.mocked(Lead.exists).mockResolvedValue(null as any);
    vi.mocked(Business.findById).mockReturnValue({ lean: vi.fn().mockResolvedValue({ businessName: 'Biz Dental' }) } as any);
    vi.mocked(Audit.findOneAndUpdate).mockReturnValue(exec({ _id: AUDIT_ID }));
    vi.mocked(measureSite).mockResolvedValue(measured() as any);
  });

  const run = (job = platformJob()) => {
    createAuditWorker();
    return capturedProcessor!(job);
  };

  it('claims its audit, measures the site and writes the result by id, with no lead and no generation job', async () => {
    const result = await run();

    expect(result).toMatchObject({ success: true, auditId: AUDIT_ID, businessId: BUSINESS_ID });
    const claim = vi.mocked(Audit.findOneAndUpdate).mock.calls[0]!;
    expect(claim[0]).toEqual({
      _id: AUDIT_ID,
      businessId: BUSINESS_ID,
      leadId: { $exists: false },
      status: { $in: ['QUEUED', 'PROCESSING'] },
    });
    expect(claim[1]).toEqual({ status: 'PROCESSING' });

    const input = vi.mocked(measureSite).mock.calls[0]![0];
    expect(input).toMatchObject({
      url: 'https://biz.example',
      niche: 'dental',
      businessName: 'Biz Dental',
      storageOwnerId: `business-${BUSINESS_ID}`,
    });

    const write = vi.mocked(Audit.findOneAndUpdate).mock.calls[1]!;
    expect(write[0]).toMatchObject({ _id: AUDIT_ID, businessId: BUSINESS_ID, leadId: { $exists: false } });
    expect(write[1]).toEqual(measured().update);

    expect(Lead.findOneAndUpdate).not.toHaveBeenCalled();
    expect(Lead.updateOne).not.toHaveBeenCalled();
    expect(addAiGenerationJob).not.toHaveBeenCalled();
  });

  it('records token events with no leadId and no tenantId', async () => {
    vi.mocked(measureSite).mockImplementation(async (input) => {
      await input.recordTokens('audit_vision_critique', 'model-x', { promptTokens: 1, completionTokens: 2, totalTokens: 3 });
      return measured() as any;
    });
    await run();
    const event = vi.mocked(AnalyticsEvent.create).mock.calls[0]![0] as any;
    expect(event.eventType).toBe('token_usage');
    expect(event).not.toHaveProperty('leadId');
    expect(event).not.toHaveProperty('tenantId');
    expect(event.metadata).toMatchObject({ stage: 'audit_vision_critique', auditId: AUDIT_ID, businessId: BUSINESS_ID, totalTokens: 3 });
  });

  it('skips an audit it cannot claim (a lead audit, a finished audit, a stale retry) and writes nothing', async () => {
    vi.mocked(Audit.findOneAndUpdate).mockReturnValue(exec(null));
    const result = await run();
    expect(result).toMatchObject({ success: false, skipped: true });
    expect(measureSite).not.toHaveBeenCalled();
    expect(Audit.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('does not require a tenantId (the lead path would refuse such a job)', async () => {
    await expect(run(platformJob())).resolves.toMatchObject({ success: true });
  });

  it('a crawl error on the last attempt writes FAILED with a sanitized reason and rethrows', async () => {
    vi.mocked(measureSite).mockRejectedValue(new Error('page timed out'));
    await expect(run(platformJob({ attemptsMade: 2 }))).rejects.toThrow('page timed out');
    const failed = vi.mocked(Audit.findOneAndUpdate).mock.calls[1]!;
    expect(failed[0]).toMatchObject({ _id: AUDIT_ID, leadId: { $exists: false }, status: { $in: ['QUEUED', 'PROCESSING'] } });
    expect(failed[1]).toMatchObject({ status: 'FAILED', errorMessage: expect.any(String) });
  });

  it('a crawl error with retries left keeps the audit claimable and rethrows', async () => {
    vi.mocked(measureSite).mockRejectedValue(new Error('page timed out'));
    await expect(run(platformJob({ attemptsMade: 0 }))).rejects.toThrow('page timed out');
    expect(Audit.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('a permanent error fails the audit and does not retry', async () => {
    vi.mocked(measureSite).mockRejectedValue(new Error('net::ERR_NAME_NOT_RESOLVED at https://biz.example'));
    await expect(run()).rejects.toThrow(/./);
    const failed = vi.mocked(Audit.findOneAndUpdate).mock.calls[1]!;
    expect(failed[1]).toMatchObject({ status: 'FAILED' });
  });

  it('a lead job still needs its studio', async () => {
    createAuditWorker();
    await expect(
      capturedProcessor!({ id: 'lj', name: 'audit-website', data: { leadId: 'lead-1', url: 'https://x.example', niche: 'other' } }),
    ).rejects.toThrow(/no valid tenantId/);
    expect(measureSite).not.toHaveBeenCalled();
  });
});

describe('a stalled platform audit job (REV-232)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Audit.findOneAndUpdate).mockReturnValue(exec({}));
  });

  it('marks only that audit FAILED and never reads or writes a lead', async () => {
    await handleAuditJobFailed(platformJob() as any, new Error('job stalled more than allowable limit'));
    expect(Audit.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: AUDIT_ID, businessId: BUSINESS_ID, leadId: { $exists: false }, status: { $in: ['QUEUED', 'PROCESSING'] } },
      { status: 'FAILED', errorMessage: STALLED_AUDIT_MESSAGE },
    );
    expect(Lead.exists).not.toHaveBeenCalled();
    expect(Lead.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('ignores a platform job that failed for another reason', async () => {
    await handleAuditJobFailed(platformJob() as any, new Error('boom'));
    expect(Audit.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
