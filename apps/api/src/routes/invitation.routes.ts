import { NextFunction, Request, Response, Router } from 'express';
import { requireAuth } from '../middlewares/requireAuth.js';
import { acceptInvitation, previewInvitation } from '../services/organization.service.js';

const router = Router();

// REV-207: the join page reads an invitation by its token without a session (the token is the secret), and a
// signed-in user accepts it; every role may accept, since it adds a membership to another organization.
router.get('/:token', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.status(200).json({ success: true, data: await previewInvitation(String(req.params.token)) });
  } catch (error) {
    next(error);
  }
});

router.post('/:token/accept', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.status(200).json({ success: true, data: await acceptInvitation(req.auth!, String(req.params.token)) });
  } catch (error) {
    next(error);
  }
});

export default router;
