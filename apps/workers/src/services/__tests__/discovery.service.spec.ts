import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IDiscoveredBusiness, IDiscoveryJobData } from '@revamp/shared-types';
import {
  runDiscovery,
  normalizeWebsite,
  createDiscoveryProvider,
  DiscoveryProviderClient,
} from '../discovery.service.js';
import { OsmDiscoveryProvider } from '../osm-discovery.provider.js';
import { GooglePlacesProvider } from '../google-places.provider.js';
import { Lead } from '../../models/Lead.model.js';

vi.mock('../../models/Lead.model.js');

const jobData: IDiscoveryJobData = { provider: 'osm', niche: 'dental', location: 'Vilnius', limit: 10 };

const business = (id: string, extra: Partial<IDiscoveredBusiness> = {}): IDiscoveredBusiness => ({
  provider: 'osm',
  externalId: `node/${id}`,
  name: `Clinic ${id}`,
  website: `https://clinic-${id}.lt`,
  ...extra,
});

/** A provider with a single page of results */
const providerReturning = (items: IDiscoveredBusiness[]): DiscoveryProviderClient => ({
  search: vi.fn().mockResolvedValue({ businesses: items }),
});

/** A provider that returns the given pages in order, each pointing at the next */
const providerPaging = (pages: IDiscoveredBusiness[][]): DiscoveryProviderClient => ({
  search: vi.fn(async (_params, cursor?: string) => {
    const index = cursor ? Number(cursor) : 0;
    return { businesses: pages[index] ?? [], nextCursor: index + 1 < pages.length ? String(index + 1) : undefined };
  }),
});

const mockExistingLeads = (leads: Array<{ _id: string; externalId?: string; domain?: string; phoneE164?: string }>) => {
  vi.spyOn(Lead, 'find').mockReturnValue({
    lean: () => ({ exec: vi.fn().mockResolvedValue(leads) }),
  } as any);
};

const mockExistingDomains = (domains: string[]) =>
  mockExistingLeads(domains.map((domain) => ({ _id: `lead-${domain}`, domain })));

describe('normalizeWebsite', () => {
  it('should add a scheme, strip www and hash, and lowercase the domain', () => {
    expect(normalizeWebsite('WWW.Clinic.LT/about#team')).toEqual({
      url: 'https://www.clinic.lt/about',
      domain: 'clinic.lt',
    });
    expect(normalizeWebsite('http://clinic.lt')).toEqual({ url: 'http://clinic.lt/', domain: 'clinic.lt' });
  });

  it('should take the first of several semicolon-separated websites', () => {
    expect(normalizeWebsite('https://a.lt; https://b.lt')?.domain).toBe('a.lt');
  });

  it('should reject missing, malformed, non-http, and hostless values', () => {
    expect(normalizeWebsite(undefined)).toBeNull();
    expect(normalizeWebsite('   ')).toBeNull();
    expect(normalizeWebsite('ftp://clinic.lt')).toBeNull();
    expect(normalizeWebsite('localhost')).toBeNull();
    expect(normalizeWebsite('https://exa mple')).toBeNull();
  });

  it('should reject social and directory profiles, including subdomains', () => {
    expect(normalizeWebsite('https://facebook.com/clinic')).toBeNull();
    expect(normalizeWebsite('https://m.facebook.com/clinic')).toBeNull();
    expect(normalizeWebsite('instagram.com/clinic')).toBeNull();
    // A domain that merely ends with the same letters is fine
    expect(normalizeWebsite('https://notfacebook.com')?.domain).toBe('notfacebook.com');
  });
});

describe('createDiscoveryProvider', () => {
  it('should build the provider for each id', () => {
    expect(createDiscoveryProvider('osm')).toBeInstanceOf(OsmDiscoveryProvider);
    expect(createDiscoveryProvider('google')).toBeInstanceOf(GooglePlacesProvider);
    expect(() => createDiscoveryProvider('bing' as any)).toThrow('Unknown discovery provider: bing');
  });
});

