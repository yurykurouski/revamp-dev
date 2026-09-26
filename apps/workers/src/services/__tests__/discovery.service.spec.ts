import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IDiscoveredBusiness, IDiscoveryJobData } from '@revamp/shared-types';
import {
  countByStatus,
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

const providerReturning = (items: IDiscoveredBusiness[]): DiscoveryProviderClient => ({
  search: vi.fn().mockResolvedValue(items),
});

const mockExistingDomains = (domains: string[]) => {
  vi.spyOn(Lead, 'find').mockReturnValue({
    lean: () => ({ exec: vi.fn().mockResolvedValue(domains.map((domain) => ({ _id: `lead-${domain}`, domain }))) }),
  } as any);
};

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
    expect(provider.search).toHaveBeenCalledWith({
      niche: 'dental',
      location: 'Vilnius',
      keyword: 'smile',
      maxResults: 30,
    });

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

    expect(Lead.find).toHaveBeenCalledWith({ domain: { $in: ['clinic-1.lt', 'clinic-2.lt'] } }, { domain: 1 });
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

  it('should propagate provider errors', async () => {
    const provider: DiscoveryProviderClient = { search: vi.fn().mockRejectedValue(new Error('Overpass down')) };
    await expect(runDiscovery(jobData, provider)).rejects.toThrow('Overpass down');
  });
});

describe('countByStatus', () => {
  it('should count candidates per status', () => {
    const c = (status: any) => ({ provider: 'osm' as const, externalId: status, name: 'x', status });
    expect(countByStatus([c('new'), c('new'), c('duplicate'), c('no_website')])).toEqual({
      new: 2,
      existing_lead: 0,
      duplicate: 1,
      no_website: 1,
      invalid: 0,
    });
  });
});
