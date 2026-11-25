import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEmailWorker } from '../email.worker.js';
import { Lead } from '../../models/Lead.model.js';
import { EmailCampaign, revertOutreachApproval } from '../../models/EmailCampaign.model.js';
import { mxValidator } from '../../services/mx.validator.js';
import { loadStudioSender, simulateDelivery } from '../../services/email.service.js';
import { Types } from 'mongoose';

const TENANT = '5eed00000000000000000009';
const TENANT_ID = new Types.ObjectId(TENANT);

vi.mock('../../models/Lead.model.js');
vi.mock('../../models/EmailCampaign.model.js');
vi.mock('../../services/mx.validator.js');
vi.mock('../../services/email.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/email.service.js')>()),
  loadStudioSender: vi.fn(),
  simulateDelivery: vi.fn(),
}));
const SENDER = { name: 'Studio A', address: 'a@studio-a.test' };
const message = (over: Record<string, unknown> = {}) => ({
  from: '"Studio A" <a@studio-a.test>',
  to: 'director@listonosz.site',
  subject: 's',
  headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  html: '<p>rendered</p>',
  text: 'rendered',
  ...over,
});
vi.mock('../../queues/connection.js', () => ({
  redisConnection: {} as any,
}));

let capturedProcessor: ((job: any) => Promise<any>) | null = null;
let capturedWorkerOpts: any = null;

