import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { DiscoveryService } from '../../services/discovery.service.js';
import { AppError } from '../../middlewares/errorHandler.js';

vi.mock('../../services/discovery.service.js');

describe('Discovery Routes Integration Tests (REV-26)', () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/v1/discovery', () => {
    it('should return 202 with the job id and pass the validated, defaulted payload', async () => {
      vi.mocked(DiscoveryService.startDiscovery).mockResolvedValue({
        jobId: 'disc-1',
        params: { provider: 'osm', niche: 'dental', location: 'Vilnius', limit: 20 },
      });

      const res = await request(app).post('/api/v1/discovery').send({ niche: 'dental', location: ' Vilnius ' });

      expect(res.status).toBe(202);
      expect(res.body).toEqual({
        success: true,
        message: 'Discovery job queued successfully',
        data: { jobId: 'disc-1', params: { provider: 'osm', niche: 'dental', location: 'Vilnius', limit: 20 } },
      });
      expect(DiscoveryService.startDiscovery).toHaveBeenCalledWith({
        provider: 'osm',
        niche: 'dental',
        location: 'Vilnius',
        limit: 20,
      });
    });

    it.each([
      [{ niche: 'dental' }, 'missing location'],
      [{ niche: 'dental', location: 'Vilnius', limit: 500 }, 'limit above 100'],
      [{ niche: 'dental', location: 'Vilnius', provider: 'yandex' }, 'unknown provider'],
      [{ niche: 'other', location: 'Vilnius' }, 'other without keyword'],
    ])('should return 400 for %j (%s)', async (body) => {
      const res = await request(app).post('/api/v1/discovery').send(body);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(DiscoveryService.startDiscovery).not.toHaveBeenCalled();
    });

    it('should return 500 when the queue is unavailable', async () => {
      vi.mocked(DiscoveryService.startDiscovery).mockRejectedValue(new Error('Redis down'));
      const res = await request(app).post('/api/v1/discovery').send({ niche: 'auto', location: 'Riga' });
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/discovery/:jobId', () => {
    it('should return 200 with the job state and result', async () => {
      const status = {
        jobId: 'disc-1',
        state: 'completed',
        params: { provider: 'osm', niche: 'dental', location: 'Vilnius', limit: 20 },
        result: { found: 5, created: 3, skippedNoWebsite: 1, skippedDuplicate: 1, skippedInvalid: 0, leadIds: ['a', 'b', 'c'] },
        error: null,
        attemptsMade: 1,
        createdAt: '2026-09-26T10:00:00.000Z',
        finishedAt: '2026-09-26T10:00:30.000Z',
      };
      vi.mocked(DiscoveryService.getDiscoveryStatus).mockResolvedValue(status as any);

      const res = await request(app).get('/api/v1/discovery/disc-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: status });
      expect(DiscoveryService.getDiscoveryStatus).toHaveBeenCalledWith('disc-1');
    });

    it('should return 404 for an unknown job', async () => {
      vi.mocked(DiscoveryService.getDiscoveryStatus).mockRejectedValue(new AppError('Discovery job not found', 404));
      const res = await request(app).get('/api/v1/discovery/missing');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/discovery/reverse-geocode (REV-28)', () => {
    it('should return 200 with the place and pass coerced coordinates', async () => {
      vi.mocked(DiscoveryService.reverseGeocode).mockResolvedValue({
        location: 'Vilnius, Lithuania',
        city: 'Vilnius',
        country: 'Lithuania',
      });

      const res = await request(app).get('/api/v1/discovery/reverse-geocode?lat=54.68&lng=25.28&lang=en');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: { location: 'Vilnius, Lithuania', city: 'Vilnius', country: 'Lithuania' },
      });
      expect(DiscoveryService.reverseGeocode).toHaveBeenCalledWith({ lat: 54.68, lng: 25.28, lang: 'en' });
      // Not swallowed by the /:jobId route
      expect(DiscoveryService.getDiscoveryStatus).not.toHaveBeenCalled();
    });

    it.each(['lat=91&lng=0', 'lng=10', 'lat=abc&lng=1', 'lat=1&lng=1&lang=bad!'])(
      'should return 400 for %s',
      async (query) => {
        const res = await request(app).get(`/api/v1/discovery/reverse-geocode?${query}`);
        expect(res.status).toBe(400);
        expect(DiscoveryService.reverseGeocode).not.toHaveBeenCalled();
      },
    );

    it.each([
      [404, 'No place found at these coordinates'],
      [502, 'Reverse geocoding service is unavailable'],
    ])('should pass through %i errors', async (status, message) => {
      vi.mocked(DiscoveryService.reverseGeocode).mockRejectedValue(new AppError(message, status));
      const res = await request(app).get('/api/v1/discovery/reverse-geocode?lat=1&lng=1');
      expect(res.status).toBe(status);
      expect(res.body.message).toBe(message);
    });
  });
});
