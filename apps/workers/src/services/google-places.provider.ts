import { IDiscoveredBusiness, NicheType } from '@revamp/shared-types';
import type { DiscoveryPage, DiscoveryProviderClient, DiscoverySearchParams, FetchFn } from './discovery.service.js';

const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
// Google caps Text Search at 20 results per page, and stops returning page tokens after 60 in total
const PAGE_SIZE = 20;

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.formattedAddress',
  'places.addressComponents',
  'places.location',
  'nextPageToken',
].join(',');

export const GOOGLE_NICHE_QUERIES: Record<NicheType, string> = {
  dental: 'dentist',
  auto: 'auto repair',
  legal: 'law firm',
  beauty: 'beauty salon',
  construction: 'construction company',
  medical: 'medical clinic',
  restaurant: 'restaurant',
  fitness: 'gym',
  real_estate: 'real estate agency',
  other: '',
};

interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  formattedAddress?: string;
  addressComponents?: Array<{ longText?: string; types?: string[] }>;
  location?: { latitude?: number; longitude?: number };
}

interface GoogleSearchResponse {
  places?: GooglePlace[];
  nextPageToken?: string;
}

export interface GooglePlacesProviderConfig {
  apiKey?: string;
  fetchFn?: FetchFn;
}

/**
 * Google Places API (New) Text Search. Uses the official API rather than scraping
 * Google Maps pages, which is against Google's Terms of Service.
 */
export class GooglePlacesProvider implements DiscoveryProviderClient {
  private readonly fetchFn: FetchFn;

  constructor(private readonly config: GooglePlacesProviderConfig) {
    this.fetchFn = config.fetchFn ?? fetch;
  }

  /** Fetches one page of results; `cursor` is the previous page's nextPageToken */
  async search(params: DiscoverySearchParams, cursor?: string): Promise<DiscoveryPage> {
    if (!this.config.apiKey) {
      throw new Error('GOOGLE_PLACES_API_KEY is not configured');
    }

    const textQuery = `${[params.keyword, GOOGLE_NICHE_QUERIES[params.niche]]
      .filter(Boolean)
      .join(' ')} in ${params.location}`;

    const res = await this.fetchFn(PLACES_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.config.apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery,
        pageSize: Math.min(PAGE_SIZE, params.maxResults),
        ...(cursor ? { pageToken: cursor } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Google Places request failed with HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }
    const body = (await res.json()) as GoogleSearchResponse;
    const businesses = (body.places ?? [])
      .map((place) => this.toBusiness(place))
      .filter((b): b is IDiscoveredBusiness => b !== null);
    return { businesses, nextCursor: body.nextPageToken || undefined };
  }

  private toBusiness(place: GooglePlace): IDiscoveredBusiness | null {
    const name = place.displayName?.text?.trim();
    if (!place.id || !name) return null;

    const city = place.addressComponents?.find((c) => c.types?.includes('locality'))?.longText;

    return {
      provider: 'google',
      externalId: place.id,
      name: name.slice(0, 100),
      website: place.websiteUri,
      phone: place.internationalPhoneNumber ?? place.nationalPhoneNumber,
      address: place.formattedAddress,
      city,
      lat: place.location?.latitude,
      lng: place.location?.longitude,
    };
  }
}
