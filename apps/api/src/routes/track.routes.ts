import { Router, Request, Response, NextFunction } from 'express';
import { MvpTrackEventSchema } from '@revamp/validation';
import { validateBody } from '../middlewares/validate.js';
import { trackingService } from '../services/tracking.service.js';
import { getTrackerScript } from '../services/tracker-script.js';

const router = Router();

// 1x1 transparent GIF buffer (43 bytes)
const TRANSPARENT_GIF_BUFFER = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

/**
 * GET /track/open/:token.gif (or /track/open/:token)
 * Renders 1x1 transparent GIF, records open in MongoDB and transitions Lead to OPENED
 */
router.get(
  ['/open/:token.gif', '/open/:token'],
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawToken = req.params['token'] || '';
      const token = rawToken.replace(/\.gif$/i, '');

      // Asynchronously process telemetry without blocking client response
      await trackingService.recordEmailOpen(token, {
        ip: req.ip,
        userAgent: req.headers['user-agent'] as string | undefined,
        referer: req.headers['referer'] as string | undefined,
      });

      res.writeHead(200, {
        'Content-Type': 'image/gif',
        'Content-Length': TRANSPARENT_GIF_BUFFER.length,
        'Cache-Control': 'no-store, no-cache, must-revalidate, private, post-check=0, pre-check=0',
        Pragma: 'no-cache',
        Expires: '0',
      });
      res.end(TRANSPARENT_GIF_BUFFER);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /track/click/:token
 * Records click in MongoDB, transitions Lead to CLICKED, and issues 302 redirect to MVP
 */
router.get(
  '/click/:token',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = req.params['token'] || '';

      const result = await trackingService.recordClick(token, {
        ip: req.ip,
        userAgent: req.headers['user-agent'] as string | undefined,
        referer: req.headers['referer'] as string | undefined,
      });

      res.redirect(302, result.redirectUrl);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /track/mvp-event
 * Ingests Beacon API / fetch events (dwell_time, cta_click, booking_intent, scroll_depth)
 * Transitions Lead to ENGAGED when dwellTimeSeconds >= 30 or on CTA/booking interaction
 */
router.post(
  '/mvp-event',
  validateBody(MvpTrackEventSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await trackingService.recordMvpEvent(req.body, {
        ip: req.ip,
        userAgent: req.headers['user-agent'] as string | undefined,
        referer: req.headers['referer'] as string | undefined,
      });

      res.status(200).json({
        success: true,
        engaged: result.engaged,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /track/revamp-tracker.js
 * Serves lightweight client-side tracking script
 */
router.get('/revamp-tracker.js', (_req: Request, res: Response): void => {
  const scriptContent = getTrackerScript();
  res.writeHead(200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  });
  res.end(scriptContent);
});

export default router;
