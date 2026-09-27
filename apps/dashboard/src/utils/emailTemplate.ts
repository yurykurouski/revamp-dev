/**
 * Outreach draft helpers. Only measured audit values go into the email; a value the audit did not
 * measure is left out rather than replaced by a made-up number (REV-45).
 */

export interface EmailTemplateContext {
  businessName: string;
  city?: string;
  demoUrl?: string;
  score?: number;
  lcpSeconds?: number;
  criticalFlaws?: Array<{ title: string }>;
}

/** Shown for a template variable whose value is unknown */
export const UNKNOWN_VALUE = 'n/a';

export function renderEmailTemplate(text: string, context: EmailTemplateContext): string {
  return text
    .replace(/{{businessName}}/g, context.businessName)
    .replace(/{{city}}/g, context.city || 'your city')
    .replace(/{{demoUrl}}/g, context.demoUrl || UNKNOWN_VALUE)
    .replace(/{{score}}/g, context.score != null ? `${context.score}/100` : UNKNOWN_VALUE)
    .replace(/{{lcpSeconds}}/g, context.lcpSeconds != null ? `${context.lcpSeconds}s` : UNKNOWN_VALUE)
    .replace(
      /{{criticalFlaws}}/g,
      context.criticalFlaws?.length
        ? context.criticalFlaws.map((f, i) => `${i + 1}. ${f.title}`).join('\n')
        : UNKNOWN_VALUE,
    );
}

/** The audit sentence of the default draft; it quotes the LCP only when the audit measured one */
export function auditSummarySentence(domain: string, lcpSeconds: number | undefined): string {
  const speed = lcpSeconds != null ? ` the current mobile version loads in ${lcpSeconds}s (LCP) and` : ' the current mobile version';
  return `We took a look at your website ${domain}. According to our automated express audit,${speed} has a few mobile layout issues.`;
}
