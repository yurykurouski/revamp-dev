import { Request, Response, NextFunction } from 'express';
import { LeadService } from '../services/lead.service.js';

export const createLead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await LeadService.createLead(req.body);
    res.status(201).json({
      success: true,
      message: 'Lead created and audit queued successfully',
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
    const result = await LeadService.getLeads(req.query);
    res.status(200).json({
      success: true,
      data: result.leads,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

export const getLeadById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await LeadService.getLeadById(req.params['id'] as string);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
