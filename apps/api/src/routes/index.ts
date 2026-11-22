import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import leadRoutes from './lead.routes.js';
import auditRoutes from './audit.routes.js';
import mvpRoutes from './mvp.routes.js';
import outreachRoutes from './outreach.routes.js';
import trackRoutes from './track.routes.js';
import discoveryRoutes from './discovery.routes.js';
import { requireAuth, requireAuthUnless } from '../middlewares/requireAuth.js';

const router = Router();

// REV-206: every route needs a session token except the ones mounted without `requireAuth` below. The list of
// public routes is also written out in routes/__tests__/route-auth.spec.ts, so a new route fails that test
// until it is classified.

// Public: liveness check, register and login (`/auth/me` guards itself)
router.use('/', healthRoutes);
router.use('/auth', authRoutes);
// Public: called by email recipients and by the generated MVP pages, which carry a campaign token
router.use('/track', trackRoutes);

router.use('/leads', requireAuth, leadRoutes);
router.use('/audits', requireAuth, auditRoutes);
router.use('/outreach', requireAuth, outreachRoutes);
router.use('/discovery', requireAuth, discoveryRoutes);
// Public: GET /mvp/preview/:slug is loaded in an iframe, which cannot send a header; the rest of /mvp is guarded
router.use(
  '/mvp',
  requireAuthUnless((req) => req.method === 'GET' && /^\/preview\/[^/]+$/.test(req.path)),
  mvpRoutes,
);

export default router;
