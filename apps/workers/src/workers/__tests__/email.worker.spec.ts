import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEmailWorker } from '../email.worker.js';
import { Lead } from '../../models/Lead.model.js';
import { EmailCampaign } from '../../models/EmailCampaign.model.js';
import { mxValidator } from '../../services/mx.validator.js';
import { emailService } from '../../services/email.service.js';

vi.mock('../../models/Lead.model.js');
vi.mock('../../models/EmailCampaign.model.js');
vi.mock('../../services/mx.validator.js');
vi.mock('../../services/email.service.js');
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

  it('should successfully validate MX, dispatch email via emailService, and update Lead status to SENT', async () => {
    createEmailWorker();
    expect(capturedProcessor).not.toBeNull();

    const mockLeadId = '64f8a1234567890123456789';
    const mockCampaignId = '64f8a9876543210987654321';

    const mockLead = {
      _id: mockLeadId,
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

    (mxValidator.validateRecipientDomain as any).mockResolvedValue({
      valid: true,
      domain: 'listonosz.site',
      mxRecords: ['mx.listonosz.site'],
    });

    (emailService.getProvider as any).mockReturnValue({ name: 'mock' });
    (emailService.sendEmail as any).mockResolvedValue({
      success: true,
      messageId: 'mock-msg-999',
      provider: 'mock',
      sentAt: new Date(),
    });

    (EmailCampaign.findByIdAndUpdate as any).mockReturnValue({
      exec: vi.fn().mockResolvedValue(mockCampaign),
    });

    (Lead.findByIdAndUpdate as any).mockReturnValue({
      exec: vi.fn().mockResolvedValue({ ...mockLead, status: 'SENT' }),
    });

    const result = await capturedProcessor!({
      id: 'job-email-1',
      data: {
        campaignId: mockCampaignId,
        leadId: mockLeadId,
      },
    });

    expect(result.success).toBe(true);
    expect(result.leadId).toBe(mockLeadId);
    expect(result.messageId).toBe('mock-msg-999');

    // Verify MX validation was called
    expect(mxValidator.validateRecipientDomain).toHaveBeenCalledWith('director@listonosz.site');

    // Verify emailService.sendEmail was called with proper options
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'director@listonosz.site',
        trackingToken: 'tok-listonosz-123',
        subject: mockCampaign.subject,
      }),
    );

    // Verify Lead status was updated to SENT
    expect(Lead.findByIdAndUpdate).toHaveBeenCalledWith(
      mockLeadId,
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

  it('should abort dispatch when Lead is not in SCHEDULED or APPROVED status (HITL Gate)', async () => {
    createEmailWorker();

    const mockLeadId = 'lead-unapproved';
    const mockLead = {
      _id: mockLeadId,
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
        campaignId: 'camp-1',
        leadId: mockLeadId,
      },
    });

    expect(result.success).toBe(false);
    expect(result.aborted).toBe(true);
    expect(result.reason).toContain('Outreach requires explicit operator approval');
    expect(emailService.sendEmail).not.toHaveBeenCalled();
    expect(mxValidator.validateRecipientDomain).not.toHaveBeenCalled();
  });

  it('should catch unroutable MX records, mark EmailCampaign as BOUNCED, Lead as REJECTED, and prevent email send', async () => {
    createEmailWorker();

    const mockLeadId = 'lead-bad-mx';
    const mockCampaignId = 'camp-bad-mx';

    const mockLead = {
      _id: mockLeadId,
      businessName: 'Non Existent Company',
      contactEmail: 'info@non-existent-fake-domain-xyz.com',
      status: 'SCHEDULED',
    };

    const mockCampaign = {
      _id: mockCampaignId,
      leadId: mockLeadId,
      status: 'SCHEDULED',
      recipientEmail: 'info@non-existent-fake-domain-xyz.com',
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

    (Lead.findByIdAndUpdate as any).mockReturnValue({
      exec: vi.fn().mockResolvedValue(mockLead),
    });

    const result = await capturedProcessor!({
      id: 'job-bad-mx',
      data: {
        campaignId: mockCampaignId,
        leadId: mockLeadId,
      },
    });

    expect(result.success).toBe(false);
    expect(result.bounced).toBe(true);
    expect(result.reason).toContain('ENOTFOUND');

    // Verified: No email sent
    expect(emailService.sendEmail).not.toHaveBeenCalled();

    // Verified: Campaign marked BOUNCED
    expect(EmailCampaign.findByIdAndUpdate).toHaveBeenCalledWith(
      mockCampaignId,
      expect.objectContaining({
        status: 'BOUNCED',
        bounceReason: expect.stringContaining('ENOTFOUND'),
      }),
    );

    // Verified: Lead marked REJECTED with mx_bounced tag
    expect(Lead.findByIdAndUpdate).toHaveBeenCalledWith(
      mockLeadId,
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
          campaignId: 'camp-1',
          leadId: 'missing-lead',
        },
      }),
    ).rejects.toThrow('Lead missing-lead not found');
  });
});
