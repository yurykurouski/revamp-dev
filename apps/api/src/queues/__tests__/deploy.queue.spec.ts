import { describe, it, expect, vi } from 'vitest';

const add = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'job-1' }));
vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(function () {
    return { add, close: vi.fn() };
  }),
}));
vi.mock('../connection.js', () => ({ redisConnection: {} }));

const { addMvpRelayoutJob, RELAYOUT_DEBOUNCE_MS } = await import('../deploy.queue.js');

describe('addMvpRelayoutJob (REV-84)', () => {
  it('queues a relayout of the MVP, debounced per MVP', async () => {
    await addMvpRelayoutJob({ leadId: 'lead-1', auditId: 'audit-1', mvpProjectId: 'mvp-1' });

    expect(add).toHaveBeenCalledWith(
      'relayout-mvp',
      { leadId: 'lead-1', auditId: 'audit-1', mvpProjectId: 'mvp-1', mode: 'relayout' },
      {
        delay: RELAYOUT_DEBOUNCE_MS,
        deduplication: { id: 'relayout-mvp-1', ttl: RELAYOUT_DEBOUNCE_MS, extend: true, replace: true },
      },
    );
  });

  it('keeps separate MVPs apart', async () => {
    add.mockClear();
    await addMvpRelayoutJob({ leadId: 'lead-2', auditId: 'audit-2', mvpProjectId: 'mvp-2' });
    expect(add.mock.calls[0]![2].deduplication.id).toBe('relayout-mvp-2');
  });
});
