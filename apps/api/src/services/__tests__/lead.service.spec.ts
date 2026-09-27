import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LeadService, LEAD_LIST_SORT } from '../lead.service.js';
import { Lead } from '../../models/Lead.model.js';
import { Audit } from '../../models/Audit.model.js';
import { MvpProject } from '../../models/MvpProject.model.js';
import * as auditQueueModule from '../../queues/audit.queue.js';
import { AppError } from '../../middlewares/errorHandler.js';

vi.mock('../../models/Lead.model.js');
vi.mock('../../models/Audit.model.js');
vi.mock('../../models/MvpProject.model.js');
vi.mock('../../queues/audit.queue.js');

/** An MvpProject.find query resolving to the given projects */
const mvpQuery = (result: Promise<unknown[]>) => ({ lean: () => ({ exec: () => result }) }) as any;

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

      vi.spyOn(Lead, 'create').mockResolvedValue(mockLead as any);
      vi.spyOn(Audit, 'create').mockResolvedValue(mockAudit as any);
      vi.spyOn(auditQueueModule, 'addAuditJob').mockResolvedValue({ id: 'job-999' } as any);

      const result = await LeadService.createLead({
        businessName: 'Dr. Smile',
        originalUrl: 'https://drsmile.example.com',
        contactEmail: 'smile@example.com',
        niche: 'dental',
      });

      expect(Lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          businessName: 'Dr. Smile',
          domain: 'drsmile.example.com',
          status: 'QUEUED',
        }),
      );
      expect(Audit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          leadId: 'lead-123',
          status: 'QUEUED',
        }),
      );
      expect(auditQueueModule.addAuditJob).toHaveBeenCalledWith({
        leadId: 'lead-123',
        url: 'https://drsmile.example.com',
        niche: 'dental',
      });
      expect(result.lead).toEqual(mockLead);
      expect(result.auditId).toBe('audit-123');
      expect(result.jobId).toBe('job-999');
    });

    it('should throw AppError if originalUrl is unparseable', async () => {
      await expect(
        LeadService.createLead({
          businessName: 'Bad URL Clinic',
          originalUrl: 'not_a_valid_url_at_all',
          contactEmail: 'bad@example.com',
          niche: 'other',
        }),
      ).rejects.toSatisfy((e) => e instanceof AppError && e.statusCode === 400 && e.code === 'INVALID_URL');
    });
  });

  describe('createLead tags (REV-29)', () => {
    beforeEach(() => {
      vi.spyOn(Lead, 'create').mockResolvedValue({ _id: 'lead-1', originalUrl: 'https://a.lt', niche: 'dental' } as any);
      vi.spyOn(Audit, 'create').mockResolvedValue({ _id: 'audit-1' } as any);
      vi.spyOn(auditQueueModule, 'addAuditJob').mockResolvedValue({ id: 'job-1' } as any);
    });

    const dto = { businessName: 'A Clinic', originalUrl: 'https://a.lt', contactEmail: 'info@a.lt', niche: 'dental' as const };

    it('should store the given tags', async () => {
      await LeadService.createLead(dto, { tags: ['discovered', 'source:osm'] });
      expect(Lead.create).toHaveBeenCalledWith(expect.objectContaining({ tags: ['discovered', 'source:osm'] }));
    });

    it('should leave tags to the model default when none are given', async () => {
      await LeadService.createLead(dto);
      expect(vi.mocked(Lead.create).mock.calls[0]?.[0]).not.toHaveProperty('tags');
    });
  });

  describe('createLead identity (REV-35)', () => {
    beforeEach(() => {
      vi.spyOn(Lead, 'create').mockResolvedValue({ _id: 'lead-1', originalUrl: 'https://a.lt', niche: 'dental' } as any);
      vi.spyOn(Audit, 'create').mockResolvedValue({ _id: 'audit-1' } as any);
      vi.spyOn(auditQueueModule, 'addAuditJob').mockResolvedValue({ id: 'job-1' } as any);
    });

    const dto = { businessName: 'A Clinic', originalUrl: 'https://a.lt', contactEmail: 'info@a.lt', niche: 'dental' as const };

    it('should store the domain in the same normalised form discovery matches on', async () => {
      await LeadService.createLead({ ...dto, originalUrl: 'https://WWW.A-Clinic.LT.:8443/contact' });
      expect(Lead.create).toHaveBeenCalledWith(expect.objectContaining({ domain: 'a-clinic.lt' }));
    });

    it('should default manual leads to source "manual" with no provider id', async () => {
      await LeadService.createLead(dto);
      const created = vi.mocked(Lead.create).mock.calls[0]?.[0] as Record<string, unknown>;
      expect(created['source']).toBe('manual');
      expect(created).not.toHaveProperty('externalId');
    });

    it('should store the discovery source and provider id when given', async () => {
      await LeadService.createLead(dto, { source: 'google', externalId: 'google:ChIJ123' });
      expect(Lead.create).toHaveBeenCalledWith(expect.objectContaining({ source: 'google', externalId: 'google:ChIJ123' }));
    });

    it('should store the E.164 phone next to the phone as entered', async () => {
      await LeadService.createLead({ ...dto, contactPhone: '+370 (600) 12-345' });
      expect(Lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ contactPhone: '+370 (600) 12-345', phoneE164: '+37060012345' }),
      );

      await LeadService.createLead({ ...dto, contactPhone: '8 600 12345' });
      expect(vi.mocked(Lead.create).mock.calls[1]?.[0]).toMatchObject({ phoneE164: undefined });
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

      const result = await LeadService.getLeads({ page: 2, limit: 10, status: 'QUEUED', niche: 'dental' });

      expect(Lead.find).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'QUEUED',
          niche: 'dental',
        }),
      );
      expect(mockFind.skip).toHaveBeenCalledWith(10);
      expect(mockFind.limit).toHaveBeenCalledWith(10);
      expect(result.leads).toEqual(mockLeads);
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

      await expect(LeadService.getLeads({})).rejects.toThrow('mvpprojects unavailable');
    });

    it('should not query MVPs for an empty page', async () => {
      mockLeadPage([]);
      const result = await LeadService.getLeads({});
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

      await LeadService.getLeads({ search: 'dental' });

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

      await expect(LeadService.getLeads({ search: 'Dr. Smile (Main+)' })).resolves.toBeDefined();

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

      const stats = await LeadService.getLeadStats();

      expect(Lead.aggregate).toHaveBeenCalledWith([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
      expect(stats).toEqual({ total: 41, byStatus: { QUEUED: 30, NEEDS_APPROVAL: 8, SENT: 3 } });
    });

    it('should count leads without a status in the total only', async () => {
      vi.spyOn(Lead, 'aggregate').mockReturnValue({
        exec: vi.fn().mockResolvedValue([{ _id: null, count: 2 }, { _id: 'QUEUED', count: 1 }]),
      } as any);

      expect(await LeadService.getLeadStats()).toEqual({ total: 3, byStatus: { QUEUED: 1 } });
    });

    it('should return zero for an empty pipeline', async () => {
      vi.spyOn(Lead, 'aggregate').mockReturnValue({ exec: vi.fn().mockResolvedValue([]) } as any);

      expect(await LeadService.getLeadStats()).toEqual({ total: 0, byStatus: {} });
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
      await LeadService.getLeads({});
      expect(mockFind.sort).toHaveBeenCalledWith({ onePageBrochure: -1, createdAt: -1 });
      expect(LEAD_LIST_SORT).toEqual({ onePageBrochure: -1, createdAt: -1 });
    });

    it('filters on the complexity class', async () => {
      mockList();
      await LeadService.getLeads({ complexity: 'ONE_PAGE_BROCHURE' });
      expect(Lead.find).toHaveBeenCalledWith({ siteComplexity: 'ONE_PAGE_BROCHURE' });
    });

    it('matches leads audited before REV-38 when filtering on UNKNOWN', async () => {
      mockList();
      await LeadService.getLeads({ complexity: 'UNKNOWN' });
      expect(Lead.find).toHaveBeenCalledWith({ siteComplexity: { $in: [null, 'UNKNOWN'] } });
    });

    it('does not filter on complexity when none is given', async () => {
      mockList();
      await LeadService.getLeads({ niche: 'dental' });
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

      const { leads } = await LeadService.getLeads({});

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

      const { leads } = await LeadService.getLeads({});

      expect(leads[0].completeness).toBeUndefined();
      expect(leads[0].previewUrl).toBe('http://minio/v/1/index.html');
    });
  });

  describe('getLeadById', () => {
    it('should return lead and its audit record', async () => {
      const mockLead = { _id: 'lead-1', businessName: 'Clinic' };
      const mockAudit = { _id: 'audit-1', leadId: 'lead-1' };

      vi.spyOn(Lead, 'findById').mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockLead),
      } as any);

      vi.spyOn(Audit, 'findOne').mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(mockAudit),
      } as any);

      const result = await LeadService.getLeadById('lead-1');

      expect(result.lead).toEqual(mockLead);
      expect(result.audit).toEqual(mockAudit);
    });

    it('should throw 404 AppError if lead does not exist', async () => {
      vi.spyOn(Lead, 'findById').mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      } as any);

      await expect(LeadService.getLeadById('non-existent')).rejects.toMatchObject({
        statusCode: 404,
        code: 'LEAD_NOT_FOUND',
        message: 'Lead not found',
      });
    });
  });
});
