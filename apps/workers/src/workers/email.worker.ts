import { Worker, Job, UnrecoverableError } from 'bullmq';
import type { Types } from 'mongoose';
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
  alreadySent?: boolean;
  reason?: string;
}

/** Campaign statuses an approved email is sent from; the worker claims it by moving it to SENDING (REV-61) */
const SENDABLE_CAMPAIGN_STATUSES = ['SCHEDULED', 'APPROVED'];

/** Finishes the lead update for a campaign that was already delivered, without sending anything */
const markLeadSent = async (
  leadId: Types.ObjectId | string,
  campaign: { _id: Types.ObjectId | string; sentAt?: Date },
  reason: string,
): Promise<IEmailWorkerResult> => {
  console.warn(`[EmailWorker] ${reason}`);
  await Lead.findByIdAndUpdate(leadId, { status: 'SENT' }).exec();
  return {
    success: true,
    alreadySent: true,
    campaignId: campaign._id.toString(),
    leadId: leadId.toString(),
    sentAt: campaign.sentAt,
    reason,
  };
};

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

      // 3. Load the approved campaign. Only the text the operator approved is ever sent: a missing
      // campaign or empty content fails the job instead of sending default copy (REV-61)
      const campaign = await EmailCampaign.findOne({
        $or: [{ _id: campaignId }, { leadId: lead._id }],
      }).exec();

      if (!campaign) {
        throw new UnrecoverableError(`No approved EmailCampaign for lead ${leadId}; nothing was sent`);
      }
      if (!campaign.subject?.trim() || !campaign.bodyHtml?.trim()) {
        throw new UnrecoverableError(
          `EmailCampaign ${campaign._id.toString()} has no approved subject or body; nothing was sent`,
        );
      }

      // A retry after the provider accepted the email must not send it again (REV-61)
      if (campaign.status === 'DELIVERED') {
        return markLeadSent(lead._id, campaign, 'The email was already sent; finishing the lead update only.');
      }

      const recipientEmail = campaign.recipientEmail || lead.contactEmail;
      if (!recipientEmail) {
        throw new Error(`No recipient email address available for lead ${leadId}`);
      }

      // 4. Pre-flight DNS MX-Record Validation
      console.log(`[EmailWorker] Running pre-flight MX validation for recipient: ${recipientEmail}...`);
      const mxResult = await mxValidator.validateRecipientDomain(recipientEmail);

      if (!mxResult.valid) {
        const bounceReason = mxResult.reason || `No routable MX records found for domain ${mxResult.domain}`;
        console.warn(`[EmailWorker] Pre-flight MX check failed for ${recipientEmail}: ${bounceReason}`);

        await EmailCampaign.findByIdAndUpdate(campaign._id, {
          status: 'BOUNCED',
          bouncedAt: new Date(),
          bounceReason,
        }).exec();

        // Update Lead status to REJECTED and tag with bounce metadata
        await Lead.findByIdAndUpdate(lead._id, {
          status: 'REJECTED',
          $addToSet: { tags: 'mx_bounced' },
        }).exec();

        return {
          success: false,
          bounced: true,
          leadId,
          campaignId: campaign._id.toString(),
          reason: bounceReason,
        };
      }

      console.log(`[EmailWorker] Recipient domain verified via MX: ${mxResult.mxRecords?.join(', ')}`);

      // 5. Claim the campaign atomically, so the email goes out at most once per approval (REV-61)
      const claimed = await EmailCampaign.findOneAndUpdate(
        { _id: campaign._id, status: { $in: SENDABLE_CAMPAIGN_STATUSES } },
        { $set: { status: 'SENDING' } },
        { new: true },
      ).exec();

      if (!claimed) {
        const current = await EmailCampaign.findById(campaign._id).exec();
        if (current?.status === 'DELIVERED') {
          return markLeadSent(lead._id, current, 'The email was already sent; finishing the lead update only.');
        }
        // SENDING: an earlier attempt claimed it and may have handed it to the provider already
        const reason = `EmailCampaign ${campaign._id.toString()} is ${current?.status ?? 'gone'}, not ${SENDABLE_CAMPAIGN_STATUSES.join('/')}. Not sending it again.`;
        console.warn(`[EmailWorker] ${reason}`);
        return { success: false, aborted: true, leadId, campaignId: campaign._id.toString(), reason };
      }

      // 6. Dispatch Email via Provider with Compliance Headers
      console.log(`[EmailWorker] Dispatching email to ${recipientEmail} via ${emailService.getProvider()?.name ?? 'no configured provider'}...`);
      let sendResult: Awaited<ReturnType<typeof emailService.sendEmail>>;
      try {
        sendResult = await emailService.sendEmail({
          to: recipientEmail,
          subject: claimed.subject,
          html: claimed.bodyHtml,
          text: claimed.bodyPlainText,
          trackingToken: claimed.trackingToken,
        });
      } catch (error) {
        // The provider did not take the email, so release the claim and let the retry send it
        await EmailCampaign.findOneAndUpdate(
          { _id: campaign._id, status: 'SENDING' },
          { $set: { status: 'SCHEDULED' } },
        ).exec();
        throw error;
      }

      console.log(
        `[EmailWorker] Email successfully dispatched. Message ID: ${sendResult.messageId}, Provider: ${sendResult.provider}`,
      );

      // 7. Record the send first: if this or anything later throws, the campaign stays SENDING and
      // a retry skips it instead of sending twice
      const now = new Date();
      await EmailCampaign.findByIdAndUpdate(campaign._id, {
        status: 'DELIVERED',
        sentAt: now,
      }).exec();

      // 8. Update Lead status to SENT
      await Lead.findByIdAndUpdate(lead._id, {
        status: 'SENT',
        updatedAt: now,
      }).exec();

      console.log(`[EmailWorker] Lead ${leadId} status updated to 'SENT'. Dispatch complete.`);

      return {
        success: true,
        campaignId: campaign._id.toString(),
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
