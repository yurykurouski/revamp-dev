import { describe, it, expect } from 'vitest';
import { MAX_AUDIT_ERROR_LENGTH, isPermanentAuditError, sanitizeAuditError } from '../src/index.js';

describe('audit errors (REV-44)', () => {
  describe('sanitizeAuditError', () => {
    it('strips ANSI colour codes and keeps only the first line', () => {
      const error = new Error(
        '\x1B[31mpage.goto: net::ERR_NAME_NOT_RESOLVED at https://ekomyj.com/\x1B[39m\nCall log:\n\x1B[2m  - navigating to "https://ekomyj.com/"\x1B[22m',
      );
      expect(sanitizeAuditError(error)).toBe('page.goto: net::ERR_NAME_NOT_RESOLVED at https://ekomyj.com/');
    });

    it('drops the browser launch log after a crash', () => {
      const error = new Error(
        'browserContext.close: Target page, context or browser has been closed\nBrowser logs:\n\n<launching> /ms-playwright/chromium --headless --no-sandbox\n<launched> pid=123',
      );
      expect(sanitizeAuditError(error)).toBe('browserContext.close: Target page, context or browser has been closed');
    });

    it('skips leading blank lines and collapses whitespace', () => {
      expect(sanitizeAuditError(new Error('\n\n   Timeout    30000ms\texceeded  \nmore'))).toBe('Timeout 30000ms exceeded');
    });

    it(`caps the reason at ${MAX_AUDIT_ERROR_LENGTH} characters`, () => {
      expect(sanitizeAuditError(new Error('x'.repeat(1000)))).toHaveLength(MAX_AUDIT_ERROR_LENGTH);
    });

    it('accepts a plain string', () => {
      expect(sanitizeAuditError('net::ERR_CERT_DATE_INVALID')).toBe('net::ERR_CERT_DATE_INVALID');
    });

    it('falls back to a generic reason for empty or non-error values', () => {
      expect(sanitizeAuditError(new Error(''))).toBe('Failed to complete audit inspection');
      expect(sanitizeAuditError(undefined)).toBe('Failed to complete audit inspection');
      expect(sanitizeAuditError({ code: 42 })).toBe('Failed to complete audit inspection');
    });
  });

  describe('isPermanentAuditError', () => {
    it.each([
      'page.goto: net::ERR_NAME_NOT_RESOLVED at https://ekomyj.com/',
      'page.goto: net::ERR_CERT_DATE_INVALID at https://renault.warszawa.pl/',
      'net::ERR_CERT_AUTHORITY_INVALID',
      'net::ERR_CERT_COMMON_NAME_INVALID',
      'net::ERR_INVALID_URL',
    ])('treats "%s" as permanent', (message) => {
      expect(isPermanentAuditError(message)).toBe(true);
    });

    it.each([
      'browserContext.close: Target page, context or browser has been closed',
      'page.goto: Timeout 30000ms exceeded.',
      'net::ERR_CONNECTION_RESET',
      'net::ERR_CONNECTION_REFUSED',
      'ERR_NAME_NOT_RESOLVED_SOMETHING',
    ])('retries "%s"', (message) => {
      expect(isPermanentAuditError(message)).toBe(false);
    });
  });
});
