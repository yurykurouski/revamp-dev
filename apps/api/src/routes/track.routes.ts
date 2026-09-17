import { Router, Request, Response, NextFunction } from 'express';

const router = Router();

// 1x1 transparent GIF buffer
const TRANSPARENT_GIF_BUFFER = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

// GET /track/open/:token.gif
router.get('/open/:token.gif', (req: Request, res: Response) => {
  const token = req.params['token'];
  // Token open logging will be stored in Mongo via AnalyticsEvent in REV-18
  console.log(`[Tracking] Email opened for token: ${token}`);

  res.writeHead(200, {
    'Content-Type': 'image/gif',
    'Content-Length': TRANSPARENT_GIF_BUFFER.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.end(TRANSPARENT_GIF_BUFFER);
});

// GET /track/click/:token
router.get('/click/:token', (req: Request, res: Response) => {
  const token = req.params['token'];
  console.log(`[Tracking] Demo link clicked for token: ${token}`);
  res.redirect(`https://preview.revampdemo.com/v/${token}`);
});

// POST /track/mvp-event
router.post('/mvp-event', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { eventType, dwellTimeSeconds, mvpProjectId } = req.body;
    console.log(`[Telemetry] MVP Event:`, { eventType, dwellTimeSeconds, mvpProjectId });
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
