import type { IOutboxMessage, IStudioSender } from './index.js';

/**
 * Renders an outreach email exactly as it would be sent (REV-221): the From header, the RFC 2369 / 8058
 * unsubscribe headers, the one-click footer and the open pixel. Pure and free of Node APIs, so the
 * workers and the demo seed share one function. Nothing is delivered; the result is the outbox record.
 */

/** `"Name" <address>`: the name quoted, backslashes and inner quotes escaped, so commas and non-ASCII stay valid */
export function formatFromHeader(sender: IStudioSender): string {
  const name = sender.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${name}" <${sender.address}>`;
}

export interface IRenderOutreachMessageInput {
  sender: IStudioSender;
  to: string;
  subject: string;
  html: string;
  text?: string;
  trackingToken: string;
  publicApiUrl: string;
  /** Adds the open-tracking pixel; off for test sends to the operator (REV-60) */
  trackOpens?: boolean;
  /** The mailbox of the mailto: part of List-Unsubscribe; defaults to `unsubscribe@` on the sender's domain */
  unsubscribeEmail?: string;
}

export function renderOutreachMessage(input: IRenderOutreachMessageInput): IOutboxMessage {
  const publicUrl = input.publicApiUrl.replace(/\/$/, '');
  const unsubscribeUrl = `${publicUrl}/track/unsubscribe/${input.trackingToken}`;
  const senderDomain = input.sender.address.split('@').pop() ?? '';
  const unsubscribeEmail = input.unsubscribeEmail || `unsubscribe@${senderDomain}`;

  const headers: Record<string, string> = {
    'List-Unsubscribe': `<mailto:${unsubscribeEmail}?subject=unsubscribe>, <${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };

  let html = input.html;
  if (!html.includes(unsubscribeUrl)) {
    const footer = `
<div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-family: sans-serif; font-size: 12px; color: #64748b; text-align: center;">
  <p style="margin: 0 0 6px 0;">You are receiving this email because your business is listed in public directories.</p>
  <p style="margin: 0;"><a href="${unsubscribeUrl}" style="color: #64748b; text-decoration: underline;">Unsubscribe in one click</a></p>
</div>`;
    html = html.includes('</body>') ? html.replace('</body>', `${footer}</body>`) : `${html}\n${footer}`;
  }

  const pixelUrl = `${publicUrl}/track/open/${input.trackingToken}.gif`;
  if (input.trackOpens !== false && !html.includes(pixelUrl)) {
    const pixel = `\n<img src="${pixelUrl}" width="1" height="1" style="display:none;width:1px;height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;" alt="" />`;
    html = html.includes('</body>') ? html.replace('</body>', `${pixel}\n</body>`) : `${html}${pixel}`;
  }

  let text = input.text || '';
  if (!text.includes(unsubscribeUrl)) {
    text = `${text}\n\n---\nYou are receiving this email because your business is listed in public directories.\nUnsubscribe in one click: ${unsubscribeUrl}`.trim();
  }

  return { from: formatFromHeader(input.sender), to: input.to, subject: input.subject, headers, html, text };
}
