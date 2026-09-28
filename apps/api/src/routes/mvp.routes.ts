import { Router, Request, Response, NextFunction } from 'express';
import {
  EditMvpSchema,
  GenerateMvpSchema,
  MvpLayoutSelectionSchema,
  UpdateMvpLayoutSchema,
  UpdateMvpTokensSchema,
  canChangeMvpLayout,
  mvpGenerationMode,
} from '@revamp/validation';
import { validateBody } from '../middlewares/validate.js';
import { MvpProject } from '../models/MvpProject.model.js';
import { findGenerationAudit } from '../services/audit-lookup.js';
import { Lead } from '../models/Lead.model.js';
import { addAiGenerationJob } from '../queues/ai.queue.js';
import { addMvpRelayoutJob } from '../queues/deploy.queue.js';
import { runMvpEditJob } from '../queues/mvp-edit.queue.js';
import { AppError } from '../middlewares/errorHandler.js';
import { redisConnection } from '../queues/connection.js';
import { getLlmProviders } from '../services/llm-providers.service.js';
import { env } from '../config/env.js';
import { MVP_LAYOUT_MANUAL_REASON, findLlmProvider } from '@revamp/shared-types';
import mongoose from 'mongoose';

const router = Router();

// GET /mvp/providers: LLM providers/models for MVP generation and whether each can run (REV-32)
router.get('/providers', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.status(200).json({ success: true, data: await getLlmProviders(redisConnection, env.NODE_ENV) });
  } catch (error) {
    next(error);
  }
});

// POST /mvp/generate
router.post(
  '/generate',
  validateBody(GenerateMvpSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { auditId, forceRegenerate, provider, model } = req.body;

      if (provider && findLlmProvider(provider)?.devOnly && env.NODE_ENV === 'production') {
        throw new AppError(400, 'LLM_PROVIDER_NOT_ALLOWED', `Provider "${provider}" is not available in production`);
      }

      // A lead can have several audits (one per retry); never build from a failed or stale one (REV-55)
      const audit = await findGenerationAudit(auditId);

      if (!audit) {
        throw new AppError(404, 'NO_COMPLETED_AUDIT', 'No completed audit found for this lead');
      }

      const lead = await Lead.findById(audit.leadId).exec();
      if (!lead) {
        throw new AppError(404, 'LEAD_NOT_FOUND', 'Associated lead not found');
      }

      // REV-31: generate once from AUDITED; regenerating needs forceRegenerate and is never
      // allowed once outreach is scheduled or dispatched (Human-In-The-Loop)
      const mode = mvpGenerationMode(lead.status);
      if (mode === 'blocked') {
        throw new AppError(409, 'MVP_GENERATION_NOT_ALLOWED', `MVP generation is not allowed while the lead is ${lead.status}`, {
          status: lead.status,
        });
      }
      if (mode === 'regenerate' && !forceRegenerate) {
        throw new AppError(409, 'MVP_ALREADY_GENERATED', 'This lead already has an MVP. Set forceRegenerate to replace it.', {
          status: lead.status,
        });
      }

      // Only if the lead is still in the status checked above, so two requests can't both start (REV-62)
      const previousStatus = lead.status;
      const claimed = await Lead.findOneAndUpdate(
        { _id: lead._id, status: previousStatus },
        { $set: { status: 'GENERATING' }, $unset: { generationError: '' } },
      ).exec();
      if (!claimed) {
        throw new AppError(409, 'MVP_GENERATION_NOT_ALLOWED', 'The lead changed while generation was being queued; try again');
      }

      const job = await addAiGenerationJob({
        leadId: lead._id.toString(),
        auditId: audit._id.toString(),
        forceRegenerate: mode === 'regenerate',
        previousStatus,
        ...(provider ? { provider, ...(model ? { model } : {}) } : {}),
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
      throw new AppError(404, 'MVP_NOT_FOUND', 'MVP not found');
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

    throw new AppError(404, 'PREVIEW_NOT_FOUND', 'Preview not found');
  } catch (error) {
    next(error);
  }
});

// PATCH /mvp/:id/tokens: saves the palette on the MVP record by its _id, then the published bundle is
// re-rendered in it (REV-90), under the same rule as a layout change; no LLM call.
router.patch(
  '/:id/tokens',
  validateBody(UpdateMvpTokensSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params['id'] || '';
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError(400, 'INVALID_ID', 'A valid 24-character hexadecimal ObjectId is required');
      }

      const { primaryColor, secondaryColor, accentColor } = req.body;
      const palette: Record<string, string> = {};
      if (primaryColor) palette['colorPalette.primary'] = primaryColor;
      if (secondaryColor) palette['colorPalette.secondary'] = secondaryColor;
      if (accentColor) palette['colorPalette.accent'] = accentColor;

      // An unknown id used to answer 200 without writing anything (REV-65)
      const project = await MvpProject.findById(id).exec();
      if (!project) {
        throw new AppError(404, 'MVP_NOT_FOUND', 'MVP not found');
      }
      const lead = await Lead.findById(project.leadId).exec();
      if (!lead) {
        throw new AppError(404, 'LEAD_NOT_FOUND', 'Associated lead not found');
      }
      // The published page changes, so the same rule as a layout change applies (HITL)
      if (!canChangeMvpLayout(lead.status)) {
        throw new AppError(
          409,
          'MVP_PALETTE_CHANGE_NOT_ALLOWED',
          `The MVP palette cannot be changed while the lead is ${lead.status}`,
          { status: lead.status },
        );
      }

      const saved = await MvpProject.findByIdAndUpdate(id, { $set: palette }, { new: true }).exec();
      if (!saved) {
        throw new AppError(404, 'MVP_NOT_FOUND', 'MVP not found');
      }

      await addMvpRelayoutJob({
        leadId: lead._id.toString(),
        auditId: saved.auditId.toString(),
        mvpProjectId: saved._id.toString(),
      });

      res.status(200).json({
        success: true,
        message: 'Palette saved; the published MVP is being re-rendered in it',
        data: saved,
      });
    } catch (error) {
      next(error);
    }
  },
);