const mockWorkerInstance = {
  on: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('bullmq', () => {
  return {
    UnrecoverableError: class UnrecoverableError extends Error {
      name = 'UnrecoverableError';
    },
    Worker: vi.fn().mockImplementation(function (queueName: string, processor: any, opts: any) {
      capturedProcessor = processor;
      capturedWorkerOpts = opts;
      return {
        ...mockWorkerInstance,
        queueName,
        opts,
      };
    }),
  };
});

describe('EmailWorker (@revamp/workers)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadStudioSender).mockResolvedValue(SENDER);
    vi.mocked(simulateDelivery).mockReturnValue(message());
    capturedProcessor = null;
    capturedWorkerOpts = null;
  });

  it('should initialize worker for EMAIL_DISPATCH queue with single-stream concurrency and 180s limiter', () => {
    const worker = createEmailWorker();
    expect(worker).toBeDefined();
    expect(capturedProcessor).toBeTypeOf('function');
    expect(capturedWorkerOpts).toEqual(
      expect.objectContaining({
        concurrency: 1,
        limiter: {
          max: 1,
          duration: 180000,
        },
      }),
    );
  });

  it('should validate MX, record a simulated delivery in the outbox, and update Lead status to SENT', async () => {
    createEmailWorker();
    expect(capturedProcessor).not.toBeNull();

    const mockLeadId = '64f8a1234567890123456789';
    const mockCampaignId = '64f8a9876543210987654321';

    const mockLead = {
      _id: mockLeadId,
      tenantId: TENANT,
      businessName: 'Listonosz Courier & Logistics',
      domain: 'listonosz.site',
      contactEmail: 'director@listonosz.site',
      status: 'SCHEDULED', // Operator approved
    };

    const mockCampaign = {
      _id: mockCampaignId,
      leadId: mockLeadId,
      status: 'SCHEDULED',
      recipientEmail: 'director@listonosz.site',
      subject: '3 ways to lift conversions on the Listonosz Courier & Logistics website',
      bodyHtml: '<p>Welcome text</p>',
      bodyPlainText: 'Welcome text',
      trackingToken: 'tok-listonosz-123',
    };

    (Lead.findById as any).mockReturnValue({
      exec: vi.fn().mockResolvedValue(mockLead),
    });

    (EmailCampaign.findOne as any).mockReturnValue({
      exec: vi.fn().mockResolvedValue(mockCampaign),
    });

    (EmailCampaign.findOneAndUpdate as any).mockReturnValue({
      exec: vi.fn().mockResolvedValue({ ...mockCampaign, status: 'SENDING' }),
    });

    (mxValidator.validateRecipientDomain as any).mockResolvedValue({
      valid: true,
      domain: 'listonosz.site',
      mxRecords: ['mx.listonosz.site'],
    });

    (EmailCampaign.findByIdAndUpdate as any).mockReturnValue({
      exec: vi.fn().mockResolvedValue(mockCampaign),
    });

    (Lead.findOneAndUpdate as any).mockReturnValue({
      exec: vi.fn().mockResolvedValue({ ...mockLead, status: 'SENT' }),
    });

    const result = await capturedProcessor!({
      id: 'job-email-1',
      data: {
        tenantId: TENANT, campaignId: mockCampaignId,
        leadId: mockLeadId,
      },
    });

    expect(result.success).toBe(true);
    expect(result.leadId).toBe(mockLeadId);
    expect(result.deliveryMode).toBe('SIMULATED');

    // Verify MX validation was called
    expect(mxValidator.validateRecipientDomain).toHaveBeenCalledWith('director@listonosz.site');

    // Verify the message is rendered from the studio sender with the approved text
    expect(simulateDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        sender: SENDER,
        to: 'director@listonosz.site',
        trackingToken: 'tok-listonosz-123',
        subject: mockCampaign.subject,
        html: '<p>Welcome text</p>',
        text: 'Welcome text',
      }),
    );

    // Verify the campaign was claimed atomically before sending (REV-61)
    expect(EmailCampaign.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: mockCampaignId, status: { $in: ['SCHEDULED', 'APPROVED'] } },
      { $set: { status: 'SENDING' } },
      { new: true },
    );

    // Verify Lead status was updated to SENT
    expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: mockLeadId, status: { $in: ['SCHEDULED'] }, tenantId: TENANT_ID },
      expect.objectContaining({
        status: 'SENT',
      }),
    );

    // Verify Campaign status was updated to DELIVERED
    expect(EmailCampaign.findByIdAndUpdate).toHaveBeenCalledWith(
      mockCampaignId,
      expect.objectContaining({
        status: 'DELIVERED',
      }),
    );
  });

  it('should abort dispatch when Lead is not SCHEDULED (HITL Gate)', async () => {
    createEmailWorker();

    const mockLeadId = 'lead-unapproved';
    const mockLead = {
      _id: mockLeadId,
      tenantId: TENANT,
      businessName: 'Unapproved Business',
      status: 'NEEDS_APPROVAL', // Operator has NOT approved
      contactEmail: 'unapproved@business.com',
    };

    (Lead.findById as any).mockReturnValue({
      exec: vi.fn().mockResolvedValue(mockLead),
    });

    const result = await capturedProcessor!({
      id: 'job-unapproved',
      data: {
        tenantId: TENANT, campaignId: 'camp-1',
        leadId: mockLeadId,
      },
    });

    expect(result.success).toBe(false);
    expect(result.aborted).toBe(true);
    expect(result.reason).toContain('Outreach requires explicit operator approval');
    expect(simulateDelivery).not.toHaveBeenCalled();
    expect(mxValidator.validateRecipientDomain).not.toHaveBeenCalled();
  });

  it('should not send to a lead that unsubscribed before the job ran (REV-73)', async () => {
    createEmailWorker();

    (Lead.findById as any).mockReturnValue({
      exec: vi.fn().mockResolvedValue({
        _id: 'lead-unsubscribed',
        tenantId: TENANT,
        businessName: 'Opted Out Business',
        status: 'UNSUBSCRIBED',
        contactEmail: 'owner@optedout.com',
      }),
    });

    const result = await capturedProcessor!({
      id: 'job-unsubscribed',
      data: { tenantId: TENANT, campaignId: 'camp-1', leadId: 'lead-unsubscribed' },
    });

    expect(result.success).toBe(false);
    expect(result.aborted).toBe(true);
    expect(result.reason).toContain('UNSUBSCRIBED');
    expect(simulateDelivery).not.toHaveBeenCalled();
    expect(Lead.findOneAndUpdate).not.toHaveBeenCalled();
    expect(EmailCampaign.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('should catch unroutable MX records, mark EmailCampaign as BOUNCED, Lead as REJECTED, and prevent email send', async () => {
    createEmailWorker();

    const mockLeadId = 'lead-bad-mx';
    const mockCampaignId = 'camp-bad-mx';

    const mockLead = {
      _id: mockLeadId,
      tenantId: TENANT,
      businessName: 'Non Existent Company',
      contactEmail: 'info@non-existent-fake-domain-xyz.com',
      status: 'SCHEDULED',
    };

    const mockCampaign = {
      _id: mockCampaignId,
      leadId: mockLeadId,
      status: 'SCHEDULED',
      recipientEmail: 'info@non-existent-fake-domain-xyz.com',
      subject: 'Subject',
      bodyHtml: '<p>Body</p>',
    };

    (Lead.findById as any).mockReturnValue({
      exec: vi.fn().mockResolvedValue(mockLead),
    });

    (EmailCampaign.findOne as any).mockReturnValue({
      exec: vi.fn().mockResolvedValue(mockCampaign),
    });

    (mxValidator.validateRecipientDomain as any).mockResolvedValue({
      valid: false,
      domain: 'non-existent-fake-domain-xyz.com',
      reason: 'Recipient domain does not exist (ENOTFOUND)',
    });

    (EmailCampaign.findByIdAndUpdate as any).mockReturnValue({
      exec: vi.fn().mockResolvedValue(mockCampaign),
    });

    (Lead.findOneAndUpdate as any).mockReturnValue({
      exec: vi.fn().mockResolvedValue(mockLead),
    });

    const result = await capturedProcessor!({
      id: 'job-bad-mx',
      data: {
        tenantId: TENANT, campaignId: mockCampaignId,
        leadId: mockLeadId,
      },
    });

    expect(result.success).toBe(false);
    expect(result.bounced).toBe(true);
    expect(result.reason).toContain('ENOTFOUND');

    // Verified: No email sent
    expect(simulateDelivery).not.toHaveBeenCalled();

    // Verified: Campaign marked BOUNCED
    expect(EmailCampaign.findByIdAndUpdate).toHaveBeenCalledWith(
      mockCampaignId,
      expect.objectContaining({
        status: 'BOUNCED',
        bounceReason: expect.stringContaining('ENOTFOUND'),
      }),
    );

    // Verified: Lead marked REJECTED with mx_bounced tag
    expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: mockLeadId, status: { $in: expect.arrayContaining(['SCHEDULED']) }, tenantId: TENANT_ID },
      expect.objectContaining({
        status: 'REJECTED',
        $addToSet: { tags: 'mx_bounced' },
      }),
    );
  });

  it('should throw error when lead is not found in database', async () => {
    createEmailWorker();

    (Lead.findById as any).mockReturnValue({
      exec: vi.fn().mockResolvedValue(null),
    });

    await expect(
      capturedProcessor!({
        id: 'job-missing-lead',
        data: {
          tenantId: TENANT, campaignId: 'camp-1',
          leadId: 'missing-lead',
        },
      }),
    ).rejects.toThrow('Lead missing-lead not found');
  });

  describe('simulated delivery from the studio sender (REV-221)', () => {
    const leadId = '64f8a1234567890123456789';
    const campaignId = '64f8a9876543210987654321';
    const lead = { _id: leadId, tenantId: TENANT, businessName: 'Biz', contactEmail: 'owner@biz.com', status: 'SCHEDULED' };
    const campaign = {
      _id: campaignId,
      leadId,
      status: 'SCHEDULED',
      senderEmail: 'old@studio-a.test',
      recipientEmail: 'owner@biz.com',
      subject: 'Approved subject',
      bodyHtml: '<p>Approved body</p>',
      bodyPlainText: 'Approved body',
      trackingToken: 'tok-approved',
    };
    const job = { id: 'j', data: { tenantId: TENANT, campaignId, leadId } };
    const exec = (value: unknown) => ({ exec: vi.fn().mockResolvedValue(value) });

    beforeEach(() => {
      (Lead.findById as any).mockReturnValue(exec(lead));
      (Lead.findOneAndUpdate as any).mockReturnValue(exec(lead));
      (EmailCampaign.findOne as any).mockReturnValue(exec(campaign));
      (EmailCampaign.findOneAndUpdate as any).mockReturnValue(exec({ ...campaign, status: 'SENDING' }));
      (EmailCampaign.findByIdAndUpdate as any).mockReturnValue(exec(campaign));
      (mxValidator.validateRecipientDomain as any).mockResolvedValue({ valid: true, domain: 'biz.com', mxRecords: ['mx.biz.com'] });
      createEmailWorker();
    });

    it('records a simulated delivery from the studio sender', async () => {
      const result = await capturedProcessor!(job);

      expect(result).toMatchObject({ success: true, deliveryMode: 'SIMULATED' });
      expect(EmailCampaign.findByIdAndUpdate).toHaveBeenCalledWith(
        campaignId,
        expect.objectContaining({
          status: 'DELIVERED',
          deliveryMode: 'SIMULATED',
          senderEmail: 'a@studio-a.test',
          senderName: 'Studio A',
          outbox: expect.objectContaining({ from: '"Studio A" <a@studio-a.test>' }),
        }),
      );
      expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'SENT' }));
    });

    it('uses the studio sender current at send time', async () => {
      // The campaign carries the approval-time sender; the owner changed it before the job ran
      vi.mocked(loadStudioSender).mockResolvedValue({ name: 'Studio A New', address: 'new@studio-a.test' });

      await capturedProcessor!(job);

      expect(vi.mocked(simulateDelivery).mock.calls[0]![0].sender).toEqual({ name: 'Studio A New', address: 'new@studio-a.test' });
      expect(EmailCampaign.findByIdAndUpdate).toHaveBeenCalledWith(
        campaignId,
        expect.objectContaining({ senderEmail: 'new@studio-a.test', senderName: 'Studio A New' }),
      );
    });

    it("reads the sender of the job's studio only", async () => {
      await capturedProcessor!(job);
      expect(loadStudioSender).toHaveBeenCalledTimes(1);
      expect(vi.mocked(loadStudioSender).mock.calls[0]![0]).toEqual(TENANT_ID);
    });

    it('returns the lead to review, with no DELIVERED write, when the studio has no sender', async () => {
      vi.mocked(loadStudioSender).mockResolvedValue(null);

      const result = await capturedProcessor!(job);

      expect(result).toMatchObject({ success: false, aborted: true, reason: expect.stringContaining('no sender') });
      expect(revertOutreachApproval).toHaveBeenCalledWith(leadId);
      expect(simulateDelivery).not.toHaveBeenCalled();
      expect(EmailCampaign.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(EmailCampaign.findOneAndUpdate).not.toHaveBeenCalled();
      expect(Lead.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('a retry of a delivered campaign leaves the outbox and sentAt as they were', async () => {
      const sentAt = new Date('2026-11-25T10:00:00Z');
      (EmailCampaign.findOne as any).mockReturnValue(exec({ ...campaign, status: 'DELIVERED', sentAt, outbox: message() }));

      const result = await capturedProcessor!(job);

      expect(result).toMatchObject({ success: true, alreadySent: true, sentAt });
      expect(simulateDelivery).not.toHaveBeenCalled();
      expect(loadStudioSender).not.toHaveBeenCalled();
      expect(EmailCampaign.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(EmailCampaign.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('at-most-once dispatch with only the approved text (REV-61)', () => {
    const leadId = '64f8a1234567890123456789';
    const campaignId = '64f8a9876543210987654321';
    let campaign: Record<string, any>;
    let lead: Record<string, any>;

    const job = (id: string) => ({ id, data: { tenantId: TENANT, campaignId, leadId } });

    // A campaign and lead whose fake queries behave like MongoDB's, so retries see earlier writes
    beforeEach(() => {
      lead = { _id: leadId, tenantId: TENANT, businessName: 'Biz', contactEmail: 'owner@biz.com', status: 'SCHEDULED' };
      campaign = {
        _id: campaignId,
        leadId,
        status: 'SCHEDULED',
        recipientEmail: 'owner@biz.com',
        subject: 'Approved subject',
        bodyHtml: '<p>Approved body</p>',
        bodyPlainText: 'Approved body',
        trackingToken: 'tok-approved',
      };

      const exec = (fn: () => unknown) => ({ exec: vi.fn().mockImplementation(async () => fn()) });
      (Lead.findById as any).mockImplementation(() => exec(() => ({ ...lead })));
      (Lead.findOneAndUpdate as any).mockImplementation((filter: any, update: any) =>
        exec(() => {
          const wanted = filter.status?.$in ?? [filter.status];
          if (!wanted.includes(lead.status)) return null;
          Object.assign(lead, update);
          return { ...lead };
        }),
      );
      (EmailCampaign.findOne as any).mockImplementation(() => exec(() => campaign && { ...campaign }));
      (EmailCampaign.findById as any).mockImplementation(() => exec(() => campaign && { ...campaign }));
      (EmailCampaign.findByIdAndUpdate as any).mockImplementation((_id: string, update: any) =>
        exec(() => Object.assign(campaign, update)),
      );
      (EmailCampaign.findOneAndUpdate as any).mockImplementation((filter: any, update: any) =>
        exec(() => {
          const wanted = filter.status?.$in ?? [filter.status];
          if (!wanted.includes(campaign.status)) return null;
          Object.assign(campaign, update.$set);
          return { ...campaign };
        }),
      );

      (mxValidator.validateRecipientDomain as any).mockResolvedValue({ valid: true, domain: 'biz.com', mxRecords: ['mx.biz.com'] });
      createEmailWorker();
    });

    it('does not record again when a retry follows a failure after the message was recorded', async () => {
      (EmailCampaign.findByIdAndUpdate as any).mockReturnValueOnce({
        exec: vi.fn().mockRejectedValue(new Error('Mongo write failed')),
      });

      await expect(capturedProcessor!(job('attempt-1'))).rejects.toThrow('Mongo write failed');
      expect(campaign['status']).toBe('SENDING');

      const retry = await capturedProcessor!(job('attempt-2'));

      expect(simulateDelivery).toHaveBeenCalledTimes(1);
      expect(retry.success).toBe(false);
      expect(retry.aborted).toBe(true);
      expect(retry.reason).toContain('SENDING');
    });

    it('finishes only the lead update when the campaign was delivered but the lead update failed', async () => {
      (Lead.findOneAndUpdate as any).mockReturnValueOnce({
        exec: vi.fn().mockRejectedValue(new Error('Lead write failed')),
      });

      await expect(capturedProcessor!(job('attempt-1'))).rejects.toThrow('Lead write failed');
      expect(campaign['status']).toBe('DELIVERED');
      expect(lead['status']).toBe('SCHEDULED');

      const retry = await capturedProcessor!(job('attempt-2'));

      expect(simulateDelivery).toHaveBeenCalledTimes(1);
      expect(retry.success).toBe(true);
      expect(retry.alreadySent).toBe(true);
      expect(lead['status']).toBe('SENT');
    });

    it('does not send when another attempt already claimed the campaign', async () => {
      campaign['status'] = 'SENDING';

      const result = await capturedProcessor!(job('attempt-1'));

      expect(result.aborted).toBe(true);
      expect(simulateDelivery).not.toHaveBeenCalled();
      expect(lead['status']).toBe('SCHEDULED');
    });

    it('keeps a lead that opted out while the email was being sent UNSUBSCRIBED (REV-62)', async () => {
      vi.mocked(simulateDelivery).mockImplementationOnce(() => {
        lead['status'] = 'UNSUBSCRIBED';
        return message();
      });

      const result = await capturedProcessor!(job('attempt-1'));

      expect(result.success).toBe(true);
      expect(campaign['status']).toBe('DELIVERED');
      expect(lead['status']).toBe('UNSUBSCRIBED');
    });

    it('fails without sending and without retrying when there is no campaign', async () => {
      campaign = null as any;

      const failure = capturedProcessor!(job('attempt-1'));

      await expect(failure).rejects.toThrow('No approved EmailCampaign');
      await expect(failure).rejects.toMatchObject({ name: 'UnrecoverableError' });
      expect(simulateDelivery).not.toHaveBeenCalled();
      expect(mxValidator.validateRecipientDomain).not.toHaveBeenCalled();
      expect(lead['status']).toBe('SCHEDULED');
    });

    it.each([
      ['subject', { subject: '' }],
      ['subject', { subject: '   ' }],
      ['body', { bodyHtml: '' }],
      ['body', { bodyHtml: undefined }],
    ])('fails without sending default copy when the approved %s is empty', async (_field, patch) => {
      Object.assign(campaign, patch);

      await expect(capturedProcessor!(job('attempt-1'))).rejects.toThrow('no approved subject or body');
      expect(simulateDelivery).not.toHaveBeenCalled();
      expect(campaign['status']).toBe('SCHEDULED');
    });
  });
  describe("the job's studio (REV-210)", () => {
    const attempt = async (data: Record<string, unknown>, lead: Record<string, unknown> | null) => {
      createEmailWorker();
      (Lead.findById as any).mockReturnValue({ exec: vi.fn().mockResolvedValue(lead) });
      return capturedProcessor!({ id: 'job-tenant', data: { campaignId: 'camp-1', leadId: 'lead-1', ...data } });
    };
    const scheduled = { _id: 'lead-1', businessName: 'Biz', status: 'SCHEDULED', contactEmail: 'owner@biz.com' };

    it.each([
      ['has no tenantId', {}, scheduled, /no valid tenantId/],
      ["belongs to another studio than its lead", { tenantId: TENANT }, { ...scheduled, tenantId: '5eed0000000000000000000a' }, /another studio/],
      ['has a lead with no studio yet', { tenantId: TENANT }, scheduled, /migrate:tenants/],
    ])('refuses a job that %s: nothing is sent or written', async (_name, data, lead, message) => {
      await expect(attempt(data, lead)).rejects.toThrow(message);
      expect(simulateDelivery).not.toHaveBeenCalled();
      expect(EmailCampaign.findOne).not.toHaveBeenCalled();
      expect(EmailCampaign.findOneAndUpdate).not.toHaveBeenCalled();
      expect(EmailCampaign.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(Lead.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("looks up the campaign only among the studio's own", async () => {
      await attempt({ tenantId: TENANT }, { ...scheduled, tenantId: TENANT }).catch(() => undefined);
      expect(vi.mocked(EmailCampaign.findOne).mock.calls[0]![0]).toMatchObject({ tenantId: TENANT_ID });
    });
  });
});
