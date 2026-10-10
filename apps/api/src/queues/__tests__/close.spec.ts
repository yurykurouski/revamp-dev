import { describe, it, expect, vi } from 'vitest';

const queue = (name: string) => ({ name, close: vi.fn().mockResolvedValue(undefined) });
const queues = vi.hoisted(() => ({}) as Record<string, { name: string; close: ReturnType<typeof vi.fn> }>);

vi.mock('../audit.queue.js', () => ({ auditQueue: (queues.audit = queue('audit')) }));
vi.mock('../ai.queue.js', () => ({ aiGenerationQueue: (queues.ai = queue('ai')) }));
vi.mock('../deploy.queue.js', () => ({ deployQueue: (queues.deploy = queue('deploy')) }));
vi.mock('../email.queue.js', () => ({ emailQueue: (queues.email = queue('email')) }));
vi.mock('../discovery.queue.js', () => ({ discoveryQueue: (queues.discovery = queue('discovery')) }));
const closeEmailTestEvents = vi.hoisted(() => vi.fn());
vi.mock('../email-test.queue.js', () => ({
  emailTestQueue: (queues.emailTest = queue('email-test')),
  closeEmailTestEvents,
}));
const closeMvpPageEvents = vi.hoisted(() => vi.fn());
vi.mock('../mvp-page.queue.js', () => ({
  mvpPageQueue: (queues.mvpPage = queue('mvp-page')),
  closeMvpPageEvents,
}));

const { closeQueues } = await import('../close.js');

describe('closeQueues (REV-66)', () => {
  it('closes every queue the API produces to and the email-test and MVP-edit QueueEvents', async () => {
    closeEmailTestEvents.mockResolvedValue(undefined);
    closeMvpPageEvents.mockResolvedValue(undefined);
    await closeQueues();

    for (const q of Object.values(queues)) expect(q.close).toHaveBeenCalledTimes(1);
    expect(Object.keys(queues)).toHaveLength(7);
    expect(closeEmailTestEvents).toHaveBeenCalledTimes(1);
    expect(closeMvpPageEvents).toHaveBeenCalledTimes(1);
  });

  it('rejects when a queue fails to close', async () => {
    queues.audit!.close.mockRejectedValueOnce(new Error('boom'));
    await expect(closeQueues()).rejects.toThrow('boom');
  });
});
