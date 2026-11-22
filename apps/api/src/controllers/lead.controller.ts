import { Request, Response, NextFunction } from 'express';
import { LeadService, GetLeadsQuery } from '../services/lead.service.js';

export const createLead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // The lead belongs to the caller's studio (REV-208)
    const result = await LeadService.createLead(req.body, { tenantId: req.auth!.organizationId });
    res.status(201).json({
      success: true,
      message: result.reused
        ? 'Lead created with the audit of this site; MVP generation queued'
        : 'Lead created and audit queued successfully',
      data: {
        id: result.lead.id,
        lead: result.lead,
        auditId: result.auditId,
        jobId: result.jobId,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getLeads = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await LeadService.getLeads(req.tenant!, req.query as GetLeadsQuery);
    res.status(200).json({
      success: true,
      data: result.leads,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

export const getLeadStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await LeadService.getLeadStats(req.tenant!);
    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
};

export const getLeadById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await LeadService.getLeadById(req.tenant!, req.params['id'] as string);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
