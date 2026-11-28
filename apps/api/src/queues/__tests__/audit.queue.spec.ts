import { beforeEach, describe, expect, it, vi } from 'vitest';

const { add } = vi.hoisted(() => ({ add: vi.fn().mockResolvedValue({ id: 'j' }) }));
vi.mock('bullmq', () => ({ Queue: vi.fn().mockImplementation(function () { return { add }; }) }));
vi.mock('../connection.js', () => ({ redisConnection: {} }));

import { addAuditJob, addPlatformAuditJob } from '../audit.queue.js';

describe('audit queue (REV-232)', () => {
  beforeEach(() => add.mockClear());

  it('queues a platform audit under its own name with one job id per audit, so a repeated add is deduplicated', async () => {
    const data = { auditId: 'a1', businessId: 'b1', url: 'https://x.example', niche: 'dental' as const };
    await addPlatformAuditJob(data);
    expect(add).toHaveBeenCalledWith('platform-audit', data, { jobId: 'platform-audit-a1' });
  });

  it('keeps the lead audit job name and gives it no custom job id', async () => {
    const data = { tenantId: 't', leadId: 'l1', url: 'https://x.example', niche: 'dental' as const };
    await addAuditJob(data);
    expect(add).toHaveBeenCalledWith('audit-website', data);
  });
});
