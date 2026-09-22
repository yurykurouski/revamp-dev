import { Worker, Job } from 'bullmq';
import crypto from 'crypto';
import { IEmailDispatchJobData } from '@revamp/shared-types';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';
import { Lead } from '../models/Lead.model.js';
import { EmailCampaign } from '../models/EmailCampaign.model.js';
import { mxValidator } from '../services/mx.validator.js';
import { emailService } from '../services/email.service.js';

export interface IEmailWorkerResult {
  success: boolean;
  campaignId?: string;
  leadId?: string;
  messageId?: string;
  provider?: string;
  sentAt?: Date;
  bounced?: boolean;
  aborted?: boolean;
  reason?: string;
}

export const createEmailWorker = (): Worker => {
  const worker = new Worker<IEmailDispatchJobData, IEmailWorkerResult>(
    QUEUE_NAMES.EMAIL_DISPATCH,
    async (job: Job<IEmailDispatchJobData>): Promise<IEmailWorkerResult> => {
      const { campaignId, leadId } = job.data;
      console.log(`[EmailWorker] Received dispatch job for lead: ${leadId}, campaign: ${campaignId}`);

      // 1. Fetch Lead
      const lead = await Lead.findById(leadId).exec();
      if (!lead) {
        throw new Error(`Lead ${leadId} not found`);
      }

      // 2. Strict Human-In-The-Loop (HITL) Gate Enforcement
      // Only leads in 'SCHEDULED' or 'APPROVED' status are permitted to receive external outreach
      if (lead.status !== 'SCHEDULED' && lead.status !== 'APPROVED') {
        const warning = `Lead ${leadId} has status "${lead.status}". Outreach requires explicit operator approval ('SCHEDULED'). Aborting dispatch.`;
        console.warn(`[EmailWorker] ${warning}`);
        return {
          success: false,
          aborted: true,
          leadId,
          reason: warning,
        };
      }

      // 3. Fetch or Locate EmailCampaign
      let campaign = await EmailCampaign.findOne({
        $or: [{ _id: campaignId }, { leadId: lead._id }],
      }).exec();

      const recipientEmail = campaign?.recipientEmail || lead.contactEmail;
      if (!recipientEmail) {
        throw new Error(`No recipient email address available for lead ${leadId}`);
      }

      // 4. Pre-flight DNS MX-Record Validation
      console.log(`[EmailWorker] Running pre-flight MX validation for recipient: ${recipientEmail}...`);
      const mxResult = await mxValidator.validateRecipientDomain(recipientEmail);

      if (!mxResult.valid) {
        const bounceReason = mxResult.reason || `No routable MX records found for domain ${mxResult.domain}`;
        console.warn(`[EmailWorker] Pre-flight MX check failed for ${recipientEmail}: ${bounceReason}`);

        // Update campaign if exists
        if (campaign) {
          await EmailCampaign.findByIdAndUpdate(campaign._id, {
            status: 'BOUNCED',
            bouncedAt: new Date(),
            bounceReason,
          }).exec();
        }

        // Update Lead status to REJECTED and tag with bounce metadata
        await Lead.findByIdAndUpdate(lead._id, {
          status: 'REJECTED',
          $addToSet: { tags: 'mx_bounced' },
        }).exec();

        return {
          success: false,
          bounced: true,
          leadId,
          campaignId: campaign?._id?.toString() || campaignId,
          reason: bounceReason,
        };
      }

      console.log(`[EmailWorker] Recipient domain verified via MX: ${mxResult.mxRecords?.join(', ')}`);

      // 5. Prepare Email Content & Tracking Token
      const trackingToken = campaign?.trackingToken || crypto.randomUUID().replace(/-/g, '');
      const subject =
        campaign?.subject ||
        `3 точки роста в конверсии сайта «${lead.businessName}» (и интерактивный прототип)`;
      const bodyHtml =
        campaign?.bodyHtml ||
        `<p>Здравствуйте! Мы подготовили интерактивную концепцию обновления сайта для компании «${lead.businessName}».</p>`;
      const bodyPlainText =
        campaign?.bodyPlainText ||
        `Здравствуйте! Мы подготовили интерактивную концепцию обновления сайта для компании «${lead.businessName}».`;

      // 6. Dispatch Email via Provider with Compliance Headers
      console.log(`[EmailWorker] Dispatching email to ${recipientEmail} via ${emailService.getProvider().name}...`);
      const sendResult = await emailService.sendEmail({
        to: recipientEmail,
        subject,
        html: bodyHtml,
        text: bodyPlainText,
        trackingToken,
      });

      console.log(
        `[EmailWorker] Email successfully dispatched. Message ID: ${sendResult.messageId}, Provider: ${sendResult.provider}`,
      );

      const now = new Date();

      // 7. Update EmailCampaign status to DELIVERED
      if (campaign) {
        await EmailCampaign.findByIdAndUpdate(campaign._id, {
          status: 'DELIVERED',
          sentAt: now,
        }).exec();
      }

      // 8. Update Lead status to SENT
      await Lead.findByIdAndUpdate(lead._id, {
        status: 'SENT',
        updatedAt: now,
      }).exec();

      console.log(`[EmailWorker] Lead ${leadId} status updated to 'SENT'. Dispatch complete.`);

      return {
        success: true,
        campaignId: campaign?._id?.toString() || campaignId,
        leadId: lead._id.toString(),
        messageId: sendResult.messageId,
        provider: sendResult.provider,
        sentAt: now,
      };
    },
    {
      connection: redisConnection,
      concurrency: 1, // Single-stream dispatch to prevent concurrent bursts
      limiter: {
        max: 1,
        duration: 180000, // Strictly enforce max 1 email per 3 minutes (180s)
      },
    },
  );

  worker.on('completed', (job, result) => {
    console.log(`[EmailWorker] Job ${job.id} completed. Success: ${result.success}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[EmailWorker] Job ${job?.id} failed:`, err);
  });

  return worker;
};
