import dns from 'dns';

export interface IMxValidationResult {
  valid: boolean;
  domain?: string;
  mxRecords?: string[];
  reason?: string;
}

export type ResolveMxFn = (domain: string) => Promise<dns.MxRecord[]>;

export class MxValidator {
  private resolveMxFn: ResolveMxFn;
  private timeoutMs: number;

  constructor(resolveMxFn?: ResolveMxFn, timeoutMs = 5000) {
    this.resolveMxFn = resolveMxFn || dns.promises.resolveMx;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Extract domain part from an email address
   */
  public extractDomain(email: string): string | null {
    if (!email || typeof email !== 'string') {
      return null;
    }

    const trimmed = email.trim().toLowerCase();
    const atIndex = trimmed.lastIndexOf('@');

    if (atIndex <= 0 || atIndex === trimmed.length - 1) {
      return null;
    }

    const domain = trimmed.slice(atIndex + 1);

    // Basic domain validation (must contain at least one dot, no spaces or special invalid chars)
    if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.') || /\s/.test(domain)) {
      return null;
    }

    return domain;
  }

  /**
   * Deterministically validates whether the recipient email domain has routable MX records
   */
  public async validateRecipientDomain(email: string): Promise<IMxValidationResult> {
    const domain = this.extractDomain(email);

    if (!domain) {
      return {
        valid: false,
        reason: 'Malformed or invalid email address',
      };
    }

    try {
      // Race DNS resolution against timeout
      const mxPromise = this.resolveMxFn(domain);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => {
          const timeoutErr = new Error(`DNS MX lookup timed out after ${this.timeoutMs}ms`);
          (timeoutErr as NodeJS.ErrnoException).code = 'ETIMEDOUT';
          reject(timeoutErr);
        }, this.timeoutMs),
      );

      const records = await Promise.race([mxPromise, timeoutPromise]);

      if (!records || records.length === 0) {
        return {
          valid: false,
          domain,
          reason: `No MX records found for domain ${domain}`,
        };
      }

      // Sort by MX priority ascending (lowest number = highest priority)
      const sortedRecords = [...records].sort((a, b) => a.priority - b.priority);
      const exchanges = sortedRecords.map((r) => r.exchange);

      return {
        valid: true,
        domain,
        mxRecords: exchanges,
      };
    } catch (err: unknown) {
      const dnsError = err as NodeJS.ErrnoException;
      const code = dnsError.code || 'UNKNOWN';

      let reason = `DNS lookup failed for ${domain}: ${dnsError.message || code}`;
      if (code === 'ENOTFOUND') {
        reason = `Recipient domain "${domain}" does not exist (ENOTFOUND)`;
      } else if (code === 'ENODATA' || code === 'NODATA') {
        reason = `Recipient domain "${domain}" has no MX records configured (ENODATA)`;
      } else if (code === 'ETIMEDOUT') {
        reason = `DNS query for "${domain}" timed out after ${this.timeoutMs}ms`;
      } else if (code === 'SERVFAIL') {
        reason = `Authoritative name servers for "${domain}" returned SERVFAIL`;
      }

      return {
        valid: false,
        domain,
        reason,
      };
    }
  }
}

export const mxValidator = new MxValidator();
