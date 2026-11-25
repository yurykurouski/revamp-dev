import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QUEUE_NAMES, draftToHtml } from '@revamp/shared-types';
import {
  createEmailTestWorker,
  processEmailTestJob,
  TEST_SUBJECT_PREFIX,
  TEST_TRACKING_TOKEN,
} from '../email-test.worker.js';
import { Lead } from '../../models/Lead.model.js';
import { EmailCampaign } from '../../models/EmailCampaign.model.js';
import { mxValidator } from '../../services/mx.validator.js';
import { loadStudioSender, simulateDelivery } from '../../services/email.service.js';

vi.mock('../../models/Lead.model.js');
vi.mock('../../models/EmailCampaign.model.js');
vi.mock('../../services/mx.validator.js');
vi.mock('../../services/email.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/email.service.js')>()),
  loadStudioSender: vi.fn(),
}));
vi.mock('../../queues/connection.js', () => ({
  redisConnection: {} as any,
}));

let capturedQueueName: string | null = null;
let capturedProcessor: ((job: any) => Promise<any>) | null = null;
let capturedWorkerOpts: any = null;

vi.mock('bullmq', () => ({
  UnrecoverableError: class UnrecoverableError extends Error {},
  Worker: vi.fn().mockImplementation(function (queueName: string, processor: any, opts: any) {
    capturedQueueName = queueName;
    capturedProcessor = processor;
    capturedWorkerOpts = opts;
    return { on: vi.fn(), close: vi.fn() };
  }),
}));

describe('EmailTestWorker (REV-60, REV-221)', () => {
  const data = {
    leadId: '64f8a1234567890123456789',
    tenantId: '5eed00000000000000000009',
    to: 'operator@revamp.io',
    subject: 'A new mobile website for Dr Smile',
    preheader: 'An interactive prototype',
    body: 'Hello,\n\nSee <https://demo.example/dr-smile>\nThanks & bye',
  };
  const sender = { name: 'Studio A', address: 'a@studio-a.test' };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadStudioSender).mockResolvedValue(sender);
    capturedQueueName = null;
    capturedProcessor = null;
    capturedWorkerOpts = null;
  });

  it('refuses a job without a valid tenantId before rendering anything (REV-210)', async () => {
    createEmailTestWorker();
    for (const tenantId of [undefined, 'nope']) {
      await expect(capturedProcessor!({ id: 'j', data: { ...data, tenantId } })).rejects.toThrow(/no valid tenantId/);
    }
    expect(loadStudioSender).not.toHaveBeenCalled();
  });

  it('listens on its own queue, without the outreach rate limit', () => {
    createEmailTestWorker();
    expect(capturedQueueName).toBe(QUEUE_NAMES.EMAIL_TEST);
    expect(capturedWorkerOpts).not.toHaveProperty('limiter');
  });

  it("simulates the draft from the job's studio sender and returns simulated: true", async () => {
    createEmailTestWorker();
    const result = await capturedProcessor!({ id: 'job-1', data });

    expect(result).toEqual({
      to: 'operator@revamp.io',
      from: '"Studio A" <a@studio-a.test>',
      subject: `${TEST_SUBJECT_PREFIX}${data.subject}`,
      simulated: true,
    });
    expect(vi.mocked(loadStudioSender).mock.calls[0]![0].toString()).toBe(data.tenantId);
  });

  it('renders the draft without an open pixel, with the test token in the footer', () => {
    const rendered = simulateDelivery({
      sender,
      to: data.to,
      subject: `${TEST_SUBJECT_PREFIX}${data.subject}`,
      html: draftToHtml(data.body, data.preheader),
      text: data.body,
      trackingToken: TEST_TRACKING_TOKEN,
      trackOpens: false,
    });
    expect(rendered.html).not.toContain('/track/open/');
    expect(rendered.html).toContain(`/track/unsubscribe/${TEST_TRACKING_TOKEN}`);
  });

  it('never reads or changes the lead or its campaign, and skips the MX pre-check', async () => {
    await processEmailTestJob(data);

    expect(Lead.findById).not.toHaveBeenCalled();
    expect(Lead.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(EmailCampaign.findOne).not.toHaveBeenCalled();
    expect(EmailCampaign.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(mxValidator.validateRecipientDomain).not.toHaveBeenCalled();
  });

  it('fails the job with SENDER_NOT_CONFIGURED when the studio has no sender', async () => {
    vi.mocked(loadStudioSender).mockResolvedValue(null);

    await expect(processEmailTestJob(data)).rejects.toThrow(/^SENDER_NOT_CONFIGURED: /);
    expect(Lead.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});
