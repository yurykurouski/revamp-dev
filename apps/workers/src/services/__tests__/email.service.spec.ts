import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { Organization } from '@revamp/db';
import { loadStudioSender, simulateDelivery } from '../email.service.js';
import { env } from '../../config/env.js';

vi.mock('@revamp/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@revamp/db')>();
  return { ...actual, Organization: { findById: vi.fn() } };
});

const sender = { name: 'Studio A', address: 'a@studio-a.test' };

describe('simulated email delivery (REV-221)', () => {
  describe('simulateDelivery', () => {
    it('renders the message with the studio sender, the compliance headers, footer and pixel, using PUBLIC_API_URL', () => {
      const message = simulateDelivery({
        sender,
        to: 'director@listonosz.site',
        subject: 'Audit and an updated version of the Listonosz website',
        html: '<p>Hello! We prepared a prototype for you.</p>',
        text: 'Hello! We prepared a prototype for you.',
        trackingToken: 'token-abc-123',
      });
      const base = env.PUBLIC_API_URL.replace(/\/$/, '');

      expect(message.from).toBe('"Studio A" <a@studio-a.test>');
      expect(message.to).toBe('director@listonosz.site');
      expect(message.headers['List-Unsubscribe']).toContain(`${base}/track/unsubscribe/token-abc-123`);
      expect(message.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      expect(message.html).toContain('Unsubscribe in one click');
      expect(message.html).toContain(`${base}/track/open/token-abc-123.gif`);
      expect(message.text).toContain('Unsubscribe in one click:');
    });

    it('leaves out the open pixel but keeps the footer when trackOpens is false (REV-60)', () => {
      const message = simulateDelivery({ sender, to: 'op@revamp.io', subject: 'Test', html: '<p>Hello</p>', text: 'Hello', trackingToken: 'test-send', trackOpens: false });
      expect(message.html).not.toContain('/track/open/');
      expect(message.html).toContain('Unsubscribe in one click');
    });

    it('does not call the network', () => {
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      simulateDelivery({ sender, to: 'a@b.test', subject: 's', html: '<p>h</p>', trackingToken: 't' });
      expect(fetch).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });

  describe('loadStudioSender', () => {
    const tenant = new Types.ObjectId();
    const mockOrganization = (organization: unknown) =>
      vi.mocked(Organization.findById).mockReturnValue({ lean: () => ({ exec: vi.fn().mockResolvedValue(organization) }) } as never);
    beforeEach(() => vi.clearAllMocks());

    it("reads the studio's own organization and returns its sender", async () => {
      mockOrganization({ sender });
      await expect(loadStudioSender(tenant)).resolves.toEqual(sender);
      expect(Organization.findById).toHaveBeenCalledWith(tenant, { sender: 1 });
    });

    it.each([['no organization', null], ['no sender', {}], ['a half-set sender', { sender: { name: 'Studio A' } }]])(
      'returns null for %s',
      async (_label, organization) => {
        mockOrganization(organization);
        await expect(loadStudioSender(tenant)).resolves.toBeNull();
      },
    );
  });
});
