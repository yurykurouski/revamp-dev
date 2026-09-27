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
import { EMAIL_PROVIDER_NOT_CONFIGURED, LeadStatus, draftToHtml } from '@revamp/shared-types';
import { validateBody } from '../middlewares/validate.js';
import { AppError } from '../middlewares/errorHandler.js';
import { Lead } from '../models/Lead.model.js';
import { EmailCampaign } from '../models/EmailCampaign.model.js';
import { addEmailDispatchJob, calculateDispatchDelay } from '../queues/email.queue.js';
import { sendTestEmailJob } from '../queues/email-test.queue.js';
import { env } from '../config/env.js';

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

const providerMissing = (): AppError => new AppError(503, 'EMAIL_PROVIDER_NOT_CONFIGURED', EMAIL_PROVIDER_NOT_CONFIGURED);

// GET /outreach/pending - Pending approval drafts
router.get('/pending', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const pendingLeads = await Lead.find({
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

      const existing = await Lead.findById(id).exec();
      if (!existing) throw leadNotFound(id);

      // Outreach is approved only from the review state (REV-59)
      if (!canApproveOutreach(existing.status)) throw notAwaitingApproval(existing.status);

      // Outreach needs a real recipient; none is invented (REV-45)
      if (!existing.contactEmail) {
        throw new AppError(409, 'NO_CONTACT_EMAIL', 'This lead has no contact email. Add one before approving outreach.');
      }

      // 1. Move the lead to SCHEDULED only if it is still awaiting approval, so two approvals at
      // once can't both queue an email (REV-59)
      const lead = await Lead.findOneAndUpdate(
        { _id: id, status: { $in: OUTREACH_APPROVABLE_STATUSES } },
        { $set: { status: 'SCHEDULED' } },
        { new: true },
      ).exec();

      if (!lead) throw notAwaitingApproval();

      // 2. Store the draft exactly as the operator approved it; there is no default copy (REV-61).
      // It is sent as escaped HTML with its line breaks, plus the same text as the plain-text part,
      // exactly like the test send (REV-72)
      const trackingToken = crypto.randomUUID().replace(/-/g, '');
      const { subject, preheader, body } = req.body as { subject: string; preheader?: string; body: string };

      const campaign = await EmailCampaign.findOneAndUpdate(
        { leadId: lead._id },
        {
          leadId: lead._id,
          status: 'SCHEDULED',
          senderEmail: env.EMAIL_FROM,
          recipientEmail: lead.contactEmail,
          subject,
          ...(preheader ? { previewText: preheader } : {}),
          bodyHtml: draftToHtml(body, preheader),
          bodyPlainText: body,
          trackingToken,
          requiresManualReview: false,
          approvedBy: req.body.approvedBy || 'operator',
          approvedAt: new Date(),
          scheduledAt: req.body.scheduleTime ? new Date(req.body.scheduleTime) : new Date(),
        },
        { upsert: true, new: true },
      ).exec();

      // 3. Calculate throttled dispatch delay with randomized jitter (15–45s)
      const delayMs = calculateDispatchDelay(0);

      // 4. Enqueue BullMQ dispatch job
      const campaignIdStr = campaign?._id ? campaign._id.toString() : id;
      const job = await addEmailDispatchJob(
        {
          campaignId: campaignIdStr,
          leadId: lead._id.toString(),
        },
        { delay: delayMs },
      );

      res.status(200).json({
        success: true,
        message: 'Email approved by operator and queued for sending',
        data: {
          campaignId: campaignIdStr,
          leadId: lead._id.toString(),
          jobId: job?.id,
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
      const lead = await Lead.findOneAndUpdate(
        { _id: id, status: { $in: OUTREACH_REJECTABLE_STATUSES } },
        { $set: { status: 'REJECTED' } },
        { new: true },
      ).exec();

      if (!lead) {
        const existing = await Lead.findById(id).exec();
        throw existing ? notRejectable(existing.status) : leadNotFound(id);
      }

      await EmailCampaign.findOneAndUpdate(
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

// POST /outreach/:id/test - Send the current draft to the operator (REV-60). It goes to the operator,
// not the lead, so it is not HITL-gated, and it never changes the lead or its campaign.
router.post(
  '/:id/test',
  validateBody(TestEmailOutreachSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'] || '';
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw invalidId();
      }

      const lead = await Lead.findById(id).exec();
      if (!lead) throw leadNotFound(id);

      // Say so up front instead of reporting a send that cannot happen (REV-45)
      if (!env.EMAIL_PROVIDER) throw providerMissing();

      const { testEmail, subject, preheader, body } = req.body;
      const outcome = await sendTestEmailJob({ leadId: id, to: testEmail, subject, preheader, body });

      if (outcome.status === 'timeout') {
        throw new AppError(
          504,
          'EMAIL_TEST_TIMEOUT',
          'The workers did not send the test email in time. Check that the workers are running.',
        );
      }

      if (outcome.status === 'failed') {
        // The workers may be configured differently from the API
        if (outcome.reason === EMAIL_PROVIDER_NOT_CONFIGURED) throw providerMissing();
        throw new AppError(502, 'EMAIL_SEND_FAILED', `The test email was not sent: ${outcome.reason}`);
      }

      res.status(200).json({
        success: true,
        message: `Test email sent to ${testEmail}`,
        data: { to: testEmail, ...outcome.result },
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
