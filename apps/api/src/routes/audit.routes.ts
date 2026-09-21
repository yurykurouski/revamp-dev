import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { TriggerAuditSchema } from '@revamp/validation';
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
