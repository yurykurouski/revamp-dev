import { Router, Request, Response, NextFunction } from 'express';
import { CreateLeadSchema } from '@revamp/validation';
import { validateBody } from '../middlewares/validate.js';

const router = Router();

// POST /leads - Create lead and queue audit
router.post(
  '/',
  validateBody(CreateLeadSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Stub for Sprint 1 Task 1: Controller will be fully connected with Mongoose in REV-6
      res.status(201).json({
        success: true,
        message: 'Lead created successfully',
        data: {
          ...req.body,
          status: 'PENDING',
          createdAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// GET /leads - List leads
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({
      success: true,
      data: [],
      pagination: { total: 0, page: 1, limit: 20 },
    });
  } catch (error) {
    next(error);
  }
});

// GET /leads/:id - Get lead details
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({
      success: true,
      data: {
        id: req.params['id'],
        businessName: 'Demo Company',
        status: 'PENDING',
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
