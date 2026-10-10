import { useCallback, useState } from 'react';
import type { IAuditDetail, IEmailDraft, ILeadItem } from '../api/client.js';
import { auditSummarySentence, EmailTemplateContext, renderEmailDraft, renderEmailTemplate } from '../utils/emailTemplate.js';

export interface EmailDraftFields {
  subject: string;
  preheader: string;
  body: string;
}

export interface EmailDraft extends EmailDraftFields {
  setSubject: (subject: string) => void;
  setPreheader: (preheader: string) => void;
  setBody: (body: string) => void;
  /** Appends a `{{variable}}` tag to the body */
  insertTag: (tag: string) => void;
  /** A text with the lead's values in place of its `{{variables}}`, as the recipient sees it */
  renderText: (text: string) => string;
  /** The draft as the preview shows it, with its variables substituted (REV-72) */
  rendered: () => IEmailDraft;
}

/** The default outreach draft; it is copy for the business owner, so it is not tied to the operator's UI language */
export function defaultEmailDraft(lead: ILeadItem, audit?: IAuditDetail | null): EmailDraftFields {
  return {
    subject: `A new mobile website for ${lead.businessName} (higher conversion, faster LCP)`,
    preheader: `We built an interactive prototype of your new website${lead.city ? ` for ${lead.city}` : ''}`,
    body: `Hello,

${auditSummarySentence(lead.domain, audit?.lcpSeconds)}

To show what a modern, high-converting site could look like, our platform automatically generated a responsive prototype for you:
👉 {{demoUrl}}

Key improvements in the prototype:
1. Fast loading on mobile with a lightweight static page
2. One-tap booking from any mobile device
3. A responsive services grid that keeps your brand identity

We would love to hear your feedback!
Best regards, the Revamp SaaS team`,
  };
}

/**
 * The operator's outreach draft for one lead (REV-77). It lives in the lead review rather than in the
 * editor, so moving between the review steps keeps unsaved edits and the action bar approves what the
 * editor shows.
 */
export function useEmailDraft(lead: ILeadItem, audit?: IAuditDetail | null): EmailDraft {
  const [initial] = useState(() => defaultEmailDraft(lead, audit));
  const [subject, setSubject] = useState(initial.subject);
  const [preheader, setPreheader] = useState(initial.preheader);
  const [body, setBody] = useState(initial.body);

  const context: EmailTemplateContext = {
    businessName: lead.businessName,
    city: lead.city,
    demoUrl: lead.previewUrl,
    score: lead.totalScore,
    lcpSeconds: audit?.lcpSeconds,
    criticalFlaws: audit?.criticalFlaws,
  };

  const insertTag = useCallback((tag: string) => setBody((prev) => `${prev} ${tag}`), []);

  return {
    subject,
    preheader,
    body,
    setSubject,
    setPreheader,
    setBody,
    insertTag,
    renderText: (text) => renderEmailTemplate(text, context),
    rendered: () => renderEmailDraft({ subject, preheader, body }, context),
  };
}
