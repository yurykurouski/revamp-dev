import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LeadService } from '../lead.service.js';
import { Lead } from '../../models/Lead.model.js';
import { Audit } from '../../models/Audit.model.js';
import * as auditQueueModule from '../../queues/audit.queue.js';
import { AppError } from '../../middlewares/errorHandler.js';

vi.mock('../../models/Lead.model.js');
vi.mock('../../models/Audit.model.js');
vi.mock('../../queues/audit.queue.js');

describe('LeadService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      ).rejects.toThrow(AppError);
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

      await expect(LeadService.getLeadById('non-existent')).rejects.toThrow('Lead not found');
    });
  });
});
