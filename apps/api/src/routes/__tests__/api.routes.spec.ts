import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../../app.js';
import { LeadService } from '../../services/lead.service.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { Audit } from '../../models/Audit.model.js';
import { Lead } from '../../models/Lead.model.js';
import { MvpProject } from '../../models/MvpProject.model.js';
import { EmailCampaign } from '../../models/EmailCampaign.model.js';
import * as auditQueue from '../../queues/audit.queue.js';

vi.mock('../../services/lead.service.js');
vi.mock('../../models/Audit.model.js');
vi.mock('../../models/Lead.model.js');
vi.mock('../../models/MvpProject.model.js');
vi.mock('../../models/EmailCampaign.model.js');
vi.mock('../../queues/audit.queue.js');
vi.mock('../../queues/ai.queue.js', () => ({
  addAiGenerationJob: vi.fn().mockResolvedValue({ id: 'mock-ai-job-1' }),
  aiGenerationQueue: {} as any,
}));
vi.mock('../../queues/email.queue.js', () => ({
  addEmailDispatchJob: vi.fn().mockResolvedValue({ id: 'mock-email-job-1' }),
  calculateDispatchDelay: vi.fn().mockReturnValue(25000),
  emailQueue: {} as any,
}));

describe('API Routes Integration Tests (Supertest)', () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/health', () => {
    it('should return 200 and healthy status', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('services');
      expect(res.body.services.api).toBe('healthy');
      expect(res.body.services).toHaveProperty('mongodb');
      expect(res.body.services).toHaveProperty('redis');
    });
  });

  describe('POST /api/v1/leads', () => {
    it('should return 400 when request body fails validation', async () => {
      const res = await request(app)
        .post('/api/v1/leads')
        .send({
          businessName: 'X', // too short
          originalUrl: 'not-a-url',
          contactEmail: 'not-an-email',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors).toBeDefined();
    });

    it('should return 201 and created lead when payload is valid', async () => {
      const mockResult = {
        lead: {
          id: 'lead-123',
          businessName: 'Dr. Smile Clinic',
          domain: 'drsmile.com',
          status: 'QUEUED',
        },
        auditId: 'audit-123',
        jobId: 'job-1',
      };

      vi.spyOn(LeadService, 'createLead').mockResolvedValue(mockResult as any);

      const res = await request(app)
        .post('/api/v1/leads')
        .send({
          businessName: 'Dr. Smile Clinic',
          originalUrl: 'https://drsmile.com',
          contactEmail: 'dr@drsmile.com',
          niche: 'dental',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('lead-123');
      expect(res.body.data.auditId).toBe('audit-123');
    });
  });

  describe('GET /api/v1/leads', () => {
    it('should return 200 and list of leads with pagination', async () => {
      vi.spyOn(LeadService, 'getLeads').mockResolvedValue({
        leads: [{ id: 'lead-1', businessName: 'Auto Fix' }] as any,
        pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
      });

      const res = await request(app).get('/api/v1/leads?niche=auto');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.pagination.total).toBe(1);
    });
  });

  describe('GET /api/v1/leads/:id', () => {
    it('should return 200 and lead details when found', async () => {
      vi.spyOn(LeadService, 'getLeadById').mockResolvedValue({
        lead: { id: 'lead-1', businessName: 'Auto Fix' } as any,
        audit: { id: 'audit-1', status: 'QUEUED' } as any,
      });

      const res = await request(app).get('/api/v1/leads/lead-1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.lead.businessName).toBe('Auto Fix');
    });

    it('should return 404 when lead is not found', async () => {
      vi.spyOn(LeadService, 'getLeadById').mockRejectedValue(new AppError('Lead not found', 404));

      const res = await request(app).get('/api/v1/leads/unknown-id');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Lead not found');
    });
  });

  describe('POST /api/v1/audits/trigger', () => {
    it('should return 400 when leadId is missing', async () => {
      const res = await request(app).post('/api/v1/audits/trigger').send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 404 when lead does not exist', async () => {
      vi.spyOn(Lead, 'findById').mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      } as any);

      const res = await request(app).post('/api/v1/audits/trigger').send({ leadId: 'lead-missing' });
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Lead not found');
    });

    it('should return 202 and queue job when lead exists', async () => {
      const mockLead = {
        _id: new mongoose.Types.ObjectId(),
        originalUrl: 'https://example.com',
        niche: 'auto',
      };
      const mockAudit = {
        _id: new mongoose.Types.ObjectId(),
      };

      vi.spyOn(Lead, 'findById').mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockLead),
      } as any);
      vi.spyOn(Audit, 'create').mockResolvedValue(mockAudit as any);
      vi.spyOn(auditQueue, 'addAuditJob').mockResolvedValue({ id: 'job-999' } as any);

      const res = await request(app)
        .post('/api/v1/audits/trigger')
        .send({ leadId: mockLead._id.toString() });

      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.data.leadId).toBe(mockLead._id.toString());
      expect(res.body.data.auditId).toBe(mockAudit._id.toString());
      expect(res.body.data.jobId).toBe('job-999');
    });
  });

  describe('GET /api/v1/audits/:id', () => {
    it('should return 200 and audit data when found', async () => {
      const auditId = new mongoose.Types.ObjectId().toString();
      const mockAudit = {
        _id: auditId,
        status: 'COMPLETED',
        scores: { total: 85, design: 80, performance: 90, accessibility: 85, standards: 100 },
        designCritique: { visualHierarchyRating: 80, criticalFlaws: [], quickWins: [] },
      };

      vi.spyOn(Audit, 'findById').mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockAudit),
      } as any);

      const res = await request(app).get(`/api/v1/audits/${auditId}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.scores.total).toBe(85);
    });

    it('should return 404 when audit is not found', async () => {
      const auditId = new mongoose.Types.ObjectId().toString();
      vi.spyOn(Audit, 'findById').mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      } as any);
      vi.spyOn(Audit, 'findOne').mockReturnValue({
        sort: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(null),
        }),
      } as any);

      const res = await request(app).get(`/api/v1/audits/${auditId}`);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Audit not found');
    });
  });

  describe('POST /api/v1/outreach/:id/approve (HITL Gate)', () => {
    it('should approve outreach draft, update Lead status to SCHEDULED, enqueue email job, and return 200', async () => {
      const leadId = new mongoose.Types.ObjectId().toString();
      const campaignId = new mongoose.Types.ObjectId().toString();

      vi.spyOn(Lead, 'findByIdAndUpdate').mockReturnValue({
        exec: vi.fn().mockResolvedValue({
          _id: leadId,
          businessName: 'Custom Business',
          contactEmail: 'custom@business.com',
          status: 'SCHEDULED',
        }),
      } as any);

      vi.spyOn(EmailCampaign, 'findOneAndUpdate').mockReturnValue({
        exec: vi.fn().mockResolvedValue({
          _id: campaignId,
          leadId,
          status: 'SCHEDULED',
          subject: 'Custom Subject',
          previewText: 'Custom Preheader',
          approvedAt: new Date().toISOString(),
        }),
      } as any);

      const res = await request(app)
        .post(`/api/v1/outreach/${leadId}/approve`)
        .send({
          approvedBy: 'operator',
          subject: 'Custom Subject',
          preheader: 'Custom Preheader',
          body: 'Hello, check your demo',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SCHEDULED');
      expect(res.body.data.subject).toBe('Custom Subject');
      expect(res.body.data.campaignId).toBe(campaignId);
      expect(res.body.data.jobId).toBe('mock-email-job-1');
      expect(Lead.findByIdAndUpdate).toHaveBeenCalledWith(
        leadId,
        { $set: { status: 'SCHEDULED' } },
        { new: true },
      );
    });
  });

  describe('POST /api/v1/outreach/:id/reject', () => {
    it('should reject outreach draft, update Lead status to REJECTED, and return 200', async () => {
      const leadId = new mongoose.Types.ObjectId().toString();
      vi.spyOn(Lead, 'findByIdAndUpdate').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ _id: leadId, status: 'REJECTED' }),
      } as any);

      const res = await request(app)
        .post(`/api/v1/outreach/${leadId}/reject`)
        .send({
          reason: 'Нецелевой бизнес',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('REJECTED');
      expect(res.body.data.reason).toBe('Нецелевой бизнес');
      expect(Lead.findByIdAndUpdate).toHaveBeenCalledWith(
        leadId,
        { $set: { status: 'REJECTED' } },
        { new: true },
      );
    });

    it('should return 400 when rejection reason is too short', async () => {
      const res = await request(app)
        .post('/api/v1/outreach/lead-123/reject')
        .send({
          reason: 'No', // < 3 characters
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/outreach/:id/test', () => {
    it('should send test email and return 200', async () => {
      const res = await request(app)
        .post('/api/v1/outreach/lead-123/test')
        .send({
          testEmail: 'operator@revamp.io',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('operator@revamp.io');
    });

    it('should return 400 when test email format is invalid', async () => {
      const res = await request(app)
        .post('/api/v1/outreach/lead-123/test')
        .send({
          testEmail: 'not-an-email',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/mvp/generate', () => {
    it('should validate auditId, update Lead status to GENERATING, enqueue ai-gen job, and return 202', async () => {
      const auditId = new mongoose.Types.ObjectId().toString();
      const leadId = new mongoose.Types.ObjectId().toString();

      vi.spyOn(Audit, 'findOne').mockReturnValue({
        exec: vi.fn().mockResolvedValue({
          _id: auditId,
          leadId,
        }),
      } as any);

      vi.spyOn(Lead, 'findById').mockReturnValue({
        exec: vi.fn().mockResolvedValue({
          _id: leadId,
          businessName: 'Dr. Smile Clinic',
        }),
      } as any);

      vi.spyOn(Lead, 'findByIdAndUpdate').mockReturnValue({
        exec: vi.fn().mockResolvedValue({
          _id: leadId,
          status: 'GENERATING',
        }),
      } as any);

      const res = await request(app)
        .post('/api/v1/mvp/generate')
        .send({ auditId });

      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('GENERATING');
      expect(res.body.data.leadId).toBe(leadId);
      expect(res.body.data.jobId).toBe('mock-ai-job-1');
      expect(Lead.findByIdAndUpdate).toHaveBeenCalledWith(leadId, { status: 'GENERATING' });
    });

    it('should return 400 when auditId is missing', async () => {
      const res = await request(app).post('/api/v1/mvp/generate').send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 404 when audit is not found', async () => {
      const auditId = new mongoose.Types.ObjectId().toString();
      vi.spyOn(Audit, 'findOne').mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      } as any);

      const res = await request(app).post('/api/v1/mvp/generate').send({ auditId });
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('PATCH /api/v1/mvp/:id/tokens', () => {
    it('should update MVP brand design tokens and return 200', async () => {
      const projectId = new mongoose.Types.ObjectId().toString();
      vi.spyOn(MvpProject, 'findByIdAndUpdate').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ _id: projectId }),
      } as any);

      const res = await request(app)
        .patch(`/api/v1/mvp/${projectId}/tokens`)
        .send({
          primaryColor: '#4F46E5',
          secondaryColor: '#A5B4FC',
          accentColor: '#4F46E5',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.primaryColor).toBe('#4F46E5');
    });

    it('should return 400 when primaryColor is an invalid hex string', async () => {
      const res = await request(app)
        .patch('/api/v1/mvp/demo/tokens')
        .send({
          primaryColor: 'invalid-hex',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Unknown route handling', () => {
    it('should return 404 for non-existent endpoint', async () => {
      const res = await request(app).get('/api/v1/non-existent-route');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
