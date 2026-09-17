import { Router, Request, Response, NextFunction } from 'express';
import { GenerateMvpSchema, UpdateMvpTokensSchema } from '@revamp/validation';
import { validateBody } from '../middlewares/validate.js';

const router = Router();

// POST /mvp/generate
router.post(
  '/generate',
  validateBody(GenerateMvpSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(202).json({
        success: true,
        message: 'MVP generation started',
        data: {
          auditId: req.body.auditId,
          status: 'GENERATING',
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// GET /mvp/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({
      success: true,
      data: {
        id: req.params['id'],
        previewSlug: 'demo-slug',
        fullPreviewUrl: 'https://preview.revampdemo.com/v/demo-slug',
      },
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /mvp/:id/tokens
router.patch(
  '/:id/tokens',
  validateBody(UpdateMvpTokensSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json({
        success: true,
        message: 'Tokens updated successfully',
        data: req.body,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
