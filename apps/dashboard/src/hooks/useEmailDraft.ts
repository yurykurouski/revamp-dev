import { useCallback, useEffect, useRef, useState } from 'react';
import type { ISenderView } from '@revamp/shared-types';
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

/**
 * Who signs the default draft: the studio's sender name, else the studio's organization name, else nobody (REV-223).
 * The platform never signs.
 */
export function draftSignerName(sender: ISenderView | undefined, organizationName: string | undefined): string | undefined {
  if (sender?.configured && sender.name) return sender.name;
  const org = organizationName?.trim();
  return org || undefined;
}

/** The draft's sign-off, in the draft's own language (English) */
export function draftSignOff(signerName?: string): string {
  return signerName ? `Best regards,\n${signerName}` : 'Best regards';
}

/**
 * The default outreach draft; it is copy for the business owner, so it is not tied to the operator's UI
 * language. It describes the prototype neutrally, so it fits a rebuild of the original page and an older
 * template MVP alike, and makes no claim the prototype or the audit does not back (REV-128): measured
 * values come from the audit only, and a value not measured is left out. The studio sending it signs it and the
 * platform never does: no platform name appears in it (REV-223).
 */
export function defaultEmailDraft(lead: ILeadItem, audit?: IAuditDetail | null, signerName?: string): EmailDraftFields {
  return {
    subject: `A prototype of an updated website for ${lead.businessName}`,
    preheader: `We built an interactive prototype of your updated website${lead.city ? ` for ${lead.city}` : ''}`,
    body: `Hello,

${auditSummarySentence(lead.domain, audit?.lcpSeconds)}

To show how your site could look, we built a prototype of your updated website:
👉 {{demoUrl}}

We would love to hear your feedback!
${draftSignOff(signerName)}`,
  };
}

/**
 * The operator's outreach draft for one lead (REV-77). It lives in the lead review rather than in the
 * editor, so moving between the review steps keeps unsaved edits and the action bar approves what the
 * editor shows. The default body follows the signer (REV-223) for as long as the operator has not changed it.
 */
export function useEmailDraft(lead: ILeadItem, audit?: IAuditDetail | null, signerName?: string): EmailDraft {
  const [initial] = useState(() => defaultEmailDraft(lead, audit, signerName));
  const [subject, setSubject] = useState(initial.subject);
  const [preheader, setPreheader] = useState(initial.preheader);
  const [body, setBody] = useState(initial.body);

  // The body counts as untouched while it equals the last default written; any edit ends the following
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const lastDefault = useRef(initial.body);
  useEffect(() => {
    const next = defaultEmailDraft(lead, audit, signerName).body;
    if (bodyRef.current === lastDefault.current && next !== lastDefault.current) {
      lastDefault.current = next;
      setBody(next);
    }
    // Only a new signer re-derives the default; the lead and audit are read as they are at that moment
  }, [signerName]);

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
