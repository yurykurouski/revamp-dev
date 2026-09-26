import { describe, it, expect, vi } from 'vitest';
import { OsmDiscoveryProvider, escapeOverpassRegex } from '../osm-discovery.provider.js';

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

    const results = await provider.search({ niche: 'dental', location: 'Vilnius', maxResults: 30 });

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
    expect(await provider.resolveLocation('Village')).toEqual({ setup: '', filter: '(around:5000,52.2,21.0)' });
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
    expect(await provider.search({ niche: 'fitness', location: 'Vilnius', maxResults: 10 })).toEqual([]);
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
