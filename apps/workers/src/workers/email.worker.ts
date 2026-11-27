import { Worker, Job, UnrecoverableError } from 'bullmq';
import type { Types } from 'mongoose';
import { IEmailDispatchJobData } from '@revamp/shared-types';
import { LeadOutreachErrorSchema, canTransition, leadStatusesInto, requiresContactRight } from '@revamp/validation';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';
import { Lead } from '../models/Lead.model.js';
import { EmailCampaign, revertOutreachApproval } from '../models/EmailCampaign.model.js';
import { findActiveContactRight } from '../models/ContactRight.model.js';
import { mxValidator } from '../services/mx.validator.js';
import { loadStudioSender, simulateDelivery } from '../services/email.service.js';
import { assertJobTenant, withTenant } from '../tenant.js';

export interface IEmailWorkerResult {
  success: boolean;
  campaignId?: string;
  leadId?: string;
  /** Always SIMULATED: nothing is delivered outside the platform (REV-221) */
  deliveryMode?: 'SIMULATED';
  sentAt?: Date;
  bounced?: boolean;
  aborted?: boolean;
  alreadySent?: boolean;
  reason?: string;
}

/** Campaign statuses an approved email is sent from; the worker claims it by moving it to SENDING (REV-61) */
const SENDABLE_CAMPAIGN_STATUSES = ['SCHEDULED', 'APPROVED'];

/** Finishes the lead update for a campaign that was already recorded as delivered, without recording it again */
const markLeadSent = async (
  tenant: Types.ObjectId,
  leadId: Types.ObjectId | string,
  campaign: { _id: Types.ObjectId | string; sentAt?: Date },
  reason: string,
): Promise<IEmailWorkerResult> => {
  console.warn(`[EmailWorker] ${reason}`);
  await Lead.findOneAndUpdate(withTenant(tenant, { _id: leadId, status: { $in: leadStatusesInto('SENT') } }), { status: 'SENT' }).exec();
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
      // The job's studio must be the lead's, before anything is written (REV-210)
      const tenant = assertJobTenant(job.data.tenantId, lead);

      // 2. Strict Human-In-The-Loop (HITL) Gate Enforcement
      // Only a lead the operator approved (SCHEDULED, the one status that can move to SENT) is emailed
      if (!canTransition(lead.status, 'SENT')) {
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
      const campaign = await EmailCampaign.findOne(withTenant(tenant, {
        $or: [{ _id: campaignId }, { leadId: lead._id }],
      })).exec();

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
        return markLeadSent(tenant, lead._id, campaign, 'The email was already sent; finishing the lead update only.');
      }

      // The studio sends under its own sender, read now, so a change after approval applies (REV-221). A studio that
      // has none (a job queued before this shipped) goes back to review instead of sending under another address
      const sender = await loadStudioSender(tenant);
      if (!sender) {
        const reason = 'Studio has no sender; lead returned to review';
        console.warn(`[EmailWorker] ${reason} (lead ${leadId})`);
        await revertOutreachApproval(lead._id.toString());
        return { success: false, aborted: true, leadId, campaignId: campaign._id.toString(), reason };
      }

      // The studio's right to contact the business must still be active now: it may have expired or been ended (an
      // opt-out) since the approval, and the job can wait behind the limiter. Checked after the DELIVERED short-circuit
      // (that email was recorded while the right was active). The lead goes back to review with the reason; nothing is
      // claimed, recorded or sent (REV-226)
      if (requiresContactRight('SENT')) {
        const right = lead.businessId ? await findActiveContactRight({ tenantId: tenant, businessId: lead.businessId }, new Date()) : null;
        if (!right) {
          const reason = 'The right to contact this business ended before the email was sent. Nothing was sent.';
          console.warn(`[EmailWorker] ${reason} (lead ${leadId}); lead returned to review`);
          const outreachError = LeadOutreachErrorSchema.parse({ code: 'CONTACT_RIGHT_EXPIRED', message: reason, at: new Date() });
          await revertOutreachApproval(lead._id.toString(), { outreachError });
          return { success: false, aborted: true, leadId, campaignId: campaign._id.toString(), reason };
        }
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

        // Update Lead status to REJECTED and tag with bounce metadata, unless it opted out meanwhile
        await Lead.findOneAndUpdate(
          withTenant(tenant, { _id: lead._id, status: { $in: leadStatusesInto('REJECTED') } }),
          { status: 'REJECTED', $addToSet: { tags: 'mx_bounced' } },
        ).exec();

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
          return markLeadSent(tenant, lead._id, current, 'The email was already sent; finishing the lead update only.');
        }
        // SENDING: an earlier attempt claimed it and may have handed it to the provider already
        const reason = `EmailCampaign ${campaign._id.toString()} is ${current?.status ?? 'gone'}, not ${SENDABLE_CAMPAIGN_STATUSES.join('/')}. Not sending it again.`;
        console.warn(`[EmailWorker] ${reason}`);
        return { success: false, aborted: true, leadId, campaignId: campaign._id.toString(), reason };
      }

      // 6. Render the message exactly as it would be sent. Nothing is delivered (REV-221): it is recorded in the outbox
      console.log(`[EmailWorker] Simulating delivery to ${recipientEmail} from ${sender.address}...`);
      const message = simulateDelivery({
        sender,
        to: recipientEmail,
        subject: claimed.subject,
        html: claimed.bodyHtml,
        text: claimed.bodyPlainText,
        trackingToken: claimed.trackingToken,
      });

      // 7. Record the message first: if this or anything later throws, the campaign stays SENDING and a retry skips
      // it instead of recording it twice. senderEmail records the sender as of now
      const now = new Date();
      await EmailCampaign.findByIdAndUpdate(campaign._id, {
        status: 'DELIVERED',
        sentAt: now,
        senderEmail: sender.address,
        senderName: sender.name,
        deliveryMode: 'SIMULATED',
        outbox: message,
      }).exec();

      // 8. Update Lead status to SENT, unless it opted out while the email was being sent
      await Lead.findOneAndUpdate(
        withTenant(tenant, { _id: lead._id, status: { $in: leadStatusesInto('SENT') } }),
        { status: 'SENT', updatedAt: now },
      ).exec();

      console.log(`[EmailWorker] Simulated delivery recorded (not sent) for lead ${leadId}; status updated to 'SENT'.`);

      return {
        success: true,
        campaignId: campaign._id.toString(),
        leadId: lead._id.toString(),
        deliveryMode: 'SIMULATED',
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
