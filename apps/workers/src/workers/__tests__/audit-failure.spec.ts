import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isFinalAuditAttempt, markLeadAuditFailed } from '../audit-failure.js';
import { Lead } from '../../models/Lead.model.js';

vi.mock('../../models/Lead.model.js', () => ({
  Lead: { findOneAndUpdate: vi.fn() },
}));

const job = (attemptsMade: number, attempts?: number) =>
  ({ data: { leadId: 'lead-1', url: 'https://a.example', niche: 'dental' }, attemptsMade, opts: { attempts } }) as any;

describe('audit failure handling (REV-44)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Lead.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockResolvedValue({}) } as any);
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
        { _id: 'lead-1', status: 'AUDITING' },
        { $set: { status: 'AUDIT_FAILED', auditError: 'net::ERR_CERT_DATE_INVALID' } },
      );
    });

    it('never throws when the database update fails', async () => {
      vi.mocked(Lead.findOneAndUpdate).mockReturnValue({ exec: vi.fn().mockRejectedValue(new Error('mongo down')) } as any);
      await expect(markLeadAuditFailed(job(2, 3), 'boom')).resolves.toBeUndefined();
    });
  });
});
