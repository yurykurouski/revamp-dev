import { Router, Request, Response, NextFunction } from 'express';
import { TriggerAuditSchema } from '@revamp/validation';
import { validateBody } from '../middlewares/validate.js';

const router = Router();

// POST /audits/trigger - Trigger audit for lead
router.post(
  '/trigger',
  validateBody(TriggerAuditSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(202).json({
        success: true,
        message: 'Audit job queued',
        data: {
          leadId: req.body.leadId,
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
    res.status(200).json({
      success: true,
      data: {
        id: req.params['id'],
        status: 'COMPLETED',
        scores: {
          total: 75,
          design: 60,
          accessibility: 85,
          performance: 70,
          standards: 80,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
