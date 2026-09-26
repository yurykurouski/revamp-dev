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
import { Audit } from '../../models/Audit.model.js';
import { addAuditJob } from '../../queues/audit.queue.js';

vi.mock('../../models/Lead.model.js');
vi.mock('../../models/Audit.model.js');
vi.mock('../../queues/audit.queue.js', () => ({
  addAuditJob: vi.fn().mockResolvedValue({ id: 'audit-job' }),
}));

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
    lean: () => ({ exec: vi.fn().mockResolvedValue(domains.map((domain) => ({ domain }))) }),
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
  let leadCounter = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    leadCounter = 0;
    mockExistingDomains([]);
    vi.spyOn(Lead, 'create').mockImplementation((async (doc: any) => {
      const id = `lead-${++leadCounter}`;
      return { ...doc, _id: { toString: () => id } };
    }) as any);
    vi.spyOn(Audit, 'create').mockResolvedValue({} as any);
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

  it('should create QUEUED leads with audits and audit jobs', async () => {
    const provider = providerReturning([
      business('1', { email: 'Hello@Clinic-1.lt', phone: '+370 600 00000', city: 'Vilnius' }),
    ]);

    const result = await runDiscovery(jobData, provider);

    expect(Lead.create).toHaveBeenCalledWith({
      businessName: 'Clinic 1',
      originalUrl: 'https://clinic-1.lt/',
      domain: 'clinic-1.lt',
      niche: 'dental',
      city: 'Vilnius',
      contactEmail: 'hello@clinic-1.lt',
      contactPhone: '+370 600 00000',
      status: 'QUEUED',
      tags: ['discovered', 'source:osm'],
    });
    expect(Audit.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'QUEUED' }));
    expect(addAuditJob).toHaveBeenCalledWith({ leadId: 'lead-1', url: 'https://clinic-1.lt/', niche: 'dental' });
    expect(result).toEqual({
      found: 1,
      created: 1,
      skippedNoWebsite: 0,
      skippedDuplicate: 0,
      skippedInvalid: 0,
      leadIds: ['lead-1'],
    });
  });

  it('should guess info@<domain> and tag the lead when no email is listed', async () => {
    await runDiscovery(jobData, providerReturning([business('2')]));
    expect(Lead.create).toHaveBeenCalledWith(
      expect.objectContaining({
        contactEmail: 'info@clinic-2.lt',
        city: 'Vilnius',
        tags: ['discovered', 'source:osm', 'email-guessed'],
      }),
    );
  });

  it('should drop unusable optional fields instead of the whole listing', async () => {
    await runDiscovery(jobData, providerReturning([business('3', { email: 'broken@', phone: '1'.repeat(40) })]));
    const created = vi.mocked(Lead.create).mock.calls[0][0] as any;
    expect(created.contactEmail).toBe('info@clinic-3.lt');
    expect(created.contactPhone).toBeUndefined();
  });

  it('should skip listings without an auditable website', async () => {
    const result = await runDiscovery(
      jobData,
      providerReturning([
        business('1'),
        business('4', { website: undefined }),
        business('5', { website: 'https://facebook.com/clinic5' }),
      ]),
    );
    expect(result.created).toBe(1);
    expect(result.skippedNoWebsite).toBe(2);
  });

  it('should skip listings that fail schema validation', async () => {
    const result = await runDiscovery(jobData, providerReturning([business('6', { name: 'X' })]));
    expect(result.skippedInvalid).toBe(1);
    expect(Lead.create).not.toHaveBeenCalled();
  });

  it('should dedupe within the batch and against existing leads', async () => {
    mockExistingDomains(['clinic-2.lt']);
    const result = await runDiscovery(
      jobData,
      providerReturning([
        business('1'),
        business('1b', { website: 'https://www.clinic-1.lt/contact' }),
        business('2'),
      ]),
    );

    expect(Lead.find).toHaveBeenCalledWith({ domain: { $in: ['clinic-1.lt', 'clinic-2.lt'] } }, { domain: 1 });
    expect(result.created).toBe(1);
    expect(result.skippedDuplicate).toBe(2);
  });

  it('should stop creating leads at the limit', async () => {
    const items = Array.from({ length: 8 }, (_, i) => business(String(i)));
    const result = await runDiscovery({ ...jobData, limit: 3 }, providerReturning(items));
    expect(result.found).toBe(8);
    expect(result.created).toBe(3);
    expect(Lead.create).toHaveBeenCalledTimes(3);
  });

  it('should count a failed import as invalid and continue with the rest', async () => {
    vi.mocked(Lead.create).mockRejectedValueOnce(new Error('validation failed'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runDiscovery(jobData, providerReturning([business('1'), business('2')]));

    expect(result.skippedInvalid).toBe(1);
    expect(result.created).toBe(1);
    expect(result.leadIds).toEqual(['lead-1']);
    errorSpy.mockRestore();
  });

  it('should propagate provider errors', async () => {
    const provider: DiscoveryProviderClient = { search: vi.fn().mockRejectedValue(new Error('Overpass down')) };
    await expect(runDiscovery(jobData, provider)).rejects.toThrow('Overpass down');
  });
});
