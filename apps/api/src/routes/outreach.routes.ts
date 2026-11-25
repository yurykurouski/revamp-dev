import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import {
  ApproveOutreachSchema,
  OUTREACH_APPROVABLE_STATUSES,
  OUTREACH_REJECTABLE_STATUSES,
  RejectOutreachSchema,
  TestEmailOutreachSchema,
  canApproveOutreach,
} from '@revamp/validation';
import type { IOutboxView } from '@revamp/shared-types';
import { LeadStatus, draftToHtml } from '@revamp/shared-types';
import { validateBody } from '../middlewares/validate.js';
import { AppError } from '../middlewares/errorHandler.js';
import { approveOutreachWithCampaign } from '../models/EmailCampaign.model.js';
import { calculateDispatchDelay } from '../queues/email.queue.js';
import { enqueueEmailOrRevert } from '../services/email-enqueue.js';
import { sendTestEmailJob } from '../queues/email-test.queue.js';
import { readSender, requireSender } from '../services/sender.service.js';
import { tenantIdOf } from '../data/tenant-scope.js';

const router = Router();

const notAwaitingApproval = (status?: LeadStatus): AppError =>
  new AppError(
    409,
    'LEAD_NOT_AWAITING_APPROVAL',
    `Only a lead awaiting approval can be approved; this lead is ${status ?? 'no longer awaiting approval'}.`,
  );

const notRejectable = (status?: LeadStatus): AppError =>
  new AppError(
    409,
    'LEAD_NOT_REJECTABLE',
    `A lead can only be rejected before its outreach is approved; this lead is ${status ?? 'no longer rejectable'}.`,
  );

const leadNotFound = (id: string): AppError => new AppError(404, 'LEAD_NOT_FOUND', `Lead ${id} not found`);

const invalidId = (): AppError =>
  new AppError(400, 'INVALID_ID', 'A valid 24-character hexadecimal ObjectId is required');

// A worker's failure reason that names the missing sender (REV-221); the API checks first, the sender may be gone by the time the job runs
const SENDER_NOT_CONFIGURED_REASON = 'SENDER_NOT_CONFIGURED';

// GET /outreach/sender - The caller's studio sender, for every role (REV-221). Reads the caller's own organization only
router.get('/sender', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ success: true, data: await readSender(req.auth!.organizationId) });
  } catch (error) {
    next(error);
  }
});

// GET /outreach/:id/outbox - The simulated email recorded for the lead (REV-221). Writes nothing: viewing it is not an
// open or a click, and nothing in it is loaded from the network by the dashboard
router.get('/:id/outbox', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id'] || '';
    if (!mongoose.Types.ObjectId.isValid(id)) throw invalidId();

    const lead = await req.tenant!.leads.findById(id).exec();
    if (!lead) throw leadNotFound(id);

    const campaign = await req.tenant!.campaigns.findOne({ leadId: lead._id }).lean().exec();
    const outbox = campaign?.outbox;
    if (!campaign || !outbox) {
      throw new AppError(404, 'OUTBOX_NOT_FOUND', 'No email has been recorded in the outbox for this lead.');
    }

    const rawHeaders = outbox.headers as unknown;
    const headers = rawHeaders instanceof Map ? Object.fromEntries(rawHeaders) : { ...(rawHeaders as Record<string, string> | undefined) };
    const data: IOutboxView = {
      from: outbox.from,
      to: outbox.to,
      subject: outbox.subject,
      headers,
      html: outbox.html,
      text: outbox.text,
      deliveryMode: campaign.deliveryMode ?? 'SIMULATED',
      sentAt: new Date(campaign.sentAt ?? campaign.updatedAt).toISOString(),
    };
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /outreach/pending - Pending approval drafts
router.get('/pending', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pendingLeads = await req.tenant!.leads.find({
      status: { $in: OUTREACH_APPROVABLE_STATUSES },
    })
      .sort({ updatedAt: -1 })
      .limit(50)
      .exec();

    res.status(200).json({
      success: true,
      data: pendingLeads,
      total: pendingLeads.length,
    });
  } catch (error) {
    next(error);
  }
});

