import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiscoveryService } from '../discovery.service.js';
import { addDiscoveryJob, getDiscoveryJob } from '../../queues/discovery.queue.js';
import { AppError } from '../../middlewares/errorHandler.js';

vi.mock('../../queues/discovery.queue.js', () => ({
  addDiscoveryJob: vi.fn(),
  getDiscoveryJob: vi.fn(),
}));

const params = { provider: 'google' as const, niche: 'legal' as const, location: 'Warsaw', keyword: 'notary', limit: 15 };

describe('DiscoveryService (API)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('startDiscovery should enqueue a job with only the known fields', async () => {
    vi.mocked(addDiscoveryJob).mockResolvedValue({ id: 'disc-9', data: params } as any);

    const result = await DiscoveryService.startDiscovery({ ...params, extra: 'ignored' } as any);

    expect(addDiscoveryJob).toHaveBeenCalledWith(params);
    expect(result).toEqual({ jobId: 'disc-9', params });
  });

  it('getDiscoveryStatus should throw 404 when the job does not exist', async () => {
    vi.mocked(getDiscoveryJob).mockResolvedValue(undefined);
    const error = await DiscoveryService.getDiscoveryStatus('nope').catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(404);
  });

  it('getDiscoveryStatus should report a completed job with its result', async () => {
    const summary = { found: 2, created: 2, skippedNoWebsite: 0, skippedDuplicate: 0, skippedInvalid: 0, leadIds: ['a', 'b'] };
    vi.mocked(getDiscoveryJob).mockResolvedValue({
      id: 'disc-9',
      data: params,
      returnvalue: summary,
      failedReason: undefined,
      attemptsMade: 1,
      timestamp: Date.UTC(2026, 8, 26, 10, 0, 0),
      finishedOn: Date.UTC(2026, 8, 26, 10, 0, 30),
      getState: vi.fn().mockResolvedValue('completed'),
    } as any);

    expect(await DiscoveryService.getDiscoveryStatus('disc-9')).toEqual({
      jobId: 'disc-9',
      state: 'completed',
      params,
      result: summary,
      error: null,
      attemptsMade: 1,
      createdAt: '2026-09-26T10:00:00.000Z',
      finishedAt: '2026-09-26T10:00:30.000Z',
    });
  });

  it('getDiscoveryStatus should report pending and failed jobs', async () => {
    const job = {
      id: 'disc-10',
      data: params,
      returnvalue: null,
      failedReason: 'GOOGLE_PLACES_API_KEY is not configured',
      attemptsMade: 1,
      timestamp: Date.UTC(2026, 8, 26),
      finishedOn: undefined,
      getState: vi.fn().mockResolvedValue('waiting'),
    };
    vi.mocked(getDiscoveryJob).mockResolvedValue(job as any);

    const waiting = await DiscoveryService.getDiscoveryStatus('disc-10');
    expect(waiting).toMatchObject({ state: 'waiting', result: null, error: null, finishedAt: null });

    job.getState.mockResolvedValue('failed');
    const failed = await DiscoveryService.getDiscoveryStatus('disc-10');
    expect(failed).toMatchObject({ state: 'failed', error: 'GOOGLE_PLACES_API_KEY is not configured' });
  });

  describe('reverseGeocode (REV-28)', () => {
    const jsonResponse = (body: unknown, status = 200) =>
      ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

    it('should query Nominatim at city level with the language and User-Agent', async () => {
      const fetchFn = vi.fn().mockResolvedValue(
        jsonResponse({ address: { city: 'Вільня', country: 'Літва', road: 'Gedimino pr.' } }),
      );

      const result = await DiscoveryService.reverseGeocode({ lat: 54.6872, lng: 25.2797, lang: 'be' }, fetchFn);

      expect(result).toEqual({ location: 'Вільня, Літва', city: 'Вільня', country: 'Літва' });
      const [url, init] = fetchFn.mock.calls[0];
      const parsed = new URL(url);
      expect(parsed.searchParams.get('lat')).toBe('54.6872');
      expect(parsed.searchParams.get('lon')).toBe('25.2797');
      expect(parsed.searchParams.get('zoom')).toBe('10');
      expect(parsed.searchParams.get('format')).toBe('jsonv2');
      expect(parsed.searchParams.get('accept-language')).toBe('be');
      expect(init.headers['User-Agent']).toMatch(/RevampBot/);
    });

    it('should omit accept-language when no language is given', async () => {
      const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ address: { city: 'Riga', country: 'Latvia' } }));
      await DiscoveryService.reverseGeocode({ lat: 56.9, lng: 24.1 }, fetchFn);
      expect(new URL(fetchFn.mock.calls[0][0]).searchParams.has('accept-language')).toBe(false);
    });

    it('should fall back from city to town, village and larger areas', async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ address: { town: 'Trakai', country: 'Lithuania' } }))
        .mockResolvedValueOnce(jsonResponse({ address: { village: 'Rudamina', county: 'Vilnius County', country: 'Lithuania' } }))
        .mockResolvedValueOnce(jsonResponse({ address: { state: 'Podlaskie', country: 'Poland' } }))
        .mockResolvedValueOnce(jsonResponse({ address: { country: 'Poland' } }));

      expect((await DiscoveryService.reverseGeocode({ lat: 1, lng: 1 }, fetchFn)).location).toBe('Trakai, Lithuania');
      expect((await DiscoveryService.reverseGeocode({ lat: 1, lng: 1 }, fetchFn)).location).toBe('Rudamina, Lithuania');
      expect((await DiscoveryService.reverseGeocode({ lat: 1, lng: 1 }, fetchFn)).location).toBe('Podlaskie, Poland');
      expect(await DiscoveryService.reverseGeocode({ lat: 1, lng: 1 }, fetchFn)).toEqual({
        location: 'Poland',
        city: undefined,
        country: 'Poland',
      });
    });

    it('should throw 404 when Nominatim finds nothing', async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ error: 'Unable to geocode' }))
        .mockResolvedValueOnce(jsonResponse({ address: { road: 'Somewhere' } }));
      for (let i = 0; i < 2; i++) {
        const error = await DiscoveryService.reverseGeocode({ lat: 0, lng: -30 }, fetchFn).catch((e) => e);
        expect(error).toBeInstanceOf(AppError);
        expect(error.statusCode).toBe(404);
      }
    });

    it('should throw 502 on HTTP errors and network failures', async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({}, 503))
        .mockRejectedValueOnce(new TypeError('fetch failed'));
      for (let i = 0; i < 2; i++) {
        const error = await DiscoveryService.reverseGeocode({ lat: 1, lng: 1 }, fetchFn).catch((e) => e);
        expect(error).toBeInstanceOf(AppError);
        expect(error.statusCode).toBe(502);
      }
    });
  });
});
