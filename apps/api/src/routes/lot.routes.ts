import { Router, type NextFunction, type Request, type Response } from 'express';
import { LotListingQuerySchema, type LotListingQuery } from '@revamp/validation';
import { env } from '../config/env.js';
import { createTenantRateLimiter, redisRateLimitStore, type RateLimitStore } from '../middlewares/rateLimit.js';
import { validateQuery } from '../middlewares/validate.js';
import { redisConnection } from '../queues/connection.js';
import { listMaskedLotsForStudio, type MaskedLotFetcher } from '../services/lot.service.js';

export interface LotRoutesDeps {
  /** The limiter's store; Redis at runtime */
  store?: RateLimitStore;
  now?: () => number;
  fetchLots?: MaskedLotFetcher;
  minGroup?: number;
  limit?: number;
  windowSeconds?: number;
}

/**
 * REV-233: `GET /lots`, the masked listing every studio member sees. Mounted behind `requireAuth` and `requireWriter`.
 * The query is validated first so a 400 does not use the studio's request budget, then the limiter, then the handler.
 */
export function createLotRoutes(deps: LotRoutesDeps = {}): Router {
  const router = Router();
  const limiter = createTenantRateLimiter({
    name: 'lots',
    limit: deps.limit ?? env.LOT_LISTING_RATE_LIMIT,
    windowSeconds: deps.windowSeconds ?? env.LOT_LISTING_RATE_WINDOW_SECONDS,
    store: deps.store ?? redisRateLimitStore(redisConnection, 500),
    now: deps.now,
  });

  router.get('/', validateQuery(LotListingQuerySchema), limiter, (req: Request, res: Response, next: NextFunction): void => {
    listMaskedLotsForStudio(req.query as unknown as LotListingQuery, {
      fetchLots: deps.fetchLots,
      minGroup: deps.minGroup,
      now: deps.now ? () => new Date(deps.now!()) : undefined,
    }).then(
      (data) => void res.status(200).json({ success: true, data }),
      next,
    );
  });

  return router;
}
