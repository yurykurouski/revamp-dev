import type { Types } from 'mongoose';
import { Organization } from '@revamp/db';
import { renderOutreachMessage, type IOutboxMessage, type IStudioSender } from '@revamp/shared-types';
import { env } from '../config/env.js';

/**
 * Simulated email delivery (REV-221). Nothing leaves the platform: the message is rendered exactly as it would be sent
 * (From the studio's own sender, RFC 2369 / 8058 unsubscribe headers, one-click footer, open pixel) and the caller
 * records it in the campaign's outbox. This is the one written exception to the "no mock providers" rule of the root
 * AGENTS.md (REV-45), limited to email delivery and always labelled `deliveryMode: 'SIMULATED'`.
 */

/** The studio's current sender, or null when it has none. Read at send time, so a change after approval applies */
export async function loadStudioSender(tenant: Types.ObjectId): Promise<IStudioSender | null> {
  const organization = await Organization.findById(tenant, { sender: 1 }).lean().exec();
  const sender = organization?.sender;
  return sender?.name && sender.address ? { name: sender.name, address: sender.address } : null;
}

/** Renders the message that would have been sent; it does not deliver anything */
export function simulateDelivery(input: Omit<Parameters<typeof renderOutreachMessage>[0], 'publicApiUrl'>): IOutboxMessage {
  return renderOutreachMessage({ ...input, publicApiUrl: env.PUBLIC_API_URL });
}
