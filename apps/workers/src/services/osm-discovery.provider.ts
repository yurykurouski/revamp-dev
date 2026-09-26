import { IDiscoveredBusiness, NicheType } from '@revamp/shared-types';
import type { DiscoveryPage, DiscoveryProviderClient, DiscoverySearchParams, FetchFn } from './discovery.service.js';

/** Overpass tag filters per niche; each entry becomes one `nwr[...]` statement */
export const OSM_NICHE_FILTERS: Record<NicheType, string[]> = {
  dental: ['["amenity"="dentist"]', '["healthcare"="dentist"]'],
  auto: ['["shop"~"^(car_repair|car|tyres|car_parts)$"]', '["amenity"="car_wash"]'],
  legal: ['["office"~"^(lawyer|notary)$"]'],
  beauty: ['["shop"~"^(beauty|hairdresser|cosmetics|massage)$"]'],
  construction: [
    '["craft"~"^(builder|carpenter|electrician|plumber|roofer|tiler|painter|hvac)$"]',
    '["office"="construction_company"]',
  ],
  medical: ['["amenity"~"^(clinic|doctors)$"]', '["healthcare"~"^(clinic|doctor|physiotherapist)$"]'],
  restaurant: ['["amenity"~"^(restaurant|cafe|fast_food|bar)$"]'],
  fitness: ['["leisure"~"^(fitness_centre|sports_centre)$"]'],
  // Keyword-only search over anything that looks like a business; one indexed key per statement,
  // since a regex over keys cannot use the Overpass index and times out on city-sized areas
  other: ['["shop"]', '["amenity"]', '["office"]', '["craft"]', '["healthcare"]', '["leisure"]'],
};

// Only listings with a website can be audited, so filter server-side to keep responses small
const HAS_WEBSITE = '[~"^(website|contact:website|url)$"~"."]';
const AROUND_RADIUS_METERS = 5000;
// How far a follow-up request may go: Overpass has no paging, so it asks for more results or a wider circle
const MAX_OUT = 2000;
const MAX_AROUND_RADIUS_METERS = 20000;
const QUERY_TIMEOUT_SECONDS = 90;
// Client-side ceiling a little above the server-side query timeout
const REQUEST_TIMEOUT_MS = (QUERY_TIMEOUT_SECONDS + 30) * 1000;

/** Where to search: optional set-up statement plus the spatial filter applied to each statement */
export interface OsmSearchScope {
  setup: string;
  filter: string;
  /** Set for around-a-point searches, which a follow-up request can widen */
  radius?: number;
}

/** Follow-up request state: how many elements to ask for and, for point locations, the radius */
interface OsmCursor {
  out: number;
  radius: number;
}

interface NominatimPlace {
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface OsmProviderConfig {
  overpassUrl: string;
  nominatimUrl: string;
  userAgent: string;
  fetchFn?: FetchFn;
}

/** OSM separates multiple values with ';' (e.g. two phone numbers); keep the first */
function firstValue(value?: string): string | undefined {
  const first = value?.split(';')[0]?.trim();
  return first || undefined;
}

/** Escapes user input for use inside an Overpass double-quoted regex */
export function escapeOverpassRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|"]/g, '\\$&');
}

function parseCursor(cursor: string): OsmCursor {
  const parsed = JSON.parse(cursor) as Partial<OsmCursor>;
  if (!Number.isInteger(parsed.out) || !Number.isInteger(parsed.radius)) {
    throw new Error(`Invalid OSM discovery cursor: ${cursor}`);
  }
  return parsed as OsmCursor;
}

/**
 * Next request after one that returned `returned` elements: a truncated result asks for more,
 * a complete one around a point widens the circle, and a complete area result is the end.
 */
export function nextCursor(state: OsmCursor, returned: number, scope: OsmSearchScope): string | undefined {
  if (returned >= state.out && state.out < MAX_OUT) {
    return JSON.stringify({ out: Math.min(state.out * 2, MAX_OUT), radius: state.radius });
  }
  if (scope.radius !== undefined && state.radius < MAX_AROUND_RADIUS_METERS) {
    return JSON.stringify({ out: state.out, radius: Math.min(state.radius * 2, MAX_AROUND_RADIUS_METERS) });
  }
  return undefined;
}

/**
 * OpenStreetMap discovery: Nominatim resolves the location, Overpass returns tagged businesses.
 * Data is ODbL-licensed and free to use with attribution.
 */
export class OsmDiscoveryProvider implements DiscoveryProviderClient {
  private readonly fetchFn: FetchFn;
  private readonly places = new Map<string, Promise<NominatimPlace>>();

