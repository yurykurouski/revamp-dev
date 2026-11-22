import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Audit, auditBelongsToLead, findAuditForLead } from '../../models/Audit.model.js';
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
    vi.mocked(auditBelongsToLead).mockReset();
    vi.mocked(Lead.countDocuments).mockReset();
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
  describe('with the lead the request is for (REV-208 review)', () => {
    const sharedAuditId = new mongoose.Types.ObjectId().toString();
    const ownerLead = new mongoose.Types.ObjectId();

    it('returns the asking lead for an audit id another lead ran, when the audit is the lead\'s own or its business\'s', async () => {
      vi.mocked(Lead.findById).mockReturnValue(exec(lead) as never);
      const shared = { _id: sharedAuditId, leadId: ownerLead, status: 'COMPLETED' };
      vi.mocked(Audit.findById).mockReturnValue(exec(shared) as never);
      vi.mocked(auditBelongsToLead).mockResolvedValue(true);
      const found = await findGenerationAudit(sharedAuditId, leadId.toString());
      expect(found).toEqual({ audit: shared, lead });
      expect(auditBelongsToLead).toHaveBeenCalledWith(sharedAuditId, lead);
    });

    it('does not build a lead from an audit that belongs to neither it nor its business: the lead\'s own completed audit instead', async () => {
      vi.mocked(Lead.findById).mockReturnValue(exec(lead) as never);
      vi.mocked(Audit.findById).mockReturnValue(exec({ _id: sharedAuditId, leadId: ownerLead, status: 'COMPLETED' }) as never);
      vi.mocked(auditBelongsToLead).mockResolvedValue(false);
      vi.mocked(findAuditForLead).mockResolvedValue(newestCompleted as never);
      expect(await findGenerationAudit(sharedAuditId, leadId.toString())).toEqual({ audit: newestCompleted, lead });
    });

    it('is null when the lead does not exist', async () => {
      vi.mocked(Lead.findById).mockReturnValue(exec(null) as never);
      expect(await findGenerationAudit(sharedAuditId, leadId.toString())).toBeNull();
    });

    it('answers a lead id in the audit position with the same lead as when it is given as the lead', async () => {
      vi.mocked(Lead.findById).mockReturnValue(exec(lead) as never);
      vi.mocked(findAuditForLead).mockResolvedValue(newestCompleted as never);
      expect(await findGenerationAudit(leadId.toString(), leadId.toString())).toEqual({ audit: newestCompleted, lead });
    });
  });

  describe('an audit id alone, with no lead named (an older client)', () => {
    it('refuses an audit that more than one lead reads: whose lead it is cannot be told', async () => {
      const businessId = new mongoose.Types.ObjectId();
      const shared = { _id: auditId, leadId, businessId, status: 'COMPLETED' };
      vi.mocked(Lead.findById).mockReturnValueOnce(exec(null) as never).mockReturnValueOnce(exec(lead) as never);
      vi.mocked(Audit.findById).mockReturnValue(exec(shared) as never);
      vi.mocked(Lead.countDocuments).mockReturnValue(exec(2) as never);
      expect(await findGenerationAudit(auditId)).toBeNull();
      expect(Lead.countDocuments).toHaveBeenCalledWith({ businessId });
    });

    it('still builds from an audit only one lead reads', async () => {
      const businessId = new mongoose.Types.ObjectId();
      const own = { _id: auditId, leadId, businessId, status: 'COMPLETED' };
      vi.mocked(Lead.findById).mockReturnValueOnce(exec(null) as never).mockReturnValueOnce(exec(lead) as never);
      vi.mocked(Audit.findById).mockReturnValue(exec(own) as never);
      vi.mocked(Lead.countDocuments).mockReturnValue(exec(1) as never);
      expect(await findGenerationAudit(auditId)).toEqual({ audit: own, lead });
    });

    it('does not count leads for an audit with no business (made before the split)', async () => {
      const legacy = { _id: auditId, leadId, status: 'COMPLETED' };
      vi.mocked(Lead.findById).mockReturnValueOnce(exec(null) as never).mockReturnValueOnce(exec(lead) as never);
      vi.mocked(Audit.findById).mockReturnValue(exec(legacy) as never);
      expect(await findGenerationAudit(auditId)).toEqual({ audit: legacy, lead });
      expect(Lead.countDocuments).not.toHaveBeenCalled();
    });
  });
});
