import { Router, Request, Response, NextFunction } from 'express';
import {
  ApproveOutreachSchema,
  RejectOutreachSchema,
  TestEmailOutreachSchema,
} from '@revamp/validation';
import { validateBody } from '../middlewares/validate.js';

const router = Router();

// GET /outreach/pending - Pending approval drafts
router.get('/pending', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({
      success: true,
      data: [],
      total: 0,
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
      res.status(200).json({
        success: true,
        message: 'Email approved by operator and queued for sending',
        data: {
          campaignId: req.params['id'],
          status: 'SCHEDULED',
          approvedBy: req.body.approvedBy,
          approvedAt: new Date().toISOString(),
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
      res.status(200).json({
        success: true,
        message: 'Campaign draft rejected',
        data: {
          campaignId: req.params['id'],
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
