import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from './errorHandler.js';
import { verifySessionToken, type SessionClaims } from '../services/token.js';

declare global {
  namespace Express {
    interface Request {
      /** Who sent the request and for which organization; set by `requireAuth` (REV-206) */
      auth?: SessionClaims;
    }
  }
}

const BEARER = /^bearer\s+(\S+)$/i;

/**
 * Checks the `Authorization: Bearer <token>` header and sets `req.auth`. The check reads the token only: a
 * member removed from an organization keeps a valid token until it expires (7 days); removing members arrives
 * with invitations (REV-207), which adds the membership lookup here.
 */
export const requireAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction): void => {
  const token = BEARER.exec(req.headers.authorization ?? '')?.[1];
  const claims = token ? verifySessionToken(token) : null;
  if (!claims) {
    next(new AppError(401, 'UNAUTHENTICATED', 'Sign in to use the API'));
    return;
  }
  req.auth = claims;
  next();
};

/** `requireAuth` for every request except those the predicate marks public (a method and path, not a whole router) */
export const requireAuthUnless =
  (isPublic: (req: Request) => boolean): RequestHandler =>
  (req, res, next) => {
    if (isPublic(req)) {
      next();
      return;
    }
    requireAuth(req, res, next);
  };