describe('runDiscovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistingDomains([]);
  });

  it('should over-fetch from the provider relative to the limit, capped at 300', async () => {
    const provider = providerReturning([]);
    await runDiscovery({ ...jobData, keyword: 'smile', limit: 10 }, provider);
    expect(provider.search).toHaveBeenCalledWith(
      {
        niche: 'dental',
        location: 'Vilnius',
        keyword: 'smile',
        maxResults: 30,
      },
      undefined,
    );

    await runDiscovery({ ...jobData, limit: 100 }, provider);
    expect(vi.mocked(provider.search).mock.calls[1][0].maxResults).toBe(300);
  });

  it('should return normalised new candidates without creating any leads', async () => {
    const provider = providerReturning([
      business('1', { email: 'Hello@Clinic-1.lt', phone: '+370 600 00000', city: 'Vilnius', lat: 54.6, lng: 25.2 }),
    ]);

    const result = await runDiscovery(jobData, provider);

    expect(result).toEqual({
      found: 1,
      candidates: [
        {
          provider: 'osm',
          externalId: 'node/1',
          name: 'Clinic 1',
          status: 'new',
          website: 'https://clinic-1.lt/',
          domain: 'clinic-1.lt',
          email: 'hello@clinic-1.lt',
          phone: '+370 600 00000',
          address: undefined,
          city: 'Vilnius',
        },
      ],
      counts: { new: 1, existing_lead: 0, duplicate: 0, no_website: 0, invalid: 0 },
      requests: 1,
      exhausted: true,
    });
    expect(Lead.create).not.toHaveBeenCalled();
  });

  it('should drop unusable optional fields instead of the whole listing', async () => {
    const { candidates } = await runDiscovery(
      jobData,
      providerReturning([business('3', { email: 'broken@', phone: '1'.repeat(40) })]),
    );
    expect(candidates[0]).toMatchObject({ status: 'new', email: undefined, phone: undefined });
  });

  it('should list listings without an auditable website as no_website', async () => {
    const { candidates } = await runDiscovery(
      jobData,
      providerReturning([
        business('4', { website: undefined, phone: '+370 1', address: 'Main st 1' }),
        business('5', { website: 'https://facebook.com/clinic5' }),
      ]),
    );
    expect(candidates).toEqual([
      expect.objectContaining({ externalId: 'node/4', status: 'no_website', phone: '+370 1', address: 'Main st 1' }),
      expect.objectContaining({ externalId: 'node/5', status: 'no_website' }),
    ]);
    expect(candidates[0]).not.toHaveProperty('website');
  });

  it('should list listings that fail schema validation as invalid', async () => {
    const { candidates } = await runDiscovery(jobData, providerReturning([business('6', { name: 'X' })]));
    expect(candidates).toEqual([
      expect.objectContaining({ name: 'X', status: 'invalid', domain: 'clinic-6.lt' }),
    ]);
  });

  it('should mark in-batch duplicates and existing leads, keeping provider order', async () => {
    mockExistingDomains(['clinic-2.lt']);
    const { candidates } = await runDiscovery(
      jobData,
      providerReturning([business('1'), business('1b', { website: 'https://www.clinic-1.lt/contact' }), business('2')]),
    );

    // Only `new` candidates are looked up, on every key they have
    expect(Lead.find).toHaveBeenCalledWith(
      {
        $or: [
          { externalId: { $in: ['osm:node/1', 'osm:node/2'] } },
          { domain: { $in: ['clinic-1.lt', 'clinic-2.lt'] } },
        ],
      },
      { externalId: 1, domain: 1, phoneE164: 1 },
    );
    expect(candidates.map((c) => [c.externalId, c.status, c.leadId])).toEqual([
      ['node/1', 'new', undefined],
      ['node/1b', 'duplicate', undefined],
      ['node/2', 'existing_lead', 'lead-clinic-2.lt'],
    ]);
  });

  it('should offer at most `limit` new businesses but keep every skipped listing', async () => {
    const items = [
      ...Array.from({ length: 5 }, (_, i) => business(String(i))),
      business('nosite', { website: undefined }),
      business('late'),
    ];
    const result = await runDiscovery({ ...jobData, limit: 3 }, providerReturning(items));

    expect(result.found).toBe(7);
    expect(result.candidates.map((c) => c.externalId)).toEqual(['node/0', 'node/1', 'node/2', 'node/nosite']);
  });

  describe('matching existing leads (REV-35)', () => {
    it('should match on the provider id even when the website changed', async () => {
      mockExistingLeads([{ _id: 'lead-9', externalId: 'osm:node/9', domain: 'old-site.lt' }]);
      const { candidates } = await runDiscovery(jobData, providerReturning([business('9')]));
      expect(candidates[0]).toMatchObject({ status: 'existing_lead', leadId: 'lead-9' });
    });

    it('should not match the same id from another provider', async () => {
      mockExistingLeads([{ _id: 'lead-9', externalId: 'google:node/9' }]);
      const { candidates } = await runDiscovery(jobData, providerReturning([business('9')]));
      expect(candidates[0]?.status).toBe('new');
    });

    it('should match domain variants: case, www, trailing dot and port', async () => {
      mockExistingDomains(['clinic-3.lt']);
      const { candidates } = await runDiscovery(
        jobData,
        providerReturning([business('3', { website: 'HTTPS://WWW.Clinic-3.LT.:8443/en' })]),
      );
      expect(candidates[0]).toMatchObject({ status: 'existing_lead', leadId: 'lead-clinic-3.lt', domain: 'clinic-3.lt' });
    });

    it('should match on the E.164 phone when id and domain differ', async () => {
      mockExistingLeads([{ _id: 'lead-p', domain: 'elsewhere.lt', phoneE164: '+37060000000' }]);
      const { candidates } = await runDiscovery(
        jobData,
        providerReturning([business('4', { phone: '+370 (600) 00-000' }), business('5', { phone: '8 600 00000' })]),
      );
      expect(candidates.map((c) => [c.externalId, c.status, c.leadId])).toEqual([
        ['node/4', 'existing_lead', 'lead-p'],
        // A national number has no country code to match on
        ['node/5', 'new', undefined],
      ]);
    });

    it('should prefer the provider id match over a domain match', async () => {
      mockExistingLeads([
        { _id: 'by-domain', domain: 'clinic-6.lt' },
        { _id: 'by-id', externalId: 'osm:node/6' },
      ]);
      const { candidates } = await runDiscovery(jobData, providerReturning([business('6')]));
      expect(candidates[0]?.leadId).toBe('by-id');
    });

    it('should skip the lookup when there is nothing new to match', async () => {
      await runDiscovery(jobData, providerReturning([business('7', { website: undefined })]));
      expect(Lead.find).not.toHaveBeenCalled();
    });
  });

  describe('filling the limit (REV-35)', () => {
    it('should page further when known leads leave fewer than `limit` new businesses', async () => {
      mockExistingDomains(['clinic-a1.lt', 'clinic-a2.lt']);
      const provider = providerPaging([[business('a1'), business('a2')], [business('b1'), business('b2')]]);

      const result = await runDiscovery({ ...jobData, limit: 2 }, provider);

      expect(provider.search).toHaveBeenCalledTimes(2);
      expect(vi.mocked(provider.search).mock.calls[1][1]).toBe('1');
      expect(result.counts).toMatchObject({ new: 2, existing_lead: 2 });
      expect(result.candidates.filter((c) => c.status === 'new').map((c) => c.externalId)).toEqual([
        'node/b1',
        'node/b2',
      ]);
      expect(result).toMatchObject({ found: 4, requests: 2, exhausted: true });
    });

    it('should stop as soon as the limit is filled, leaving the provider not exhausted', async () => {
      const provider = providerPaging([[business('a1'), business('a2')], [business('b1')]]);
      const result = await runDiscovery({ ...jobData, limit: 2 }, provider);
      expect(provider.search).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ requests: 1, exhausted: false });
    });

    it('should stop at the request cap', async () => {
      const pages = Array.from({ length: 10 }, (_, i) => [business(`x${i}`, { website: undefined })]);
      const provider = providerPaging(pages);

      const result = await runDiscovery({ ...jobData, limit: 5 }, provider, { maxRequests: 3 });

      expect(provider.search).toHaveBeenCalledTimes(3);
      expect(result).toMatchObject({ requests: 3, exhausted: false, found: 3 });
      expect(result.counts).toMatchObject({ new: 0, no_website: 3 });
    });

    it('should report exhaustion when the provider runs out before the limit', async () => {
      const result = await runDiscovery({ ...jobData, limit: 10 }, providerPaging([[business('1')], [business('2')]]));
      expect(result).toMatchObject({ requests: 2, exhausted: true });
      expect(result.counts?.new).toBe(2);
    });

    it('should ignore listings a follow-up request returns again and dedupe domains across pages', async () => {
      const provider = providerPaging([
        [business('1')],
        [business('1'), business('2'), business('2b', { website: 'https://clinic-1.lt/' })],
      ]);
      const result = await runDiscovery({ ...jobData, limit: 5 }, provider);

      expect(result.found).toBe(3);
      expect(result.candidates.map((c) => [c.externalId, c.status])).toEqual([
        ['node/1', 'new'],
        ['node/2', 'new'],
        ['node/2b', 'duplicate'],
      ]);
    });
  });

  it('should propagate provider errors', async () => {
    const provider: DiscoveryProviderClient = { search: vi.fn().mockRejectedValue(new Error('Overpass down')) };
    await expect(runDiscovery(jobData, provider)).rejects.toThrow('Overpass down');
  });
});
