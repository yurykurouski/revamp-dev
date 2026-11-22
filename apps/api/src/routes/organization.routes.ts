import { NextFunction, Request, Response, Router } from 'express';
import { ChangeMemberRoleSchema, CreateInvitationSchema } from '@revamp/validation';
import { validateBody } from '../middlewares/validate.js';
import {
  changeRole,
  inviteMember,
  listMembers,
  removeFromOrganization,
  revokePendingInvitation,
} from '../services/organization.service.js';

const router = Router();

// REV-207: members and invitations of the caller's organization. Mounted behind `requireAuth` and `requireOwner`
// (routes/index.ts): only owners get here, and every service call acts on `req.auth.organizationId`.
const handle =
  (action: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await action(req, res);
    } catch (error) {
      next(error);
    }
  };

router.get(
  '/members',
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await listMembers(req.auth!) });
  }),
);

router.post(
  '/invitations',
  validateBody(CreateInvitationSchema),
  handle(async (req, res) => {
    res.status(201).json({ success: true, data: await inviteMember(req.auth!, req.body) });
  }),
);

router.delete(
  '/invitations/:id',
  handle(async (req, res) => {
    await revokePendingInvitation(req.auth!, String(req.params.id));
    res.status(200).json({ success: true });
  }),
);

router.patch(
  '/members/:userId',
  validateBody(ChangeMemberRoleSchema),
  handle(async (req, res) => {
    await changeRole(req.auth!, String(req.params.userId), req.body);
    res.status(200).json({ success: true });
  }),
);

router.delete(
  '/members/:userId',
  handle(async (req, res) => {
    await removeFromOrganization(req.auth!, String(req.params.userId));
    res.status(200).json({ success: true });
  }),
);

export default router;
