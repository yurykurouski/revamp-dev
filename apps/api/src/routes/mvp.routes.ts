import { Router, Request, Response, NextFunction } from 'express';
import { GenerateMvpSchema, UpdateMvpTokensSchema, mvpGenerationMode } from '@revamp/validation';
import { validateBody } from '../middlewares/validate.js';
import { MvpProject } from '../models/MvpProject.model.js';
import { Audit } from '../models/Audit.model.js';
import { Lead } from '../models/Lead.model.js';
import { addAiGenerationJob } from '../queues/ai.queue.js';
import { AppError } from '../middlewares/errorHandler.js';
import mongoose from 'mongoose';

const router = Router();

// POST /mvp/generate
router.post(
  '/generate',
  validateBody(GenerateMvpSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { auditId, forceRegenerate } = req.body;

      const isValidId = mongoose.Types.ObjectId.isValid(auditId);
      const audit = await Audit.findOne({
        $or: [
          ...(isValidId ? [{ _id: auditId }, { leadId: auditId }] : [{ _id: auditId }]),
        ],
      }).exec();

      if (!audit) {
        throw new AppError('Audit not found', 404);
      }

      const lead = await Lead.findById(audit.leadId).exec();
      if (!lead) {
        throw new AppError('Associated lead not found', 404);
      }

      // REV-31: generate once from AUDITED; regenerating needs forceRegenerate and is never
      // allowed once outreach is scheduled or dispatched (Human-In-The-Loop)
      const mode = mvpGenerationMode(lead.status);
      if (mode === 'blocked') {
        throw new AppError(`MVP generation is not allowed while the lead is ${lead.status}`, 409, {
          code: 'MVP_GENERATION_NOT_ALLOWED',
          status: lead.status,
        });
      }
      if (mode === 'regenerate' && !forceRegenerate) {
        throw new AppError('This lead already has an MVP. Set forceRegenerate to replace it.', 409, {
          code: 'MVP_ALREADY_GENERATED',
          status: lead.status,
        });
      }

      const previousStatus = lead.status;
      await Lead.findByIdAndUpdate(lead._id, {
        $set: { status: 'GENERATING' },
        $unset: { generationError: '' },
      }).exec();

      const job = await addAiGenerationJob({
        leadId: lead._id.toString(),
        auditId: audit._id.toString(),
        forceRegenerate: mode === 'regenerate',
        previousStatus,
      });

      res.status(202).json({
        success: true,
        message: 'MVP generation enqueued successfully',
        data: {
          leadId: lead._id.toString(),
          auditId: audit._id.toString(),
          jobId: job.id,
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
