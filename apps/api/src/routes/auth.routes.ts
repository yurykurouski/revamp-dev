import { NextFunction, Request, Response, Router } from 'express';
import { LoginSchema, RegisterSchema } from '@revamp/validation';
import { isPlatformAdmin, requireAuth } from '../middlewares/requireAuth.js';
import { validateBody } from '../middlewares/validate.js';
import { getAuthContext, loginUser, registerUser } from '../services/auth.service.js';

const router = Router();

// REV-206: register and login are public; everything else in the API needs a token (routes/index.ts)
router.post('/register', validateBody(RegisterSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json({ success: true, data: await registerUser(req.body) });
  } catch (error) {
    next(error);
  }
});

router.post('/login', validateBody(LoginSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ success: true, data: await loginUser(req.body) });
  } catch (error) {
    next(error);
  }
});

router.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const context = await getAuthContext(req.auth!);
    // REV-232: whether the caller is a platform admin; the dashboard shows nothing for it yet
    res.status(200).json({ success: true, data: { ...context, platformAdmin: isPlatformAdmin(context.user.email) } });
  } catch (error) {
    next(error);
  }
});

export default router;
