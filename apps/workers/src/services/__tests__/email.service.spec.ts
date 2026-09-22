import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EmailService,
  MockEmailProvider,
  ResendEmailProvider,
  SendGridEmailProvider,
  SmtpEmailProvider,
} from '../email.service.js';

describe('EmailService & Providers (@revamp/workers)', () => {
  let mockProvider: MockEmailProvider;
  let service: EmailService;

  beforeEach(() => {
    mockProvider = new MockEmailProvider();
    service = new EmailService(mockProvider);
  });

  describe('MockEmailProvider & Compliance Injections', () => {
    it('should successfully send email and record sent message in mock provider', async () => {
      const result = await service.sendEmail({
        to: 'director@listonosz.site',
        subject: 'Аудит и обновленная версия сайта Listonosz',
        html: '<p>Здравствуйте! Мы подготовили для вас прототип.</p>',
        text: 'Здравствуйте! Мы подготовили для вас прототип.',
        trackingToken: 'token-abc-123',
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe('mock');
      expect(result.messageId).toContain('mock-');
      expect(mockProvider.sentMessages).toHaveLength(1);

      const sent = mockProvider.sentMessages[0]!;
      expect(sent.to).toBe('director@listonosz.site');
      expect(sent.subject).toBe('Аудит и обновленная версия сайта Listonosz');

      // Verify RFC 8058 & RFC 2369 compliance headers
      expect(sent.headers).toBeDefined();
      expect(sent.headers!['List-Unsubscribe']).toContain('token-abc-123');
      expect(sent.headers!['List-Unsubscribe']).toContain('mailto:unsubscribe@');
      expect(sent.headers!['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

      // Verify HTML 1-click unsubscribe footer
      expect(sent.html).toContain('Отписаться от рассылки в 1 клик');
      expect(sent.html).toContain('/track/unsubscribe/token-abc-123');

      // Verify 1x1 tracking pixel injection (REV-18)
      expect(sent.html).toContain('/track/open/token-abc-123.gif');
      expect(sent.html).toContain('width="1" height="1"');

      // Verify plain text 1-click unsubscribe footer
      expect(sent.text).toContain('Отписаться от рассылки в 1 клик:');
      expect(sent.text).toContain('/track/unsubscribe/token-abc-123');
    });

    it('should not duplicate unsubscribe footer if it is already present in HTML and text', async () => {
      const customUnsubscribe = 'http://localhost:4000/api/v1/track/unsubscribe/token-xyz';
      const existingHtml = `<p>Текст письма</p><a href="${customUnsubscribe}">Отписаться</a><img src="http://localhost:4000/api/v1/track/open/token-xyz.gif" width="1" height="1" style="display:none;" alt="" />`;
      const existingText = `Текст письма. Отписка: ${customUnsubscribe}`;

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
        subject: 'Новый сайт для вашей компании',
        html: '<h1>Заголовок</h1>',
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
        subject: 'Предложение по редизайну',
        html: '<p>HTML контент</p>',
        text: 'Text контент',
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
