import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiClient } from '../../api/client.js';
import {
  DISCOVERY_POLL_INTERVAL_MS,
  discoveryRefetchInterval,
  discoveryStateBucket,
  countCandidates,
  importableIds,
  pruneSelection,
  summarizeImport,
  detectLocation,
  isDiscoveryFinished,
  LocationDetectError,
  validateDiscoveryForm,
} from '../useDiscovery.js';

describe('discovery hook helpers (REV-27)', () => {
  it('isDiscoveryFinished should be true only for completed and failed jobs', () => {
    expect(isDiscoveryFinished({ state: 'completed' })).toBe(true);
    expect(isDiscoveryFinished({ state: 'failed' })).toBe(true);
    expect(isDiscoveryFinished({ state: 'active' })).toBe(false);
    expect(isDiscoveryFinished({ state: 'waiting' })).toBe(false);
    expect(isDiscoveryFinished(undefined)).toBe(false);
    expect(isDiscoveryFinished(null)).toBe(false);
  });

  it('discoveryRefetchInterval should poll until the job finishes', () => {
    expect(discoveryRefetchInterval(undefined)).toBe(DISCOVERY_POLL_INTERVAL_MS);
    expect(discoveryRefetchInterval({ state: 'delayed' })).toBe(DISCOVERY_POLL_INTERVAL_MS);
    expect(discoveryRefetchInterval({ state: 'active' })).toBe(DISCOVERY_POLL_INTERVAL_MS);
    expect(discoveryRefetchInterval({ state: 'completed' })).toBe(false);
    expect(discoveryRefetchInterval({ state: 'failed' })).toBe(false);
  });

  it('discoveryStateBucket should collapse BullMQ states', () => {
    expect(discoveryStateBucket('waiting')).toBe('queued');
    expect(discoveryStateBucket('delayed')).toBe('queued');
    expect(discoveryStateBucket('prioritized')).toBe('queued');
    expect(discoveryStateBucket('waiting-children')).toBe('queued');
    expect(discoveryStateBucket('unknown')).toBe('queued');
    expect(discoveryStateBucket('active')).toBe('running');
    expect(discoveryStateBucket('completed')).toBe('completed');
    expect(discoveryStateBucket('failed')).toBe('failed');
  });

  describe('validateDiscoveryForm', () => {
    it('should return parsed data with defaults on success', () => {
      expect(validateDiscoveryForm({ provider: 'google', niche: 'auto', location: ' Riga ', limit: 5 })).toEqual({
        success: true,
        data: { provider: 'google', niche: 'auto', location: 'Riga', limit: 5 },
      });
      const defaulted = validateDiscoveryForm({ niche: 'dental', location: 'Riga' });
      expect(defaulted.success && defaulted.data.limit).toBe(20);
    });

    it.each([
      [{ niche: 'dental' as const, location: 'R' }, 'discovery.errors.location'],
      [{ niche: 'other' as const, location: 'Riga' }, 'discovery.errors.keyword'],
      [{ niche: 'dental' as const, location: 'Riga', limit: 0 }, 'discovery.errors.limit'],
      [{ niche: 'dental' as const, location: 'Riga', limit: Number.NaN }, 'discovery.errors.limit'],
      [{ niche: 'dental' as const, location: 'Riga', provider: 'bing' as never }, 'discovery.errors.invalid'],
    ])('should map %j to %s', (input, errorKey) => {
      expect(validateDiscoveryForm(input)).toEqual({ success: false, errorKey });
    });
  });

  describe('detectLocation (REV-28)', () => {
    const position = { coords: { latitude: 54.6872, longitude: 25.2797 } } as GeolocationPosition;
    const geoResolving = {
      getCurrentPosition: vi.fn((ok: PositionCallback, _fail?: PositionErrorCallback | null, _options?: PositionOptions) =>
        ok(position),
      ),
    };
    const geoFailing = (code: number) => ({
      getCurrentPosition: vi.fn((_ok: PositionCallback, fail?: PositionErrorCallback | null) =>
        fail?.({ code, message: 'x' } as GeolocationPositionError),
      ),
    });
    const errorKeyOf = (promise: Promise<unknown>) =>
      promise.then(
        () => null,
        (e) => (e instanceof LocationDetectError ? e.errorKey : e),
      );

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should reverse-geocode the position in the UI language with a coarse, cached fix', async () => {
      const spy = vi
        .spyOn(apiClient, 'reverseGeocode')
        .mockResolvedValue({ location: 'Вільня, Літва', city: 'Вільня', country: 'Літва' });

      await expect(detectLocation('be', geoResolving)).resolves.toBe('Вільня, Літва');
      expect(spy).toHaveBeenCalledWith(54.6872, 25.2797, 'be');
      const options = geoResolving.getCurrentPosition.mock.calls[0]?.[2];
      expect(options).toMatchObject({ enableHighAccuracy: false, timeout: 10000 });
      expect(options?.maximumAge).toBeGreaterThan(0);
    });

    it('should report a browser without geolocation', async () => {
      expect(await errorKeyOf(detectLocation('en', undefined))).toBe('discovery.errors.geoUnsupported');
    });

    it.each([
      [1, 'discovery.errors.geoDenied'],
      [2, 'discovery.errors.geoUnavailable'],
      [3, 'discovery.errors.geoTimeout'],
      [99, 'discovery.errors.geoUnavailable'],
    ])('should map geolocation error code %i to %s', async (code, key) => {
      const spy = vi.spyOn(apiClient, 'reverseGeocode');
      expect(await errorKeyOf(detectLocation('en', geoFailing(code)))).toBe(key);
      expect(spy).not.toHaveBeenCalled();
    });

    it('should report a failed place lookup', async () => {
      vi.spyOn(apiClient, 'reverseGeocode').mockRejectedValue(new Error('No place found at these coordinates'));
      expect(await errorKeyOf(detectLocation('en', geoResolving))).toBe('discovery.errors.geoLookupFailed');
    });
  });

  describe('candidate review helpers (REV-29)', () => {
    const c = (id: string, status: any) => ({ provider: 'osm' as const, externalId: id, name: id, status });
    const candidates = [c('a', 'new'), c('b', 'new'), c('c', 'existing_lead'), c('d', 'no_website'), c('e', 'duplicate')];

    it('countCandidates should count every status', () => {
      expect(countCandidates(candidates)).toEqual({ new: 2, existing_lead: 1, duplicate: 1, no_website: 1, invalid: 0 });
      expect(countCandidates([])).toEqual({ new: 0, existing_lead: 0, duplicate: 0, no_website: 0, invalid: 0 });
    });

    it('importableIds should return only new candidates', () => {
      expect(importableIds(candidates)).toEqual(['a', 'b']);
    });

    it('pruneSelection should drop ids that are no longer importable', () => {
      const afterImport = [c('a', 'existing_lead'), c('b', 'new')];
      expect([...pruneSelection(new Set(['a', 'b', 'zzz']), afterImport)]).toEqual(['b']);
    });

    it('summarizeImport should split imported, skipped and failed', () => {
      expect(
        summarizeImport({
          imported: 2,
          results: [
            { externalId: '1', outcome: 'imported' },
            { externalId: '2', outcome: 'imported' },
            { externalId: '3', outcome: 'existing_lead' },
            { externalId: '4', outcome: 'not_found' },
            { externalId: '5', outcome: 'failed' },
          ],
        }),
      ).toEqual({ imported: 2, skipped: 2, failed: 1 });
    });
  });
});
