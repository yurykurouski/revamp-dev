import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { TriggerAuditSchema, canTransition, leadStatusesInto } from '@revamp/validation';
import { validateBody } from '../middlewares/validate.js';
import { Audit } from '../models/Audit.model.js';
import { Lead } from '../models/Lead.model.js';
import { addAuditJob } from '../queues/audit.queue.js';
import { AppError } from '../middlewares/errorHandler.js';

const router = Router();

// POST /audits/trigger - Trigger or re-trigger audit for lead
router.post(
  '/trigger',
  validateBody(TriggerAuditSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { leadId } = req.body;
      const lead = await Lead.findById(leadId).exec();
      if (!lead) {
        throw new AppError('Lead not found', 404);
      }

      // Only a queued lead or a failed audit can be (re)run; an audit never moves a lead that is
      // further along back to AUDITING (REV-62)
      if (lead.status !== 'QUEUED' && !canTransition(lead.status, 'QUEUED')) {
        throw new AppError(`An audit cannot be started while the lead is ${lead.status}`, 409, {
          code: 'LEAD_NOT_AUDITABLE',
          status: lead.status,
        });
      }

      // REV-44: retrying a failed audit clears the error and puts the lead back in the queue
      if (lead.status !== 'QUEUED' || lead.auditError) {
        const requeued = await Lead.findOneAndUpdate(
          { _id: lead._id, status: { $in: leadStatusesInto('QUEUED', { includeSelf: true }) } },
          { $set: { status: 'QUEUED' }, $unset: { auditError: '' } },
        ).exec();
        if (!requeued) {
          throw new AppError('The lead changed while the audit was being queued; try again', 409, {
            code: 'LEAD_NOT_AUDITABLE',
          });
        }
      }

      const audit = await Audit.create({
        leadId: lead._id,
        status: 'QUEUED',
      });

      const job = await addAuditJob({
        leadId: lead._id.toString(),
        url: lead.originalUrl,
        niche: lead.niche,
      });

      res.status(202).json({
        success: true,
        message: 'Audit job queued',
        data: {
          leadId: lead._id.toString(),
          auditId: audit._id.toString(),
          jobId: job.id,
          status: 'QUEUED',
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// GET /audits/:id - Get audit results
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id'];
    let audit = null;

    if (id && mongoose.Types.ObjectId.isValid(id)) {
      audit = await Audit.findById(id).exec();
      if (!audit) {
        audit = await Audit.findOne({ leadId: id }).sort({ createdAt: -1 }).exec();
      }
    }

    if (!audit) {
      throw new AppError('Audit not found', 404);
    }

    res.status(200).json({
      success: true,
      data: audit,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
