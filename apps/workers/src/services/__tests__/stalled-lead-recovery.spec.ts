import { beforeEach, describe, expect, it, vi } from 'vitest';

const leadFind = vi.fn();
const leadCount = vi.fn();
const findAuditForLead = vi.fn();
const addAiGenerationJob = vi.fn();

vi.mock('../../models/Lead.model.js', () => ({
  Lead: { find: (...a: unknown[]) => leadFind(...a), countDocuments: (...a: unknown[]) => leadCount(...a) },
}));
vi.mock('../../models/Audit.model.js', () => ({ findAuditForLead: (...a: unknown[]) => findAuditForLead(...a) }));
vi.mock('../../queues/ai.queue.js', () => ({ addAiGenerationJob: (...a: unknown[]) => addAiGenerationJob(...a) }));

const { recoverStalledAuditedLeads } = await import('../stalled-lead-recovery.js');
const { skippedDemoLeadFilter, stalledAuditedLeadFilter } = await import('@revamp/db');

const exec = <T>(value: T) => ({ exec: () => Promise.resolve(value) });
const TENANT = '5eed00000000000000000001';
const lead = (id: string, businessName = `Lead ${id}`, tenantId: string | undefined = TENANT) => ({
  _id: { toString: () => id },
  businessName,
  ...(tenantId ? { tenantId: { toString: () => tenantId } } : {}),
});

describe('recoverStalledAuditedLeads (REV-204, REV-210)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    leadCount.mockReturnValue(exec(0));
    addAiGenerationJob.mockResolvedValue(undefined);
  });

  it('reads leads through the filter that leaves seeded demo leads out', async () => {
    leadFind.mockReturnValue(exec([]));
    await recoverStalledAuditedLeads();
    expect(leadFind).toHaveBeenCalledWith(stalledAuditedLeadFilter());
    expect(stalledAuditedLeadFilter()).toEqual({ status: 'AUDITED', tags: { $ne: 'demo-seed' } });
  });

  it('queues a lead with a completed audit and skips one without', async () => {
    leadFind.mockReturnValue(exec([lead('a'), lead('b')]));
    findAuditForLead.mockResolvedValueOnce({ _id: { toString: () => 'audit-a' } }).mockResolvedValueOnce(null);
    expect(await recoverStalledAuditedLeads()).toBe(1);
    expect(findAuditForLead).toHaveBeenCalledWith(expect.objectContaining({ businessName: 'Lead a' }), { completedOnly: true });
    expect(addAiGenerationJob).toHaveBeenCalledTimes(1);
    expect(addAiGenerationJob).toHaveBeenCalledWith({ leadId: 'a', tenantId: TENANT, auditId: 'audit-a' });
  });

  it("queues each lead with its own studio and leaves a lead with no studio for the migration", async () => {
    leadFind.mockReturnValue(exec([lead('l1'), lead('l2', 'No studio', undefined)]));
    findAuditForLead.mockResolvedValue({ _id: { toString: () => 'audit-1' } });
    expect(await recoverStalledAuditedLeads()).toBe(1);
    expect(addAiGenerationJob).toHaveBeenCalledTimes(1);
    expect(addAiGenerationJob).toHaveBeenCalledWith({ leadId: 'l1', tenantId: TENANT, auditId: 'audit-1' });
  });

  it('logs how many demo leads it left alone', async () => {
    leadFind.mockReturnValue(exec([]));
    leadCount.mockReturnValue(exec(2));
    expect(await recoverStalledAuditedLeads()).toBe(0);
    expect(leadCount).toHaveBeenCalledWith(skippedDemoLeadFilter());
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Skipped 2 demo leads (demo-seed)'));
    expect(addAiGenerationJob).not.toHaveBeenCalled();
  });

  it('says nothing about demo leads when there are none', async () => {
    leadFind.mockReturnValue(exec([]));
    await recoverStalledAuditedLeads();
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('demo leads'));
  });

  it('returns 0 and logs when the lookup fails', async () => {
    leadFind.mockReturnValue({ exec: () => Promise.reject(new Error('mongo down')) });
    expect(await recoverStalledAuditedLeads()).toBe(0);
    expect(console.error).toHaveBeenCalled();
  });
});
