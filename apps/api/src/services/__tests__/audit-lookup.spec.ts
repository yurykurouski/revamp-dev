import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Audit, findAuditForLead } from '../../models/Audit.model.js';
import { Lead } from '../../models/Lead.model.js';
import { findGenerationAudit } from '../audit-lookup.js';

vi.mock('../../models/Audit.model.js');
vi.mock('../../models/Lead.model.js');

const exec = <T>(value: T) => ({ exec: vi.fn().mockResolvedValue(value) });

describe('findGenerationAudit (REV-55, REV-208)', () => {
  const leadId = new mongoose.Types.ObjectId();
  const businessId = new mongoose.Types.ObjectId();
  const lead = { _id: leadId, businessId, status: 'AUDITED' };
  const auditId = new mongoose.Types.ObjectId().toString();
  const newestCompleted = { _id: 'newest', leadId, status: 'COMPLETED' };

  beforeEach(() => {
    vi.mocked(Audit.findById).mockReset();
    vi.mocked(Lead.findById).mockReset();
    vi.mocked(findAuditForLead).mockReset();
  });

  it('treats an id that is a lead as a lead: its own completed audit, else its business\'s, and returns that lead', async () => {
    vi.mocked(Lead.findById).mockReturnValue(exec(lead) as never);
    vi.mocked(findAuditForLead).mockResolvedValue(newestCompleted as never);
    const found = await findGenerationAudit(leadId.toString());
    expect(found).toEqual({ audit: newestCompleted, lead });
    expect(findAuditForLead).toHaveBeenCalledWith(lead, { completedOnly: true });
    expect(Audit.findById).not.toHaveBeenCalled();
  });

  it('returns the asking lead, not the lead that ran a shared audit', async () => {
    const owner = { _id: new mongoose.Types.ObjectId(), businessId };
    vi.mocked(Lead.findById).mockReturnValue(exec(lead) as never);
    vi.mocked(findAuditForLead).mockResolvedValue({ _id: 'shared', leadId: owner._id, status: 'COMPLETED' } as never);
    const found = await findGenerationAudit(leadId.toString());
    expect(String(found!.lead._id)).toBe(String(leadId));
    expect(String(found!.audit.leadId)).toBe(String(owner._id));
  });

  it('uses the given audit when it is completed, with the lead that ran it', async () => {
    const exact = { _id: auditId, leadId, status: 'COMPLETED' };
    vi.mocked(Lead.findById).mockReturnValueOnce(exec(null) as never).mockReturnValueOnce(exec(lead) as never);
    vi.mocked(Audit.findById).mockReturnValue(exec(exact) as never);
    expect(await findGenerationAudit(auditId)).toEqual({ audit: exact, lead });
    expect(findAuditForLead).not.toHaveBeenCalled();
  });

  it("takes the newest completed audit for a failed audit's lead", async () => {
    vi.mocked(Lead.findById).mockReturnValueOnce(exec(null) as never).mockReturnValueOnce(exec(lead) as never);
    vi.mocked(Audit.findById).mockReturnValue(exec({ _id: auditId, leadId, status: 'FAILED' }) as never);
    vi.mocked(findAuditForLead).mockResolvedValue(newestCompleted as never);
    expect(await findGenerationAudit(auditId)).toEqual({ audit: newestCompleted, lead });
    expect(findAuditForLead).toHaveBeenCalledWith(lead, { completedOnly: true });
  });

  it('returns null for a non-ObjectId id without querying', async () => {
    expect(await findGenerationAudit('audit-abc')).toBeNull();
    expect(Lead.findById).not.toHaveBeenCalled();
    expect(Audit.findById).not.toHaveBeenCalled();
  });

  it('returns null when nothing matches: no lead, no audit, or no completed audit', async () => {
    vi.mocked(Lead.findById).mockReturnValue(exec(null) as never);
    vi.mocked(Audit.findById).mockReturnValue(exec(null) as never);
    expect(await findGenerationAudit(auditId)).toBeNull();
    vi.mocked(Lead.findById).mockReturnValue(exec(lead) as never);
    vi.mocked(findAuditForLead).mockResolvedValue(null);
    expect(await findGenerationAudit(leadId.toString())).toBeNull();
  });

  it('returns null when the audit\'s lead is gone', async () => {
    vi.mocked(Lead.findById).mockReturnValue(exec(null) as never);
    vi.mocked(Audit.findById).mockReturnValue(exec({ _id: auditId, leadId, status: 'COMPLETED' }) as never);
    expect(await findGenerationAudit(auditId)).toBeNull();
  });
});
