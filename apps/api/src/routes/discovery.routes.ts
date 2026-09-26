import { Router } from 'express';
import { StartDiscoverySchema } from '@revamp/validation';
import { validateBody } from '../middlewares/validate.js';
import { startDiscovery, getDiscoveryStatus } from '../controllers/discovery.controller.js';

const router = Router();

// POST /discovery - Queue a maps-provider search that imports businesses as leads
router.post('/', validateBody(StartDiscoverySchema), startDiscovery);

// GET /discovery/:jobId - Discovery job state and import summary
router.get('/:jobId', getDiscoveryStatus);

export default router;
