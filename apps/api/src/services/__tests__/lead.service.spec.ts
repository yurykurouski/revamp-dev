import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LeadService, LEAD_LIST_SORT } from '../lead.service.js';
import { Lead, addLeadToBusiness } from '../../models/Lead.model.js';
import { Audit, findAuditForLead } from '../../models/Audit.model.js';
import { MvpProject } from '../../models/MvpProject.model.js';
import { ContactRight } from '../../models/ContactRight.model.js';
import * as auditQueueModule from '../../queues/audit.queue.js';
import { addAiGenerationJob } from '../../queues/ai.queue.js';
import { AUDIT_ENQUEUE_TIMEOUT_MS } from '../audit-enqueue.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { scopeFor } from '../../data/tenant-scope.js';
import { ContactRightRefusedError } from '@revamp/db';
import { env } from '../../config/env.js';

vi.mock('../../data/tenant-scope.js', async () => (await import('../../__tests__/scope-passthrough.js')).tenantScopeMock());
vi.mock('../../models/Lead.model.js');
vi.mock('../../models/Audit.model.js');
vi.mock('../../models/MvpProject.model.js');
vi.mock('../../queues/audit.queue.js');
vi.mock('../../queues/ai.queue.js', () => ({ addAiGenerationJob: vi.fn(), aiGenerationQueue: {} }));
vi.mock('../../queues/connection.js', () => ({ redisConnection: { status: 'ready' } }));

/** An MvpProject.find query resolving to the given projects */
const mvpQuery = (result: Promise<unknown[]>) => ({ lean: () => ({ exec: () => result }) }) as any;

const create = (dto: Parameters<typeof LeadService.createLead>[0], options: Partial<Parameters<typeof LeadService.createLead>[1]> = {}) =>
  LeadService.createLead(dto, { tenantId: 'studio-1', ...options });
const scope = scopeFor('5eed00000000000000000001');

