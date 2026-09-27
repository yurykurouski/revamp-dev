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

const unsubscribePage = (title: string, body: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" href="data:,">
<title>${title}</title>
<style>
  body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; }
  main { max-width: 480px; margin: 12vh auto; padding: 32px 24px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; }
  h1 { margin: 0 0 12px; font-size: 1.35rem; }
  p { margin: 0 0 20px; line-height: 1.5; color: #334155; }
  button { font: inherit; padding: 10px 20px; border: 0; border-radius: 8px; background: #0f172a; color: #fff; cursor: pointer; }
</style>
</head>
<body><main><h1>${title}</h1>${body}</main></body>
</html>`;

const UNSUBSCRIBED_PAGE = unsubscribePage(
  'You are unsubscribed',
  '<p>We will not email you again.</p>',
);

const UNKNOWN_LINK_PAGE = unsubscribePage(
  'Link not recognised',
  '<p>This unsubscribe link is not valid. If you keep receiving our emails, reply to one of them and ask us to stop.</p>',
);

// The confirm button posts back to this same URL
const CONFIRM_PAGE = unsubscribePage(
  'Unsubscribe from our emails?',
  '<p>Confirm and we will not email you again.</p><form method="post"><button type="submit">Unsubscribe</button></form>',
);

const sendPage = (res: Response, status: number, html: string): void => {
  res.status(status).set({ 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' }).send(html);
};

/**
 * GET /track/unsubscribe/:token
 * Shows a confirmation page and changes nothing: mail security scanners prefetch every link in
 * an email, so a GET must not opt the recipient out (RFC 8058 §3.2, REV-73)
 */
router.get(
  '/unsubscribe/:token',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { found, unsubscribed } = await trackingService.findUnsubscribeCampaign(req.params['token'] || '');
      if (!found) sendPage(res, 404, UNKNOWN_LINK_PAGE);
      else sendPage(res, 200, unsubscribed ? UNSUBSCRIBED_PAGE : CONFIRM_PAGE);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /track/unsubscribe/:token
 * RFC 8058 one-click unsubscribe (mail clients post `List-Unsubscribe=One-Click`) and the
 * confirmation form. Idempotent; unknown tokens answer 404 and change nothing (REV-73)
 */
router.post(
  '/unsubscribe/:token',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await trackingService.recordUnsubscribe(req.params['token'] || '', {
        ip: req.ip,
        userAgent: req.headers['user-agent'] as string | undefined,
        referer: req.headers['referer'] as string | undefined,
      });
      sendPage(res, result.found ? 200 : 404, result.found ? UNSUBSCRIBED_PAGE : UNKNOWN_LINK_PAGE);
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
    // MVP pages load this from the storage host; helmet's default same-origin CORP would block it (REV-52)
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });
  res.end(scriptContent);
});

export default router;
