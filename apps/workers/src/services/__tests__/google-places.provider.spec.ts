import { describe, it, expect, vi } from 'vitest';
import { GooglePlacesProvider } from '../google-places.provider.js';

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response;

const place = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  displayName: { text: `Business ${id}` },
  websiteUri: `https://${id}.example.com/`,
  ...extra,
});

describe('GooglePlacesProvider', () => {
  it('should throw when the API key is missing', async () => {
    const provider = new GooglePlacesProvider({ fetchFn: vi.fn() });
    await expect(provider.search({ niche: 'dental', location: 'Vilnius', maxResults: 10 })).rejects.toThrow(
      'GOOGLE_PLACES_API_KEY is not configured',
    );
  });

  it('should send a text query with field mask and normalise places', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        places: [
          place('a', {
            internationalPhoneNumber: '+370 600 00000',
            nationalPhoneNumber: '8 600 00000',
            formattedAddress: 'Gedimino pr. 1, Vilnius, Lithuania',
            addressComponents: [
              { longText: '1', types: ['street_number'] },
              { longText: 'Vilnius', types: ['locality', 'political'] },
            ],
            location: { latitude: 54.68, longitude: 25.28 },
          }),
          { id: 'no-name' },
        ],
      }),
    );
    const provider = new GooglePlacesProvider({ apiKey: 'key-123', fetchFn });

    const { businesses: results, nextCursor } = await provider.search({
      niche: 'dental',
      location: 'Vilnius',
      maxResults: 10,
    });
    expect(nextCursor).toBeUndefined();

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://places.googleapis.com/v1/places:searchText');
    expect(init.headers['X-Goog-Api-Key']).toBe('key-123');
    expect(init.headers['X-Goog-FieldMask']).toContain('places.websiteUri');
    expect(init.headers['X-Goog-FieldMask']).toContain('nextPageToken');
    expect(JSON.parse(init.body)).toEqual({ textQuery: 'dentist in Vilnius', pageSize: 10 });

    expect(results).toEqual([
      {
        provider: 'google',
        externalId: 'a',
        name: 'Business a',
        website: 'https://a.example.com/',
        phone: '+370 600 00000',
        address: 'Gedimino pr. 1, Vilnius, Lithuania',
        city: 'Vilnius',
        lat: 54.68,
        lng: 25.28,
      },
    ]);
  });

  it('should combine keyword with the niche term and use the keyword alone for other', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ places: [] }));
    const provider = new GooglePlacesProvider({ apiKey: 'k', fetchFn });

    await provider.search({ niche: 'beauty', location: 'Riga', keyword: 'nail', maxResults: 5 });
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).textQuery).toBe('nail beauty salon in Riga');

    await provider.search({ niche: 'other', location: 'Riga', keyword: 'bakery', maxResults: 5 });
    expect(JSON.parse(fetchFn.mock.calls[1][1].body).textQuery).toBe('bakery in Riga');
  });

  it('should search real estate agencies for the real_estate niche (REV-106)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ places: [] }));
    const provider = new GooglePlacesProvider({ apiKey: 'k', fetchFn });

    await provider.search({ niche: 'real_estate', location: 'Vilnius', maxResults: 5 });
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).textQuery).toBe('real estate agency in Vilnius');
  });

  it('should fetch one page per call, passing the cursor as pageToken and returning the next token', async () => {
    const page = (prefix: string, token?: string) =>
      jsonResponse({
        places: Array.from({ length: 20 }, (_, i) => place(`${prefix}${i}`)),
        ...(token ? { nextPageToken: token } : {}),
      });
    const fetchFn = vi.fn().mockResolvedValueOnce(page('p1-', 't1')).mockResolvedValueOnce(page('p2-'));
    const provider = new GooglePlacesProvider({ apiKey: 'k', fetchFn });
    const params = { niche: 'restaurant' as const, location: 'Warsaw', maxResults: 300 };

    const first = await provider.search(params);
    expect(first.businesses).toHaveLength(20);
    expect(first.nextCursor).toBe('t1');
    // Google's page size tops out at 20 however many results the search wants
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ textQuery: 'restaurant in Warsaw', pageSize: 20 });

    const second = await provider.search(params, first.nextCursor);
    expect(JSON.parse(fetchFn.mock.calls[1][1].body).pageToken).toBe('t1');
    expect(second.businesses[0]?.externalId).toBe('p2-0');
    // Google stops returning a token once the search is exhausted (at most 60 results)
    expect(second.nextCursor).toBeUndefined();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('should surface HTTP errors with the response detail', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse({ error: { message: 'API key not valid' } }, 403));
    const provider = new GooglePlacesProvider({ apiKey: 'bad', fetchFn });
    await expect(provider.search({ niche: 'legal', location: 'Vilnius', maxResults: 5 })).rejects.toThrow(
      /HTTP 403: .*API key not valid/,
    );
  });
});
