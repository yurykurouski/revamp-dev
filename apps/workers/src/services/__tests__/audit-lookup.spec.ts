import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Audit, auditBelongsToLead, findAuditForLead } from '../../models/Audit.model.js';
import { Lead } from '../../models/Lead.model.js';
import { findGenerationAudit } from '../audit-lookup.js';

vi.mock('../../models/Audit.model.js');
vi.mock('../../models/Lead.model.js');

describe('findGenerationAudit (REV-55, REV-208)', () => {
  const leadId = new mongoose.Types.ObjectId().toString();
  const businessId = new mongoose.Types.ObjectId();
  const auditId = new mongoose.Types.ObjectId().toString();
  const newestCompleted = { _id: 'newest', leadId, status: 'COMPLETED' };

  const mockLead = (value: unknown = { businessId }) =>
    vi.mocked(Lead.findById).mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(value) }) } as never);
  const mockExact = (exact: unknown) => vi.mocked(Audit.findById).mockReturnValue({ exec: () => Promise.resolve(exact) } as never);

  beforeEach(() => {
    vi.mocked(Audit.findById).mockReset();
    vi.mocked(Lead.findById).mockReset();
    vi.mocked(findAuditForLead).mockReset().mockResolvedValue(newestCompleted as never);
    vi.mocked(auditBelongsToLead).mockReset().mockResolvedValue(true);
    mockLead();
  });

  it('uses the given audit when it is completed and belongs to the lead or to its business', async () => {
    const exact = { _id: auditId, leadId: 'someone-else', status: 'COMPLETED' };
    mockExact(exact);
    expect(await findGenerationAudit(leadId, auditId)).toBe(exact);
    expect(auditBelongsToLead).toHaveBeenCalledWith(auditId, { _id: leadId, businessId });
    expect(findAuditForLead).not.toHaveBeenCalled();
  });

  it.each(['FAILED', 'PROCESSING', 'QUEUED'])('falls back to the completed audit of the lead when the given one is %s', async (status) => {
    mockExact({ _id: auditId, leadId, status });
    expect(await findGenerationAudit(leadId, auditId)).toBe(newestCompleted);
    expect(findAuditForLead).toHaveBeenCalledWith({ _id: leadId, businessId }, { completedOnly: true });
  });

  it('refuses the given audit when it belongs to neither the lead nor its business, and falls back', async () => {
    mockExact({ _id: auditId, leadId: 'x', status: 'COMPLETED' });
    vi.mocked(auditBelongsToLead).mockResolvedValue(false);
    expect(await findGenerationAudit(leadId, auditId)).toBe(newestCompleted);
  });

  it('falls back when the given audit does not exist', async () => {
    mockExact(null);
    expect(await findGenerationAudit(leadId, auditId)).toBe(newestCompleted);
  });

  it.each([undefined, 'lead-or-garbage'])('skips the exact lookup for a missing or non-ObjectId id (%s)', async (id) => {
    expect(await findGenerationAudit(leadId, id)).toBe(newestCompleted);
    expect(Audit.findById).not.toHaveBeenCalled();
  });

  it("gives a lead that took another studio's audit the completed audit of its business", async () => {
    const shared = { _id: 'shared', leadId: 'other-studio-lead', status: 'COMPLETED' };
    vi.mocked(findAuditForLead).mockResolvedValue(shared as never);
    expect(await findGenerationAudit(leadId)).toBe(shared);
  });

  it('works for a lead made before the split: no business, its own audits only', async () => {
    mockLead({});
    await findGenerationAudit(leadId);
    expect(findAuditForLead).toHaveBeenCalledWith({ _id: leadId, businessId: undefined }, { completedOnly: true });
  });

  it('returns null when there is no completed audit', async () => {
    vi.mocked(findAuditForLead).mockResolvedValue(null);
    expect(await findGenerationAudit(leadId)).toBeNull();
  });
});