describe('LeadService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Leads have no MVP unless a test says otherwise
    vi.mocked(MvpProject.find).mockReturnValue(mvpQuery(Promise.resolve([])));
  });

  describe('createLead', () => {
    it('should successfully create lead, create audit, and enqueue audit job', async () => {
      const mockLead = {
        _id: 'lead-123',
        id: 'lead-123',
        businessName: 'Dr. Smile',
        originalUrl: 'https://drsmile.example.com',
        domain: 'drsmile.example.com',
        niche: 'dental',
        status: 'QUEUED',
      };
      const mockAudit = {
        _id: 'audit-123',
        leadId: 'lead-123',
        status: 'QUEUED',
      };

      vi.mocked(addLeadToBusiness).mockResolvedValue({ lead: mockLead, audit: mockAudit } as any);
      vi.spyOn(auditQueueModule, 'addAuditJob').mockResolvedValue({ id: 'job-999' } as any);

      const result = await create({
        businessName: 'Dr. Smile',
        originalUrl: 'https://drsmile.example.com',
        contactEmail: 'smile@example.com',
        niche: 'dental',
      });

      expect(addLeadToBusiness).toHaveBeenCalledWith(
        expect.objectContaining({
          lead: expect.objectContaining({ businessName: 'Dr. Smile', domain: 'drsmile.example.com', status: 'QUEUED' }),
        }),
      );
      expect(auditQueueModule.addAuditJob).toHaveBeenCalledWith({
        leadId: 'lead-123',
        tenantId: 'studio-1',
        url: 'https://drsmile.example.com',
        niche: 'dental',
      });
      expect(result.lead).toEqual(mockLead);
      expect(result.auditId).toBe('audit-123');
      expect(result.jobId).toBe('job-999');
    });

    it('should throw AppError if originalUrl is unparseable', async () => {
      await expect(
        create({
          businessName: 'Bad URL Clinic',
          originalUrl: 'not_a_valid_url_at_all',
          contactEmail: 'bad@example.com',
          niche: 'other',
        }),
      ).rejects.toSatisfy((e) => e instanceof AppError && e.statusCode === 400 && e.code === 'INVALID_URL');
    });

    const dto = { businessName: 'A Clinic', originalUrl: 'https://a.lt', contactEmail: 'info@a.lt', niche: 'dental' as const };

    it('queues nothing when the lead and audit insert fails (REV-202)', async () => {
      vi.mocked(addLeadToBusiness).mockRejectedValue(new Error('audit insert failed'));
      await expect(create(dto)).rejects.toThrow('audit insert failed');
      expect(auditQueueModule.addAuditJob).not.toHaveBeenCalled();
    });

    it('answers AUDIT_QUEUE_UNAVAILABLE and fails the lead when the job cannot be queued (REV-202)', async () => {
      vi.mocked(addLeadToBusiness).mockResolvedValue({
        lead: { _id: 'lead-1', originalUrl: 'https://a.lt', niche: 'dental' },
        audit: { _id: 'audit-1' },
      } as any);
      vi.mocked(auditQueueModule.addAuditJob).mockRejectedValue(new Error('ECONNREFUSED'));
      vi.mocked(Lead.findOneAndUpdate).mockReturnValue({ exec: () => Promise.resolve({}) } as any);
      vi.mocked(Audit.updateOne).mockReturnValue({ exec: () => Promise.resolve({}) } as any);

      await expect(create(dto)).rejects.toSatisfy(
        (e) => e instanceof AppError && e.statusCode === 503 && e.code === 'AUDIT_QUEUE_UNAVAILABLE',
      );
      expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 'lead-1' }),
        expect.objectContaining({ $set: expect.objectContaining({ status: 'AUDIT_FAILED' }) }),
      );
    });
  });

  describe('createLead tags (REV-29)', () => {
    beforeEach(() => {
      vi.mocked(addLeadToBusiness).mockResolvedValue({
        lead: { _id: 'lead-1', originalUrl: 'https://a.lt', niche: 'dental' },
        audit: { _id: 'audit-1' },
      } as any);
      vi.spyOn(auditQueueModule, 'addAuditJob').mockResolvedValue({ id: 'job-1' } as any);
    });

    const dto = { businessName: 'A Clinic', originalUrl: 'https://a.lt', contactEmail: 'info@a.lt', niche: 'dental' as const };

    it("should store the operator's locale, and none when the request had none (REV-162)", async () => {
      await create({ ...dto, operatorLocale: 'pl' });
      expect(addLeadToBusiness).toHaveBeenCalledWith(expect.objectContaining({ lead: expect.objectContaining({ operatorLocale: 'pl' }) }));
      await create(dto);
      expect(vi.mocked(addLeadToBusiness).mock.calls[1]?.[0]?.lead).not.toHaveProperty('operatorLocale');
    });

    it('should store the given tags', async () => {
      await create(dto, { tags: ['discovered', 'source:osm'] });
      expect(addLeadToBusiness).toHaveBeenCalledWith(expect.objectContaining({ lead: expect.objectContaining({ tags: ['discovered', 'source:osm'] }) }));
    });

    it('should leave tags to the model default when none are given', async () => {
      await create(dto);
      expect(vi.mocked(addLeadToBusiness).mock.calls[0]?.[0]?.lead).not.toHaveProperty('tags');
    });
  });

  describe('createLead identity (REV-35)', () => {
    beforeEach(() => {
      vi.mocked(addLeadToBusiness).mockResolvedValue({
        lead: { _id: 'lead-1', originalUrl: 'https://a.lt', niche: 'dental' },
        audit: { _id: 'audit-1' },
      } as any);
      vi.spyOn(auditQueueModule, 'addAuditJob').mockResolvedValue({ id: 'job-1' } as any);
    });

    const dto = { businessName: 'A Clinic', originalUrl: 'https://a.lt', contactEmail: 'info@a.lt', niche: 'dental' as const };

    it('should store the domain in the same normalised form discovery matches on', async () => {
      await create({ ...dto, originalUrl: 'https://WWW.A-Clinic.LT.:8443/contact' });
      expect(addLeadToBusiness).toHaveBeenCalledWith(expect.objectContaining({ lead: expect.objectContaining({ domain: 'a-clinic.lt' }) }));
    });

    it('should default manual leads to source "manual" with no provider id', async () => {
      await create(dto);
      const created = vi.mocked(addLeadToBusiness).mock.calls[0]?.[0]?.lead as Record<string, unknown>;
      expect(created['source']).toBe('manual');
      expect(created).not.toHaveProperty('externalId');
    });

    it('should store the discovery source and provider id when given', async () => {
      await create(dto, { source: 'google', externalId: 'google:ChIJ123' });
      expect(addLeadToBusiness).toHaveBeenCalledWith(expect.objectContaining({ lead: expect.objectContaining({ source: 'google', externalId: 'google:ChIJ123' }) }));
    });

    it('should store the E.164 phone next to the phone as entered', async () => {
      await create({ ...dto, contactPhone: '+370 (600) 12-345' });
      expect(addLeadToBusiness).toHaveBeenCalledWith(
        expect.objectContaining({ lead: expect.objectContaining({ contactPhone: '+370 (600) 12-345', phoneE164: '+37060012345' }) }),
      );

      await create({ ...dto, contactPhone: '8 600 12345' });
      expect(vi.mocked(addLeadToBusiness).mock.calls[1]?.[0]?.lead).toMatchObject({ phoneE164: undefined });
    });
  });

  describe('createLead and the shared business (REV-208)', () => {
    const dto = { businessName: 'A Clinic', originalUrl: 'https://www.a.lt/contact', contactEmail: 'info@a.lt', niche: 'dental' as const };

    beforeEach(() => {
      vi.spyOn(auditQueueModule, 'addAuditJob').mockResolvedValue({ id: 'job-1' } as any);
    });

    it("adds the lead for the caller's studio, on the canonical domain, and passes the audit-derived fields function", async () => {
      vi.mocked(addLeadToBusiness).mockResolvedValue({ lead: { _id: 'l1', originalUrl: dto.originalUrl, niche: 'dental' }, audit: { _id: 'a1' }, reused: false } as any);
      await create(dto, { tenantId: 'studio-1' });
      const input = vi.mocked(addLeadToBusiness).mock.calls[0]![0];
      expect(input.tenantId).toBe('studio-1');
      expect(input.lead).toMatchObject({ domain: 'a.lt', status: 'QUEUED' });
      expect(input.deriveFromAudit({ scores: { total: 42 }, siteComplexity: { class: 'ONE_PAGE_BROCHURE' } } as never, {}).set).toMatchObject({
        totalScore: 42,
        onePageBrochure: true,
      });
    });

    it('queues the audit job for a lead with its own audit', async () => {
      vi.mocked(addLeadToBusiness).mockResolvedValue({ lead: { _id: 'l1', originalUrl: dto.originalUrl, niche: 'dental' }, audit: { _id: 'a1' }, reused: false } as any);
      const result = await create(dto, { tenantId: 'studio-1' });
      expect(auditQueueModule.addAuditJob).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ auditId: 'a1', jobId: 'job-1' });
    });

    it("queues no audit for a lead that took another studio's audit, and queues the MVP generation instead", async () => {
      vi.mocked(addLeadToBusiness).mockResolvedValue({
        lead: { _id: 'l2', originalUrl: dto.originalUrl, niche: 'dental' },
        sourceAudit: { _id: 'shared-audit' },
        reused: true,
      } as any);
      vi.mocked(addAiGenerationJob).mockResolvedValue({ id: 'ai-1' } as any);
      const result = await create(dto, { tenantId: 'studio-2' });
      expect(auditQueueModule.addAuditJob).not.toHaveBeenCalled();
      expect(addAiGenerationJob).toHaveBeenCalledWith({ leadId: 'l2', tenantId: 'studio-2', auditId: 'shared-audit' });
      expect(result).toMatchObject({ auditId: 'shared-audit', jobId: 'ai-1', reused: true });
    });

    it('keeps a reused lead as it is when the generation job cannot be queued: it is AUDITED and can be generated by hand', async () => {
      vi.mocked(addLeadToBusiness).mockResolvedValue({ lead: { _id: 'l2', originalUrl: dto.originalUrl, niche: 'dental' }, sourceAudit: { _id: 'shared-audit' }, reused: true } as any);
      vi.mocked(addAiGenerationJob).mockRejectedValue(new Error('redis down'));
      const result = await create(dto, { tenantId: 'studio-2' });
      expect(result).toMatchObject({ auditId: 'shared-audit' });
      expect(result.jobId).toBeUndefined();
      expect(Lead.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('does not hang when the queue never answers: the reused lead is returned after the enqueue limit, still AUDITED (REV-208 review)', async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(addLeadToBusiness).mockResolvedValue({ lead: { _id: 'l2', originalUrl: dto.originalUrl, niche: 'dental' }, sourceAudit: { _id: 'shared-audit' }, reused: true } as any);
        // Redis down: the connection retries forever, so the call neither resolves nor rejects
        vi.mocked(addAiGenerationJob).mockReturnValue(new Promise(() => undefined) as never);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const pending = create(dto, { tenantId: 'studio-2' });
        await vi.advanceTimersByTimeAsync(AUDIT_ENQUEUE_TIMEOUT_MS + 1);
        const result = await pending;
        expect(result).toMatchObject({ auditId: 'shared-audit' });
        expect(result.jobId).toBeUndefined();
        expect(Lead.findOneAndUpdate).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('answers 409 LEAD_ALREADY_EXISTS with the id of the existing lead when the studio already has one for the site', async () => {
      vi.mocked(addLeadToBusiness).mockRejectedValue(Object.assign(new Error('exists'), { code: 'LEAD_ALREADY_EXISTS', leadId: 'old-lead' }));
      const error = await create(dto, { tenantId: 'studio-1' }).catch((e) => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ statusCode: 409, code: 'LEAD_ALREADY_EXISTS', details: { leadId: 'old-lead' } });
      expect(auditQueueModule.addAuditJob).not.toHaveBeenCalled();
    });

    it('claims the studio\'s contact right with the env durations and returns its expiry (REV-225)', async () => {
      const expiresAt = new Date('2026-12-11T00:00:00.000Z');
      vi.mocked(addLeadToBusiness).mockResolvedValue({
        lead: { _id: 'l', originalUrl: 'https://x.example', niche: 'dental' },
        audit: { _id: 'a' },
        reused: false,
        contactRight: { expiresAt },
      } as any);
      vi.spyOn(auditQueueModule, 'addAuditJob').mockResolvedValue({ id: 'job' } as any);
      const result = await create(dto, { tenantId: 'studio-1' });
      expect(vi.mocked(addLeadToBusiness).mock.calls[0]![0].contactRight).toEqual({
        durations: { rightDays: env.CONTACT_RIGHT_DAYS, cooldownDays: env.CONTACT_COOLDOWN_DAYS },
        source: 'ADD_LEAD',
      });
      expect(result.contactRightExpiresAt).toEqual(expiresAt);
    });

    it('returns the right on the reused-audit path too (REV-225)', async () => {
      const expiresAt = new Date('2026-12-11T00:00:00.000Z');
      vi.mocked(addLeadToBusiness).mockResolvedValue({
        lead: { _id: 'l' },
        sourceAudit: { _id: 'shared' },
        reused: true,
        contactRight: { expiresAt },
      } as any);
      vi.mocked(addAiGenerationJob).mockResolvedValue({ id: 'ai' } as any);
      expect((await create(dto, { tenantId: 'studio-1' })).contactRightExpiresAt).toEqual(expiresAt);
    });

    it.each([
      ['held', 'CONTACT_RIGHT_HELD', new Date('2026-12-11T00:00:00.000Z'), { expiresAt: '2026-12-11T00:00:00.000Z' }],
      ['cooldown', 'BUSINESS_IN_COOLDOWN', new Date('2027-01-10T00:00:00.000Z'), { availableAt: '2027-01-10T00:00:00.000Z' }],
      ['opted_out', 'BUSINESS_OPTED_OUT', undefined, undefined],
    ] as const)('maps a %s refusal to 409 %s and queues nothing (REV-225)', async (reason, code, until, details) => {
      vi.mocked(addLeadToBusiness).mockRejectedValue(new ContactRightRefusedError(reason, until));
      const error = await create(dto, { tenantId: 'studio-1' }).catch((e) => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ statusCode: 409, code, details });
      expect(auditQueueModule.addAuditJob).not.toHaveBeenCalled();
      expect(addAiGenerationJob).not.toHaveBeenCalled();
    });

    it('passes any other failure through', async () => {
      const boom = new Error('mongo down');
      vi.mocked(addLeadToBusiness).mockRejectedValue(boom);
      await expect(create(dto, { tenantId: 'studio-1' })).rejects.toBe(boom);
    });
  });

  describe('getLeads', () => {
    it('should return paginated leads with correct metadata', async () => {
      const mockLeads = [{ id: '1', businessName: 'Clinic 1' }];
      const mockFind = {
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(mockLeads),
      };
      const mockCount = {
        exec: vi.fn().mockResolvedValue(25),
      };

      vi.spyOn(Lead, 'find').mockReturnValue(mockFind as any);
      vi.spyOn(Lead, 'countDocuments').mockReturnValue(mockCount as any);

      const result = await LeadService.getLeads(scope, { page: 2, limit: 10, status: 'QUEUED', niche: 'dental' });

      expect(Lead.find).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'QUEUED',
          niche: 'dental',
        }),
      );
      expect(mockFind.skip).toHaveBeenCalledWith(10);
      expect(mockFind.limit).toHaveBeenCalledWith(10);
      expect(result.leads).toEqual(mockLeads.map((l) => ({ ...l, contactRight: null })));
      expect(result.pagination).toEqual({
        total: 25,
        page: 2,
        limit: 10,
        totalPages: 3,
      });
    });

    const mockLeadPage = (leads: unknown[]) => {
      vi.spyOn(Lead, 'find').mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(leads),
      } as any);
      vi.spyOn(Lead, 'countDocuments').mockReturnValue({ exec: vi.fn().mockResolvedValue(leads.length) } as any);
    };

    it('should surface an MVP lookup failure instead of hiding it (REV-45)', async () => {
      mockLeadPage([{ _id: 'lead-1', businessName: 'Clinic 1' }]);
      vi.mocked(MvpProject.find).mockReturnValue(mvpQuery(Promise.reject(new Error('mvpprojects unavailable'))));

      await expect(LeadService.getLeads(scope, {})).rejects.toThrow('mvpprojects unavailable');
    });

    it('should not query MVPs for an empty page', async () => {
      mockLeadPage([]);
      const result = await LeadService.getLeads(scope, {});
      expect(result.leads).toEqual([]);
      expect(MvpProject.find).not.toHaveBeenCalled();
    });

    it('should construct search regex filter when query.search is provided', async () => {
      const mockFind = {
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      };
      const mockCount = {
        exec: vi.fn().mockResolvedValue(0),
      };

      vi.spyOn(Lead, 'find').mockReturnValue(mockFind as any);
      vi.spyOn(Lead, 'countDocuments').mockReturnValue(mockCount as any);

      await LeadService.getLeads(scope, { search: 'dental' });

      expect(Lead.find).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: expect.arrayContaining([
            expect.objectContaining({ businessName: expect.any(RegExp) }),
            expect.objectContaining({ domain: expect.any(RegExp) }),
          ]),
        }),
      );
    });
  });

  describe('getLeads search escaping (REV-43)', () => {
    it('should match regex metacharacters in the search text literally', async () => {
      vi.spyOn(Lead, 'find').mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      } as any);
      vi.spyOn(Lead, 'countDocuments').mockReturnValue({ exec: vi.fn().mockResolvedValue(0) } as any);

      await expect(LeadService.getLeads(scope, { search: 'Dr. Smile (Main+)' })).resolves.toBeDefined();

      const filter = vi.mocked(Lead.find).mock.calls[0]?.[0] as { $or: Array<{ businessName?: RegExp }> };
      const regex = filter.$or.find((clause) => clause.businessName)!.businessName!;
      expect(regex.test('dr. smile (main+) clinic')).toBe(true);
      expect(regex.test('Dr5 Smile Main')).toBe(false);
      expect(regex.flags).toContain('i');
    });
  });

  describe('getLeadStats (REV-43)', () => {
    it('should total the per-status counts from the aggregation', async () => {
      vi.spyOn(Lead, 'aggregate').mockReturnValue({
        exec: vi.fn().mockResolvedValue([
          { _id: 'QUEUED', count: 30 },
          { _id: 'NEEDS_APPROVAL', count: 8 },
          { _id: 'SENT', count: 3 },
        ]),
      } as any);

      const stats = await LeadService.getLeadStats(scope);

      expect(Lead.aggregate).toHaveBeenCalledWith([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
      expect(stats).toEqual({ total: 41, byStatus: { QUEUED: 30, NEEDS_APPROVAL: 8, SENT: 3 } });
    });

    it('should count leads without a status in the total only', async () => {
      vi.spyOn(Lead, 'aggregate').mockReturnValue({
        exec: vi.fn().mockResolvedValue([{ _id: null, count: 2 }, { _id: 'QUEUED', count: 1 }]),
      } as any);

      expect(await LeadService.getLeadStats(scope)).toEqual({ total: 3, byStatus: { QUEUED: 1 } });
    });

    it('should return zero for an empty pipeline', async () => {
      vi.spyOn(Lead, 'aggregate').mockReturnValue({ exec: vi.fn().mockResolvedValue([]) } as any);

      expect(await LeadService.getLeadStats(scope)).toEqual({ total: 0, byStatus: {} });
    });
  });

  describe('getLeads site complexity (REV-38)', () => {
    const mockList = () => {
      const mockFind = {
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      };
      vi.spyOn(Lead, 'find').mockReturnValue(mockFind as any);
      vi.spyOn(Lead, 'countDocuments').mockReturnValue({ exec: vi.fn().mockResolvedValue(0) } as any);
      return mockFind;
    };

    it('sorts one-page brochure sites first, newest first within each group', async () => {
      const mockFind = mockList();
      await LeadService.getLeads(scope, {});
      expect(mockFind.sort).toHaveBeenCalledWith({ onePageBrochure: -1, createdAt: -1 });
      expect(LEAD_LIST_SORT).toEqual({ onePageBrochure: -1, createdAt: -1 });
    });

    it('filters on the complexity class', async () => {
      mockList();
      await LeadService.getLeads(scope, { complexity: 'ONE_PAGE_BROCHURE' });
      expect(Lead.find).toHaveBeenCalledWith({ siteComplexity: 'ONE_PAGE_BROCHURE' });
    });

    it('matches leads audited before REV-38 when filtering on UNKNOWN', async () => {
      mockList();
      await LeadService.getLeads(scope, { complexity: 'UNKNOWN' });
      expect(Lead.find).toHaveBeenCalledWith({ siteComplexity: { $in: [null, 'UNKNOWN'] } });
    });

    it('does not filter on complexity when none is given', async () => {
      mockList();
      await LeadService.getLeads(scope, { niche: 'dental' });
      expect(Lead.find).toHaveBeenCalledWith({ niche: 'dental' });
    });
  });

  describe('getLeads completeness summary (REV-36)', () => {
    const mockLeadQuery = (leads: unknown[]) => {
      vi.spyOn(Lead, 'find').mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(leads),
      } as any);
      vi.spyOn(Lead, 'countDocuments').mockReturnValue({ exec: vi.fn().mockResolvedValue(leads.length) } as any);
    };
    const mockMvps = (mvps: unknown[]) =>
      vi.spyOn(MvpProject, 'find').mockReturnValue({
        lean: () => ({ exec: vi.fn().mockResolvedValue(mvps) }),
      } as any);

    it('adds the critical issues from the MVP completeness report to each lead', async () => {
      mockLeadQuery([
        { _id: 'lead-1', businessName: 'Clinic 1' },
        { _id: 'lead-2', businessName: 'Clinic 2' },
        { _id: 'lead-3', businessName: 'Clinic 3' },
      ]);
      mockMvps([
        {
          leadId: 'lead-1',
          fullPreviewUrl: 'http://minio/v/1/index.html',
          completenessReport: {
            status: 'verified',
            score: 62,
            hasCriticalIssues: true,
            checkedAt: '2026-09-26T10:00:00.000Z',
            checks: [
              { field: 'phone', tier: 'critical', status: 'missing' },
              { field: 'email', tier: 'critical', status: 'present' },
              { field: 'email', tier: 'critical', status: 'unsourced' },
              { field: 'services', tier: 'important', status: 'missing' },
            ],
          },
        },
        {
          leadId: 'lead-2',
          fullPreviewUrl: 'http://minio/v/2/index.html',
          completenessReport: { status: 'unverified', hasCriticalIssues: false, checks: [], checkedAt: '2026-09-26T10:00:00.000Z' },
        },
      ]);

      const { leads } = await LeadService.getLeads(scope, {});

      expect(leads[0].completeness).toEqual({
        status: 'verified',
        score: 62,
        hasCriticalIssues: true,
        criticalIssues: ['phone', 'email'],
      });
      expect(leads[1].completeness).toEqual({
        status: 'unverified',
        score: undefined,
        hasCriticalIssues: false,
        criticalIssues: [],
      });
      // No MVP yet, or an MVP deployed before the check existed
      expect(leads[2].completeness).toBeUndefined();
    });

    it('leaves leads without a summary when the MVP has no report', async () => {
      mockLeadQuery([{ _id: 'lead-1', businessName: 'Clinic 1' }]);
      mockMvps([{ leadId: 'lead-1', fullPreviewUrl: 'http://minio/v/1/index.html' }]);

      const { leads } = await LeadService.getLeads(scope, {});

      expect(leads[0].completeness).toBeUndefined();
      expect(leads[0].previewUrl).toBe('http://minio/v/1/index.html');
    });
  });

  describe('the studio\'s contact right on a lead (REV-228)', () => {
    const NOW = new Date('2026-11-27T12:00:00.000Z');
    const day = 86_400_000;
    const mockLeadQuery = (leads: unknown[]) => {
      vi.spyOn(Lead, 'find').mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(leads),
      } as any);
      vi.spyOn(Lead, 'countDocuments').mockReturnValue({ exec: vi.fn().mockResolvedValue(leads.length) } as any);
    };
    const mockRights = (rights: unknown[]) =>
      vi.spyOn(ContactRight, 'find').mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        lean: () => ({ exec: vi.fn().mockResolvedValue(rights) }),
      } as any);

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
    });
    afterEach(() => vi.useRealTimers());

    it('adds the view to each lead of a page with one query: active, ended, and none', async () => {
      mockLeadQuery([
        { _id: 'l1', businessId: 'b1' },
        { _id: 'l2', businessId: 'b2' },
        { _id: 'l3', businessId: 'b3' },
        { _id: 'l4' },
      ]);
      const expiresAt = new Date(NOW.getTime() + 10 * day);
      const endedAt = new Date(NOW.getTime() - day);
      const rights = mockRights([
        { businessId: 'b1', grantedAt: new Date(NOW.getTime() - day), expiresAt },
        // newest first: the second b2 right is older and ignored
        { businessId: 'b2', grantedAt: new Date(NOW.getTime() - 5 * day), expiresAt: new Date(NOW.getTime() + 20 * day), endedAt, endReason: 'opted_out' },
        { businessId: 'b2', grantedAt: new Date(NOW.getTime() - 50 * day), expiresAt: new Date(NOW.getTime() - 20 * day) },
        { businessId: 'b3', grantedAt: new Date(NOW.getTime() - 40 * day), expiresAt: new Date(NOW.getTime() - 10 * day) },
      ]);

      const { leads } = await LeadService.getLeads(scope, {});

      expect(rights).toHaveBeenCalledTimes(1);
      expect(leads[0].contactRight).toEqual({ expiresAt: expiresAt.toISOString(), active: true });
      expect(leads[1].contactRight).toEqual({
        expiresAt: new Date(NOW.getTime() + 20 * day).toISOString(),
        active: false,
        endedAt: endedAt.toISOString(),
        endReason: 'opted_out',
      });
      expect(leads[2].contactRight).toEqual({ expiresAt: new Date(NOW.getTime() - 10 * day).toISOString(), active: false });
      expect(leads[3].contactRight).toBeNull();
    });

    it('is null for a business the studio never had a right on, and reads nothing without a business', async () => {
      mockLeadQuery([{ _id: 'l1', businessId: 'b1' }, { _id: 'l2' }]);
      mockRights([]);
      const { leads } = await LeadService.getLeads(scope, {});
      expect(leads.map((l: any) => l.contactRight)).toEqual([null, null]);

      const rights = mockRights([]);
      rights.mockClear();
      mockLeadQuery([{ _id: 'l2' }]);
      await LeadService.getLeads(scope, {});
      expect(rights).toHaveBeenCalledTimes(0);
    });

    it('the lead detail carries the same view', async () => {
      const expiresAt = new Date(NOW.getTime() + 2 * day);
      vi.spyOn(Lead, 'findById').mockReturnValue({ exec: vi.fn().mockResolvedValue({ _id: 'l1', businessId: 'b1', businessName: 'Clinic' }) } as any);
      vi.spyOn(ContactRight, 'findOne').mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        lean: () => ({ exec: vi.fn().mockResolvedValue({ businessId: 'b1', grantedAt: new Date(NOW.getTime() - day), expiresAt }) }),
        exec: vi.fn().mockResolvedValue({ businessId: 'b1', grantedAt: new Date(NOW.getTime() - day), expiresAt }),
      } as any);
      vi.mocked(findAuditForLead).mockResolvedValue(null as never);

      const result = await LeadService.getLeadById(scope, 'l1');

      expect((result.lead as any).contactRight).toEqual({ expiresAt: expiresAt.toISOString(), active: true });
      expect((result.lead as any).businessName).toBe('Clinic');
    });

    it('the lead detail has a null view without a right', async () => {
      vi.spyOn(Lead, 'findById').mockReturnValue({ exec: vi.fn().mockResolvedValue({ _id: 'l1', businessName: 'Clinic' }) } as any);
      vi.mocked(findAuditForLead).mockResolvedValue(null as never);
      const result = await LeadService.getLeadById(scope, 'l1');
      expect((result.lead as any).contactRight).toBeNull();
    });
  });

  describe('getLeadById', () => {
    it('should return lead and its audit record', async () => {
      const mockLead = { _id: 'lead-1', businessName: 'Clinic' };
      const mockAudit = { _id: 'audit-1', leadId: 'lead-1' };

      vi.spyOn(Lead, 'findById').mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockLead),
      } as any);

      vi.mocked(findAuditForLead).mockResolvedValue(mockAudit as never);

      const result = await LeadService.getLeadById(scope, 'lead-1');

      expect(result.lead).toEqual({ ...mockLead, contactRight: null });
      expect(result.audit).toEqual(mockAudit);
      // The lead's own newest audit, else the completed audit of its business (REV-208)
      expect(findAuditForLead).toHaveBeenCalledWith(mockLead);
    });

    it('should throw 404 AppError if lead does not exist', async () => {
      vi.spyOn(Lead, 'findById').mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      } as any);

      await expect(LeadService.getLeadById(scope, 'non-existent')).rejects.toMatchObject({
        statusCode: 404,
        code: 'LEAD_NOT_FOUND',
        message: 'Lead not found',
      });
    });
  });
});
