import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { QueryClient, QueryObserver, environmentManager } from '@tanstack/react-query';
import { IDiscoveryCandidate, IDiscoveryJobStatus } from '@revamp/shared-types';
import { apiClient } from '../../api/client.js';
import {
  DISCOVERY_POLL_INTERVAL_MS,
  discoveryRefetchInterval,
  discoveryIndicator,
  discoveryFinishAction,
  discoveryStatusQueryOptions,
  newCandidateCount,
  discoveryStateBucket,
  countCandidates,
  discoverySearchOutcome,
  importableIds,
  visibleCandidates,
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

  describe('existing leads and search outcome (REV-35)', () => {
    const c = (id: string, status: any) => ({ provider: 'osm' as const, externalId: id, name: id, status });
    const candidates = [
      c('a', 'new'),
      c('b', 'existing_lead'),
      c('c', 'no_website'),
      c('d', 'existing_lead'),
      c('e', 'duplicate'),
      c('f', 'invalid'),
    ];
    const ids = (list: Array<{ externalId: string }>) => list.map((x) => x.externalId);

    it('visibleCandidates should hide existing leads and other skipped listings by default', () => {
      expect(ids(visibleCandidates(candidates, { showExisting: false, showSkipped: false }))).toEqual(['a']);
    });

    it('visibleCandidates should show existing leads with their toggle, in provider order', () => {
      expect(ids(visibleCandidates(candidates, { showExisting: true, showSkipped: false }))).toEqual(['a', 'b', 'd']);
    });

    it('visibleCandidates should show other skipped listings independently of existing leads', () => {
      expect(ids(visibleCandidates(candidates, { showExisting: false, showSkipped: true }))).toEqual(['a', 'c', 'e', 'f']);
      expect(ids(visibleCandidates(candidates, { showExisting: true, showSkipped: true }))).toEqual(ids(candidates));
    });

    it('countCandidates should count existing leads for the summary line', () => {
      expect(countCandidates(candidates)).toMatchObject({ new: 1, existing_lead: 2 });
    });

    const counts = (n: number) => ({ new: n, existing_lead: 4, duplicate: 0, no_website: 0, invalid: 0 });

    it('discoverySearchOutcome should be filled when the search found `limit` new businesses', () => {
      expect(discoverySearchOutcome({ counts: counts(10), exhausted: true }, 10)).toBe('filled');
      expect(discoverySearchOutcome({ counts: counts(10), exhausted: false }, 10)).toBe('filled');
    });

    it('discoverySearchOutcome should tell an exhausted area from a request cap', () => {
      expect(discoverySearchOutcome({ counts: counts(3), exhausted: true }, 10)).toBe('exhausted');
      expect(discoverySearchOutcome({ counts: counts(3), exhausted: false }, 10)).toBe('capped');
    });

    it('discoverySearchOutcome should treat jobs from before REV-35 as filled', () => {
      expect(discoverySearchOutcome({}, 10)).toBe('filled');
      expect(discoverySearchOutcome({ counts: counts(0) }, 10)).toBe('filled');
    });
  });
});

