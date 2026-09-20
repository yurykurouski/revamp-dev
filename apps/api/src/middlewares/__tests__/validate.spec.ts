import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validateBody, validateQuery } from '../validate.js';

describe('Validation Middlewares (validateBody & validateQuery)', () => {
  const mockResponse = () => ({} as Response);

  it('should call next() and assign parsed data to req.body when valid', async () => {
    const schema = z.object({
      age: z.coerce.number().min(18),
      name: z.string().trim(),
    });

    const middleware = validateBody(schema);
    const req = {
      body: {
        age: '25',
        name: '  Alice  ',
      },
    } as unknown as Request;
    const res = mockResponse();
    const next: NextFunction = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.body).toEqual({
      age: 25,
      name: 'Alice',
    });
  });

  it('should pass ZodError to next() when req.body is invalid', async () => {
    const schema = z.object({
      email: z.string().email(),
    });

    const middleware = validateBody(schema);
    const req = {
      body: {
        email: 'invalid-email',
      },
    } as unknown as Request;
    const res = mockResponse();
    const next: NextFunction = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(z.ZodError));
  });

  it('should call next() and assign parsed data to req.query when valid', async () => {
    const schema = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(20),
    });

    const middleware = validateQuery(schema);
    const req = {
      query: {
        page: '3',
      },
    } as unknown as Request;
    const res = mockResponse();
    const next: NextFunction = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.query).toEqual({
      page: 3,
      limit: 20,
    });
  });

  it('should pass ZodError to next() when req.query is invalid', async () => {
    const schema = z.object({
      limit: z.coerce.number().max(50),
    });

    const middleware = validateQuery(schema);
    const req = {
      query: {
        limit: '1000',
      },
    } as unknown as Request;
    const res = mockResponse();
    const next: NextFunction = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(z.ZodError));
  });
});