// PATCH /mvp/:id/layout: the operator's layout for the MVP (REV-84). Saved on the MVP record by its
// _id, then the published bundle is re-rendered from the stored copy in that layout; no LLM call.
router.patch(
  '/:id/layout',
  validateBody(UpdateMvpLayoutSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params['id'] || '';
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError(400, 'INVALID_ID', 'A valid 24-character hexadecimal ObjectId is required');
      }
      const { variant } = req.body;

      const project = await MvpProject.findById(id).exec();
      if (!project) {
        throw new AppError(404, 'MVP_NOT_FOUND', 'MVP not found');
      }
      const lead = await Lead.findById(project.leadId).exec();
      if (!lead) {
        throw new AppError(404, 'LEAD_NOT_FOUND', 'Associated lead not found');
      }
      // Same rule as a regeneration: never while one runs, nor once outreach is scheduled or sent (HITL)
      if (!canChangeMvpLayout(lead.status)) {
        throw new AppError(
          409,
          'MVP_LAYOUT_CHANGE_NOT_ALLOWED',
          `The MVP layout cannot be changed while the lead is ${lead.status}`,
          { status: lead.status },
        );
      }

      if (project.layout?.variant === variant) {
        res.status(200).json({ success: true, message: 'The MVP already uses this layout', data: project });
        return;
      }

      // The audit facts behind the automatic choice are kept; the rule becomes the operator's
      const facts = (project.layout?.reasons ?? []).filter((reason) => !reason.startsWith('rule:'));
      const layout = MvpLayoutSelectionSchema.parse({
        variant,
        reasons: [MVP_LAYOUT_MANUAL_REASON, ...facts].slice(0, 12),
      });
      const saved = await MvpProject.findByIdAndUpdate(id, { $set: { layout } }, { new: true }).exec();
      if (!saved) {
        throw new AppError(404, 'MVP_NOT_FOUND', 'MVP not found');
      }

      await addMvpRelayoutJob({
        leadId: lead._id.toString(),
        auditId: saved.auditId.toString(),
        mvpProjectId: saved._id.toString(),
      });

      res.status(200).json({
        success: true,
        message: 'Layout saved; the published MVP is being re-rendered in it',
        data: saved,
      });
    } catch (error) {
      next(error);
    }
  },
);

// POST /mvp/:id/edit: the operator describes a change in their own words; the workers' LLM applies it to
// the copy, palette and/or layout under Strict Grounding and the page is re-published (REV-85). The request
// waits for the result, so the operator is told what changed or why nothing did.
router.post(
  '/:id/edit',
  validateBody(EditMvpSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params['id'] || '';
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError(400, 'INVALID_ID', 'A valid 24-character hexadecimal ObjectId is required');
      }

      const project = await MvpProject.findById(id).exec();
      if (!project) {
        throw new AppError(404, 'MVP_NOT_FOUND', 'MVP not found');
      }
      const lead = await Lead.findById(project.leadId).exec();
      if (!lead) {
        throw new AppError(404, 'LEAD_NOT_FOUND', 'Associated lead not found');
      }
      // The published page changes, so the same rule as a layout change applies (HITL)
      if (!canChangeMvpLayout(lead.status)) {
        throw new AppError(409, 'MVP_EDIT_NOT_ALLOWED', `The MVP cannot be changed while the lead is ${lead.status}`, {
          status: lead.status,
        });
      }

      const outcome = await runMvpEditJob({ mvpProjectId: id, instruction: req.body.instruction });
      if (outcome.status === 'timeout') {
        throw new AppError(
          504,
          'MVP_EDIT_TIMEOUT',
          'The change took too long and was not applied. Check that the workers are running, then try again.',
        );
      }
      if (outcome.status === 'failed') {
        throw new AppError(502, 'MVP_EDIT_FAILED', `The change was not applied: ${outcome.reason}`);
      }

      const saved = await MvpProject.findById(id).exec();
      res.status(200).json({
        success: true,
        message: outcome.result.applied ? 'Change applied; the published MVP was re-rendered' : 'Nothing was changed',
        data: { ...outcome.result, mvp: saved ?? project },
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