describe('background discovery indicator (REV-40)', () => {
  const base = { activeJobId: 'disc-1', resultsSeen: false };

  it('is idle without a job', () => {
    expect(discoveryIndicator({ ...base, activeJobId: null })).toBe('idle');
    expect(discoveryIndicator({ ...base, activeJobId: null, status: { state: 'completed' } })).toBe('idle');
  });

  it('shows progress while the job is queued or running, including before the first status arrives', () => {
    expect(discoveryIndicator({ ...base })).toBe('running');
    expect(discoveryIndicator({ ...base, status: { state: 'waiting' } })).toBe('running');
    expect(discoveryIndicator({ ...base, status: { state: 'delayed' } })).toBe('running');
    expect(discoveryIndicator({ ...base, status: { state: 'active' } })).toBe('running');
  });

  it('keeps showing progress even if the operator already saw an earlier state', () => {
    expect(discoveryIndicator({ ...base, resultsSeen: true, status: { state: 'active' } })).toBe('running');
  });

  it('shows results ready on completion and an error on failure', () => {
    expect(discoveryIndicator({ ...base, status: { state: 'completed' } })).toBe('ready');
    expect(discoveryIndicator({ ...base, status: { state: 'failed' } })).toBe('failed');
    expect(discoveryIndicator({ ...base, isError: true })).toBe('failed');
  });

  it('clears once the operator has seen the outcome', () => {
    const seen = { ...base, resultsSeen: true };
    expect(discoveryIndicator({ ...seen, status: { state: 'completed' } })).toBe('idle');
    expect(discoveryIndicator({ ...seen, status: { state: 'failed' } })).toBe('idle');
    expect(discoveryIndicator({ ...seen, isError: true })).toBe('idle');
  });

  it('newCandidateCount counts only importable businesses', () => {
    const candidate = (externalId: string, status: IDiscoveryCandidate['status']) =>
      ({ externalId, status }) as IDiscoveryCandidate;
    expect(
      newCandidateCount({ candidates: [candidate('a', 'new'), candidate('b', 'new'), candidate('c', 'existing_lead')] }),
    ).toBe(2);
    expect(newCandidateCount({ candidates: [] })).toBe(0);
    expect(newCandidateCount(null)).toBe(0);
    expect(newCandidateCount(undefined)).toBe(0);
    // Pre-REV-29 jobs kept no candidate list
    expect(newCandidateCount({ candidates: undefined as unknown as IDiscoveryCandidate[] })).toBe(0);
  });

  describe('status polling', () => {
    // Query-core never schedules refetch intervals on the server, which is what Node looks like
    const wasServer = environmentManager.isServer();
    beforeAll(() => environmentManager.setIsServer(() => false));
    afterAll(() => environmentManager.setIsServer(() => wasServer));

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    const status = (state: IDiscoveryJobStatus['state']) => ({ jobId: 'disc-1', state }) as IDiscoveryJobStatus;

    /** Subscribes like a mounted component and returns how often the API was called after `ms` */
    async function pollFor(states: IDiscoveryJobStatus['state'][], ms: number): Promise<number> {
      vi.useFakeTimers();
      const spy = vi.spyOn(apiClient, 'getDiscoveryStatus');
      states.forEach((state) => spy.mockResolvedValueOnce(status(state)));
      spy.mockResolvedValue(status(states[states.length - 1]));

      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const observer = new QueryObserver(client, discoveryStatusQueryOptions('disc-1'));
      const unsubscribe = observer.subscribe(() => {});
      await vi.advanceTimersByTimeAsync(ms);
      unsubscribe();
      client.clear();
      return spy.mock.calls.length;
    }

    it('keeps polling while the job is queued or running', async () => {
      expect(await pollFor(['waiting', 'active'], DISCOVERY_POLL_INTERVAL_MS * 3 + 10)).toBe(4);
    });

    it('stops polling once the job completes', async () => {
      expect(await pollFor(['active', 'completed'], DISCOVERY_POLL_INTERVAL_MS * 5)).toBe(2);
    });

    it('stops polling once the job fails', async () => {
      expect(await pollFor(['waiting', 'failed'], DISCOVERY_POLL_INTERVAL_MS * 5)).toBe(2);
    });

    it('does not poll without a job', async () => {
      vi.useFakeTimers();
      const spy = vi.spyOn(apiClient, 'getDiscoveryStatus');
      const client = new QueryClient();
      const unsubscribe = new QueryObserver(client, discoveryStatusQueryOptions(null)).subscribe(() => {});
      await vi.advanceTimersByTimeAsync(DISCOVERY_POLL_INTERVAL_MS * 3);
      unsubscribe();
      expect(spy).not.toHaveBeenCalled();
    });
  });
});

describe('background discovery finish (REV-41)', () => {
  const candidate = (externalId: string, status: IDiscoveryCandidate['status']) => ({ externalId, status }) as IDiscoveryCandidate;
  const completed = (...statuses: IDiscoveryCandidate['status'][]) =>
    ({ state: 'completed', result: { candidates: statuses.map((st, i) => candidate(`c${i}`, st)) } }) as IDiscoveryJobStatus;
  const base = { activeJobId: 'disc-1', resultsSeen: false, isOpen: false, notifiedJobId: null };

  it('announces new businesses when the job completes with some', () => {
    expect(discoveryFinishAction({ ...base, status: completed('new', 'existing_lead') })).toBe('notifyReady');
  });

  it('shows a notice instead when nothing new was found', () => {
    expect(discoveryFinishAction({ ...base, status: completed() })).toBe('notifyEmpty');
    expect(discoveryFinishAction({ ...base, status: completed('existing_lead', 'no_website') })).toBe('notifyEmpty');
    // Pre-REV-29 jobs kept no candidate list
    expect(discoveryFinishAction({ ...base, status: { state: 'completed', result: {} } as IDiscoveryJobStatus })).toBe('notifyEmpty');
  });

  it('shows a failure notice when the job or its status request fails', () => {
    expect(discoveryFinishAction({ ...base, status: { state: 'failed' } })).toBe('notifyFailed');
    expect(discoveryFinishAction({ ...base, isError: true })).toBe('notifyFailed');
  });

  it('does nothing while the job is queued or running', () => {
    expect(discoveryFinishAction({ ...base })).toBe('none');
    expect(discoveryFinishAction({ ...base, status: { state: 'waiting' } })).toBe('none');
    expect(discoveryFinishAction({ ...base, status: { state: 'active' } })).toBe('none');
  });

  it('does nothing without a job', () => {
    expect(discoveryFinishAction({ ...base, activeJobId: null, status: completed('new') })).toBe('none');
  });

  it('does nothing when the modal is already open', () => {
    expect(discoveryFinishAction({ ...base, isOpen: true, status: completed('new') })).toBe('none');
    expect(discoveryFinishAction({ ...base, isOpen: true, status: { state: 'failed' } })).toBe('none');
  });

  it('announces once per job: not again after it was announced or seen', () => {
    expect(discoveryFinishAction({ ...base, notifiedJobId: 'disc-1', status: completed('new') })).toBe('none');
    expect(discoveryFinishAction({ ...base, resultsSeen: true, status: completed('new') })).toBe('none');
    expect(discoveryFinishAction({ ...base, resultsSeen: true, isError: true })).toBe('none');
  });

  it('announces a new job even if an earlier one was announced', () => {
    expect(discoveryFinishAction({ ...base, notifiedJobId: 'disc-0', status: completed('new') })).toBe('notifyReady');
  });
});
