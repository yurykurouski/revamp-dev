import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EMAIL_PROVIDER_NOT_CONFIGURED, QUEUE_NAMES } from '@revamp/shared-types';
import {
  createEmailTestWorker,
  draftToHtml,
  processEmailTestJob,
  TEST_SUBJECT_PREFIX,
  TEST_TRACKING_TOKEN,
} from '../email-test.worker.js';
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

let capturedQueueName: string | null = null;
let capturedProcessor: ((job: any) => Promise<any>) | null = null;
let capturedWorkerOpts: any = null;

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(function (queueName: string, processor: any, opts: any) {
    capturedQueueName = queueName;
    capturedProcessor = processor;
    capturedWorkerOpts = opts;
    return { on: vi.fn(), close: vi.fn() };
  }),
}));

describe('EmailTestWorker (REV-60)', () => {
  const data = {
    leadId: '64f8a1234567890123456789',
    to: 'operator@revamp.io',
    subject: 'A new mobile website for Dr Smile',
    preheader: 'An interactive prototype',
    body: 'Hello,\n\nSee <https://demo.example/dr-smile>\nThanks & bye',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    capturedQueueName = null;
    capturedProcessor = null;
    capturedWorkerOpts = null;
  });

  it('listens on its own queue, without the outreach rate limit', () => {
    createEmailTestWorker();
    expect(capturedQueueName).toBe(QUEUE_NAMES.EMAIL_TEST);
    expect(capturedWorkerOpts).not.toHaveProperty('limiter');
  });

  it('sends the draft to the operator without open tracking and returns the provider result', async () => {
    const sentAt = new Date('2026-09-27T12:00:00Z');
    vi.mocked(emailService.sendEmail).mockResolvedValue({ success: true, messageId: 'msg-1', provider: 'smtp', sentAt });

    createEmailTestWorker();
    const result = await capturedProcessor!({ id: 'job-1', data });

    expect(result).toEqual({ messageId: 'msg-1', provider: 'smtp', sentAt: sentAt.toISOString() });
    expect(emailService.sendEmail).toHaveBeenCalledWith({
      to: 'operator@revamp.io',
      subject: `${TEST_SUBJECT_PREFIX}${data.subject}`,
      html: draftToHtml(data.body, data.preheader),
      text: data.body,
      trackingToken: TEST_TRACKING_TOKEN,
      trackOpens: false,
    });
  });

  it('never reads or changes the lead or its campaign, and skips the MX pre-check', async () => {
    vi.mocked(emailService.sendEmail).mockResolvedValue({ success: true, provider: 'smtp', sentAt: new Date() });

    await processEmailTestJob(data);

    expect(Lead.findById).not.toHaveBeenCalled();
    expect(Lead.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(EmailCampaign.findOne).not.toHaveBeenCalled();
    expect(EmailCampaign.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(mxValidator.validateRecipientDomain).not.toHaveBeenCalled();
  });

  it('fails the job when no provider is configured', async () => {
    vi.mocked(emailService.sendEmail).mockRejectedValue(new Error(EMAIL_PROVIDER_NOT_CONFIGURED));

    await expect(processEmailTestJob(data)).rejects.toThrow(EMAIL_PROVIDER_NOT_CONFIGURED);
    expect(Lead.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('fails the job with the provider error', async () => {
    vi.mocked(emailService.sendEmail).mockRejectedValue(new Error('Resend API error (403): forbidden'));

    await expect(processEmailTestJob(data)).rejects.toThrow('Resend API error (403)');
  });

  describe('draftToHtml', () => {
    it('escapes the draft and keeps its paragraphs and line breaks', () => {
      expect(draftToHtml('Hi <b>you</b>\nline 2\n\nA & "B"')).toBe(
        '<p>Hi &lt;b&gt;you&lt;/b&gt;<br>line 2</p>\n<p>A &amp; &quot;B&quot;</p>',
      );
    });

    it('adds the preheader as hidden text before the body', () => {
      const html = draftToHtml('Body', 'Preview <text>');
      expect(html.startsWith('<div style="display:none;')).toBe(true);
      expect(html).toContain('Preview &lt;text&gt;');
      expect(html.endsWith('<p>Body</p>')).toBe(true);
    });
  });
});