  constructor(private readonly config: OsmProviderConfig) {
    this.fetchFn = config.fetchFn ?? fetch;
  }

  async search(params: DiscoverySearchParams, cursor?: string): Promise<DiscoveryPage> {
    const state = cursor ? parseCursor(cursor) : { out: params.maxResults, radius: AROUND_RADIUS_METERS };
    const scope = await this.resolveLocation(params.location, state.radius);
    const query = this.buildQuery({ ...params, maxResults: state.out }, scope);

    const res = await this.fetchFn(this.config.overpassUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.config.userAgent,
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Overpass request failed with HTTP ${res.status}`);
    }
    const body = (await res.json()) as { elements?: OverpassElement[]; remark?: string };
    // A timed-out or failed query still answers 200, with a remark and partial or no elements
    if (body.remark && /error|timed out|out of memory/i.test(body.remark)) {
      throw new Error(`Overpass query failed: ${body.remark.slice(0, 200)}`);
    }
    const elements = body.elements ?? [];
    const businesses = elements
      .map((el) => this.toBusiness(el))
      .filter((b): b is IDiscoveredBusiness => b !== null);
    return { businesses, nextCursor: nextCursor(state, elements.length, scope) };
  }

  /** Resolves the location to an Overpass area set or, for point results, an around-radius */
  async resolveLocation(location: string, radius = AROUND_RADIUS_METERS): Promise<OsmSearchScope> {
    const place = await this.lookupPlace(location);

    // Overpass area ids are the OSM id offset by type
    const areaOffset = place.osm_type === 'relation' ? 3600000000 : place.osm_type === 'way' ? 2400000000 : null;
    if (areaOffset !== null && place.osm_id) {
      return { setup: `area(id:${areaOffset + place.osm_id})->.a;\n`, filter: '(area.a)' };
    }
    if (place.lat && place.lon) {
      return { setup: '', filter: `(around:${radius},${place.lat},${place.lon})`, radius };
    }
    throw new Error(`Location has no usable geometry: ${location}`);
  }

  /** Nominatim lookup, once per location for this provider instance (i.e. per discovery job) */
  private lookupPlace(location: string): Promise<NominatimPlace> {
    let place = this.places.get(location);
    if (!place) {
      place = this.fetchPlace(location);
      // Don't cache failures, so a retry of the same job asks again
      place.catch(() => this.places.delete(location));
      this.places.set(location, place);
    }
    return place;
  }

  private async fetchPlace(location: string): Promise<NominatimPlace> {
    const url = new URL(this.config.nominatimUrl);
    url.searchParams.set('q', location);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');

    const res = await this.fetchFn(url.toString(), {
      headers: { 'User-Agent': this.config.userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`Nominatim request failed with HTTP ${res.status}`);
    }
    const [place] = (await res.json()) as NominatimPlace[];
    if (!place) {
      throw new Error(`Location not found: ${location}`);
    }
    return place;
  }

  buildQuery(params: DiscoverySearchParams, scope: OsmSearchScope): string {
    const nameFilter = params.keyword
      ? `["name"~"${escapeOverpassRegex(params.keyword)}",i]`
      : '["name"]';
    // Indexed tag filter and spatial filter first; the unindexed name/website checks then run on few elements
    const statements = OSM_NICHE_FILTERS[params.niche]
      .map((filter) => `  nwr${filter}${scope.filter}${nameFilter}${HAS_WEBSITE};`)
      .join('\n');
    return (
      `[out:json][timeout:${QUERY_TIMEOUT_SECONDS}];\n${scope.setup}` +
      `(\n${statements}\n);\nout center tags ${params.maxResults};`
    );
  }

  private toBusiness(el: OverpassElement): IDiscoveredBusiness | null {
    const tags = el.tags ?? {};
    const name = tags['name']?.trim();
    if (!name) return null;

    const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
    const city = tags['addr:city'];
    const address = [street, tags['addr:postcode'], city].filter(Boolean).join(', ');

    return {
      provider: 'osm',
      externalId: `${el.type}/${el.id}`,
      name: name.slice(0, 100),
      website: firstValue(tags['website'] ?? tags['contact:website'] ?? tags['url']),
      phone: firstValue(tags['phone'] ?? tags['contact:phone']),
      email: firstValue(tags['email'] ?? tags['contact:email']),
      address: address || undefined,
      city,
      lat: el.lat ?? el.center?.lat,
      lng: el.lon ?? el.center?.lon,
    };
  }
}
