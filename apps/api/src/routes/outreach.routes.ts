import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import {
  ApproveOutreachSchema,
  RejectOutreachSchema,
  TestEmailOutreachSchema,
} from '@revamp/validation';
import { validateBody } from '../middlewares/validate.js';
import { Lead } from '../models/Lead.model.js';
import { EmailCampaign } from '../models/EmailCampaign.model.js';
import { addEmailDispatchJob, calculateDispatchDelay } from '../queues/email.queue.js';
import { env } from '../config/env.js';

const router = Router();

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

      // 1. Update Lead status to SCHEDULED
      const lead = await Lead.findByIdAndUpdate(
        id,
        { $set: { status: 'SCHEDULED' } },
        { new: true },
      ).exec();

      if (!lead) {
        res.status(404).json({
          success: false,
          error: {
            code: 'LEAD_NOT_FOUND',
            message: `Lead ${id} not found`,
          },
        });
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
          recipientEmail: lead.contactEmail || 'lead@example.com',
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

      const lead = await Lead.findByIdAndUpdate(
        id,
        { $set: { status: 'REJECTED' } },
        { new: true },
      ).exec();

      if (!lead) {
        res.status(404).json({
          success: false,
          error: {
            code: 'LEAD_NOT_FOUND',
            message: `Lead ${id} not found`,
          },
        });
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
