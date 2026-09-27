import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorCode, IApiErrorResponse } from '@revamp/shared-types';

/** An error a route or service raises on purpose; `errorHandler` sends it as the one error format (REV-63) */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ApiErrorCode;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(statusCode: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

const sendError = (res: Response, statusCode: number, code: ApiErrorCode, message: string, details?: unknown): void => {
  const body: IApiErrorResponse = {
    success: false,
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  };
  res.status(statusCode).json(body);
};

/** Errors express.json() raises for a body it can't read */
type BodyParserError = Error & { type?: string };

export const errorHandler = (
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof ZodError) {
    const [first] = err.errors;
    const message = first
      ? `${first.path.length ? `${first.path.join('.')}: ` : ''}${first.message}`
      : 'Validation Error';
    sendError(res, 400, 'VALIDATION_ERROR', message, { issues: err.errors });
    return;
  }

  if (err instanceof AppError) {
    sendError(res, err.statusCode, err.code, err.message, err.details);
    return;
  }

  // Mongoose invalid ObjectId / CastError
  if (err.name === 'CastError') {
    sendError(res, 400, 'INVALID_ID', 'Invalid resource identifier format');
    return;
  }

  // MongoDB duplicate key error
  if ((err as Error & { code?: number }).code === 11000) {
    sendError(res, 409, 'DUPLICATE', 'Duplicate field value entered');
    return;
  }

  const bodyErrorType = (err as BodyParserError).type;
  if (bodyErrorType === 'entity.parse.failed') {
    sendError(res, 400, 'INVALID_JSON', 'The request body is not valid JSON');
    return;
  }
  if (bodyErrorType === 'entity.too.large') {
    sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'The request body is too large');
    return;
  }

  // Unhandled internal server error
  console.error('[Unhandled Error]', err);
  sendError(res, 500, 'INTERNAL', process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message);
};

/** The catch-all for routes that don't exist */
export const notFoundHandler = (_req: Request, res: Response): void => {
  sendError(res, 404, 'NOT_FOUND', 'Endpoint not found');
};
