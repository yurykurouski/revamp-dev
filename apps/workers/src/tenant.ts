import { Types } from 'mongoose';
import { UnrecoverableError } from 'bullmq';

// REV-210: every job carries the studio it runs for. A worker checks it against the lead's own `tenantId` before it
// writes anything, and adds it to the queries it runs, so a job never changes another studio's record.

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** The job's studio as an ObjectId; a job without one, or with one that is no id, is refused (no retry will fix it) */
export function jobTenant(tenantId: unknown): Types.ObjectId {
  if (typeof tenantId !== 'string' || !OBJECT_ID.test(tenantId)) {
    throw new UnrecoverableError('The job carries no valid tenantId; nothing was written');
  }
  return new Types.ObjectId(tenantId);
}

/**
 * Refuses a job whose studio is not its lead's: the lead has none (before `migrate:tenants`) or another one. Call it
 * after the lead is loaded and before the first write.
 */
export function assertJobTenant(tenantId: unknown, lead: { tenantId?: Types.ObjectId | string | null }): Types.ObjectId {
  const tenant = jobTenant(tenantId);
  if (!lead.tenantId || String(lead.tenantId) !== String(tenant)) {
    throw new UnrecoverableError(
      lead.tenantId
        ? 'The job belongs to another studio than its lead; nothing was written'
        : 'The lead belongs to no studio yet (run npm run migrate:tenants); nothing was written',
    );
  }
  return tenant;
}

/** `filter` restricted to the studio's records */
export const withTenant = <F extends Record<string, unknown>>(tenant: Types.ObjectId, filter: F): F & { tenantId: Types.ObjectId } => ({
  ...filter,
  tenantId: tenant,
});
