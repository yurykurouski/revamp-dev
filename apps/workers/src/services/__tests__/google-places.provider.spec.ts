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

    const results = await provider.search({ niche: 'dental', location: 'Vilnius', maxResults: 10 });

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

  it('should follow nextPageToken until the target is reached and cap at 60', async () => {
    const page = (prefix: string, token?: string) =>
      jsonResponse({
        places: Array.from({ length: 20 }, (_, i) => place(`${prefix}${i}`)),
        ...(token ? { nextPageToken: token } : {}),
      });
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(page('p1-', 't1'))
      .mockResolvedValueOnce(page('p2-', 't2'))
      .mockResolvedValueOnce(page('p3-', 't3'));
    const provider = new GooglePlacesProvider({ apiKey: 'k', fetchFn });

    const results = await provider.search({ niche: 'restaurant', location: 'Warsaw', maxResults: 300 });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).pageToken).toBeUndefined();
    expect(JSON.parse(fetchFn.mock.calls[1][1].body).pageToken).toBe('t1');
    expect(JSON.parse(fetchFn.mock.calls[2][1].body).pageToken).toBe('t2');
    expect(results).toHaveLength(60);
  });

  it('should stop paging when no nextPageToken is returned', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse({ places: [place('only')] }));
    const provider = new GooglePlacesProvider({ apiKey: 'k', fetchFn });
    const results = await provider.search({ niche: 'fitness', location: 'Minsk', maxResults: 40 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it('should surface HTTP errors with the response detail', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse({ error: { message: 'API key not valid' } }, 403));
    const provider = new GooglePlacesProvider({ apiKey: 'bad', fetchFn });
    await expect(provider.search({ niche: 'legal', location: 'Vilnius', maxResults: 5 })).rejects.toThrow(
      /HTTP 403: .*API key not valid/,
    );
  });
});
