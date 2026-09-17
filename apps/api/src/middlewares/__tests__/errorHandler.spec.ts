import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError, errorHandler } from '../errorHandler.js';

describe('Error Handler Middleware', () => {
  const mockRequest = () => ({} as Request);
  const mockResponse = () => {
    const res = {} as Response;
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  };
  const mockNext: NextFunction = vi.fn();

  it('should instantiate AppError with statusCode and message', () => {
    const err = new AppError('Resource not found', 404);
    expect(err.message).toBe('Resource not found');
    expect(err.statusCode).toBe(404);
    expect(err.isOperational).toBe(true);
  });

  it('should handle AppError and return corresponding status and json', () => {
    const err = new AppError('Forbidden action', 403);
    const req = mockRequest();
    const res = mockResponse();

    errorHandler(err, req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'Forbidden action',
      }),
    );
  });

  it('should handle ZodError and return 400 with details', () => {
    const schema = z.object({ email: z.string().email() });
    let zodError: unknown;
    try {
      schema.parse({ email: 'bad-email' });
    } catch (e) {
      zodError = e;
    }

    const req = mockRequest();
    const res = mockResponse();

    errorHandler(zodError as Error, req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'Validation Error',
        errors: expect.any(Array),
      }),
    );
  });

  it('should handle Mongoose CastError and return 400', () => {
    const castError = new Error('Cast to ObjectId failed');
    castError.name = 'CastError';
    const req = mockRequest();
    const res = mockResponse();

    errorHandler(castError, req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'Invalid resource identifier format',
      }),
    );
  });

  it('should handle Mongo duplicate key error (code 11000) and return 409', () => {
    const dupError = new Error('E11000 duplicate key error') as Error & { code: number };
    dupError.code = 11000;
    const req = mockRequest();
    const res = mockResponse();

    errorHandler(dupError, req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'Duplicate field value entered',
      }),
    );
  });

  it('should handle unknown internal server error with 500', () => {
    const unknownError = new Error('Something went unexpectedly wrong');
    const req = mockRequest();
    const res = mockResponse();

    errorHandler(unknownError, req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
      }),
    );
  });
});
