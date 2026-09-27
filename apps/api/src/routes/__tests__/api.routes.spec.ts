import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
import { addAiGenerationJob } from '../../queues/ai.queue.js';
import { addEmailDispatchJob } from '../../queues/email.queue.js';
import { sendTestEmailJob } from '../../queues/email-test.queue.js';
import { env } from '../../config/env.js';
import { redisConnection } from '../../queues/connection.js';
import { EMAIL_PROVIDER_NOT_CONFIGURED, LLM_CAPABILITIES_REDIS_KEY, draftToHtml } from '@revamp/shared-types';

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
vi.mock('../../queues/email-test.queue.js', () => ({
  sendTestEmailJob: vi.fn(),
}));

describe('API Routes Integration Tests (Supertest)', () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/health', () => {
    const originalRedisStatus = redisConnection.status;
    const setDependencies = (mongoReadyState: number, redisStatus: string) => {
      vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(mongoReadyState as any);
      (redisConnection as any).status = redisStatus;
    };

    afterEach(() => {
      vi.restoreAllMocks();
      (redisConnection as any).status = originalRedisStatus;
    });

    it('should return 200 and healthy status when MongoDB and Redis are connected', async () => {
      setDependencies(1, 'ready');
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body.services).toEqual({ api: 'healthy', mongodb: 'connected', redis: 'connected' });
      expect(res.body).toHaveProperty('timestamp');
    });

    it('should treat an ioredis "connect" status as connected', async () => {
      setDependencies(1, 'connect');
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.services.redis).toBe('connected');
    });

    it('should return 503 with the same body shape when MongoDB is disconnected (REV-66)', async () => {
      setDependencies(0, 'ready');
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(503);
      expect(res.body).toHaveProperty('status', 'degraded');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body.services).toEqual({ api: 'healthy', mongodb: 'disconnected', redis: 'connected' });
    });

    it('should return 503 while MongoDB is still connecting', async () => {
      setDependencies(2, 'ready');
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(503);
      expect(res.body.services.mongodb).toBe('connecting');
    });

    it('should return 503 when Redis is not connected (REV-66)', async () => {
      setDependencies(1, 'reconnecting');
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(503);
      expect(res.body).toHaveProperty('status', 'degraded');
      expect(res.body.services).toEqual({ api: 'healthy', mongodb: 'connected', redis: 'reconnecting' });
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
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.issues.length).toBeGreaterThan(0);
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

    it('should accept a lead without a contact email and pass none on (REV-45)', async () => {
      const create = vi
        .spyOn(LeadService, 'createLead')
        .mockResolvedValue({ lead: { id: 'lead-1' }, auditId: 'audit-1', jobId: 'job-1' } as any);

      const res = await request(app)
        .post('/api/v1/leads')
        .send({ businessName: 'No Email Clinic', originalUrl: 'https://no-email.com', contactEmail: '' });

      expect(res.status).toBe(201);
      expect(create.mock.calls[0]![0].contactEmail).toBeUndefined();
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

    it('should pass a validated complexity filter to the service (REV-38)', async () => {
      const spy = vi.spyOn(LeadService, 'getLeads').mockResolvedValue({
        leads: [],
        pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
      });

      const res = await request(app).get('/api/v1/leads?complexity=ONE_PAGE_BROCHURE&page=2&status=');

      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledWith({ complexity: 'ONE_PAGE_BROCHURE', page: 2 });
    });

    it('should return 400 for an unknown complexity class (REV-38)', async () => {
      const spy = vi.spyOn(LeadService, 'getLeads');
      spy.mockClear();

      const res = await request(app).get('/api/v1/leads?complexity=HUGE');

      expect(res.status).toBe(400);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/leads/stats (REV-43)', () => {
    it('should return 200 with pipeline-wide counts and not treat "stats" as a lead id', async () => {
      const byId = vi.spyOn(LeadService, 'getLeadById');
      byId.mockClear();
      vi.spyOn(LeadService, 'getLeadStats').mockResolvedValue({ total: 41, byStatus: { QUEUED: 41 } });

      const res = await request(app).get('/api/v1/leads/stats');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { total: 41, byStatus: { QUEUED: 41 } } });
      expect(byId).not.toHaveBeenCalled();
    });

    it('should return 500 when the aggregation fails', async () => {
      vi.spyOn(LeadService, 'getLeadStats').mockRejectedValue(new Error('mongo down'));

      const res = await request(app).get('/api/v1/leads/stats');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/leads search and paging (REV-43)', () => {
    it('should pass search, page and limit to the service', async () => {
      const spy = vi.spyOn(LeadService, 'getLeads').mockResolvedValue({
        leads: [],
        pagination: { total: 0, page: 2, limit: 100, totalPages: 0 },
      });

      const res = await request(app).get('/api/v1/leads?search=dental&page=2&limit=100');

      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledWith({ search: 'dental', page: 2, limit: 100 });
    });

    it('should reject a page size above 100', async () => {
      const spy = vi.spyOn(LeadService, 'getLeads');
      spy.mockClear();

      const res = await request(app).get('/api/v1/leads?limit=101');

      expect(res.status).toBe(400);
      expect(spy).not.toHaveBeenCalled();
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
      vi.spyOn(LeadService, 'getLeadById').mockRejectedValue(new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found'));

      const res = await request(app).get('/api/v1/leads/unknown-id');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toEqual({ code: 'LEAD_NOT_FOUND', message: 'Lead not found' });
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
      expect(res.body.error).toEqual({ code: 'LEAD_NOT_FOUND', message: 'Lead not found' });
    });

    it('should return 202 and queue job when lead exists', async () => {
      const mockLead = {
        _id: new mongoose.Types.ObjectId(),
        originalUrl: 'https://example.com',
        niche: 'auto',
        status: 'QUEUED',
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

    it('should put a failed lead back in the queue and clear its audit error on retry (REV-44)', async () => {
      const mockLead = {
        _id: new mongoose.Types.ObjectId(),
        originalUrl: 'https://ekomyj.com',
        niche: 'dental',
        status: 'AUDIT_FAILED',
        auditError: 'page.goto: net::ERR_NAME_NOT_RESOLVED at https://ekomyj.com/',
      };
      vi.spyOn(Lead, 'findById').mockReturnValue({ exec: vi.fn().mockResolvedValue(mockLead) } as any);
      vi.spyOn(Lead, 'findOneAndUpdate').mockReturnValue({ exec: vi.fn().mockResolvedValue({}) } as any);
      vi.spyOn(Audit, 'create').mockResolvedValue({ _id: new mongoose.Types.ObjectId() } as any);
      vi.spyOn(auditQueue, 'addAuditJob').mockResolvedValue({ id: 'job-retry' } as any);

      const res = await request(app).post('/api/v1/audits/trigger').send({ leadId: mockLead._id.toString() });

      expect(res.status).toBe(202);
      // Atomic: only a lead that is still AUDIT_FAILED (or already QUEUED) is put back (REV-62)
      expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: mockLead._id, status: { $in: ['AUDIT_FAILED', 'QUEUED'] } },
        { $set: { status: 'QUEUED' }, $unset: { auditError: '' } },
      );
      expect(auditQueue.addAuditJob).toHaveBeenCalledWith({
        leadId: mockLead._id.toString(),
        url: 'https://ekomyj.com',
        niche: 'dental',
      });
    });

    it('should re-run the audit of a queued lead without changing it', async () => {
      const mockLead = { _id: new mongoose.Types.ObjectId(), originalUrl: 'https://a.example', niche: 'auto', status: 'QUEUED' };
      vi.spyOn(Lead, 'findById').mockReturnValue({ exec: vi.fn().mockResolvedValue(mockLead) } as any);
      const updateSpy = vi.spyOn(Lead, 'findOneAndUpdate');
      vi.spyOn(Audit, 'create').mockResolvedValue({ _id: new mongoose.Types.ObjectId() } as any);
      vi.spyOn(auditQueue, 'addAuditJob').mockResolvedValue({ id: 'job-1' } as any);

      const res = await request(app).post('/api/v1/audits/trigger').send({ leadId: mockLead._id.toString() });

      expect(res.status).toBe(202);
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it.each(['AUDITING', 'AUDITED', 'GENERATING', 'NEEDS_APPROVAL', 'SCHEDULED', 'SENT', 'REJECTED', 'UNSUBSCRIBED'])(
      'should refuse to audit a %s lead with 409, queueing nothing (REV-62)',
      async (status) => {
        const mockLead = { _id: new mongoose.Types.ObjectId(), originalUrl: 'https://a.example', niche: 'auto', status };
        vi.spyOn(Lead, 'findById').mockReturnValue({ exec: vi.fn().mockResolvedValue(mockLead) } as any);
        const updateSpy = vi.spyOn(Lead, 'findOneAndUpdate');
        const createSpy = vi.spyOn(Audit, 'create');
        const queueSpy = vi.spyOn(auditQueue, 'addAuditJob');

        const res = await request(app).post('/api/v1/audits/trigger').send({ leadId: mockLead._id.toString() });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('LEAD_NOT_AUDITABLE');
        expect(res.body.error.details).toEqual({ status });
        expect(updateSpy).not.toHaveBeenCalled();
        expect(createSpy).not.toHaveBeenCalled();
        expect(queueSpy).not.toHaveBeenCalled();
      },
    );

    it('should return 409 when the failed lead changes before it is re-queued', async () => {
      const mockLead = { _id: new mongoose.Types.ObjectId(), originalUrl: 'https://a.example', niche: 'auto', status: 'AUDIT_FAILED' };
      vi.spyOn(Lead, 'findById').mockReturnValue({ exec: vi.fn().mockResolvedValue(mockLead) } as any);
      vi.spyOn(Lead, 'findOneAndUpdate').mockReturnValue({ exec: vi.fn().mockResolvedValue(null) } as any);
      const queueSpy = vi.spyOn(auditQueue, 'addAuditJob');

      const res = await request(app).post('/api/v1/audits/trigger').send({ leadId: mockLead._id.toString() });

      expect(res.status).toBe(409);
      expect(queueSpy).not.toHaveBeenCalled();
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
      expect(res.body.error).toEqual({ code: 'AUDIT_NOT_FOUND', message: 'Audit not found' });
    });
  });

  describe('POST /api/v1/outreach/:id/approve (HITL Gate)', () => {
    const approvedDraft = { approvedBy: 'operator', subject: 'Approved subject', body: 'Approved body' };

    const mockFindById = (lead: Record<string, unknown> | null) =>
      vi.spyOn(Lead, 'findById').mockReturnValue({ exec: vi.fn().mockResolvedValue(lead) } as any);

    it.each(['NEEDS_APPROVAL'])(
      'approves a %s lead atomically, schedules it, enqueues the email and returns 200',
      async (status) => {
        const leadId = new mongoose.Types.ObjectId().toString();
        const campaignId = new mongoose.Types.ObjectId().toString();

        mockFindById({ _id: leadId, status, contactEmail: 'custom@business.com' });
        vi.spyOn(Lead, 'findOneAndUpdate').mockReturnValue({
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
        expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
          { _id: leadId, status: { $in: ['NEEDS_APPROVAL'] } },
          { $set: { status: 'SCHEDULED' } },
          { new: true },
        );
        expect(vi.mocked(EmailCampaign.findOneAndUpdate).mock.calls[0]![1]).toMatchObject({
          recipientEmail: 'custom@business.com',
        });
        expect(addEmailDispatchJob).toHaveBeenCalledTimes(1);
      },
    );

    it('stores the approved draft as escaped HTML with its line breaks, plus the plain text (REV-72)', async () => {
      const leadId = new mongoose.Types.ObjectId().toString();
      const body = 'Hello,\nsee <your> demo & more\n\nhttps://demo.example/x';

      mockFindById({ _id: leadId, status: 'NEEDS_APPROVAL', contactEmail: 'owner@business.com' });
      vi.spyOn(Lead, 'findOneAndUpdate').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ _id: leadId, businessName: 'Biz', contactEmail: 'owner@business.com' }),
      } as any);
      vi.spyOn(EmailCampaign, 'findOneAndUpdate').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ _id: new mongoose.Types.ObjectId() }),
      } as any);

      const res = await request(app)
        .post(`/api/v1/outreach/${leadId}/approve`)
        .send({ approvedBy: 'operator', subject: 'Subject', preheader: 'Pre <view>', body });

      expect(res.status).toBe(200);
      const update = vi.mocked(EmailCampaign.findOneAndUpdate).mock.calls[0]![1] as Record<string, unknown>;
      expect(update['bodyHtml']).toBe(draftToHtml(body, 'Pre <view>'));
      expect(update['bodyHtml']).toContain('<p>Hello,<br>see &lt;your&gt; demo &amp; more</p>\n<p>https://demo.example/x</p>');
      expect(update['bodyPlainText']).toBe(body);
    });

    it.each([
      'QUEUED',
      'AUDITING',
      'AUDIT_FAILED',
      'AUDITED',
      'GENERATING',
      'SCHEDULED',
      'SENT',
      'OPENED',
      'CLICKED',
      'ENGAGED',
      'REJECTED',
      'UNSUBSCRIBED',
    ])('returns 409 LEAD_NOT_AWAITING_APPROVAL and queues nothing for a %s lead (REV-59)', async (status) => {
      const leadId = new mongoose.Types.ObjectId().toString();
      mockFindById({ _id: leadId, status, contactEmail: 'owner@business.com' });
      const update = vi.spyOn(Lead, 'findOneAndUpdate');
      const campaign = vi.spyOn(EmailCampaign, 'findOneAndUpdate');

      const res = await request(app).post(`/api/v1/outreach/${leadId}/approve`).send(approvedDraft);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('LEAD_NOT_AWAITING_APPROVAL');
      expect(res.body.error.message).toContain(status);
      expect(update).not.toHaveBeenCalled();
      expect(campaign).not.toHaveBeenCalled();
      expect(addEmailDispatchJob).not.toHaveBeenCalled();
    });

    it('returns 409 and queues nothing when a concurrent approval already moved the lead on (REV-59)', async () => {
      const leadId = new mongoose.Types.ObjectId().toString();
      mockFindById({ _id: leadId, status: 'NEEDS_APPROVAL', contactEmail: 'owner@business.com' });
      // The status filter no longer matches: another request scheduled the lead in between
      vi.spyOn(Lead, 'findOneAndUpdate').mockReturnValue({ exec: vi.fn().mockResolvedValue(null) } as any);
      const campaign = vi.spyOn(EmailCampaign, 'findOneAndUpdate');

      const res = await request(app).post(`/api/v1/outreach/${leadId}/approve`).send(approvedDraft);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LEAD_NOT_AWAITING_APPROVAL');
      expect(campaign).not.toHaveBeenCalled();
      expect(addEmailDispatchJob).not.toHaveBeenCalled();
    });

    it('returns 404 when the lead does not exist', async () => {
      const leadId = new mongoose.Types.ObjectId().toString();
      mockFindById(null);
      const update = vi.spyOn(Lead, 'findOneAndUpdate');

      const res = await request(app).post(`/api/v1/outreach/${leadId}/approve`).send(approvedDraft);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('LEAD_NOT_FOUND');
      expect(update).not.toHaveBeenCalled();
      expect(addEmailDispatchJob).not.toHaveBeenCalled();
    });

    it.each([
      ['no draft', { approvedBy: 'operator' }],
      ['no body', { approvedBy: 'operator', subject: 'Approved subject' }],
      ['an empty body', { approvedBy: 'operator', subject: 'Approved subject', body: '   ' }],
      ['no subject', { approvedBy: 'operator', body: 'Approved body' }],
    ])('returns 400 and schedules nothing for an approval with %s (REV-61)', async (_case, payload) => {
      const leadId = new mongoose.Types.ObjectId().toString();
      const find = mockFindById({ _id: leadId, status: 'NEEDS_APPROVAL', contactEmail: 'owner@business.com' });
      const update = vi.spyOn(Lead, 'findOneAndUpdate');
      const campaign = vi.spyOn(EmailCampaign, 'findOneAndUpdate');

      const res = await request(app).post(`/api/v1/outreach/${leadId}/approve`).send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(find).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(campaign).not.toHaveBeenCalled();
      expect(addEmailDispatchJob).not.toHaveBeenCalled();
    });

    it('stores the approved subject and body with no default copy (REV-61)', async () => {
      const leadId = new mongoose.Types.ObjectId().toString();
      mockFindById({ _id: leadId, status: 'NEEDS_APPROVAL', contactEmail: 'owner@business.com' });
      vi.spyOn(Lead, 'findOneAndUpdate').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ _id: leadId, businessName: 'Biz', contactEmail: 'owner@business.com' }),
      } as any);
      vi.spyOn(EmailCampaign, 'findOneAndUpdate').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ _id: new mongoose.Types.ObjectId() }),
      } as any);

      const res = await request(app).post(`/api/v1/outreach/${leadId}/approve`).send(approvedDraft);

      expect(res.status).toBe(200);
      const update = vi.mocked(EmailCampaign.findOneAndUpdate).mock.calls[0]![1] as Record<string, unknown>;
      expect(update['subject']).toBe('Approved subject');
      expect(update['bodyHtml']).toBe(draftToHtml('Approved body'));
      expect(update['bodyPlainText']).toBe('Approved body');
      expect(update).not.toHaveProperty('previewText');
    });

    it('returns 400 for an invalid lead id', async () => {
      const res = await request(app).post('/api/v1/outreach/lead-123/approve').send(approvedDraft);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ID');
    });

    it('should return 409 and schedule nothing when the lead has no contact email (REV-45)', async () => {
      const leadId = new mongoose.Types.ObjectId().toString();
      mockFindById({ _id: leadId, status: 'NEEDS_APPROVAL', businessName: 'No Email' });
      const update = vi.spyOn(Lead, 'findOneAndUpdate');
      const campaign = vi.spyOn(EmailCampaign, 'findOneAndUpdate');

      const res = await request(app).post(`/api/v1/outreach/${leadId}/approve`).send(approvedDraft);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('NO_CONTACT_EMAIL');
      expect(update).not.toHaveBeenCalled();
      expect(campaign).not.toHaveBeenCalled();
      expect(addEmailDispatchJob).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/outreach/:id/reject', () => {
    it.each([
      'QUEUED',
      'AUDITING',
      'AUDIT_FAILED',
      'AUDITED',
      'GENERATING',
      'NEEDS_APPROVAL',
    ])('rejects a %s lead atomically and returns 200', async () => {
      const leadId = new mongoose.Types.ObjectId().toString();
      vi.spyOn(Lead, 'findOneAndUpdate').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ _id: leadId, status: 'REJECTED' }),
      } as any);
      vi.spyOn(EmailCampaign, 'findOneAndUpdate').mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      } as any);

      const res = await request(app)
        .post(`/api/v1/outreach/${leadId}/reject`)
        .send({
          reason: 'Off-target business',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('REJECTED');
      expect(res.body.data.reason).toBe('Off-target business');
      expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: leadId,
          status: {
            $in: [
              'QUEUED',
              'AUDITING',
              'AUDIT_FAILED',
              'AUDITED',
              'GENERATING',
              'NEEDS_APPROVAL',
            ],
          },
        },
        { $set: { status: 'REJECTED' } },
        { new: true },
      );
      expect(EmailCampaign.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });

    it.each(['SCHEDULED', 'SENT', 'OPENED', 'CLICKED', 'ENGAGED', 'REJECTED', 'UNSUBSCRIBED'])(
      'returns 409 LEAD_NOT_REJECTABLE and changes nothing for a %s lead (REV-59)',
      async (status) => {
        const leadId = new mongoose.Types.ObjectId().toString();
        vi.spyOn(Lead, 'findOneAndUpdate').mockReturnValue({ exec: vi.fn().mockResolvedValue(null) } as any);
        vi.spyOn(Lead, 'findById').mockReturnValue({
          exec: vi.fn().mockResolvedValue({ _id: leadId, status }),
        } as any);
        const campaign = vi.spyOn(EmailCampaign, 'findOneAndUpdate');

        const res = await request(app).post(`/api/v1/outreach/${leadId}/reject`).send({ reason: 'Too late' });

        expect(res.status).toBe(409);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('LEAD_NOT_REJECTABLE');
        expect(res.body.error.message).toContain(status);
        expect(campaign).not.toHaveBeenCalled();
      },
    );

    it('returns 404 when the lead does not exist', async () => {
      const leadId = new mongoose.Types.ObjectId().toString();
      vi.spyOn(Lead, 'findOneAndUpdate').mockReturnValue({ exec: vi.fn().mockResolvedValue(null) } as any);
      vi.spyOn(Lead, 'findById').mockReturnValue({ exec: vi.fn().mockResolvedValue(null) } as any);
      const campaign = vi.spyOn(EmailCampaign, 'findOneAndUpdate');

      const res = await request(app).post(`/api/v1/outreach/${leadId}/reject`).send({ reason: 'Gone' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('LEAD_NOT_FOUND');
      expect(campaign).not.toHaveBeenCalled();
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

  describe('POST /api/v1/outreach/:id/test (REV-60)', () => {
    const leadId = new mongoose.Types.ObjectId().toString();
    const draft = {
      testEmail: 'operator@revamp.io',
      subject: 'A new mobile website for Dr Smile',
      preheader: 'An interactive prototype',
      body: 'Hello,\n\nSee https://demo.example/dr-smile',
    };
    const originalProvider = env.EMAIL_PROVIDER;

    const mockLead = (lead: Record<string, unknown> | null) =>
      vi.spyOn(Lead, 'findById').mockReturnValue({ exec: vi.fn().mockResolvedValue(lead) } as any);

    const expectNothingChanged = () => {
      expect(Lead.findOneAndUpdate).not.toHaveBeenCalled();
      expect(Lead.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(EmailCampaign.findOneAndUpdate).not.toHaveBeenCalled();
      expect(addEmailDispatchJob).not.toHaveBeenCalled();
    };

    beforeEach(() => {
      env.EMAIL_PROVIDER = 'smtp';
      mockLead({ _id: leadId, status: 'NEEDS_APPROVAL', contactEmail: 'owner@business.com' });
    });

    afterEach(() => {
      env.EMAIL_PROVIDER = originalProvider;
    });

    it('sends the draft to the operator through the workers and returns 200 with the provider result', async () => {
      const sentAt = new Date().toISOString();
      vi.mocked(sendTestEmailJob).mockResolvedValue({
        status: 'sent',
        result: { messageId: 'msg-1', provider: 'smtp', sentAt },
      });

      const res = await request(app).post(`/api/v1/outreach/${leadId}/test`).send(draft);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('operator@revamp.io');
      expect(res.body.data).toEqual({ to: 'operator@revamp.io', messageId: 'msg-1', provider: 'smtp', sentAt });
      expect(sendTestEmailJob).toHaveBeenCalledWith({
        leadId,
        to: 'operator@revamp.io',
        subject: draft.subject,
        preheader: draft.preheader,
        body: draft.body,
      });
      expectNothingChanged();
    });

    it.each(['SENT', 'REJECTED', 'SCHEDULED'])('does not gate a test send on the lead status (%s)', async (status) => {
      mockLead({ _id: leadId, status });
      vi.mocked(sendTestEmailJob).mockResolvedValue({
        status: 'sent',
        result: { provider: 'smtp', sentAt: new Date().toISOString() },
      });

      const res = await request(app).post(`/api/v1/outreach/${leadId}/test`).send(draft);

      expect(res.status).toBe(200);
      expectNothingChanged();
    });

    it('returns 503 EMAIL_PROVIDER_NOT_CONFIGURED and queues nothing when no provider is set', async () => {
      env.EMAIL_PROVIDER = undefined;

      const res = await request(app).post(`/api/v1/outreach/${leadId}/test`).send(draft);

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EMAIL_PROVIDER_NOT_CONFIGURED');
      expect(sendTestEmailJob).not.toHaveBeenCalled();
      expectNothingChanged();
    });

    it('returns 503 when the workers report that they have no provider', async () => {
      vi.mocked(sendTestEmailJob).mockResolvedValue({ status: 'failed', reason: EMAIL_PROVIDER_NOT_CONFIGURED });

      const res = await request(app).post(`/api/v1/outreach/${leadId}/test`).send(draft);

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('EMAIL_PROVIDER_NOT_CONFIGURED');
    });

    it('returns 502 EMAIL_SEND_FAILED with the provider error when the send fails', async () => {
      vi.mocked(sendTestEmailJob).mockResolvedValue({ status: 'failed', reason: 'Resend API error (403): forbidden' });

      const res = await request(app).post(`/api/v1/outreach/${leadId}/test`).send(draft);

      expect(res.status).toBe(502);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EMAIL_SEND_FAILED');
      expect(res.body.error.message).toContain('Resend API error (403)');
      expectNothingChanged();
    });

    it('returns 504 EMAIL_TEST_TIMEOUT when no worker sends it in time', async () => {
      vi.mocked(sendTestEmailJob).mockResolvedValue({ status: 'timeout' });

      const res = await request(app).post(`/api/v1/outreach/${leadId}/test`).send(draft);

      expect(res.status).toBe(504);
      expect(res.body.error.code).toBe('EMAIL_TEST_TIMEOUT');
    });

    it('returns 404 for an unknown lead', async () => {
      mockLead(null);

      const res = await request(app).post(`/api/v1/outreach/${leadId}/test`).send(draft);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('LEAD_NOT_FOUND');
      expect(sendTestEmailJob).not.toHaveBeenCalled();
    });

    it('returns 400 for an invalid lead id', async () => {
      const res = await request(app).post('/api/v1/outreach/lead-123/test').send(draft);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ID');
      expect(sendTestEmailJob).not.toHaveBeenCalled();
    });

    it('returns 400 when the test email format is invalid', async () => {
      const res = await request(app)
        .post(`/api/v1/outreach/${leadId}/test`)
        .send({ ...draft, testEmail: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(sendTestEmailJob).not.toHaveBeenCalled();
    });

    it('returns 400 when the draft is missing', async () => {
      const res = await request(app).post(`/api/v1/outreach/${leadId}/test`).send({ testEmail: 'operator@revamp.io' });

      expect(res.status).toBe(400);
      expect(sendTestEmailJob).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/mvp/generate', () => {
    const auditId = new mongoose.Types.ObjectId().toString();
    const leadId = new mongoose.Types.ObjectId().toString();

    const mockLeadWithStatus = (status: string) => {
      vi.spyOn(Audit, 'findById').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ _id: auditId, leadId, status: 'COMPLETED' }),
      } as any);
      vi.spyOn(Lead, 'findById').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ _id: leadId, businessName: 'Dr. Smile Clinic', status }),
      } as any);
      vi.spyOn(Lead, 'findOneAndUpdate').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ _id: leadId, status: 'GENERATING' }),
      } as any);
    };

    beforeEach(() => {
      vi.mocked(addAiGenerationJob).mockClear();
    });

    it('should validate auditId, update Lead status to GENERATING, enqueue ai-gen job, and return 202', async () => {
      mockLeadWithStatus('AUDITED');

      const res = await request(app)
        .post('/api/v1/mvp/generate')
        .send({ auditId });

      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('GENERATING');
      expect(res.body.data.leadId).toBe(leadId);
      expect(res.body.data.jobId).toBe('mock-ai-job-1');
      // Atomic: only a lead still in the status that was checked moves to GENERATING (REV-62)
      expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: leadId, status: 'AUDITED' },
        { $set: { status: 'GENERATING' }, $unset: { generationError: '' } },
      );
      expect(addAiGenerationJob).toHaveBeenCalledWith({
        leadId,
        auditId,
        forceRegenerate: false,
        previousStatus: 'AUDITED',
      });
    });

    it.each(['NEEDS_APPROVAL'])(
      'should regenerate the MVP of a %s lead when forceRegenerate is set (REV-31)',
      async (status) => {
        mockLeadWithStatus(status);

        const res = await request(app)
          .post('/api/v1/mvp/generate')
          .send({ auditId, forceRegenerate: true });

        expect(res.status).toBe(202);
        expect(addAiGenerationJob).toHaveBeenCalledWith({
          leadId,
          auditId,
          forceRegenerate: true,
          previousStatus: status,
        });
      },
    );

    it('should return 409 and enqueue nothing when the lead changes before it is claimed (REV-62)', async () => {
      mockLeadWithStatus('AUDITED');
      vi.mocked(Lead.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue(null) } as any);

      const res = await request(app).post('/api/v1/mvp/generate').send({ auditId });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('MVP_GENERATION_NOT_ALLOWED');
      expect(addAiGenerationJob).not.toHaveBeenCalled();
    });

    it('should return 409 when the lead already has an MVP and forceRegenerate is not set', async () => {
      mockLeadWithStatus('NEEDS_APPROVAL');

      const res = await request(app).post('/api/v1/mvp/generate').send({ auditId });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('MVP_ALREADY_GENERATED');
      expect(res.body.error.details).toEqual({ status: 'NEEDS_APPROVAL' });
      expect(Lead.findOneAndUpdate).not.toHaveBeenCalled();
      expect(addAiGenerationJob).not.toHaveBeenCalled();
    });

    it.each(['SCHEDULED', 'SENT', 'OPENED', 'CLICKED', 'ENGAGED', 'REJECTED', 'UNSUBSCRIBED', 'GENERATING', 'AUDITING'])(
      'should return 409 for a %s lead even with forceRegenerate (REV-31)',
      async (status) => {
        mockLeadWithStatus(status);

        const res = await request(app)
          .post('/api/v1/mvp/generate')
          .send({ auditId, forceRegenerate: true });

        expect(res.status).toBe(409);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('MVP_GENERATION_NOT_ALLOWED');
        expect(res.body.error.details).toEqual({ status });
        expect(Lead.findOneAndUpdate).not.toHaveBeenCalled();
        expect(addAiGenerationJob).not.toHaveBeenCalled();
      },
    );

    describe('audit resolution when the lead has several audits (REV-55)', () => {
      const newestAuditId = new mongoose.Types.ObjectId().toString();

      /** findById answers the id sent; findOne().sort() is the lead's newest COMPLETED audit */
      const mockAudits = (byId: unknown, newest: unknown) => {
        mockLeadWithStatus('NEEDS_APPROVAL');
        vi.spyOn(Audit, 'findById').mockReturnValue({ exec: vi.fn().mockResolvedValue(byId) } as any);
        const sort = vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(newest) });
        vi.spyOn(Audit, 'findOne').mockReturnValue({ sort } as any);
        return sort;
      };

      it("uses the lead's newest completed audit when the dashboard sends the lead id", async () => {
        const sort = mockAudits(null, { _id: newestAuditId, leadId, status: 'COMPLETED' });

        const res = await request(app).post('/api/v1/mvp/generate').send({ auditId: leadId, forceRegenerate: true });

        expect(res.status).toBe(202);
        expect(res.body.data.auditId).toBe(newestAuditId);
        expect(Audit.findOne).toHaveBeenCalledWith({ leadId, status: 'COMPLETED' });
        expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
        expect(addAiGenerationJob).toHaveBeenCalledWith(expect.objectContaining({ leadId, auditId: newestAuditId }));
      });

      it('never builds from a failed audit when a newer completed one exists', async () => {
        mockAudits({ _id: auditId, leadId, status: 'FAILED' }, { _id: newestAuditId, leadId, status: 'COMPLETED' });

        const res = await request(app).post('/api/v1/mvp/generate').send({ auditId, forceRegenerate: true });

        expect(res.status).toBe(202);
        expect(addAiGenerationJob).toHaveBeenCalledWith(expect.objectContaining({ auditId: newestAuditId }));
      });

      it('returns 404 and enqueues nothing when the lead has no completed audit', async () => {
        mockAudits({ _id: auditId, leadId, status: 'FAILED' }, null);

        const res = await request(app).post('/api/v1/mvp/generate').send({ auditId });

        expect(res.status).toBe(404);
        expect(res.body.error).toEqual({ code: 'NO_COMPLETED_AUDIT', message: 'No completed audit found for this lead' });
        expect(addAiGenerationJob).not.toHaveBeenCalled();
      });
    });

    it('should return 400 when auditId is missing', async () => {
      const res = await request(app).post('/api/v1/mvp/generate').send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 400 when forceRegenerate is not a boolean', async () => {
      const res = await request(app).post('/api/v1/mvp/generate').send({ auditId, forceRegenerate: 'yes' });
      expect(res.status).toBe(400);
    });

    it('should pass the chosen provider and model to the ai-gen job (REV-32)', async () => {
      mockLeadWithStatus('AUDITED');

      const res = await request(app)
        .post('/api/v1/mvp/generate')
        .send({ auditId, provider: 'claude-cli', model: 'opus' });

      expect(res.status).toBe(202);
      expect(addAiGenerationJob).toHaveBeenCalledWith({
        leadId,
        auditId,
        forceRegenerate: false,
        previousStatus: 'AUDITED',
        provider: 'claude-cli',
        model: 'opus',
      });
    });

    it('should pass a provider without a model, leaving the model to the worker (REV-32)', async () => {
      mockLeadWithStatus('NEEDS_APPROVAL');

      const res = await request(app)
        .post('/api/v1/mvp/generate')
        .send({ auditId, forceRegenerate: true, provider: 'anthropic' });

      expect(res.status).toBe(202);
      expect(addAiGenerationJob).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'anthropic', forceRegenerate: true }),
      );
      expect(vi.mocked(addAiGenerationJob).mock.calls[0]![0]).not.toHaveProperty('model');
    });

    it.each([
      [{ provider: 'llama' }],
      [{ provider: 'openai', model: 'claude-opus-5' }],
      [{ provider: 'claude-cli', model: 'gpt-4o' }],
      [{ model: 'sonnet' }],
    ])('should return 400 for an unknown provider or a mismatched model: %j (REV-32)', async (choice) => {
      mockLeadWithStatus('AUDITED');

      const res = await request(app).post('/api/v1/mvp/generate').send({ auditId, ...choice });

      expect(res.status).toBe(400);
      expect(addAiGenerationJob).not.toHaveBeenCalled();
    });

    it('should reject the removed mock provider (REV-45)', async () => {
      mockLeadWithStatus('AUDITED');
      const res = await request(app).post('/api/v1/mvp/generate').send({ auditId, provider: 'mock' });
      expect(res.status).toBe(400);
      expect(addAiGenerationJob).not.toHaveBeenCalled();
    });

    it('should return 404 when audit is not found', async () => {
      vi.spyOn(Audit, 'findById').mockReturnValue({ exec: vi.fn().mockResolvedValue(null) } as any);
      vi.spyOn(Audit, 'findOne').mockReturnValue({
        sort: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(null) }),
      } as any);

      const res = await request(app).post('/api/v1/mvp/generate').send({ auditId });
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should return 404 when the audit has no lead', async () => {
      vi.spyOn(Audit, 'findById').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ _id: auditId, leadId, status: 'COMPLETED' }),
      } as any);
      vi.spyOn(Lead, 'findById').mockReturnValue({ exec: vi.fn().mockResolvedValue(null) } as any);

      const res = await request(app).post('/api/v1/mvp/generate').send({ auditId, forceRegenerate: true });
      expect(res.status).toBe(404);
      expect(addAiGenerationJob).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/mvp/providers (REV-32)', () => {
    const capabilities = {
      checkedAt: '2026-09-26T12:00:00.000Z',
      defaultProvider: 'claude-cli',
      defaultModel: 'sonnet',
      providers: [
        { id: 'anthropic', available: false, reason: 'missing_api_key' },
        { id: 'openai', available: true },
        { id: 'gemini', available: false, reason: 'missing_api_key' },
        { id: 'claude-cli', available: true },
      ],
    };

    it('should return every provider with the worker-reported availability and default', async () => {
      const get = vi.spyOn(redisConnection, 'get').mockResolvedValue(JSON.stringify(capabilities));

      const res = await request(app).get('/api/v1/mvp/providers');

      expect(res.status).toBe(200);
      expect(get).toHaveBeenCalledWith(LLM_CAPABILITIES_REDIS_KEY);
      expect(res.body.data.workersOnline).toBe(true);
      expect(res.body.data.defaultProvider).toBe('claude-cli');
      expect(res.body.data.defaultModel).toBe('sonnet');
      const byId = Object.fromEntries(res.body.data.providers.map((p: any) => [p.id, p]));
      expect(Object.keys(byId)).toEqual(['anthropic', 'openai', 'gemini', 'claude-cli']);
      expect(byId['anthropic']).toMatchObject({ available: false, reason: 'missing_api_key' });
      expect(byId['claude-cli']).toMatchObject({ available: true, local: true });
      expect(byId['claude-cli'].models.map((m: any) => m.id)).toEqual(['sonnet', 'opus', 'haiku']);
    });

    it('should mark every provider unavailable when no worker has reported', async () => {
      vi.spyOn(redisConnection, 'get').mockResolvedValue(null);

      const res = await request(app).get('/api/v1/mvp/providers');

      expect(res.status).toBe(200);
      expect(res.body.data.workersOnline).toBe(false);
      expect(res.body.data.defaultProvider).toBeUndefined();
      expect(res.body.data.providers.every((p: any) => !p.available && p.reason === 'workers_offline')).toBe(true);
    });

    it('should still answer when Redis fails', async () => {
      vi.spyOn(redisConnection, 'get').mockRejectedValue(new Error('ECONNREFUSED'));

      const res = await request(app).get('/api/v1/mvp/providers');

      expect(res.status).toBe(200);
      expect(res.body.data.workersOnline).toBe(false);
    });

    it('should offer no mock provider and no default when the workers have none configured (REV-45)', async () => {
      vi.spyOn(redisConnection, 'get').mockResolvedValue(
        JSON.stringify({ checkedAt: capabilities.checkedAt, providers: capabilities.providers }),
      );

      const res = await request(app).get('/api/v1/mvp/providers');

      expect(res.body.data.workersOnline).toBe(true);
      expect(res.body.data.defaultProvider).toBeUndefined();
      expect(res.body.data.defaultModel).toBeUndefined();
      expect(res.body.data.providers.map((p: any) => p.id)).not.toContain('mock');
    });
  });

  describe('GET /api/v1/mvp/:id', () => {
    it('should return the MVP project looked up by id, lead or audit', async () => {
      const leadId = new mongoose.Types.ObjectId().toString();
      const project = { leadId, fullPreviewUrl: 'http://minio/revamp-demos/v/smile/index.html' };
      const findOne = vi.spyOn(MvpProject, 'findOne').mockReturnValue({ exec: vi.fn().mockResolvedValue(project) } as any);

      const res = await request(app).get(`/api/v1/mvp/${leadId}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(project);
      expect(findOne).toHaveBeenCalledWith({ $or: [{ _id: leadId }, { leadId }, { auditId: leadId }] });
    });

    it('should look up a slug by previewSlug', async () => {
      const findOne = vi.spyOn(MvpProject, 'findOne').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ previewSlug: 'smile-1' }),
      } as any);

      const res = await request(app).get('/api/v1/mvp/smile-1');

      expect(res.status).toBe(200);
      expect(findOne).toHaveBeenCalledWith({ previewSlug: 'smile-1' });
    });

    it.each([new mongoose.Types.ObjectId().toString(), 'unknown-slug'])(
      'should return 404 instead of a made-up preview when no MVP exists (%s) (REV-45)',
      async (id) => {
        vi.spyOn(MvpProject, 'findOne').mockReturnValue({ exec: vi.fn().mockResolvedValue(null) } as any);

        const res = await request(app).get(`/api/v1/mvp/${id}`);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toEqual({ code: 'MVP_NOT_FOUND', message: 'MVP not found' });
        expect(res.body.data).toBeUndefined();
      },
    );

    it('should return 500 when the lookup fails', async () => {
      vi.spyOn(MvpProject, 'findOne').mockReturnValue({ exec: vi.fn().mockRejectedValue(new Error('db down')) } as any);
      const res = await request(app).get('/api/v1/mvp/some-slug');
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INTERNAL');
    });
  });

  describe('GET /api/v1/mvp/preview/:slug', () => {
    it('should redirect to the stored preview', async () => {
      vi.spyOn(MvpProject, 'findOne').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ fullPreviewUrl: 'http://minio/revamp-demos/smile/index.html' }),
      } as any);
      const res = await request(app).get('/api/v1/mvp/preview/smile');
      expect(res.status).toBe(302);
      expect(res.headers['location']).toBe('http://minio/revamp-demos/smile/index.html');
    });

    it('should return 404 in the standard error format for an unknown slug (REV-63)', async () => {
      vi.spyOn(MvpProject, 'findOne').mockReturnValue({ exec: vi.fn().mockResolvedValue(null) } as any);
      const res = await request(app).get('/api/v1/mvp/preview/missing');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ success: false, error: { code: 'PREVIEW_NOT_FOUND', message: 'Preview not found' } });
    });
  });

  describe('PATCH /api/v1/mvp/:id/tokens', () => {
    it('should save the palette and return the updated MVP from the database', async () => {
      const projectId = new mongoose.Types.ObjectId().toString();
      const saved = { _id: projectId, colorPalette: { primary: '#4F46E5', secondary: '#A5B4FC', accent: '#4F46E5' } };
      const updateSpy = vi.spyOn(MvpProject, 'findByIdAndUpdate').mockReturnValue({
        exec: vi.fn().mockResolvedValue(saved),
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
      expect(res.body.data.colorPalette).toEqual(saved.colorPalette);
      expect(updateSpy).toHaveBeenCalledWith(
        projectId,
        {
          $set: {
            'colorPalette.primary': '#4F46E5',
            'colorPalette.secondary': '#A5B4FC',
            'colorPalette.accent': '#4F46E5',
          },
        },
        { new: true },
      );
    });

    it('should only set the colors present in the body (REV-65)', async () => {
      const projectId = new mongoose.Types.ObjectId().toString();
      const updateSpy = vi.spyOn(MvpProject, 'findByIdAndUpdate').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ _id: projectId, colorPalette: { primary: '#123456' } }),
      } as any);

      const res = await request(app).patch(`/api/v1/mvp/${projectId}/tokens`).send({ primaryColor: '#123456' });

      expect(res.status).toBe(200);
      expect(updateSpy).toHaveBeenCalledWith(projectId, { $set: { 'colorPalette.primary': '#123456' } }, { new: true });
    });

    it('should return 400 INVALID_ID for an id that is not an ObjectId and write nothing (REV-65)', async () => {
      const updateSpy = vi.spyOn(MvpProject, 'findByIdAndUpdate');

      const res = await request(app).patch('/api/v1/mvp/demo/tokens').send({ primaryColor: '#4F46E5' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: { code: 'INVALID_ID', message: 'A valid 24-character hexadecimal ObjectId is required' },
      });
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('should return 404 MVP_NOT_FOUND for an unknown MVP id (REV-65)', async () => {
      const projectId = new mongoose.Types.ObjectId().toString();
      vi.spyOn(MvpProject, 'findByIdAndUpdate').mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      } as any);

      const res = await request(app).patch(`/api/v1/mvp/${projectId}/tokens`).send({ primaryColor: '#4F46E5' });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ success: false, error: { code: 'MVP_NOT_FOUND', message: 'MVP not found' } });
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
      expect(res.body).toEqual({ success: false, error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
    });

    it('should return 400 INVALID_JSON for a malformed JSON body (REV-63)', async () => {
      const res = await request(app)
        .post('/api/v1/leads')
        .set('Content-Type', 'application/json')
        .send('{"businessName": ');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: { code: 'INVALID_JSON', message: 'The request body is not valid JSON' },
      });
    });
  });
});
