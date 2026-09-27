import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { trackingService } from '../../services/tracking.service.js';
import { env } from '../../config/env.js';

vi.mock('../../services/tracking.service.js', () => ({
  trackingService: {
    recordEmailOpen: vi.fn().mockResolvedValue({ success: true, leadId: 'lead-1' }),
    recordClick: vi.fn().mockResolvedValue({
      success: true,
      redirectUrl: 'http://localhost:9000/revamp-demos/v/sample/index.html?token=tok-click',
      leadId: 'lead-1',
    }),
    recordMvpEvent: vi.fn().mockResolvedValue({ success: true, engaged: true }),
    findUnsubscribeCampaign: vi.fn(),
    recordUnsubscribe: vi.fn(),
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

    it('allows cross-origin loading from the MVP storage host (REV-52)', async () => {
      const res = await request(app).get('/api/v1/track/revamp-tracker.js');

      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });
  });

  describe('CORS for MVP telemetry (REV-52)', () => {
    const previewOrigin = new URL(env.S3_ENDPOINT).origin;

    it('answers the credentialed sendBeacon preflight from the MVP storage origin', async () => {
      const res = await request(app)
        .options('/api/v1/track/mvp-event')
        .set('Origin', previewOrigin)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe(previewOrigin);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('accepts mvp-event beacons from the production preview domain', async () => {
      const origin = `https://${env.PREVIEW_DOMAIN}`;
      const res = await request(app)
        .post('/api/v1/track/mvp-event')
        .set('Origin', origin)
        .send({ token: 'tok-mvp-123', eventType: 'pageview' });

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
    });

    it('does not allow unknown origins', async () => {
      const res = await request(app)
        .options('/api/v1/track/mvp-event')
        .set('Origin', 'https://evil.example.com')
        .set('Access-Control-Request-Method', 'POST');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('does not open the rest of the API to the preview origin', async () => {
      const res = await request(app)
        .options('/api/v1/leads')
        .set('Origin', previewOrigin)
        .set('Access-Control-Request-Method', 'GET');

      expect(res.headers['access-control-allow-origin']).toBe(env.CORS_ORIGIN);
      expect(res.headers['access-control-allow-origin']).not.toBe(previewOrigin);
    });

    it('keeps credentialed CORS for the dashboard origin', async () => {
      const res = await request(app)
        .options('/api/v1/track/mvp-event')
        .set('Origin', env.CORS_ORIGIN)
        .set('Access-Control-Request-Method', 'POST');

      expect(res.headers['access-control-allow-origin']).toBe(env.CORS_ORIGIN);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  describe('/api/v1/track/unsubscribe/:token (REV-73)', () => {
    it('GET shows a confirmation form and does not unsubscribe, so link scanners cannot opt anyone out', async () => {
      vi.mocked(trackingService.findUnsubscribeCampaign).mockResolvedValue({ found: true, unsubscribed: false });

      const res = await request(app).get('/api/v1/track/unsubscribe/tok-1');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.text).toContain('<form method="post">');
      expect(trackingService.findUnsubscribeCampaign).toHaveBeenCalledWith('tok-1');
      expect(trackingService.recordUnsubscribe).not.toHaveBeenCalled();
    });

    it('GET tells an already unsubscribed recipient so, without a form', async () => {
      vi.mocked(trackingService.findUnsubscribeCampaign).mockResolvedValue({ found: true, unsubscribed: true });

      const res = await request(app).get('/api/v1/track/unsubscribe/tok-1');

      expect(res.status).toBe(200);
      expect(res.text).toContain('You are unsubscribed');
      expect(res.text).not.toContain('<form');
    });

    it.each(['unknown-token', 'test-send'])('GET answers 404 for the unknown token %s', async (token) => {
      vi.mocked(trackingService.findUnsubscribeCampaign).mockResolvedValue({ found: false, unsubscribed: false });

      const res = await request(app).get(`/api/v1/track/unsubscribe/${token}`);

      expect(res.status).toBe(404);
      expect(res.text).toContain('Link not recognised');
    });

    it('POST with the RFC 8058 one-click body unsubscribes and answers 200', async () => {
      vi.mocked(trackingService.recordUnsubscribe).mockResolvedValue({
        found: true,
        alreadyUnsubscribed: false,
        leadId: 'lead-1',
      });

      const res = await request(app)
        .post('/api/v1/track/unsubscribe/tok-1')
        .type('form')
        .send('List-Unsubscribe=One-Click');

      expect(res.status).toBe(200);
      expect(res.text).toContain('You are unsubscribed');
      expect(trackingService.recordUnsubscribe).toHaveBeenCalledWith(
        'tok-1',
        expect.objectContaining({ ip: expect.any(String) }),
      );
    });

    it('POST again for an unsubscribed token still answers 200', async () => {
      vi.mocked(trackingService.recordUnsubscribe).mockResolvedValue({
        found: true,
        alreadyUnsubscribed: true,
        leadId: 'lead-1',
      });

      const res = await request(app).post('/api/v1/track/unsubscribe/tok-1');

      expect(res.status).toBe(200);
      expect(res.text).toContain('You are unsubscribed');
    });

    it('POST answers 404 for an unknown token', async () => {
      vi.mocked(trackingService.recordUnsubscribe).mockResolvedValue({ found: false, alreadyUnsubscribed: false });

      const res = await request(app).post('/api/v1/track/unsubscribe/test-send');

      expect(res.status).toBe(404);
      expect(res.text).toContain('Link not recognised');
    });

    it('passes service errors to the error handler', async () => {
      vi.mocked(trackingService.recordUnsubscribe).mockRejectedValue(new Error('db down'));

      const res = await request(app).post('/api/v1/track/unsubscribe/tok-1');

      expect(res.status).toBe(500);
    });
  });
});
