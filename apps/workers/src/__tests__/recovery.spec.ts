import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Lead } from '../models/Lead.model.js';
import { findAuditForLead } from '../models/Audit.model.js';
import { addAiGenerationJob } from '../queues/ai.queue.js';
import { recoverStalledAuditedLeads } from '../index.js';

vi.mock('../models/Lead.model.js');
vi.mock('../models/Audit.model.js');
vi.mock('../queues/ai.queue.js', () => ({ addAiGenerationJob: vi.fn().mockResolvedValue({ id: 'j' }), aiGenerationQueue: {} }));
vi.mock('../queues/connection.js', () => ({ redisConnection: { status: 'ready' } }));

describe('recoverStalledAuditedLeads (REV-210)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findAuditForLead).mockResolvedValue({ _id: 'audit-1' } as never);
  });

  it("queues each audited lead's generation with its own studio, and leaves a lead with no studio for the migration", async () => {
    const leads = [
      { _id: 'l1', tenantId: { toString: () => '5eed00000000000000000001' }, businessName: 'A' },
      { _id: 'l2', businessName: 'No studio' },
    ];
    vi.mocked(Lead.find).mockReturnValue({ exec: vi.fn().mockResolvedValue(leads) } as never);
    expect(await recoverStalledAuditedLeads()).toBe(1);
    expect(addAiGenerationJob).toHaveBeenCalledTimes(1);
    expect(addAiGenerationJob).toHaveBeenCalledWith({ leadId: 'l1', tenantId: '5eed00000000000000000001', auditId: 'audit-1' });
  });
});