// POST /outreach/:id/approve - HITL Manual Approval Gate
router.post(
  '/:id/approve',
  validateBody(ApproveOutreachSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'] || '';
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw invalidId();
      }

      const existing = await req.tenant!.leads.findById(id).exec();
      if (!existing) throw leadNotFound(id);

      // Outreach is approved only from the review state (REV-59)
      if (!canApproveOutreach(existing.status)) throw notAwaitingApproval(existing.status);

      // Outreach needs a real recipient; none is invented (REV-45)
      if (!existing.contactEmail) {
        throw new AppError(409, 'NO_CONTACT_EMAIL', 'This lead has no contact email. Add one before approving outreach.');
      }

      // The studio sends under its own sender (REV-221); without one nothing is written and nothing is queued
      const sender = await requireSender(req.auth!.organizationId);

      // 1. Store the draft exactly as the operator approved it; there is no default copy (REV-61). It is sent as
      // escaped HTML with its line breaks, plus the same text as the plain-text part, exactly like the test send (REV-72)
      const trackingToken = crypto.randomUUID().replace(/-/g, '');
      const { subject, preheader, body } = req.body as { subject: string; preheader?: string; body: string };

      // 2. The lead moves to SCHEDULED and its campaign is written in one transaction, only if the lead is still
      // awaiting approval, so two approvals at once can't both queue an email (REV-59, REV-203)
      const written = await approveOutreachWithCampaign(id, {
        status: 'SCHEDULED',
        senderEmail: sender.address,
        senderName: sender.name,
        recipientEmail: existing.contactEmail,
        subject,
        ...(preheader ? { previewText: preheader } : {}),
        bodyHtml: draftToHtml(body, preheader),
        bodyPlainText: body,
        trackingToken,
        requiresManualReview: false,
        approvedBy: req.body.approvedBy || 'operator',
        approvedAt: new Date(),
        scheduledAt: req.body.scheduleTime ? new Date(req.body.scheduleTime) : new Date(),
      });
      if (!written) throw notAwaitingApproval();
      const { lead, campaign } = written;

      // 3. Throttled dispatch delay with randomized jitter (15–45s)
      const delayMs = calculateDispatchDelay(0);

      // 4. Queue the send; a queue that fails or does not answer returns the lead to review with 503 (REV-203)
      const campaignIdStr = campaign._id.toString();
      const { jobId } = await enqueueEmailOrRevert({ campaignId: campaignIdStr, leadId: lead._id.toString(), tenantId: tenantIdOf(req.tenant!) }, delayMs);

      res.status(200).json({
        success: true,
        message: 'Email approved by operator and queued for sending',
        data: {
          campaignId: campaignIdStr,
          leadId: lead._id.toString(),
          jobId,
          status: 'SCHEDULED',
          delayMs,
          approvedBy: req.body.approvedBy,
          approvedAt: campaign?.approvedAt || new Date().toISOString(),
          subject: campaign?.subject || subject,
          preheader: campaign?.previewText || preheader,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// POST /outreach/:id/reject - Reject draft
router.post(
  '/:id/reject',
  validateBody(RejectOutreachSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'] || '';
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw invalidId();
      }

      // Reject only before outreach is approved; the status filter makes check and update atomic (REV-59)
      const lead = await req.tenant!.leads.findOneAndUpdate(
        { _id: id, status: { $in: OUTREACH_REJECTABLE_STATUSES } },
        { $set: { status: 'REJECTED' } },
        { new: true },
      ).exec();

      if (!lead) {
        const existing = await req.tenant!.leads.findById(id).exec();
        throw existing ? notRejectable(existing.status) : leadNotFound(id);
      }

      await req.tenant!.campaigns.findOneAndUpdate(
        { leadId: lead._id },
        {
          status: 'REJECTED',
          bounceReason: req.body.reason,
        },
      ).exec();

      res.status(200).json({
        success: true,
        message: 'Campaign draft rejected',
        data: {
          campaignId: id,
          leadId: id,
          status: 'REJECTED',
          reason: req.body.reason,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// POST /outreach/:id/test - Simulate sending the current draft to the operator (REV-60, REV-221). It goes to the operator,
// not the lead, so it is not HITL-gated, it never changes the lead or its campaign, and nothing is delivered.
router.post(
  '/:id/test',
  validateBody(TestEmailOutreachSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'] || '';
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw invalidId();
      }

      const lead = await req.tenant!.leads.findById(id).exec();
      if (!lead) throw leadNotFound(id);

      // Say so up front instead of queuing a test that cannot be rendered (REV-221)
      await requireSender(req.auth!.organizationId);

      const { testEmail, subject, preheader, body } = req.body;
      const outcome = await sendTestEmailJob({ leadId: id, tenantId: tenantIdOf(req.tenant!), to: testEmail, subject, preheader, body });

      if (outcome.status === 'timeout') {
        throw new AppError(
          504,
          'EMAIL_TEST_TIMEOUT',
          'The workers did not send the test email in time. Check that the workers are running.',
        );
      }

      if (outcome.status === 'failed') {
        // The sender may have gone between the check above and the job
        if (outcome.reason.startsWith(SENDER_NOT_CONFIGURED_REASON)) {
          throw new AppError(409, 'SENDER_NOT_CONFIGURED', 'This studio has no sender yet. The studio owner sets it in Settings.');
        }
        throw new AppError(502, 'EMAIL_SEND_FAILED', `The test email was not simulated: ${outcome.reason}`);
      }

      res.status(200).json({
        success: true,
        message: `Test email simulated for ${testEmail}`,
        data: outcome.result,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
