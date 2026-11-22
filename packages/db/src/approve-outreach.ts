import mongoose from 'mongoose';
import { EmailCampaign, type IEmailCampaignDocument } from './models/EmailCampaign.model.js';
import { Lead, type ILeadDocument } from './models/Lead.model.js';

/**
 * The operator's approval (REV-203): the lead moves NEEDS_APPROVAL → SCHEDULED and its approved campaign is upserted
 * in one transaction, so a failed campaign write never leaves a lead SCHEDULED with nothing to send. Returns null, with
 * nothing written, when the lead is no longer awaiting approval (a second approval at the same time). The campaign is
 * upserted on `{ leadId }` with `leadId` kept out of the update (REV-201). The caller queues the send after the commit.
 */
export async function approveOutreachWithCampaign(
  leadId: string,
  campaign: Record<string, unknown>,
): Promise<{ lead: ILeadDocument; campaign: IEmailCampaignDocument } | null> {
  let result: { lead: ILeadDocument; campaign: IEmailCampaignDocument } | null = null;
  await mongoose.connection.transaction(async (session) => {
    result = null;
    const lead = await Lead.findOneAndUpdate(
      { _id: leadId, status: 'NEEDS_APPROVAL' },
      { $set: { status: 'SCHEDULED' } },
      { new: true, session },
    ).exec();
    if (!lead) return;
    const written = await EmailCampaign.findOneAndUpdate({ leadId: lead._id }, { $set: { ...campaign, ...(lead.tenantId ? { tenantId: lead.tenantId } : {}) } }, { upsert: true, new: true, session }).exec();
    result = { lead, campaign: written! };
  });
  return result;
}

/** Campaign statuses an approval revert may undo: approved, not yet claimed by the email worker */
const REVERTIBLE_CAMPAIGN_STATUSES: readonly string[] = ['SCHEDULED', 'APPROVED'];

/**
 * Undoes an approval whose send could not be queued (REV-203): the lead SCHEDULED → NEEDS_APPROVAL and its campaign
 * back to NEEDS_APPROVAL without the approval stamps, in one transaction, so the operator can approve again. Only a
 * lead still SCHEDULED changes, and nothing changes when its campaign is already claimed or finished by the email
 * worker (SENDING, DELIVERED, …) or the lead is already SENT. Returns whether the lead was moved.
 */
export async function revertOutreachApproval(leadId: string): Promise<boolean> {
  let moved = false;
  await mongoose.connection.transaction(async (session) => {
    moved = false;
    // A campaign the email worker already claimed (SENDING) or finished is not an approval to undo: reverting its lead
    // would let a second approval send the email again
    const campaign = await EmailCampaign.findOne({ leadId }, { status: 1 }, { session }).lean().exec();
    if (campaign && !REVERTIBLE_CAMPAIGN_STATUSES.includes(campaign.status)) return;
    const lead = await Lead.findOneAndUpdate({ _id: leadId, status: 'SCHEDULED' }, { $set: { status: 'NEEDS_APPROVAL' } }, { session }).exec();
    moved = Boolean(lead);
    if (!lead) return;
    await EmailCampaign.updateOne(
      { leadId: lead._id, status: 'SCHEDULED' },
      { $set: { status: 'NEEDS_APPROVAL' }, $unset: { approvedAt: '', approvedBy: '', scheduledAt: '' } },
      { session },
    ).exec();
  });
  return moved;
}
