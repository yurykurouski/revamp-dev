import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { canManageMembers, canWrite } from '@revamp/shared-types';
import { AppError } from './errorHandler.js';
import { findMembershipRole } from '../services/membership.service.js';
import { verifySessionToken, type SessionClaims } from '../services/token.js';

declare global {
  namespace Express {
    interface Request {
      /** Who sent the request, for which organization and with which role; set by `requireAuth` (REV-206) */
      auth?: SessionClaims;
    }
  }
}

const BEARER = /^bearer\s+(\S+)$/i;

/**
 * Checks the `Authorization: Bearer <token>` header and sets `req.auth`. The role comes from the membership in the
 * database on every request, not from the token (REV-207): a member removed from the organization is refused at
 * once, and a changed role applies at once. The token's own `role` claim is ignored.
 */
export const requireAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction): void => {
  const token = BEARER.exec(req.headers.authorization ?? '')?.[1];
  const claims = token ? verifySessionToken(token) : null;
  if (!claims) {
    next(new AppError(401, 'UNAUTHENTICATED', 'Sign in to use the API'));
    return;
  }
  findMembershipRole(claims.userId, claims.organizationId).then(
    (role) => {
      if (!role) {
        next(new AppError(401, 'UNAUTHENTICATED', 'The session is no longer valid'));
        return;
      }
      req.auth = { ...claims, role };
      next();
    },
    (error: unknown) => next(error),
  );
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

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const refuse = (next: NextFunction, message: string): void => next(new AppError(403, 'FORBIDDEN', message));

/**
 * After `requireAuth`: a request that changes data needs the owner or operator role (REV-207). A viewer can read
 * everything and change nothing; a read passes (it is the public preview's guard too). A write without `req.auth`
 * means the guard order is wrong: the answer is 401, never a pass.
 */
export const requireWriter: RequestHandler = (req, _res, next) => {
  if (READ_METHODS.has(req.method)) {
    next();
    return;
  }
  if (!req.auth) {
    next(new AppError(401, 'UNAUTHENTICATED', 'Sign in to use the API'));
    return;
  }
  if (canWrite(req.auth.role)) {
    next();
    return;
  }
  refuse(next, 'Your role can read but not change data');
};

/** After `requireAuth`: only owners manage members and invitations (REV-207) */
export const requireOwner: RequestHandler = (req, _res, next) => {
  if (!req.auth) {
    next(new AppError(401, 'UNAUTHENTICATED', 'Sign in to use the API'));
    return;
  }
  if (canManageMembers(req.auth.role)) {
    next();
    return;
  }
  refuse(next, 'Only an owner can manage members');
};
