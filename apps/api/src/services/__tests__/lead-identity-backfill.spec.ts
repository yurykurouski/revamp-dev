import { describe, it, expect } from 'vitest';
import { IDiscoveryCandidate } from '@revamp/shared-types';
import { indexDiscoveredIds, planLeadIdentityUpdate } from '../lead-identity-backfill.js';

const candidate = (externalId: string, domain?: string, provider: 'osm' | 'google' = 'osm'): IDiscoveryCandidate => ({
  provider,
  externalId,
  name: 'x',
  status: 'new',
  domain,
});

describe('Lead identity backfill (REV-35)', () => {
  describe('indexDiscoveredIds', () => {
    it('should index listing ids by provider and normalised domain across jobs', () => {
      const index = indexDiscoveredIds([
        { found: 1, candidates: [candidate('node/1', 'WWW.A.lt'), candidate('node/2')] },
        { found: 1, candidates: [candidate('ChIJ9', 'a.lt', 'google')] },
        null,
        // Jobs from before REV-29 have no candidate list
        { found: 1 } as never,
      ]);
      expect(index.get('osm|a.lt')).toBe('osm:node/1');
      expect(index.get('google|a.lt')).toBe('google:ChIJ9');
      expect(index.size).toBe(2);
    });

    it('should mark a domain shared by different listings as ambiguous, but not a repeated one', () => {
      const index = indexDiscoveredIds([
        { found: 2, candidates: [candidate('node/1', 'a.lt'), candidate('node/2', 'a.lt')] },
        { found: 2, candidates: [candidate('node/3', 'b.lt')] },
        { found: 2, candidates: [candidate('node/3', 'b.lt')] },
      ]);
      expect(index.get('osm|a.lt')).toBeNull();
      expect(index.get('osm|b.lt')).toBe('osm:node/3');
    });
  });

  describe('planLeadIdentityUpdate', () => {
    const discovered = indexDiscoveredIds([
      { found: 2, candidates: [candidate('node/1', 'a.lt'), candidate('node/2', 'shared.lt'), candidate('node/3', 'shared.lt')] },
    ]);

    it('should normalise the domain from the original URL and set the phone and source', () => {
      expect(
        planLeadIdentityUpdate(
          { _id: '1', originalUrl: 'https://WWW.Clinic.lt.:443/', domain: 'www.clinic.lt', contactPhone: '+370 600 00000' },
          discovered,
        ),
      ).toEqual({ domain: 'clinic.lt', phoneE164: '+37060000000', source: 'manual' });
    });

    it('should fall back to the stored domain when the URL cannot be parsed', () => {
      expect(planLeadIdentityUpdate({ _id: '1', originalUrl: 'not a url', domain: 'WWW.Clinic.lt' }, discovered)).toEqual({
        domain: 'clinic.lt',
        source: 'manual',
      });
    });

    it('should recover source and provider id for a discovery import', () => {
      expect(
        planLeadIdentityUpdate(
          { _id: '1', originalUrl: 'https://a.lt/', domain: 'a.lt', tags: ['discovered', 'source:osm'] },
          discovered,
        ),
      ).toEqual({ source: 'osm', externalId: 'osm:node/1' });
    });

    it('should not recover an id for an ambiguous domain, another provider, or a manual lead', () => {
      const osmLead = { _id: '1', originalUrl: 'https://shared.lt/', domain: 'shared.lt', tags: ['source:osm'] };
      expect(planLeadIdentityUpdate(osmLead, discovered)).toEqual({ source: 'osm' });

      const googleLead = { _id: '2', originalUrl: 'https://a.lt/', domain: 'a.lt', tags: ['source:google'] };
      expect(planLeadIdentityUpdate(googleLead, discovered)).toEqual({ source: 'google' });

      const manual = { _id: '3', originalUrl: 'https://a.lt/', domain: 'a.lt', tags: [] };
      expect(planLeadIdentityUpdate(manual, discovered)).toEqual({ source: 'manual' });
    });

    it('should keep an existing provider id and source', () => {
      expect(
        planLeadIdentityUpdate(
          {
            _id: '1',
            originalUrl: 'https://a.lt/',
            domain: 'a.lt',
            source: 'google',
            externalId: 'google:ChIJ1',
            tags: ['source:osm'],
          },
          discovered,
        ),
      ).toBeNull();
    });

    it('should return null for a lead that is already up to date', () => {
      expect(
        planLeadIdentityUpdate(
          {
            _id: '1',
            originalUrl: 'https://clinic.lt/',
            domain: 'clinic.lt',
            contactPhone: '+370 600 00000',
            phoneE164: '+37060000000',
            source: 'manual',
          },
          discovered,
        ),
      ).toBeNull();
    });
  });
});
