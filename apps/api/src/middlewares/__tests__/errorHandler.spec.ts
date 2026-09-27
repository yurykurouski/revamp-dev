import { describe, it, expect, vi, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError, errorHandler, notFoundHandler } from '../errorHandler.js';

describe('Error Handler Middleware (REV-63: one error format)', () => {
  const mockRequest = () => ({} as Request);
  const mockResponse = () => {
    const res = {} as Response;
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  };
  const mockNext: NextFunction = vi.fn();

  const handle = (err: Error) => {
    const res = mockResponse();
    errorHandler(err, mockRequest(), res, mockNext);
    return res;
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('should instantiate AppError with statusCode, code, message and details', () => {
    const err = new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found', { id: 'x' });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Lead not found');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('LEAD_NOT_FOUND');
    expect(err.details).toEqual({ id: 'x' });
    expect(err.isOperational).toBe(true);
  });

  it('should send an AppError as { success: false, error: { code, message } }', () => {
    const res = handle(new AppError(409, 'LEAD_NOT_REJECTABLE', 'Not rejectable'));

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'LEAD_NOT_REJECTABLE', message: 'Not rejectable' },
    });
  });

  it('should include AppError details when given', () => {
    const res = handle(new AppError(409, 'MVP_ALREADY_GENERATED', 'Already generated', { status: 'NEEDS_APPROVAL' }));

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'MVP_ALREADY_GENERATED', message: 'Already generated', details: { status: 'NEEDS_APPROVAL' } },
    });
  });

  it('should send a ZodError as 400 VALIDATION_ERROR with the first issue as the message and all issues in details', () => {
    const schema = z.object({ email: z.string().email(), age: z.number() });
    const zodError = schema.safeParse({ email: 'bad-email', age: 'x' }).error!;

    const res = handle(zodError);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = vi.mocked(res.json).mock.calls[0]![0];
    expect(body).toEqual({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'email: Invalid email',
        details: { issues: zodError.errors },
      },
    });
    expect(body.error.details.issues).toHaveLength(2);
  });

  it('should leave the path out of the message for a root-level Zod issue', () => {
    const zodError = z.string().safeParse(1).error!;
    const body = vi.mocked(handle(zodError).json).mock.calls[0]![0];
    expect(body.error.message).toBe('Expected string, received number');
  });

  it('should send a Mongoose CastError as 400 INVALID_ID', () => {
    const castError = new Error('Cast to ObjectId failed');
    castError.name = 'CastError';

    const res = handle(castError);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INVALID_ID', message: 'Invalid resource identifier format' },
    });
  });

  it('should send a Mongo duplicate key error (code 11000) as 409 DUPLICATE', () => {
    const dupError = new Error('E11000 duplicate key error') as Error & { code: number };
    dupError.code = 11000;

    const res = handle(dupError);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'DUPLICATE', message: 'Duplicate field value entered' },
    });
  });

  it.each([
    ['entity.parse.failed', 400, 'INVALID_JSON'],
    ['entity.too.large', 413, 'PAYLOAD_TOO_LARGE'],
  ])('should send a %s body error as %i %s', (type, status, code) => {
    const bodyError = Object.assign(new Error('body'), { type });

    const res = handle(bodyError);

    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: expect.objectContaining({ code }) });
  });

  it('should send an unknown error as 500 INTERNAL with its message outside production', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'development');

    const res = handle(new Error('Something went unexpectedly wrong'));

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INTERNAL', message: 'Something went unexpectedly wrong' },
    });
  });

  it('should hide the message of an unknown error in production', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'production');

    const res = handle(new Error('secret connection string'));

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INTERNAL', message: 'Internal server error' },
    });
  });

  it('should send unknown routes as 404 NOT_FOUND', () => {
    const res = mockResponse();
    notFoundHandler(mockRequest(), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
    });
  });
});
