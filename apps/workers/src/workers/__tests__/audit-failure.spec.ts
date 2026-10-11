import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STALLED_AUDIT_MESSAGE, handleAuditJobFailed, isFinalAuditAttempt, markLeadAuditFailed } from '../audit-failure.js';
import { Audit } from '../../models/Audit.model.js';
import { Lead } from '../../models/Lead.model.js';

vi.mock('../../models/Audit.model.js', () => ({
  Audit: { findOneAndUpdate: vi.fn() },
}));
vi.mock('../../models/Lead.model.js', () => ({
  Lead: { findOneAndUpdate: vi.fn() },
}));

const job = (attemptsMade: number, attempts?: number) =>
  ({ data: { leadId: 'lead-1', url: 'https://a.example', niche: 'dental' }, attemptsMade, opts: { attempts } }) as any;

describe('audit failure handling (REV-44)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Lead.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue({}) } as any);
    vi.mocked(Audit.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue({}) } as any);
  });

  describe('isFinalAuditAttempt', () => {
    it('is false while retries remain', () => {
      expect(isFinalAuditAttempt(job(0, 3), false)).toBe(false);
      expect(isFinalAuditAttempt(job(1, 3), false)).toBe(false);
    });

    it('is true on the last attempt', () => {
      expect(isFinalAuditAttempt(job(2, 3), false)).toBe(true);
    });

    it('is true for a permanent error on any attempt', () => {
      expect(isFinalAuditAttempt(job(0, 3), true)).toBe(true);
    });

    it('treats a job without an attempts option as a single attempt', () => {
      expect(isFinalAuditAttempt(job(0), false)).toBe(true);
    });
  });

  describe('markLeadAuditFailed', () => {
    it('moves only a lead still in AUDITING to AUDIT_FAILED', async () => {
      await markLeadAuditFailed(job(2, 3), 'net::ERR_CERT_DATE_INVALID');
      expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'lead-1', status: { $in: ['AUDITING'] } },
        { $set: { status: 'AUDIT_FAILED', auditError: 'net::ERR_CERT_DATE_INVALID' } },
      );
    });

    it('never throws when the database update fails', async () => {
      vi.mocked(Lead.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockRejectedValue(new Error('mongo down')) } as any);
      await expect(markLeadAuditFailed(job(2, 3), 'boom')).resolves.toBeUndefined();
    });
  });

  describe('handleAuditJobFailed (REV-145)', () => {
    const stalled = new Error('job stalled more than allowable limit');

    it('closes the running audit and moves the lead to AUDIT_FAILED when the job stalled out', async () => {
      await handleAuditJobFailed(job(0, 3), stalled);
      expect(Audit.findOneAndUpdate).toHaveBeenCalledWith(
        { leadId: 'lead-1', status: { $in: ['QUEUED', 'PROCESSING'] } },
        { status: 'FAILED', errorMessage: STALLED_AUDIT_MESSAGE },
        { sort: { createdAt: -1 } },
      );
      expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'lead-1', status: { $in: ['AUDITING'] } },
        { $set: { status: 'AUDIT_FAILED', auditError: STALLED_AUDIT_MESSAGE } },
      );
    });

    it('ignores a failure raised inside the processor, which already handled it', async () => {
      await handleAuditJobFailed(job(2, 3), new Error('net::ERR_NAME_NOT_RESOLVED'));
      expect(Audit.findOneAndUpdate).not.toHaveBeenCalled();
      expect(Lead.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('ignores a failure without a job', async () => {
      await handleAuditJobFailed(undefined, stalled);
      expect(Lead.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('still moves the lead when closing the audit fails, and never throws', async () => {
      vi.mocked(Audit.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockRejectedValue(new Error('mongo down')) } as any);
      await expect(handleAuditJobFailed(job(0, 3), stalled)).resolves.toBeUndefined();
      expect(Lead.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });
  });
});
