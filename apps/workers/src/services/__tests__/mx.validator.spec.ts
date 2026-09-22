import { describe, it, expect, vi } from 'vitest';
import { MxValidator, mxValidator } from '../mx.validator.js';
import dns from 'dns';

describe('MxValidator (@revamp/workers)', () => {
  describe('extractDomain', () => {
    it('should extract domain correctly from standard email addresses', () => {
      expect(mxValidator.extractDomain('director@listonosz.site')).toBe('listonosz.site');
      expect(mxValidator.extractDomain('user.name+tag@sub.domain.co.uk')).toBe('sub.domain.co.uk');
      expect(mxValidator.extractDomain('   HELLO@EXAMPLE.COM   ')).toBe('example.com');
    });

    it('should return null for malformed or missing email addresses', () => {
      expect(mxValidator.extractDomain('')).toBeNull();
      expect(mxValidator.extractDomain('no-at-sign.com')).toBeNull();
      expect(mxValidator.extractDomain('@nodomain.com')).toBeNull();
      expect(mxDomainWithoutTld()).toBeNull();
      expect(mxValidator.extractDomain('user@domain with spaces.com')).toBeNull();
      expect(mxValidator.extractDomain(null as unknown as string)).toBeNull();
    });

    function mxDomainWithoutTld() {
      return mxValidator.extractDomain('user@nodot');
    }
  });

  describe('validateRecipientDomain with mocked resolver', () => {
    it('should return valid=true with sorted MX exchanges when MX records exist', async () => {
      const mockRecords: dns.MxRecord[] = [
        { exchange: 'mail2.example.com', priority: 20 },
        { exchange: 'mail1.example.com', priority: 10 },
        { exchange: 'mail3.example.com', priority: 30 },
      ];

      const mockResolver = vi.fn().mockResolvedValue(mockRecords);
      const validator = new MxValidator(mockResolver);

      const result = await validator.validateRecipientDomain('ceo@example.com');

      expect(result.valid).toBe(true);
      expect(result.domain).toBe('example.com');
      expect(result.mxRecords).toEqual([
        'mail1.example.com',
        'mail2.example.com',
        'mail3.example.com',
      ]);
      expect(mockResolver).toHaveBeenCalledWith('example.com');
    });

    it('should return valid=false when MX records array is empty', async () => {
      const mockResolver = vi.fn().mockResolvedValue([]);
      const validator = new MxValidator(mockResolver);

      const result = await validator.validateRecipientDomain('contact@nomailserver.org');

      expect(result.valid).toBe(false);
      expect(result.domain).toBe('nomailserver.org');
      expect(result.reason).toContain('No MX records found');
    });

    it('should handle ENOTFOUND DNS error gracefully without throwing', async () => {
      const error: NodeJS.ErrnoException = new Error('getaddrinfo ENOTFOUND non-existent-domain-xyz.com');
      error.code = 'ENOTFOUND';

      const mockResolver = vi.fn().mockRejectedValue(error);
      const validator = new MxValidator(mockResolver);

      const result = await validator.validateRecipientDomain('test@non-existent-domain-xyz.com');

      expect(result.valid).toBe(false);
      expect(result.domain).toBe('non-existent-domain-xyz.com');
      expect(result.reason).toContain('does not exist (ENOTFOUND)');
    });

    it('should handle ENODATA DNS error gracefully when domain has no MX entries', async () => {
      const error: NodeJS.ErrnoException = new Error('queryMx ENODATA domain-without-mx.com');
      error.code = 'ENODATA';

      const mockResolver = vi.fn().mockRejectedValue(error);
      const validator = new MxValidator(mockResolver);

      const result = await validator.validateRecipientDomain('test@domain-without-mx.com');

      expect(result.valid).toBe(false);
      expect(result.domain).toBe('domain-without-mx.com');
      expect(result.reason).toContain('has no MX records configured (ENODATA)');
    });

    it('should handle SERVFAIL error', async () => {
      const error: NodeJS.ErrnoException = new Error('queryMx SERVFAIL error');
      error.code = 'SERVFAIL';

      const mockResolver = vi.fn().mockRejectedValue(error);
      const validator = new MxValidator(mockResolver);

      const result = await validator.validateRecipientDomain('user@broken-dns.com');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('SERVFAIL');
    });

    it('should handle DNS query timeout', async () => {
      const mockResolver = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 500)),
      );
      const validator = new MxValidator(mockResolver, 50); // 50ms timeout

      const result = await validator.validateRecipientDomain('user@hanging-dns.com');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('timed out after 50ms');
    });

    it('should reject malformed email before calling DNS resolver', async () => {
      const mockResolver = vi.fn();
      const validator = new MxValidator(mockResolver);

      const result = await validator.validateRecipientDomain('invalid-email-address');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Malformed or invalid email address');
      expect(mockResolver).not.toHaveBeenCalled();
    });
  });
});
