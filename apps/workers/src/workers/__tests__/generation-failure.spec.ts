import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGenerationFailure, statusAfterFailedGeneration } from '../generation-failure.js';
import { Lead } from '../../models/Lead.model.js';

vi.mock('../../models/Lead.model.js');

describe('MVP generation failure handling (REV-31)', () => {
  const exec = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    exec.mockResolvedValue({ _id: 'lead-1' });
    vi.mocked(Lead.findOneAndUpdate).mockReturnValue({ exec } as any);
  });

  const job = (data: Record<string, unknown>, attemptsMade: number, attempts = 3) =>
    ({ id: 'job-1', data, attemptsMade, opts: { attempts } }) as any;

  it('sends a first-time generation back to AUDITED and a regeneration back to review', () => {
    expect(statusAfterFailedGeneration(undefined)).toBe('AUDITED');
    expect(statusAfterFailedGeneration('AUDITED')).toBe('AUDITED');
    expect(statusAfterFailedGeneration('NEEDS_APPROVAL')).toBe('NEEDS_APPROVAL');
    expect(statusAfterFailedGeneration('MVP_READY')).toBe('NEEDS_APPROVAL');
    // Never restores an approved state without a fresh operator review
    expect(statusAfterFailedGeneration('APPROVED')).toBe('NEEDS_APPROVAL');
  });

  it('does nothing while BullMQ still has retries left', async () => {
    await handleGenerationFailure(job({ leadId: 'lead-1' }, 2), new Error('LLM timeout'), 'content');
    expect(Lead.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('resets a lead still GENERATING and records the error after the last attempt', async () => {
    await handleGenerationFailure(
      job({ leadId: 'lead-1', previousStatus: 'NEEDS_APPROVAL' }, 3),
      new Error('S3 upload refused'),
      'deploy',
    );

    expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'lead-1', status: 'GENERATING' },
      { $set: { status: 'NEEDS_APPROVAL', generationError: 'MVP deploy failed: S3 upload refused' } },
    );
  });

  it('returns a failed first generation to AUDITED so it can be retried', async () => {
    await handleGenerationFailure(job({ leadId: 'lead-1', previousStatus: 'AUDITED' }, 1, 1), new Error('boom'), 'content');

    expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'lead-1', status: 'GENERATING' },
      { $set: { status: 'AUDITED', generationError: 'MVP content failed: boom' } },
    );
  });

  it('truncates long error messages', async () => {
    await handleGenerationFailure(job({ leadId: 'lead-1' }, 3), new Error('x'.repeat(1000)), 'content');
    const update = vi.mocked(Lead.findOneAndUpdate).mock.calls[0]![1] as { $set: { generationError: string } };
    expect(update.$set.generationError.length).toBe(300);
  });

  it('ignores a missing job and never throws when the update fails', async () => {
    await expect(handleGenerationFailure(undefined, new Error('x'), 'content')).resolves.toBeUndefined();
    exec.mockRejectedValueOnce(new Error('Mongo down'));
    await expect(handleGenerationFailure(job({ leadId: 'lead-1' }, 3), new Error('x'), 'deploy')).resolves.toBeUndefined();
  });
});
