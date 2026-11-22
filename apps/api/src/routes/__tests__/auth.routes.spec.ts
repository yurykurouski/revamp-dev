import type { Server } from 'node:http';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../middlewares/errorHandler.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { signSessionToken } from '../../services/token.js';
import * as authService from '../../services/auth.service.js';
import authRoutes from '../auth.routes.js';
import { closeServer, listenOnLoopback } from './loopback-server.js';

vi.mock('../../services/auth.service.js');

const claims = { userId: '5eed00000000000000000001', organizationId: '5eed00000000000000000002', role: 'owner' as const };
const session = {
  token: 'tok',
  user: { id: claims.userId, email: 'owner@studio.test' },
  organization: { id: claims.organizationId, name: 'Pixel Studio' },
  role: 'owner' as const,
};
const register = { email: 'Owner@Studio.Test', password: 'correct horse battery', organizationName: 'Pixel Studio' };

describe('auth routes (REV-206)', () => {
  let server: Server;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/auth', authRoutes);
    app.use(errorHandler);
    server = await listenOnLoopback(app);
  });
  afterAll(() => closeServer(server));
  beforeEach(() => vi.clearAllMocks());

  describe('POST /auth/register', () => {
    it('201 with the session; the service gets the validated, lowercased body', async () => {
      vi.mocked(authService.registerUser).mockResolvedValue(session);
      const res = await request(server).post('/auth/register').send(register);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true, data: session });
      expect(authService.registerUser).toHaveBeenCalledWith({
        email: 'owner@studio.test',
        password: 'correct horse battery',
        organizationName: 'Pixel Studio',
      });
    });

    it.each([
      ['a short password', { ...register, password: 'short' }],
      ['a malformed email', { ...register, email: 'nope' }],
      ['no organization name', { ...register, organizationName: '' }],
      ['an empty body', {}],
    ])('400 VALIDATION_ERROR for %s, without calling the service', async (_label, body) => {
      const res = await request(server).post('/auth/register').send(body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
      expect(authService.registerUser).not.toHaveBeenCalled();
    });

    it('409 EMAIL_TAKEN in the standard error format', async () => {
      vi.mocked(authService.registerUser).mockRejectedValue(new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists'));
      const res = await request(server).post('/auth/register').send(register);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ success: false, error: { code: 'EMAIL_TAKEN', message: 'An account with this email already exists' } });
    });
  });

  describe('POST /auth/login', () => {
    it('200 with the session', async () => {
      vi.mocked(authService.loginUser).mockResolvedValue(session);
      const res = await request(server).post('/auth/login').send({ email: 'Owner@Studio.Test', password: 'x' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: session });
      expect(authService.loginUser).toHaveBeenCalledWith({ email: 'owner@studio.test', password: 'x' });
    });

    it.each([
      ['no password', { email: 'a@b.co' }],
      ['a malformed email', { email: 'nope', password: 'x' }],
    ])('400 VALIDATION_ERROR for %s', async (_label, body) => {
      const res = await request(server).post('/auth/login').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(authService.loginUser).not.toHaveBeenCalled();
    });

    it('401 INVALID_CREDENTIALS', async () => {
      vi.mocked(authService.loginUser).mockRejectedValue(new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect'));
      const res = await request(server).post('/auth/login').send({ email: 'a@b.co', password: 'bad' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('GET /auth/me', () => {
    it('401 UNAUTHENTICATED without a token', async () => {
      const res = await request(server).get('/auth/me');
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ success: false, error: { code: 'UNAUTHENTICATED' } });
      expect(authService.getAuthContext).not.toHaveBeenCalled();
    });

    it('200 with the context for the token holder', async () => {
      const { token: _token, ...context } = session;
      vi.mocked(authService.getAuthContext).mockResolvedValue(context);
      const res = await request(server).get('/auth/me').set('Authorization', `Bearer ${signSessionToken(claims)}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: context });
      expect(authService.getAuthContext).toHaveBeenCalledWith(claims);
    });

    it('401 when the account behind a valid token is gone', async () => {
      vi.mocked(authService.getAuthContext).mockRejectedValue(new AppError(401, 'UNAUTHENTICATED', 'The session is no longer valid'));
      const res = await request(server).get('/auth/me').set('Authorization', `Bearer ${signSessionToken(claims)}`);
      expect(res.status).toBe(401);
    });
  });
});
