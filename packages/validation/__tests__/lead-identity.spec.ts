import { describe, it, expect } from 'vitest';
import {
  LEAD_IDENTITY_PROJECTION,
  countCandidatesByStatus,
  createLeadMatcher,
  leadExternalId,
  leadMatchFilter,
  leadMatchKeys,
  normalizeDomain,
  normalizePhone,
} from '../src/index.js';

describe('Lead identity (REV-35)', () => {
  describe('normalizeDomain', () => {
    it('should lowercase and strip www, trailing dots and ports from URLs and bare hosts', () => {
      expect(normalizeDomain('https://WWW.Clinic.LT:8443/about?x=1')).toBe('clinic.lt');
      expect(normalizeDomain('clinic.lt.')).toBe('clinic.lt');
      expect(normalizeDomain('www.clinic.lt...')).toBe('clinic.lt');
      expect(normalizeDomain('  Clinic.lt  ')).toBe('clinic.lt');
      expect(normalizeDomain('http://clinic.lt:80')).toBe('clinic.lt');
    });

    it('should keep other subdomains, which may belong to a different business', () => {
      expect(normalizeDomain('https://shop.clinic.lt')).toBe('shop.clinic.lt');
      expect(normalizeDomain('https://www2.clinic.lt')).toBe('www2.clinic.lt');
    });

    it('should return undefined for empty or unparseable input', () => {
      expect(normalizeDomain(undefined)).toBeUndefined();
      expect(normalizeDomain(null)).toBeUndefined();
      expect(normalizeDomain('   ')).toBeUndefined();
      expect(normalizeDomain('https://exa mple.lt')).toBeUndefined();
      expect(normalizeDomain('http://')).toBeUndefined();
    });
  });

  describe('normalizePhone', () => {
    it('should convert internationally written numbers to E.164', () => {
      expect(normalizePhone('+370 600 00000')).toBe('+37060000000');
      expect(normalizePhone('+375 (29) 123-45-67')).toBe('+375291234567');
      expect(normalizePhone('00375 29 1234567')).toBe('+375291234567');
      expect(normalizePhone('tel:+48.22.123.45.67')).toBe('+48221234567');
    });

    it('should drop the national trunk prefix written as (0)', () => {
      expect(normalizePhone('+44 (0) 20 7946 0958')).toBe('+442079460958');
    });

    it('should keep only the first of several numbers and drop extensions', () => {
      expect(normalizePhone('+370 600 00000; +370 5 230 8827')).toBe('+37060000000');
      expect(normalizePhone('+370 600 00000, +370 611 11111')).toBe('+37060000000');
      expect(normalizePhone('+1 212 555 0100 ext. 12')).toBe('+12125550100');
      expect(normalizePhone('+1 212 555 0100 x12')).toBe('+12125550100');
    });

    it('should not guess a country for national numbers', () => {
      expect(normalizePhone('8 600 00000')).toBeUndefined();
      expect(normalizePhone('(029) 123-45-67')).toBeUndefined();
    });

    it('should reject too short, too long, or zero-led country codes', () => {
      expect(normalizePhone('+370 1')).toBeUndefined();
      expect(normalizePhone('+1234567890123456')).toBeUndefined();
      expect(normalizePhone('+0 600 00000')).toBeUndefined();
      expect(normalizePhone('')).toBeUndefined();
      expect(normalizePhone(undefined)).toBeUndefined();
    });

    it('should accept the E.164 boundaries of 7 and 15 digits', () => {
      expect(normalizePhone('+1234567')).toBe('+1234567');
      expect(normalizePhone('+123456789012345')).toBe('+123456789012345');
    });
  });

  describe('leadMatchKeys', () => {
    it('should qualify the listing id with its provider and normalise domain and phone', () => {
      expect(leadExternalId('osm', 'node/1')).toBe('osm:node/1');
      expect(
        leadMatchKeys({ provider: 'google', externalId: 'ChIJ1', domain: 'WWW.A.lt', phone: '+370 600 00000' }),
      ).toEqual({ externalId: 'google:ChIJ1', domain: 'a.lt', phoneE164: '+37060000000' });
      expect(leadMatchKeys({ provider: 'osm', externalId: 'way/2' })).toEqual({
        externalId: 'osm:way/2',
        domain: undefined,
        phoneE164: undefined,
      });
    });
  });

  describe('leadMatchFilter', () => {
    it('should build one deduplicated $in clause per key type present', () => {
      expect(
        leadMatchFilter([
          { externalId: 'osm:node/1', domain: 'a.lt', phoneE164: '+37060000000' },
          { externalId: 'osm:node/2', domain: 'a.lt' },
        ]),
      ).toEqual({
        $or: [
          { externalId: { $in: ['osm:node/1', 'osm:node/2'] } },
          { domain: { $in: ['a.lt'] } },
          { phoneE164: { $in: ['+37060000000'] } },
        ],
      });
    });

    it('should return null when there is nothing to look up', () => {
      expect(leadMatchFilter([])).toBeNull();
    });

    it('should project exactly the fields the matcher reads', () => {
      expect(LEAD_IDENTITY_PROJECTION).toEqual({ externalId: 1, domain: 1, phoneE164: 1 });
    });
  });

  describe('createLeadMatcher', () => {
    const match = createLeadMatcher([
      { _id: 'by-domain', domain: 'a.lt' },
      { _id: 'by-id', externalId: 'osm:node/1', domain: null },
      { _id: 'by-phone', phoneE164: '+37060000000' },
    ]);

    it('should match on provider id first, then domain, then phone', () => {
      expect(match({ externalId: 'osm:node/1', domain: 'a.lt', phoneE164: '+37060000000' })).toBe('by-id');
      expect(match({ externalId: 'osm:node/9', domain: 'a.lt', phoneE164: '+37060000000' })).toBe('by-domain');
      expect(match({ externalId: 'osm:node/9', domain: 'b.lt', phoneE164: '+37060000000' })).toBe('by-phone');
    });

    it('should return undefined when nothing matches', () => {
      expect(match({ externalId: 'osm:node/9', domain: 'b.lt' })).toBeUndefined();
      expect(createLeadMatcher([])({ externalId: 'osm:node/1' })).toBeUndefined();
    });

    it('should stringify ObjectId-like ids', () => {
      const id = { toString: () => '64f0c0ffee' };
      expect(createLeadMatcher([{ _id: id, domain: 'a.lt' }])({ externalId: 'x', domain: 'a.lt' })).toBe('64f0c0ffee');
    });
  });

  describe('countCandidatesByStatus', () => {
    it('should count every status, including ones with no candidates', () => {
      const statuses = ['new', 'new', 'duplicate', 'no_website', 'existing_lead'] as const;
      expect(countCandidatesByStatus(statuses.map((status) => ({ status })))).toEqual({
        new: 2,
        existing_lead: 1,
        duplicate: 1,
        no_website: 1,
        invalid: 0,
      });
      expect(countCandidatesByStatus([])).toEqual({ new: 0, existing_lead: 0, duplicate: 0, no_website: 0, invalid: 0 });
    });
  });
});
