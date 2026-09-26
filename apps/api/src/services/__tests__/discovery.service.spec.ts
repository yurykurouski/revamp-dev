import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiscoveryService } from '../discovery.service.js';
import { addDiscoveryJob, getDiscoveryJob } from '../../queues/discovery.queue.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { Lead } from '../../models/Lead.model.js';
import { LeadService } from '../lead.service.js';

vi.mock('../../queues/discovery.queue.js', () => ({
  addDiscoveryJob: vi.fn(),
  getDiscoveryJob: vi.fn(),
}));
vi.mock('../../models/Lead.model.js');
vi.mock('../lead.service.js');

const mockExistingLeads = (domains: string[]) => {
  vi.spyOn(Lead, 'find').mockReturnValue({
    lean: () => ({ exec: vi.fn().mockResolvedValue(domains.map((domain) => ({ _id: `lead-${domain}`, domain }))) }),
  } as any);
};

const candidate = (id: string, extra: Record<string, unknown> = {}) => ({
  provider: 'osm' as const,
  externalId: `node/${id}`,
  name: `Clinic ${id}`,
  status: 'new' as const,
  website: `https://clinic-${id}.lt/`,
  domain: `clinic-${id}.lt`,
  ...extra,
});

const completedJob = (candidates: unknown[], state = 'completed') => ({
  id: 'disc-9',
  data: { provider: 'osm', niche: 'dental', location: 'Vilnius, Lithuania', limit: 10 },
  returnvalue: { found: candidates.length, candidates },
  attemptsMade: 1,
  timestamp: Date.UTC(2026, 8, 26),
  finishedOn: Date.UTC(2026, 8, 26),
  getState: vi.fn().mockResolvedValue(state),
});

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
    mockExistingLeads([]);
    const summary = { found: 1, candidates: [candidate('1')] };
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

  describe('getDiscoveryStatus candidate refresh (REV-29)', () => {
    it('should mark new candidates that have since become leads', async () => {
      mockExistingLeads(['clinic-2.lt']);
      vi.mocked(getDiscoveryJob).mockResolvedValue(
        completedJob([candidate('1'), candidate('2'), candidate('3', { status: 'no_website', website: undefined, domain: undefined })]) as any,
      );

      const { result } = await DiscoveryService.getDiscoveryStatus('disc-9');

      expect(Lead.find).toHaveBeenCalledWith({ domain: { $in: ['clinic-1.lt', 'clinic-2.lt'] } }, { domain: 1 });
      expect(result?.candidates.map((c) => [c.externalId, c.status, c.leadId])).toEqual([
        ['node/1', 'new', undefined],
        ['node/2', 'existing_lead', 'lead-clinic-2.lt'],
        ['node/3', 'no_website', undefined],
      ]);
    });

    it('should skip the lead lookup when nothing is new, and pass legacy results through', async () => {
      vi.mocked(getDiscoveryJob).mockResolvedValue(completedJob([candidate('1', { status: 'duplicate' })]) as any);
      await DiscoveryService.getDiscoveryStatus('disc-9');
      expect(Lead.find).not.toHaveBeenCalled();

      const legacy = { found: 1, created: 1, leadIds: ['x'] };
      expect(await DiscoveryService.withCurrentLeads(legacy as any)).toBe(legacy);
      expect(await DiscoveryService.withCurrentLeads(null)).toBeNull();
    });
  });

  describe('importCandidates (REV-29)', () => {
    beforeEach(() => {
      mockExistingLeads([]);
      let n = 0;
      vi.mocked(LeadService.createLead).mockImplementation(async () => {
        const id = `new-lead-${++n}`;
        return { lead: { _id: { toString: () => id } }, auditId: 'a', jobId: 'j' } as any;
      });
    });

    it('should create leads from the stored candidates with discovery tags', async () => {
      vi.mocked(getDiscoveryJob).mockResolvedValue(
        completedJob([
          candidate('1', { email: 'hi@clinic-1.lt', phone: '+370 600', city: 'Vilnius' }),
          candidate('2'),
        ]) as any,
      );

      const result = await DiscoveryService.importCandidates('disc-9', { externalIds: ['node/1', 'node/2'] });

      expect(LeadService.createLead).toHaveBeenNthCalledWith(
        1,
        {
          businessName: 'Clinic 1',
          originalUrl: 'https://clinic-1.lt/',
          contactEmail: 'hi@clinic-1.lt',
          niche: 'dental',
          city: 'Vilnius',
          contactPhone: '+370 600',
        },
        { tags: ['discovered', 'source:osm'] },
      );
      // No listed email: guessed address, tagged for replacement after the audit; job location as city
      expect(LeadService.createLead).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ contactEmail: 'info@clinic-2.lt', city: 'Vilnius, Lithuania' }),
        { tags: ['discovered', 'source:osm', 'email-guessed'] },
      );
      expect(result).toEqual({
        imported: 2,
        results: [
          { externalId: 'node/1', outcome: 'imported', leadId: 'new-lead-1' },
          { externalId: 'node/2', outcome: 'imported', leadId: 'new-lead-2' },
        ],
      });
    });

    it('should report unknown, non-importable, and already-imported ids without creating leads', async () => {
      mockExistingLeads(['clinic-4.lt']);
      vi.mocked(getDiscoveryJob).mockResolvedValue(
        completedJob([
          candidate('2', { status: 'no_website', website: undefined, domain: undefined }),
          candidate('3', { status: 'existing_lead', leadId: 'old-lead' }),
          candidate('4'),
        ]) as any,
      );

      const result = await DiscoveryService.importCandidates('disc-9', {
        externalIds: ['node/404', 'node/2', 'node/3', 'node/4'],
      });

      expect(LeadService.createLead).not.toHaveBeenCalled();
      expect(result).toEqual({
        imported: 0,
        results: [
          { externalId: 'node/404', outcome: 'not_found' },
          { externalId: 'node/2', outcome: 'not_importable' },
          { externalId: 'node/3', outcome: 'existing_lead', leadId: 'old-lead' },
          { externalId: 'node/4', outcome: 'existing_lead', leadId: 'lead-clinic-4.lt' },
        ],
      });
    });

    it('should record failures and keep importing the rest', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(getDiscoveryJob).mockResolvedValue(completedJob([candidate('1'), candidate('2')]) as any);
      vi.mocked(LeadService.createLead).mockRejectedValueOnce(new Error('validation failed'));

      const result = await DiscoveryService.importCandidates('disc-9', { externalIds: ['node/1', 'node/2'] });

      expect(result.imported).toBe(1);
      expect(result.results.map((r) => r.outcome)).toEqual(['failed', 'imported']);
    });

    it('should throw 404 for an unknown job and 409 for an unfinished one', async () => {
      vi.mocked(getDiscoveryJob).mockResolvedValue(undefined);
      const missing = await DiscoveryService.importCandidates('x', { externalIds: ['node/1'] }).catch((e) => e);
      expect(missing).toBeInstanceOf(AppError);
      expect(missing.statusCode).toBe(404);

      vi.mocked(getDiscoveryJob).mockResolvedValue(completedJob([candidate('1')], 'active') as any);
      const running = await DiscoveryService.importCandidates('x', { externalIds: ['node/1'] }).catch((e) => e);
      expect(running.statusCode).toBe(409);
      expect(LeadService.createLead).not.toHaveBeenCalled();
    });

    it('should treat a legacy job without candidates as having nothing to import', async () => {
      vi.mocked(getDiscoveryJob).mockResolvedValue({
        ...completedJob([]),
        returnvalue: { found: 1, created: 1, leadIds: ['x'] },
      } as any);
      const result = await DiscoveryService.importCandidates('disc-9', { externalIds: ['node/1'] });
      expect(result).toEqual({ imported: 0, results: [{ externalId: 'node/1', outcome: 'not_found' }] });
    });
  });
});
