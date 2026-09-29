import { describe, it, expect, vi } from 'vitest';
import { OsmDiscoveryProvider, escapeOverpassRegex, nextCursor } from '../osm-discovery.provider.js';

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const config = {
  overpassUrl: 'https://overpass.test/api/interpreter',
  nominatimUrl: 'https://nominatim.test/search',
  userAgent: 'RevampTest/1.0',
};

const overpassElements = {
  elements: [
    {
      type: 'node',
      id: 101,
      lat: 54.68,
      lon: 25.28,
      tags: {
        name: 'Smile Dental',
        website: 'https://smile.lt',
        phone: '+370 600 00000',
        email: 'hello@smile.lt',
        'addr:street': 'Gedimino pr.',
        'addr:housenumber': '1',
        'addr:postcode': '01103',
        'addr:city': 'Vilnius',
      },
    },
    {
      type: 'way',
      id: 202,
      center: { lat: 54.7, lon: 25.3 },
      tags: {
        name: 'Tooth Studio',
        'contact:website': 'toothstudio.lt',
        // Multi-valued tags keep only the first value
        'contact:phone': '+370 611 11111; +370 5 230 8827',
        email: ' ; ',
      },
    },
    { type: 'node', id: 303, tags: { website: 'https://noname.lt' } },
  ],
};

