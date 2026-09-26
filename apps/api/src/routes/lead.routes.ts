import { Router } from 'express';
import { CreateLeadSchema, GetLeadsQuerySchema } from '@revamp/validation';
import { validateBody, validateQuery } from '../middlewares/validate.js';
import { createLead, getLeads, getLeadById } from '../controllers/lead.controller.js';

const router = Router();

// POST /leads - Create lead and queue audit in BullMQ
router.post('/', validateBody(CreateLeadSchema), createLead);

// GET /leads - List leads with filters and pagination
router.get('/', validateQuery(GetLeadsQuerySchema), getLeads);

// GET /leads/:id - Get lead details and audit status
router.get('/:id', getLeadById);

export default router;
