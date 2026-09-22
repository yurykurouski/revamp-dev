import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { trackingService } from '../../services/tracking.service.js';

vi.mock('../../services/tracking.service.js', () => ({
  trackingService: {
    recordEmailOpen: vi.fn().mockResolvedValue({ success: true, leadId: 'lead-1' }),
    recordClick: vi.fn().mockResolvedValue({
      success: true,
      redirectUrl: 'http://localhost:9000/revamp-demos/v/sample/index.html?token=tok-click',
      leadId: 'lead-1',
    }),
    recordMvpEvent: vi.fn().mockResolvedValue({ success: true, engaged: true }),
  },
}));

describe('Track Routes Integration Tests (REV-18 Telemetry)', () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/track/open/:token.gif', () => {
    it('should return 200, image/gif, no-cache headers, and invoke recordEmailOpen', async () => {
      const res = await request(app).get('/api/v1/track/open/tok-pixel-123.gif');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/gif');
      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.headers['cache-control']).toContain('no-cache');
      expect(res.headers['pragma']).toBe('no-cache');
      expect(res.headers['expires']).toBe('0');
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.length).toBe(42); // 1x1 transparent GIF buffer length

      expect(trackingService.recordEmailOpen).toHaveBeenCalledWith(
        'tok-pixel-123',
        expect.objectContaining({
          ip: expect.any(String),
        }),
      );
    });

    it('should also support /open/:token without .gif extension', async () => {
      const res = await request(app).get('/api/v1/track/open/tok-pixel-456');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/gif');
      expect(trackingService.recordEmailOpen).toHaveBeenCalledWith(
        'tok-pixel-456',
        expect.anything(),
      );
    });
  });

  describe('GET /api/v1/track/click/:token', () => {
    it('should invoke recordClick and respond with 302 redirect to MVP demo URL', async () => {
      const res = await request(app).get('/api/v1/track/click/tok-click-789');

      expect(res.status).toBe(302);
      expect(res.headers['location']).toBe(
        'http://localhost:9000/revamp-demos/v/sample/index.html?token=tok-click',
      );
      expect(trackingService.recordClick).toHaveBeenCalledWith(
        'tok-click-789',
        expect.objectContaining({
          ip: expect.any(String),
        }),
      );
    });
  });

  describe('POST /api/v1/track/mvp-event', () => {
    it('should validate telemetry payload and return 200 with engaged status', async () => {
      const res = await request(app)
        .post('/api/v1/track/mvp-event')
        .send({
          token: 'tok-event-111',
          eventType: 'dwell_time',
          dwellTimeSeconds: 35,
          scrollDepthPercent: 75,
          metadata: { device: 'mobile' },
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        engaged: true,
      });
      expect(trackingService.recordMvpEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'tok-event-111',
          eventType: 'dwell_time',
          dwellTimeSeconds: 35,
        }),
        expect.anything(),
      );
    });

    it('should return 400 when payload fails validation', async () => {
      const res = await request(app)
        .post('/api/v1/track/mvp-event')
        .send({
          // Missing token, leadId, mvpProjectId
          eventType: 'invalid_event',
          dwellTimeSeconds: -10,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors).toBeDefined();
      expect(trackingService.recordMvpEvent).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/track/revamp-tracker.js', () => {
    it('should serve client tracking script with javascript mime-type and caching headers', async () => {
      const res = await request(app).get('/api/v1/track/revamp-tracker.js');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/javascript');
      expect(res.headers['cache-control']).toContain('public');
      expect(res.text).toContain('revamp-tracker.js');
      expect(res.text).toContain('sendBeacon');
      expect(res.text).toContain('dwell_time');
      expect(res.text).toContain('cta_click');
    });
  });
});
