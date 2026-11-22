import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUDIT_ENQUEUE_TIMEOUT_MS, AUDIT_QUEUE_ERROR, enqueueAuditOrFail } from '../audit-enqueue.js';
import { Lead } from '../../models/Lead.model.js';
import { Audit } from '../../models/Audit.model.js';
import * as auditQueueModule from '../../queues/audit.queue.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { scopeFor } from '../../data/tenant-scope.js';

vi.mock('../../data/tenant-scope.js', async () => (await import('../../__tests__/scope-passthrough.js')).tenantScopeMock());
vi.mock('../../models/Lead.model.js');
vi.mock('../../models/Audit.model.js');
vi.mock('../../queues/audit.queue.js');
const redis = vi.hoisted(() => ({ status: 'ready' }));
vi.mock('../../queues/connection.js', () => ({ redisConnection: redis }));

const params = { leadId: 'lead-1', auditId: 'audit-1', url: 'https://a.lt', niche: 'dental' as const };
const exec = (value: unknown) => ({ exec: () => Promise.resolve(value) }) as any;
const isQueueError = (e: unknown) =>
  e instanceof AppError &&
  e.statusCode === 503 &&
  e.code === 'AUDIT_QUEUE_UNAVAILABLE' &&
  (e.details as { leadId?: string } | undefined)?.leadId === 'lead-1';

const scope = scopeFor('5eed00000000000000000001');

describe('enqueueAuditOrFail (REV-202)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redis.status = 'ready';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(Lead.findOneAndUpdate).mockReturnValue(exec({ _id: 'lead-1' }));
    vi.mocked(Audit.updateOne).mockReturnValue(exec({ modifiedCount: 1 }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queues the job and returns its id', async () => {
    vi.mocked(auditQueueModule.addAuditJob).mockResolvedValue({ id: 'job-1' } as any);
    await expect(enqueueAuditOrFail(scope, params)).resolves.toEqual({ jobId: 'job-1' });
    expect(auditQueueModule.addAuditJob).toHaveBeenCalledWith({ leadId: 'lead-1', url: 'https://a.lt', niche: 'dental' });
    expect(Lead.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('moves the lead to AUDIT_FAILED through the state machine and fails the audit when queueing fails', async () => {
    vi.mocked(auditQueueModule.addAuditJob).mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(enqueueAuditOrFail(scope, params)).rejects.toSatisfy(isQueueError);
    expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
      // QUEUED only: a lead a worker already took (the job did land) keeps its running audit
      { _id: 'lead-1', status: 'QUEUED' },
      { $set: { status: 'AUDIT_FAILED', auditError: AUDIT_QUEUE_ERROR } },
    );
    expect(Audit.updateOne).toHaveBeenCalledWith(
      { _id: 'audit-1', status: 'QUEUED' },
      { $set: { status: 'FAILED', errorMessage: AUDIT_QUEUE_ERROR } },
    );
  });

  it('gives up after the timeout when Redis never answers', async () => {
    vi.useFakeTimers();
    vi.mocked(auditQueueModule.addAuditJob).mockReturnValue(new Promise(() => {}) as any);
    const result = enqueueAuditOrFail(scope, params);
    const settled = expect(result).rejects.toSatisfy(isQueueError);
    await vi.advanceTimersByTimeAsync(AUDIT_ENQUEUE_TIMEOUT_MS);
    await settled;
    expect(AUDIT_ENQUEUE_TIMEOUT_MS).toBe(5000);
    expect(Lead.findOneAndUpdate).toHaveBeenCalled();
  });

  it('fails at once without queueing when Redis is not connected, so no job can land later', async () => {
    redis.status = 'reconnecting';
    await expect(enqueueAuditOrFail(scope, params)).rejects.toSatisfy(isQueueError);
    expect(auditQueueModule.addAuditJob).not.toHaveBeenCalled();
    expect(Lead.findOneAndUpdate).toHaveBeenCalledWith({ _id: 'lead-1', status: 'QUEUED' }, expect.anything());
  });

  it('still answers 503 when the lead already moved on (a late job picked it up)', async () => {
    vi.mocked(auditQueueModule.addAuditJob).mockRejectedValue(new Error('down'));
    vi.mocked(Lead.findOneAndUpdate).mockReturnValue(exec(null));
    await expect(enqueueAuditOrFail(scope, params)).rejects.toSatisfy(isQueueError);
    expect(Audit.updateOne).toHaveBeenCalledWith(expect.objectContaining({ status: 'QUEUED' }), expect.anything());
  });

  it('still answers 503 when marking the lead failed throws too', async () => {
    vi.mocked(auditQueueModule.addAuditJob).mockRejectedValue(new Error('down'));
    vi.mocked(Lead.findOneAndUpdate).mockReturnValue({ exec: () => Promise.reject(new Error('mongo down')) } as any);
    await expect(enqueueAuditOrFail(scope, params)).rejects.toSatisfy(isQueueError);
  });
});
