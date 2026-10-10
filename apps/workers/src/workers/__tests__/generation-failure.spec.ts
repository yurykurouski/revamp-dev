import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGenerationFailure, statusAfterFailedGeneration } from '../generation-failure.js';
import { canTransition } from '@revamp/validation';
import { Lead } from '../../models/Lead.model.js';
import { MvpPageUnavailableError } from '../ai.worker.js';

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
  });

  it('only resets to a status the lead may move to from GENERATING (REV-62)', () => {
    for (const previous of [undefined, 'AUDITED', 'NEEDS_APPROVAL'] as const) {
      expect(canTransition('GENERATING', statusAfterFailedGeneration(previous))).toBe(true);
    }
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

  it('records a render failure at once, with its code and reason, without waiting for retries (REV-132)', async () => {
    const at = new Date('2026-10-04T12:00:00Z');
    const err = Object.assign(new Error('MVP_MODERNIZE_UNAVAILABLE: not_configured'), {
      name: 'UnrecoverableError',
      failure: { code: 'MVP_MODERNIZE_UNAVAILABLE', reason: 'not_configured', level: 'modern', at },
    });
    await handleGenerationFailure(job({ leadId: 'lead-1' }, 1), err, 'deploy');
    expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'lead-1', status: 'GENERATING' },
      {
        $set: {
          status: 'AUDITED',
          generationError: 'MVP deploy failed: MVP_MODERNIZE_UNAVAILABLE: not_configured',
          generationFailure: { code: 'MVP_MODERNIZE_UNAVAILABLE', reason: 'not_configured', level: 'modern', at },
        },
      },
    );
  });

  it('records a page the model could not make at once, from the ai worker (REV-138)', async () => {
    const at = new Date('2026-10-10T12:00:00Z');
    const failure = { code: 'MVP_PAGE_UNAVAILABLE', reason: 'invalid_page', message: 'rejected twice', at };
    const err = Object.assign(new Error('rejected twice'), { name: 'UnrecoverableError', failure });
    await handleGenerationFailure(job({ leadId: 'lead-1', previousStatus: 'AUDITED' }, 3), err, 'content');
    expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'lead-1', status: 'GENERATING' },
      { $set: { status: 'AUDITED', generationError: 'MVP content failed: rejected twice', generationFailure: failure } },
    );
  });

  it('resets the lead at once for the real page error on its first attempt (review, REV-138)', async () => {
    const failure = { code: 'MVP_PAGE_UNAVAILABLE' as const, reason: 'invalid_page' as const, message: 'rejected twice', at: new Date('2026-10-10T12:00:00Z') };
    // The real bullmq class: its constructor names the error after the subclass
    await handleGenerationFailure(job({ leadId: 'lead-1', previousStatus: 'AUDITED' }, 1), new MvpPageUnavailableError(failure), 'content');
    expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'lead-1', status: 'GENERATING' },
      { $set: { status: 'AUDITED', generationError: 'MVP content failed: rejected twice', generationFailure: failure } },
    );
  });

  it('treats any final error BullMQ will not retry as the last attempt', async () => {
    const err = Object.assign(new Error('boom'), { name: 'UnrecoverableError' });
    await handleGenerationFailure(job({ leadId: 'lead-1' }, 1), err, 'deploy');
    expect(Lead.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'lead-1', status: 'GENERATING' },
      { $set: { status: 'AUDITED', generationError: 'MVP deploy failed: boom' } },
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