describe('OsmDiscoveryProvider', () => {
  it('should resolve a relation to an Overpass area and normalise elements', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ osm_type: 'relation', osm_id: 1529146 }]))
      .mockResolvedValueOnce(jsonResponse(overpassElements));
    const provider = new OsmDiscoveryProvider({ ...config, fetchFn });

    const { businesses: results, nextCursor: cursor } = await provider.search({
      niche: 'dental',
      location: 'Vilnius',
      maxResults: 30,
    });
    // Fewer elements than asked for in an area: the area has nothing more
    expect(cursor).toBeUndefined();

    const nominatimUrl = new URL(fetchFn.mock.calls[0][0]);
    expect(nominatimUrl.searchParams.get('q')).toBe('Vilnius');
    expect(fetchFn.mock.calls[0][1].headers['User-Agent']).toBe('RevampTest/1.0');

    const [overpassUrl, overpassInit] = fetchFn.mock.calls[1];
    expect(overpassUrl).toBe(config.overpassUrl);
    const query = new URLSearchParams(overpassInit.body).get('data')!;
    expect(query).toContain('area(id:3601529146)->.a;');
    expect(query).toContain('nwr["amenity"="dentist"](area.a)["name"]');
    expect(query).toContain('[timeout:90]');
    expect(query).toContain('out center tags 30;');
    expect(overpassInit.signal).toBeInstanceOf(AbortSignal);

    // Element without a name is dropped
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      provider: 'osm',
      externalId: 'node/101',
      name: 'Smile Dental',
      website: 'https://smile.lt',
      phone: '+370 600 00000',
      email: 'hello@smile.lt',
      address: 'Gedimino pr. 1, 01103, Vilnius',
      city: 'Vilnius',
      lat: 54.68,
      lng: 25.28,
    });
    expect(results[1]).toMatchObject({
      externalId: 'way/202',
      website: 'toothstudio.lt',
      phone: '+370 611 11111',
      lat: 54.7,
      lng: 25.3,
      address: undefined,
      email: undefined,
    });
  });

  it('should map ways to areas and fall back to an around-radius for nodes', async () => {
    const fetchFn = vi.fn();
    const provider = new OsmDiscoveryProvider({ ...config, fetchFn });

    fetchFn.mockResolvedValueOnce(jsonResponse([{ osm_type: 'way', osm_id: 5 }]));
    expect(await provider.resolveLocation('Somewhere')).toEqual({
      setup: 'area(id:2400000005)->.a;\n',
      filter: '(area.a)',
    });

    fetchFn.mockResolvedValueOnce(jsonResponse([{ osm_type: 'node', osm_id: 7, lat: '52.2', lon: '21.0' }]));
    expect(await provider.resolveLocation('Village')).toEqual({
      setup: '',
      filter: '(around:5000,52.2,21.0)',
      radius: 5000,
    });
  });

  it('should throw when the location cannot be found or has no geometry', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse([]));
    const provider = new OsmDiscoveryProvider({ ...config, fetchFn });
    await expect(provider.resolveLocation('Atlantis')).rejects.toThrow('Location not found: Atlantis');

    fetchFn.mockResolvedValueOnce(jsonResponse([{ osm_type: 'node' }]));
    await expect(provider.resolveLocation('Nowhere')).rejects.toThrow('no usable geometry');
  });

  it('should surface HTTP errors from Nominatim and Overpass', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse({}, 503));
    const provider = new OsmDiscoveryProvider({ ...config, fetchFn });
    await expect(provider.search({ niche: 'dental', location: 'Vilnius', maxResults: 10 })).rejects.toThrow(
      'Nominatim request failed with HTTP 503',
    );

    fetchFn
      .mockResolvedValueOnce(jsonResponse([{ osm_type: 'relation', osm_id: 1 }]))
      .mockResolvedValueOnce(jsonResponse({}, 429));
    await expect(provider.search({ niche: 'dental', location: 'Vilnius', maxResults: 10 })).rejects.toThrow(
      'Overpass request failed with HTTP 429',
    );
  });

  it('should throw when Overpass answers 200 with a timeout remark instead of silently returning nothing', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ osm_type: 'relation', osm_id: 1 }]))
      .mockResolvedValueOnce(
        jsonResponse({
          elements: [],
          remark: 'runtime error: Query timed out in "query" at line 4 after 91 seconds.',
        }),
      );
    const provider = new OsmDiscoveryProvider({ ...config, fetchFn });
    await expect(provider.search({ niche: 'dental', location: 'Vilnius', maxResults: 10 })).rejects.toThrow(
      'Overpass query failed: runtime error: Query timed out',
    );
  });

  it('should return an empty list when Overpass has no elements', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ osm_type: 'relation', osm_id: 1 }]))
      .mockResolvedValueOnce(jsonResponse({}));
    const provider = new OsmDiscoveryProvider({ ...config, fetchFn });
    expect(await provider.search({ niche: 'fitness', location: 'Vilnius', maxResults: 10 })).toEqual({
      businesses: [],
      nextCursor: undefined,
    });
  });

  it('should search estate agent offices and shops for the real_estate niche (REV-106)', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ osm_type: 'relation', osm_id: 1 }]))
      .mockResolvedValueOnce(jsonResponse({}));
    const provider = new OsmDiscoveryProvider({ ...config, fetchFn });
    await provider.search({ niche: 'real_estate', location: 'Vilnius', maxResults: 10 });

    const query = new URLSearchParams(fetchFn.mock.calls[1][1].body).get('data')!;
    expect(query).toContain('nwr["office"="estate_agent"](area.a)');
    expect(query).toContain('nwr["shop"="estate_agent"](area.a)');
  });

  describe('paging (REV-35)', () => {
    const element = (id: number) => ({ type: 'node', id, tags: { name: `Place ${id}`, website: `https://p${id}.lt` } });

    it('should ask for twice as many results when a request came back full, resolving the location once', async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([{ osm_type: 'relation', osm_id: 1 }]))
        .mockResolvedValueOnce(jsonResponse({ elements: [element(1), element(2)] }))
        .mockResolvedValueOnce(jsonResponse({ elements: [element(1), element(2), element(3)] }));
      const provider = new OsmDiscoveryProvider({ ...config, fetchFn });
      const params = { niche: 'dental' as const, location: 'Vilnius', maxResults: 2 };

      const first = await provider.search(params);
      expect(first.businesses).toHaveLength(2);
      expect(first.nextCursor).toBeDefined();

      const second = await provider.search(params, first.nextCursor);
      expect(second.businesses).toHaveLength(3);
      expect(second.nextCursor).toBeUndefined();

      // One Nominatim lookup, then two Overpass queries with a growing output limit
      expect(fetchFn).toHaveBeenCalledTimes(3);
      expect(new URLSearchParams(fetchFn.mock.calls[1][1].body).get('data')).toContain('out center tags 2;');
      expect(new URLSearchParams(fetchFn.mock.calls[2][1].body).get('data')).toContain('out center tags 4;');
    });

    it('should widen the circle around a point location until the maximum radius', async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([{ osm_type: 'node', osm_id: 7, lat: '52.2', lon: '21.0' }]))
        .mockResolvedValue(jsonResponse({ elements: [element(1)] }));
      const provider = new OsmDiscoveryProvider({ ...config, fetchFn });
      const params = { niche: 'dental' as const, location: 'Village', maxResults: 10 };

      const radii: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await provider.search(params, cursor);
        const query = new URLSearchParams(fetchFn.mock.calls.at(-1)![1].body).get('data')!;
        radii.push(query.match(/around:(\d+)/)![1]!);
        cursor = page.nextCursor;
      } while (cursor);

      expect(radii).toEqual(['5000', '10000', '20000']);
    });

    it('should retry a failed location lookup instead of caching the failure', async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({}, 503))
        .mockResolvedValueOnce(jsonResponse([{ osm_type: 'relation', osm_id: 1 }]))
        .mockResolvedValueOnce(jsonResponse({ elements: [] }));
      const provider = new OsmDiscoveryProvider({ ...config, fetchFn });
      const params = { niche: 'dental' as const, location: 'Vilnius', maxResults: 10 };

      await expect(provider.search(params)).rejects.toThrow('Nominatim request failed with HTTP 503');
      await expect(provider.search(params)).resolves.toEqual({ businesses: [], nextCursor: undefined });
    });

    it('should reject a malformed cursor', async () => {
      const provider = new OsmDiscoveryProvider({ ...config, fetchFn: vi.fn() });
      await expect(
        provider.search({ niche: 'dental', location: 'Vilnius', maxResults: 10 }, '{"out":"many"}'),
      ).rejects.toThrow('Invalid OSM discovery cursor');
    });

    it('nextCursor should stop growing the output limit at 2000 and end complete area results', () => {
      const area = { setup: 'area(id:1)->.a;\n', filter: '(area.a)' };
      expect(JSON.parse(nextCursor({ out: 1500, radius: 5000 }, 1500, area)!)).toEqual({ out: 2000, radius: 5000 });
      expect(nextCursor({ out: 2000, radius: 5000 }, 2000, area)).toBeUndefined();
      expect(nextCursor({ out: 100, radius: 5000 }, 40, area)).toBeUndefined();
    });
  });

  describe('buildQuery', () => {
    const provider = new OsmDiscoveryProvider({ ...config, fetchFn: vi.fn() });

    const area = { setup: 'area(id:3600000001)->.a;\n', filter: '(area.a)' };

    it('should emit one statement per niche filter with the indexed tag and spatial filter first', () => {
      const query = provider.buildQuery({ niche: 'medical', location: 'x', maxResults: 60 }, area);
      expect(query.startsWith('[out:json][timeout:90];\narea(id:3600000001)->.a;\n(')).toBe(true);
      const statements = query.split('\n').filter((line) => line.trim().startsWith('nwr'));
      expect(statements).toHaveLength(2);
      for (const statement of statements) {
        expect(statement).toMatch(/^ {2}nwr\[[^\]]+\]\(area\.a\)\["name"\]\[~"\^\(website\|contact:website\|url\)\$"~"\."\];$/);
      }
    });

    it('should use a plain around filter without a set-up statement for point locations', () => {
      const query = provider.buildQuery(
        { niche: 'fitness', location: 'x', maxResults: 5 },
        { setup: '', filter: '(around:5000,52.2,21.0)' },
      );
      expect(query).not.toContain('->.a');
      expect(query).toContain('(around:5000,52.2,21.0)["name"]');
    });

    it('should split "other" into one indexed key per statement with an escaped keyword filter', () => {
      const query = provider.buildQuery(
        { niche: 'other', location: 'x', keyword: 'Bakery "Best" (24/7)', maxResults: 10 },
        area,
      );
      const statements = query.split('\n').filter((line) => line.trim().startsWith('nwr'));
      expect(statements).toHaveLength(6);
      expect(statements[0]).toContain('nwr["shop"](area.a)["name"~"Bakery \\"Best\\" \\(24/7\\)",i]');
      // No unindexed regex-over-keys filters
      expect(query).not.toContain('[~"^(shop');
    });
  });

  it('escapeOverpassRegex should escape regex metacharacters and quotes', () => {
    expect(escapeOverpassRegex('a.b*c"d\\e')).toBe('a\\.b\\*c\\"d\\\\e');
  });
});
