import { NextFunction, Request, Response, Router } from 'express';
import { StudioSenderSchema } from '@revamp/validation';
import { validateBody } from '../middlewares/validate.js';
import { saveSender } from '../services/sender.service.js';

const router = Router();

// REV-221: the owner sets the studio's sender. Mounted behind `requireAuth` and `requireOwner` (routes/index.ts); it
// writes the caller's own organization only. There is no DELETE: the sender can be changed, not removed.
router.put('/', validateBody(StudioSenderSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ success: true, data: await saveSender(req.auth!.organizationId, req.body) });
  } catch (error) {
    next(error);
  }
});

export default router;
