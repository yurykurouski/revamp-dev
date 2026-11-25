import type { ISenderView, IStudioSender } from '@revamp/shared-types';
import { AppError } from '../middlewares/errorHandler.js';
import { Organization } from '../models/Organization.model.js';

// REV-221: the studio sender. Every function acts on the organization id of the signed-in caller (`req.auth`), never on an
// id from the request, so a studio can only read and change its own sender.

const toView = (sender?: { name?: string | null; address?: string | null } | null): ISenderView =>
  sender?.name && sender.address ? { configured: true, name: sender.name, address: sender.address } : { configured: false };

export async function readSender(organizationId: string): Promise<ISenderView> {
  const organization = await Organization.findById(organizationId, { sender: 1 }).lean().exec();
  return toView(organization?.sender);
}

export async function saveSender(organizationId: string, sender: IStudioSender): Promise<ISenderView> {
  const organization = await Organization.findByIdAndUpdate(
    organizationId,
    { $set: { sender: { name: sender.name, address: sender.address } } },
    { new: true, runValidators: true },
  )
    .lean()
    .exec();
  return toView(organization?.sender);
}

/** The studio's sender, or 409 SENDER_NOT_CONFIGURED: approval and test sends need one */
export async function requireSender(organizationId: string): Promise<IStudioSender> {
  const view = await readSender(organizationId);
  if (!view.configured || !view.name || !view.address) {
    throw new AppError(
      409,
      'SENDER_NOT_CONFIGURED',
      'This studio has no sender yet. The studio owner sets it in Settings before outreach can be approved or tested.',
    );
  }
  return { name: view.name, address: view.address };
}
