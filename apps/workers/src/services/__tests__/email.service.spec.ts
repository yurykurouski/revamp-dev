import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createEmailProvider,
  EMAIL_PROVIDER_NOT_CONFIGURED,
  EmailService,
  IEmailProvider,
  ISendEmailOptions,
  ISendEmailResult,
  ResendEmailProvider,
  SendGridEmailProvider,
  SmtpEmailProvider,
} from '../email.service.js';

/** Test double that records what EmailService hands to a provider */
class RecordingEmailProvider implements IEmailProvider {
  public name = 'recording';
  public sentMessages: ISendEmailOptions[] = [];

  async send(options: ISendEmailOptions): Promise<ISendEmailResult> {
    this.sentMessages.push(options);
    return { success: true, messageId: `recorded-${this.sentMessages.length}`, provider: this.name, sentAt: new Date() };
  }
}

describe('EmailService & Providers (@revamp/workers)', () => {
  let mockProvider: RecordingEmailProvider;
  let service: EmailService;

  beforeEach(() => {
    mockProvider = new RecordingEmailProvider();
    service = new EmailService(mockProvider);
  });

  describe('provider configuration (REV-45)', () => {
    it('creates the provider EMAIL_PROVIDER names', () => {
      expect(createEmailProvider('resend')).toBeInstanceOf(ResendEmailProvider);
      expect(createEmailProvider('sendgrid')).toBeInstanceOf(SendGridEmailProvider);
      expect(createEmailProvider('smtp')).toBeInstanceOf(SmtpEmailProvider);
    });

    it('has no provider, and no mock fallback, when EMAIL_PROVIDER is unset', () => {
      expect(createEmailProvider(undefined)).toBeNull();
      expect(new EmailService(null).getProvider()).toBeNull();
    });

    it('fails the dispatch instead of pretending the email was sent', async () => {
      const unconfigured = new EmailService(null);
      await expect(
        unconfigured.sendEmail({ to: 'owner@smile.pl', subject: 's', html: '<p>h</p>', trackingToken: 't' }),
      ).rejects.toThrow(EMAIL_PROVIDER_NOT_CONFIGURED);
    });

    it('uses a provider set later', async () => {
      const unconfigured = new EmailService(null);
      unconfigured.setProvider(mockProvider);
      await expect(
        unconfigured.sendEmail({ to: 'owner@smile.pl', subject: 's', html: '<p>h</p>', trackingToken: 't' }),
      ).resolves.toMatchObject({ success: true, provider: 'recording' });
    });
  });

  describe('Compliance Injections', () => {
    it('should successfully send email with compliance headers, footer and tracking pixel', async () => {
      const result = await service.sendEmail({
        to: 'director@listonosz.site',
        subject: 'Audit and an updated version of the Listonosz website',
        html: '<p>Hello! We prepared a prototype for you.</p>',
        text: 'Hello! We prepared a prototype for you.',
        trackingToken: 'token-abc-123',
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe('recording');
      expect(result.messageId).toBe('recorded-1');
      expect(mockProvider.sentMessages).toHaveLength(1);

      const sent = mockProvider.sentMessages[0]!;
      expect(sent.to).toBe('director@listonosz.site');
      expect(sent.subject).toBe('Audit and an updated version of the Listonosz website');

      // Verify RFC 8058 & RFC 2369 compliance headers
      expect(sent.headers).toBeDefined();
      expect(sent.headers!['List-Unsubscribe']).toContain('token-abc-123');
      expect(sent.headers!['List-Unsubscribe']).toContain('mailto:unsubscribe@');
      expect(sent.headers!['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

      // Verify HTML 1-click unsubscribe footer
      expect(sent.html).toContain('Unsubscribe in one click');
      expect(sent.html).toContain('/track/unsubscribe/token-abc-123');

      // Verify 1x1 tracking pixel injection (REV-18)
      expect(sent.html).toContain('/track/open/token-abc-123.gif');
      expect(sent.html).toContain('width="1" height="1"');

      // Verify plain text 1-click unsubscribe footer
      expect(sent.text).toContain('Unsubscribe in one click:');
      expect(sent.text).toContain('/track/unsubscribe/token-abc-123');
    });

    it('leaves out the tracking pixel but keeps the footer when trackOpens is false (REV-60)', async () => {
      await service.sendEmail({
        to: 'operator@revamp.io',
        subject: 'Test',
        html: '<p>Hello</p>',
        text: 'Hello',
        trackingToken: 'test-send',
        trackOpens: false,
      });

      const sent = mockProvider.sentMessages[0]!;
      expect(sent.html).not.toContain('/track/open/');
      expect(sent.html).toContain('Unsubscribe in one click');
    });

    it('should not duplicate unsubscribe footer if it is already present in HTML and text', async () => {
      const customUnsubscribe = 'http://localhost:4000/api/v1/track/unsubscribe/token-xyz';
      const existingHtml = `<p>Email text</p><a href="${customUnsubscribe}">Unsubscribe</a><img src="http://localhost:4000/api/v1/track/open/token-xyz.gif" width="1" height="1" style="display:none;" alt="" />`;
      const existingText = `Email text. Unsubscribe: ${customUnsubscribe}`;

      await service.sendEmail({
        to: 'user@example.com',
        subject: 'Test existing footer',
        html: existingHtml,
        text: existingText,
        trackingToken: 'token-xyz',
      });

      const sent = mockProvider.sentMessages[0]!;
      expect(sent.html).toBe(existingHtml);
      expect(sent.text).toBe(existingText);
    });
  });

  describe('ResendEmailProvider', () => {
    it('should post correctly formatted payload to Resend API endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'resend-msg-123' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const resend = new ResendEmailProvider('re_test_key_123');
      const res = await resend.send({
        to: 'client@company.com',
        from: 'Revamp <outreach@revampdemo.com>',
        subject: 'A new website for your company',
        html: '<h1>Heading</h1>',
        trackingToken: 'resend-tok',
        headers: { 'List-Unsubscribe': '<https://test/unsub>' },
      });

      expect(res.success).toBe(true);
      expect(res.messageId).toBe('resend-msg-123');
      expect(res.provider).toBe('resend');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer re_test_key_123',
            'Content-Type': 'application/json',
          }),
        }),
      );

      vi.unstubAllGlobals();
    });

    it('should throw error when Resend API returns error status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Domain not verified',
      });
      vi.stubGlobal('fetch', mockFetch);

      const resend = new ResendEmailProvider('re_invalid');
      await expect(
        resend.send({
          to: 'client@company.com',
          subject: 'Test',
          html: 'Body',
          trackingToken: 'tok',
        }),
      ).rejects.toThrow('Resend API error (403): Domain not verified');

      vi.unstubAllGlobals();
    });
  });

  describe('SendGridEmailProvider', () => {
    it('should post correctly formatted SendGrid v3 payload', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        headers: {
          get: (name: string) => (name.toLowerCase() === 'x-message-id' ? 'sg-msg-999' : null),
        },
      });
      vi.stubGlobal('fetch', mockFetch);

      const sendGrid = new SendGridEmailProvider('SG.test_key_456');
      const res = await sendGrid.send({
        to: 'ceo@enterprise.ru',
        from: 'Revamp Sales <sales@revampdemo.com>',
        subject: 'Redesign proposal',
        html: '<p>HTML content</p>',
        text: 'Text content',
        trackingToken: 'sg-tok',
      });

      expect(res.success).toBe(true);
      expect(res.messageId).toBe('sg-msg-999');
      expect(res.provider).toBe('sendgrid');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.sendgrid.com/v3/mail/send',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer SG.test_key_456',
          }),
        }),
      );

      vi.unstubAllGlobals();
    });
  });

  describe('SmtpEmailProvider', () => {
    it('should call transporter.sendMail with proper arguments', async () => {
      const mockSendMail = vi.fn().mockResolvedValue({
        messageId: '<smtp-msg-abc@domain>',
      });
      const mockTransporter = {
        sendMail: mockSendMail,
      } as any;

      const smtp = new SmtpEmailProvider(mockTransporter);
      const res = await smtp.send({
        to: 'user@smtp.com',
        subject: 'SMTP Test',
        html: 'Hello SMTP',
        trackingToken: 'smtp-tok',
      });

      expect(res.success).toBe(true);
      expect(res.messageId).toBe('<smtp-msg-abc@domain>');
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@smtp.com',
          subject: 'SMTP Test',
          html: 'Hello SMTP',
        }),
      );
    });
  });
});
