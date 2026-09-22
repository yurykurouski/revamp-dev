import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';

export interface ISendEmailOptions {
  to: string;
  from?: string;
  subject: string;
  html: string;
  text?: string;
  trackingToken: string;
  unsubscribeUrl?: string;
  unsubscribeEmail?: string;
  headers?: Record<string, string>;
}

export interface ISendEmailResult {
  success: boolean;
  messageId?: string;
  provider: string;
  sentAt: Date;
  error?: string;
}

export interface IEmailProvider {
  name: string;
  send(options: ISendEmailOptions): Promise<ISendEmailResult>;
}

/**
 * In-memory Mock Provider for offline dev and deterministic Vitest suites
 */
export class MockEmailProvider implements IEmailProvider {
  public name = 'mock';
  public sentMessages: Array<ISendEmailOptions & { messageId: string; sentAt: Date }> = [];

  async send(options: ISendEmailOptions): Promise<ISendEmailResult> {
    const messageId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const sentAt = new Date();

    this.sentMessages.push({
      ...options,
      messageId,
      sentAt,
    });

    return {
      success: true,
      messageId,
      provider: 'mock',
      sentAt,
    };
  }

  public clear(): void {
    this.sentMessages = [];
  }
}

/**
 * Resend API Email Provider (Native fetch to api.resend.com)
 */
export class ResendEmailProvider implements IEmailProvider {
  public name = 'resend';
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || env.RESEND_API_KEY || '';
  }

  async send(options: ISendEmailOptions): Promise<ISendEmailResult> {
    if (!this.apiKey) {
      throw new Error('Resend API key is not configured');
    }

    const payload = {
      from: options.from || env.EMAIL_FROM,
      to: [options.to],
      subject: options.subject,
      html: options.html,
      text: options.text,
      headers: options.headers,
    };

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Resend API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as { id?: string };
    return {
      success: true,
      messageId: data.id || `resend-${Date.now()}`,
      provider: 'resend',
      sentAt: new Date(),
    };
  }
}

/**
 * SendGrid API Email Provider (Native fetch to api.sendgrid.com)
 */
export class SendGridEmailProvider implements IEmailProvider {
  public name = 'sendgrid';
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || env.SENDGRID_API_KEY || '';
  }

  async send(options: ISendEmailOptions): Promise<ISendEmailResult> {
    if (!this.apiKey) {
      throw new Error('SendGrid API key is not configured');
    }

    const payload = {
      personalizations: [
        {
          to: [{ email: options.to }],
          subject: options.subject,
        },
      ],
      from: {
        email: (options.from || env.EMAIL_FROM).replace(/.*<([^>]+)>.*/, '$1').trim(),
        name: (options.from || env.EMAIL_FROM).includes('<')
          ? (options.from || env.EMAIL_FROM).replace(/<.*/, '').trim()
          : undefined,
      },
      content: [
        ...(options.text ? [{ type: 'text/plain', value: options.text }] : []),
        { type: 'text/html', value: options.html },
      ],
      headers: options.headers,
    };

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok && response.status !== 202) {
      const errorText = await response.text();
      throw new Error(`SendGrid API error (${response.status}): ${errorText}`);
    }

    const messageId = response.headers.get('x-message-id') || `sendgrid-${Date.now()}`;
    return {
      success: true,
      messageId,
      provider: 'sendgrid',
      sentAt: new Date(),
    };
  }
}

/**
 * SMTP Email Provider (Nodemailer)
 */
export class SmtpEmailProvider implements IEmailProvider {
  public name = 'smtp';
  private transporter: Transporter;

  constructor(transporter?: Transporter) {
    if (transporter) {
      this.transporter = transporter;
    } else {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST || 'localhost',
        port: env.SMTP_PORT || 587,
        auth:
          env.SMTP_USER && env.SMTP_PASS
            ? {
                user: env.SMTP_USER,
                pass: env.SMTP_PASS,
              }
            : undefined,
      });
    }
  }

  async send(options: ISendEmailOptions): Promise<ISendEmailResult> {
    const info = await this.transporter.sendMail({
      from: options.from || env.EMAIL_FROM,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      headers: options.headers,
    });

    return {
      success: true,
      messageId: info.messageId,
      provider: 'smtp',
      sentAt: new Date(),
    };
  }
}

/**
 * Main Email Service
 * Enforces List-Unsubscribe, List-Unsubscribe-Post, 1-Click HTML footer, and tracking token
 */
export class EmailService {
  private provider: IEmailProvider;

  constructor(provider?: IEmailProvider) {
    this.provider = provider || this.resolveDefaultProvider();
  }

  public setProvider(provider: IEmailProvider): void {
    this.provider = provider;
  }

  public getProvider(): IEmailProvider {
    return this.provider;
  }

  private resolveDefaultProvider(): IEmailProvider {
    switch (env.EMAIL_PROVIDER) {
      case 'resend':
        return new ResendEmailProvider();
      case 'sendgrid':
        return new SendGridEmailProvider();
      case 'smtp':
        return new SmtpEmailProvider();
      case 'mock':
      default:
        return new MockEmailProvider();
    }
  }

  /**
   * Dispatches email with RFC compliance headers and mandatory 1-click unsubscribe links
   */
  public async sendEmail(options: ISendEmailOptions): Promise<ISendEmailResult> {
    const trackingToken = options.trackingToken;
    const publicUrl = env.PUBLIC_API_URL.replace(/\/$/, '');
    const unsubscribeUrl = options.unsubscribeUrl || `${publicUrl}/track/unsubscribe/${trackingToken}`;
    const unsubscribeEmail = options.unsubscribeEmail || 'unsubscribe@revampdemo.com';

    // Compliance RFC 8058 & RFC 2369 Headers
    const complianceHeaders: Record<string, string> = {
      'List-Unsubscribe': `<mailto:${unsubscribeEmail}?subject=unsubscribe>, <${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      ...options.headers,
    };

    // Append 1-click unsubscribe footer to HTML
    let preparedHtml = options.html;
    if (!preparedHtml.includes(unsubscribeUrl)) {
      const unsubscribeHtmlFooter = `
<div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-family: sans-serif; font-size: 12px; color: #64748b; text-align: center;">
  <p style="margin: 0 0 6px 0;">Вы получили это письмо, так как ваш бизнес зарегистрирован в открытых каталогах.</p>
  <p style="margin: 0;"><a href="${unsubscribeUrl}" style="color: #64748b; text-decoration: underline;">Отписаться от рассылки в 1 клик</a></p>
</div>`;
      if (preparedHtml.includes('</body>')) {
        preparedHtml = preparedHtml.replace('</body>', `${unsubscribeHtmlFooter}</body>`);
      } else {
        preparedHtml = `${preparedHtml}\n${unsubscribeHtmlFooter}`;
      }
    }

    // Append 1-click unsubscribe footer to Plain Text
    let preparedText = options.text || '';
    if (!preparedText.includes(unsubscribeUrl)) {
      const unsubscribeTextFooter = `\n\n---\nВы получили это письмо, так как ваш бизнес зарегистрирован в открытых каталогах.\nОтписаться от рассылки в 1 клик: ${unsubscribeUrl}`;
      preparedText = `${preparedText}${unsubscribeTextFooter}`.trim();
    }

    return await this.provider.send({
      ...options,
      from: options.from || env.EMAIL_FROM,
      html: preparedHtml,
      text: preparedText,
      unsubscribeUrl,
      unsubscribeEmail,
      headers: complianceHeaders,
    });
  }
}

export const emailService = new EmailService();
