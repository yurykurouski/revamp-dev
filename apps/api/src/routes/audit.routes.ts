import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { TriggerAuditSchema, canTransition, leadStatusesInto } from '@revamp/validation';
import { validateBody } from '../middlewares/validate.js';
import { Audit, findAuditForLead } from '../models/Audit.model.js';
import { enqueueAuditOrFail } from '../services/audit-enqueue.js';
import { AppError } from '../middlewares/errorHandler.js';

const router = Router();

// POST /audits/trigger - Trigger or re-trigger audit for lead
router.post(
  '/trigger',
  validateBody(TriggerAuditSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { leadId } = req.body;
      const lead = await req.tenant!.leads.findById(leadId).exec();
      if (!lead) {
        throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found');
      }

      // Only a queued lead or a failed audit can be (re)run; an audit never moves a lead that is
      // further along back to AUDITING (REV-62)
      if (lead.status !== 'QUEUED' && !canTransition(lead.status, 'QUEUED')) {
        throw new AppError(409, 'LEAD_NOT_AUDITABLE', `An audit cannot be started while the lead is ${lead.status}`, {
          status: lead.status,
        });
      }

      // REV-44: retrying a failed audit clears the error and puts the lead back in the queue
      if (lead.status !== 'QUEUED' || lead.auditError) {
        const requeued = await req.tenant!.leads.findOneAndUpdate(
          { _id: lead._id, status: { $in: leadStatusesInto('QUEUED', { includeSelf: true }) } },
          { $set: { status: 'QUEUED' }, $unset: { auditError: '' } },
        ).exec();
        if (!requeued) {
          throw new AppError(409, 'LEAD_NOT_AUDITABLE', 'The lead changed while the audit was being queued; try again');
        }
      }

      const audit = await Audit.create({
        leadId: lead._id,
        ...(lead.businessId ? { businessId: lead.businessId } : {}),
        status: 'QUEUED',
      });

      // REV-202: a queue that fails or does not answer puts the lead back in AUDIT_FAILED with a 503
      const { jobId } = await enqueueAuditOrFail(req.tenant!, {
        leadId: lead._id.toString(),
        auditId: audit._id.toString(),
        url: lead.originalUrl,
        niche: lead.niche,
      });

      res.status(202).json({
        success: true,
        message: 'Audit job queued',
        data: {
          leadId: lead._id.toString(),
          auditId: audit._id.toString(),
          jobId,
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
      // Audits are shared between studios, so one is reached only through a lead of the caller's studio (REV-209):
      // the id is a lead's, or an audit that a lead of the studio reads (its own, or one of its business)
      const lead = await req.tenant!.leads.findById(id).exec();
      if (lead) {
        audit = await findAuditForLead(lead);
      } else {
        const found = await Audit.findById(id).exec();
        if (found) {
          // A platform audit has no leadId (REV-232): never put `{ _id: undefined }` in the $or, it matches every lead.
          // With neither a lead nor a business there is no reader: answer as missing
          const readerFilters = [...(found.leadId ? [{ _id: found.leadId }] : []), ...(found.businessId ? [{ businessId: found.businessId }] : [])];
          const readers = readerFilters.length === 0 ? [] : await req.tenant!.leads.find({ $or: readerFilters }).limit(1).exec();
          audit = readers.length > 0 ? found : null;
        }
      }
    }

    if (!audit) {
      throw new AppError(404, 'AUDIT_NOT_FOUND', 'Audit not found');
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
