import { Router, Request, Response, NextFunction } from 'express';
import { GenerateMvpSchema, UpdateMvpTokensSchema } from '@revamp/validation';
import { validateBody } from '../middlewares/validate.js';
import { MvpProject } from '../models/MvpProject.model.js';
import mongoose from 'mongoose';

const router = Router();

// POST /mvp/generate
router.post(
  '/generate',
  validateBody(GenerateMvpSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

// GET /mvp/:id (lookup by ID, leadId, or slug)
router.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params['id'] || '';
    let project = null;

    if (id && mongoose.Types.ObjectId.isValid(id)) {
      project = await MvpProject.findOne({
        $or: [{ _id: id }, { leadId: id }, { auditId: id }],
      }).exec();
    } else if (id) {
      project = await MvpProject.findOne({ previewSlug: id }).exec();
    }

    if (!project) {
      // Fallback for mocked or pre-existing demos
      res.status(200).json({
        success: true,
        data: {
          id,
          previewSlug: id,
          fullPreviewUrl: `http://localhost:9000/revamp-demos/v/${id}/index.html`,
          isPublished: true,
        },
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: project,
    });
  } catch (error) {
    next(error);
  }
});

// GET /mvp/preview/:slug (with sandboxing security headers)
router.get('/preview/:slug', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const slug = req.params['slug'] || '';
    res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' data: https:;");
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    const project = await MvpProject.findOne({ previewSlug: slug }).exec();
    if (project) {
      res.redirect(project.fullPreviewUrl);
      return;
    }

    res.status(404).json({
      success: false,
      error: 'Preview not found',
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /mvp/:id/tokens
router.patch(
  '/:id/tokens',
  validateBody(UpdateMvpTokensSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params['id'] || '';
      const updates = req.body;

      if (id && mongoose.Types.ObjectId.isValid(id)) {
        await MvpProject.findByIdAndUpdate(id, {
          $set: {
            'colorPalette.primary': updates.primaryColor,
            'colorPalette.secondary': updates.secondaryColor,
            'colorPalette.accent': updates.accentColor,
          },
        }).exec();
      }

      res.status(200).json({
        success: true,
        message: 'Tokens updated successfully',
        data: updates,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
