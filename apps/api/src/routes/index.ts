import { Router } from 'express';
import healthRoutes from './health.routes.js';
import leadRoutes from './lead.routes.js';
import auditRoutes from './audit.routes.js';
import mvpRoutes from './mvp.routes.js';
import outreachRoutes from './outreach.routes.js';
import trackRoutes from './track.routes.js';

const router = Router();

router.use('/', healthRoutes);
router.use('/leads', leadRoutes);
router.use('/audits', auditRoutes);
router.use('/mvp', mvpRoutes);
router.use('/outreach', outreachRoutes);
router.use('/track', trackRoutes);

export default router;
