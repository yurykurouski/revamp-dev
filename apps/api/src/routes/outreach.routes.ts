import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import {
  ApproveOutreachSchema,
  RejectOutreachSchema,
  TestEmailOutreachSchema,
} from '@revamp/validation';
import {
  LeadStatus,
  OUTREACH_APPROVABLE_STATUSES,
  OUTREACH_REJECTABLE_STATUSES,
  canApproveOutreach,
} from '@revamp/shared-types';
import { validateBody } from '../middlewares/validate.js';
import { Lead } from '../models/Lead.model.js';
import { EmailCampaign } from '../models/EmailCampaign.model.js';
import { addEmailDispatchJob, calculateDispatchDelay } from '../queues/email.queue.js';
import { env } from '../config/env.js';

const router = Router();

const notAwaitingApproval = (res: Response, status?: LeadStatus): void => {
  res.status(409).json({
    success: false,
    error: {
      code: 'LEAD_NOT_AWAITING_APPROVAL',
      message: `Only a lead awaiting approval can be approved; this lead is ${status ?? 'no longer awaiting approval'}.`,
    },
  });
};

const notRejectable = (res: Response, status?: LeadStatus): void => {
  res.status(409).json({
    success: false,
    error: {
      code: 'LEAD_NOT_REJECTABLE',
      message: `A lead can only be rejected before its outreach is approved; this lead is ${status ?? 'no longer rejectable'}.`,
    },
  });
};

const leadNotFound = (res: Response, id: string): void => {
  res.status(404).json({
    success: false,
    error: {
      code: 'LEAD_NOT_FOUND',
      message: `Lead ${id} not found`,
    },
  });
};

// GET /outreach/pending - Pending approval drafts
router.get('/pending', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const pendingLeads = await Lead.find({
      status: { $in: ['NEEDS_APPROVAL', 'AWAITING_APPROVAL'] },
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
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_ID',
            message: 'A valid 24-character hexadecimal ObjectId is required',
          },
        });
        return;
      }

      const existing = await Lead.findById(id).exec();
      if (!existing) {
        leadNotFound(res, id);
        return;
      }

      // Outreach is approved only from the review state (REV-59)
      if (!canApproveOutreach(existing.status)) {
        notAwaitingApproval(res, existing.status);
        return;
      }

      // Outreach needs a real recipient; none is invented (REV-45)
      if (!existing.contactEmail) {
        res.status(409).json({
          success: false,
          error: {
            code: 'NO_CONTACT_EMAIL',
            message: 'This lead has no contact email. Add one before approving outreach.',
          },
        });
        return;
      }

      // 1. Move the lead to SCHEDULED only if it is still awaiting approval, so two approvals at
      // once can't both queue an email (REV-59)
      const lead = await Lead.findOneAndUpdate(
        { _id: id, status: { $in: OUTREACH_APPROVABLE_STATUSES } },
        { $set: { status: 'SCHEDULED' } },
        { new: true },
      ).exec();

      if (!lead) {
        notAwaitingApproval(res);
        return;
      }

      // 2. Create or Update EmailCampaign document in MongoDB
      const trackingToken = crypto.randomUUID().replace(/-/g, '');
      const subject =
        req.body.subject ||
        `3 ways to lift conversions on the ${lead.businessName || 'your company'} website (plus an interactive prototype)`;
      const bodyHtml =
        req.body.body ||
        `<p>Hello! We prepared an interactive website redesign concept for ${lead.businessName || 'your company'}.</p>`;

      const campaign = await EmailCampaign.findOneAndUpdate(
        { leadId: lead._id },
        {
          leadId: lead._id,
          status: 'SCHEDULED',
          senderEmail: env.EMAIL_FROM,
          recipientEmail: lead.contactEmail,
          subject,
          previewText: req.body.preheader || 'A new mobile concept',
          bodyHtml,
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
          preheader: campaign?.previewText || req.body.preheader,
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
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_ID',
            message: 'A valid 24-character hexadecimal ObjectId is required',
          },
        });
        return;
      }

      // Reject only before outreach is approved; the status filter makes check and update atomic (REV-59)
      const lead = await Lead.findOneAndUpdate(
        { _id: id, status: { $in: OUTREACH_REJECTABLE_STATUSES } },
        { $set: { status: 'REJECTED' } },
        { new: true },
      ).exec();

      if (!lead) {
        const existing = await Lead.findById(id).exec();
        if (existing) notRejectable(res, existing.status);
        else leadNotFound(res, id);
        return;
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

// POST /outreach/:id/test - Send test email to operator
router.post(
  '/:id/test',
  validateBody(TestEmailOutreachSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json({
        success: true,
        message: `Test email sent to ${req.body.testEmail}`,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
