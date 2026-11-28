import { Router, type NextFunction, type Request, type Response } from 'express';
import { AdminLotsQuerySchema, CreateLotSchema, CreatePlatformAuditSchema, OpenLotSchema } from '@revamp/validation';
import { validateBody, validateQuery } from '../middlewares/validate.js';
import {
  createLotForBusiness,
  getPlatformAudit,
  listLots,
  openLot,
  requestPlatformAudit,
  withdrawLot,
} from '../services/lot.service.js';

// REV-232: platform admin routes, mounted behind `requireAuth` and `requirePlatformAdmin`. They touch platform-owned
// records (shared audits, lots), never a studio's leads.
const router = Router();

const handler =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

router.post(
  '/platform-audits',
  validateBody(CreatePlatformAuditSchema),
  handler(async (req, res) => {
    const data = await requestPlatformAudit(req.body);
    res.status(data.queued ? 201 : 200).json({ success: true, data });
  }),
);

router.get(
  '/platform-audits/:id',
  handler(async (req, res) => {
    res.status(200).json({ success: true, data: await getPlatformAudit(String(req.params['id'])) });
  }),
);

router.post(
  '/lots',
  validateBody(CreateLotSchema),
  handler(async (req, res) => {
    res.status(201).json({ success: true, data: await createLotForBusiness(req.body.businessId) });
  }),
);

router.get(
  '/lots',
  validateQuery(AdminLotsQuerySchema),
  handler(async (req, res) => {
    const { data, pagination } = await listLots(req.query as never);
    res.status(200).json({ success: true, data, pagination });
  }),
);

router.post(
  '/lots/:id/open',
  validateBody(OpenLotSchema),
  handler(async (req, res) => {
    res.status(200).json({ success: true, data: await openLot(String(req.params['id']), req.body.releaseAt) });
  }),
);

router.post(
  '/lots/:id/withdraw',
  handler(async (req, res) => {
    res.status(200).json({ success: true, data: await withdrawLot(String(req.params['id'])) });
  }),
);

export default router;
