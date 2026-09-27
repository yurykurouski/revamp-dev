import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Audit } from '../../models/Audit.model.js';
import { findGenerationAudit } from '../audit-lookup.js';

vi.mock('../../models/Audit.model.js');

describe('findGenerationAudit (REV-55)', () => {
  const leadId = new mongoose.Types.ObjectId().toString();
  const auditId = new mongoose.Types.ObjectId().toString();
  const newestCompleted = { _id: 'newest', leadId, status: 'COMPLETED' };
  let sort: ReturnType<typeof vi.fn>;

  /** `exact` is what `findOne({ _id, leadId })` returns; the fallback query returns `fallback` */
  const mockAudits = (exact: unknown, fallback: unknown = newestCompleted) => {
    sort = vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(fallback) });
    vi.mocked(Audit.findOne).mockImplementation(((filter?: Record<string, unknown>) =>
      filter?._id ? { exec: vi.fn().mockResolvedValue(exact) } : { sort }) as any);
  };

  beforeEach(() => vi.mocked(Audit.findOne).mockReset());

  it('uses the given audit when it is a completed audit of the lead', async () => {
    const exact = { _id: auditId, leadId, status: 'COMPLETED' };
    mockAudits(exact);

    expect(await findGenerationAudit(leadId, auditId)).toBe(exact);
    expect(Audit.findOne).toHaveBeenCalledTimes(1);
    expect(Audit.findOne).toHaveBeenCalledWith({ _id: auditId, leadId });
  });

  it.each(['FAILED', 'PROCESSING', 'QUEUED'])('falls back to the newest completed audit when the given one is %s', async (status) => {
    mockAudits({ _id: auditId, leadId, status });

    expect(await findGenerationAudit(leadId, auditId)).toBe(newestCompleted);
    expect(Audit.findOne).toHaveBeenLastCalledWith({ leadId, status: 'COMPLETED' });
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
  });

  it('falls back when the given audit belongs to another lead or does not exist', async () => {
    mockAudits(null);
    expect(await findGenerationAudit(leadId, auditId)).toBe(newestCompleted);
  });

  it.each([undefined, 'lead-or-garbage'])('skips the exact lookup for a missing or non-ObjectId id (%s)', async (id) => {
    mockAudits(null);

    expect(await findGenerationAudit(leadId, id)).toBe(newestCompleted);
    expect(Audit.findOne).toHaveBeenCalledTimes(1);
    expect(Audit.findOne).toHaveBeenCalledWith({ leadId, status: 'COMPLETED' });
  });

  it('returns null when the lead has no completed audit', async () => {
    mockAudits({ _id: auditId, leadId, status: 'FAILED' }, null);
    expect(await findGenerationAudit(leadId, auditId)).toBeNull();
  });
});
