import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Audit } from '../../models/Audit.model.js';
import { findGenerationAudit } from '../audit-lookup.js';

vi.mock('../../models/Audit.model.js');

describe('findGenerationAudit (REV-55)', () => {
  const leadId = new mongoose.Types.ObjectId();
  const auditId = new mongoose.Types.ObjectId().toString();
  const newestCompleted = { _id: 'newest', leadId, status: 'COMPLETED' };
  let sort: ReturnType<typeof vi.fn>;

  const mockAudits = (byId: unknown, fallback: unknown = newestCompleted) => {
    vi.mocked(Audit.findById).mockReturnValue({ exec: vi.fn().mockResolvedValue(byId) } as any);
    sort = vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(fallback) });
    vi.mocked(Audit.findOne).mockReturnValue({ sort } as any);
  };

  beforeEach(() => {
    vi.mocked(Audit.findById).mockReset();
    vi.mocked(Audit.findOne).mockReset();
  });

  it('uses the given audit when it is completed', async () => {
    const exact = { _id: auditId, leadId, status: 'COMPLETED' };
    mockAudits(exact);

    expect(await findGenerationAudit(auditId)).toBe(exact);
    expect(Audit.findOne).not.toHaveBeenCalled();
  });

  it("takes the newest completed audit of a failed audit's lead", async () => {
    mockAudits({ _id: auditId, leadId, status: 'FAILED' });

    expect(await findGenerationAudit(auditId)).toBe(newestCompleted);
    expect(Audit.findOne).toHaveBeenCalledWith({ leadId, status: 'COMPLETED' });
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
  });

  it('treats an id that is not an audit as a lead id', async () => {
    const id = leadId.toString();
    mockAudits(null);

    expect(await findGenerationAudit(id)).toBe(newestCompleted);
    expect(Audit.findOne).toHaveBeenCalledWith({ leadId: id, status: 'COMPLETED' });
  });

  it('returns null for a non-ObjectId id without querying', async () => {
    expect(await findGenerationAudit('audit-abc')).toBeNull();
    expect(Audit.findById).not.toHaveBeenCalled();
  });

  it('returns null when the lead has no completed audit', async () => {
    mockAudits(null, null);
    expect(await findGenerationAudit(leadId.toString())).toBeNull();
  });
});
