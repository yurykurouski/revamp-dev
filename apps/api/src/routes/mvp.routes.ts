import { Router, Request, Response, NextFunction } from 'express';
import {
  EditMvpSchema,
  GenerateMvpSchema,
  MvpVersionParamsSchema,
  UpdateMvpTokensSchema,
  canChangeMvpLayout,
  mvpGenerationMode,
} from '@revamp/validation';
import { validateBody } from '../middlewares/validate.js';
import { MvpProject } from '../models/MvpProject.model.js';
import { findGenerationAudit } from '../services/audit-lookup.js';
import { Lead } from '../models/Lead.model.js';
import { addAiGenerationJob } from '../queues/ai.queue.js';
import { MVP_PAGE_CHANGE_WAIT_MS, MVP_PAGE_PUBLISH_WAIT_MS, runMvpPageJob } from '../queues/mvp-page.queue.js';
import { AppError } from '../middlewares/errorHandler.js';
import { redisConnection } from '../queues/connection.js';
import { getLlmProviders } from '../services/llm-providers.service.js';
import { env } from '../config/env.js';
import { IMvpPageJobData, IMvpPageVersion, findLlmProvider } from '@revamp/shared-types';
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
        { $set: { status: 'GENERATING' }, $unset: { generationError: '', generationFailure: '' } },
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

/**
 * The MVP a change applies to (REV-139): a page the model designed, whose lead is still in review. A change re-publishes
 * the page, so the rule of a regeneration applies: never while one runs, nor once outreach is scheduled or sent (HITL).
 */
async function loadChangeableMvp(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(400, 'INVALID_ID', 'A valid 24-character hexadecimal ObjectId is required');
  }
  const project = await MvpProject.findById(id).exec();
  if (!project) {
    throw new AppError(404, 'MVP_NOT_FOUND', 'MVP not found');
  }
  if (!project.page) {
    throw new AppError(409, 'MVP_PREVIOUS_GENERATOR', 'This MVP was made by the previous generator: only a regeneration applies to it');
  }
  const lead = await Lead.findById(project.leadId).exec();
  if (!lead) {
    throw new AppError(404, 'LEAD_NOT_FOUND', 'Associated lead not found');
  }
  if (!canChangeMvpLayout(lead.status)) {
    throw new AppError(409, 'MVP_EDIT_NOT_ALLOWED', `The MVP cannot be changed while the lead is ${lead.status}`, { status: lead.status });
  }
  return project;
}

/**
 * Runs a change on the workers and answers with its result and the MVP as saved after it (REV-85, REV-139). Nothing
 * is published when the model gave no page or a version no longer fits the audit; the reason is returned.
 */
async function runPageChange(res: Response, id: string, job: Omit<IMvpPageJobData, 'deadline' | 'mvpProjectId'>, waitMs: number): Promise<void> {
  const outcome = await runMvpPageJob({ mvpProjectId: id, ...job }, waitMs);
  if (outcome.status === 'timeout') {
    if (outcome.running) {
      throw new AppError(504, 'MVP_EDIT_TIMEOUT', 'The change is taking longer than expected and may still be published. Reload the MVP in a minute before trying again.');
    }
    throw new AppError(504, 'MVP_EDIT_TIMEOUT', 'The change took too long and was not applied. Check that the workers are running, then try again.');
  }
  if (outcome.status === 'failed') {
    throw new AppError(502, 'MVP_EDIT_FAILED', `The change was not applied: ${outcome.reason}`);
  }
  const result = outcome.result;
  if (!result.applied && result.reason === 'unusable_version') {
    throw new AppError(409, 'MVP_VERSION_UNUSABLE', result.message, { problems: result.problems ?? [] });
  }
  if (!result.applied && result.reason !== 'unchanged') {
    throw new AppError(502, 'MVP_EDIT_FAILED', `The change was not applied: ${result.message}`, {
      reason: result.reason,
      ...(result.problems ? { problems: result.problems } : {}),
    });
  }
  const saved = await MvpProject.findById(id).exec();
  res.status(200).json({
    success: true,
    message: result.applied ? 'Change applied; the published MVP was re-published' : 'Nothing was changed',
    data: { ...result, mvp: saved },
  });
}

// POST /mvp/:id/edit: the operator describes a change in their own words; the model returns the whole page with it,
// checked like a generation, and the page is re-published as a new version (REV-139). The request waits for the result.
router.post(
  '/:id/edit',
  validateBody(EditMvpSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params['id'] || '';
      await loadChangeableMvp(id);
      await runPageChange(res, id, { action: 'change', instruction: req.body.instruction }, MVP_PAGE_CHANGE_WAIT_MS);
    } catch (error) {
      next(error);
    }
  },
);

// PATCH /mvp/:id/tokens: the operator's palette and fonts over the model's theme (REV-139); readable text and a listed
// font pairing are required by the schema. The stored page is re-finished and re-published; no model call, no version.
router.patch(
  '/:id/tokens',
  validateBody(UpdateMvpTokensSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params['id'] || '';
      await loadChangeableMvp(id);
      await runPageChange(res, id, { action: 'controls', controls: req.body }, MVP_PAGE_PUBLISH_WAIT_MS);
    } catch (error) {
      next(error);
    }
  },
);

// POST /mvp/:id/versions/:n/restore: re-publishes a stored version of the page, with the current palette and fonts, as
// a new version (REV-139); a version that no longer fits the audit (contacts, images) is refused with its problems.
router.post('/:id/versions/:n/restore', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // A ZodError answers 400 VALIDATION_ERROR through the error handler
    const { n } = MvpVersionParamsSchema.parse({ n: req.params['n'] });
    const id = req.params['id'] || '';
    const project = await loadChangeableMvp(id);
    if (!((project.versions ?? []) as IMvpPageVersion[]).some((v) => v.n === n)) {
      throw new AppError(404, 'MVP_VERSION_NOT_FOUND', `Version ${n} of this MVP is not stored`);
    }
    await runPageChange(res, id, { action: 'restore', version: n }, MVP_PAGE_PUBLISH_WAIT_MS);
  } catch (error) {
    next(error);
  }
});

export default router;
