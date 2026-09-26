import { Router } from 'express';
import { ImportDiscoverySchema, ReverseGeocodeQuerySchema, StartDiscoverySchema } from '@revamp/validation';
import { validateBody, validateQuery } from '../middlewares/validate.js';
import {
  startDiscovery,
  getDiscoveryStatus,
  reverseGeocode,
  importDiscoveryCandidates,
} from '../controllers/discovery.controller.js';

const router = Router();

// POST /discovery - Queue a maps-provider search that imports businesses as leads
router.post('/', validateBody(StartDiscoverySchema), startDiscovery);

// GET /discovery/reverse-geocode - Browser coordinates to a place name (declared before /:jobId)
router.get('/reverse-geocode', validateQuery(ReverseGeocodeQuerySchema), reverseGeocode);

// GET /discovery/:jobId - Discovery job state and import summary
router.get('/:jobId', getDiscoveryStatus);

// POST /discovery/:jobId/import - Import the operator's selection as leads (REV-29)
router.post('/:jobId/import', validateBody(ImportDiscoverySchema), importDiscoveryCandidates);

export default router;
