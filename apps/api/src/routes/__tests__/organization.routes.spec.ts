import type { Server } from 'node:http';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, errorHandler } from '../../middlewares/errorHandler.js';
import { requireAuth, requireOwner } from '../../middlewares/requireAuth.js';
import * as organization from '../../services/organization.service.js';
import { signSessionToken } from '../../services/token.js';
import invitationRoutes from '../invitation.routes.js';
import organizationRoutes from '../organization.routes.js';
import { closeServer, listenOnLoopback } from './loopback-server.js';
import { setMemberRole } from './authed-request.js';

vi.mock('../../services/membership.service.js', async () => (await import('./authed-request.js')).membershipServiceMock());
vi.mock('../../services/organization.service.js');

const claims = { userId: '5eed00000000000000000001', organizationId: '5eed00000000000000000002', role: 'owner' as const };
const bearer = { Authorization: `Bearer ${signSessionToken(claims)}` };
const invitation = { id: 'i1', email: 'ann@studio.test', role: 'viewer' as const, expiresAt: '2026-12-01T00:00:00.000Z', createdAt: '2026-11-24T00:00:00.000Z' };
const session = {
  token: 'tok',
  user: { id: claims.userId, email: 'ann@studio.test' },
  organization: { id: claims.organizationId, name: 'Pixel Studio' },
  role: 'viewer' as const,
};

describe('organization and invitation routes (REV-207)', () => {
  let server: Server;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/organization', requireAuth, requireOwner, organizationRoutes);
    app.use('/invitations', invitationRoutes);
    app.use(errorHandler);
    server = await listenOnLoopback(app);
  });
  afterAll(async () => {
    setMemberRole('owner');
    await closeServer(server);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    setMemberRole('owner');
  });

  describe('GET /organization/members', () => {
    it('200 with the members and invitations of the caller organization', async () => {
      const data = { members: [{ userId: 'u1', email: 'a@b.co', role: 'owner' as const, joinedAt: 'x' }], invitations: [invitation] };
      vi.mocked(organization.listMembers).mockResolvedValue(data);
      const res = await request(server).get('/organization/members').set(bearer);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data });
      expect(organization.listMembers).toHaveBeenCalledWith(claims);
    });

    it('401 without a token, 403 FORBIDDEN for an operator and a viewer', async () => {
      expect((await request(server).get('/organization/members')).status).toBe(401);
      for (const role of ['operator', 'viewer'] as const) {
        setMemberRole(role);
        const res = await request(server).get('/organization/members').set(bearer);
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
      }
      expect(organization.listMembers).not.toHaveBeenCalled();
    });
  });

  describe('POST /organization/invitations', () => {
    it('201 with the invitation and its one-time token; the service gets the validated body', async () => {
      const created = { invitation, token: 't'.repeat(43) };
      vi.mocked(organization.inviteMember).mockResolvedValue(created);
      const res = await request(server).post('/organization/invitations').set(bearer).send({ email: ' Ann@Studio.Test ', role: 'viewer' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true, data: created });
      expect(organization.inviteMember).toHaveBeenCalledWith({ ...claims }, { email: 'ann@studio.test', role: 'viewer' });
    });

    it.each([
      ['an unknown role', { email: 'a@b.co', role: 'admin' }],
      ['a malformed email', { email: 'nope', role: 'viewer' }],
      ['an empty body', {}],
    ])('400 VALIDATION_ERROR for %s', async (_label, body) => {
      const res = await request(server).post('/organization/invitations').set(bearer).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(organization.inviteMember).not.toHaveBeenCalled();
    });

    it('409 ALREADY_MEMBER in the standard error format', async () => {
      vi.mocked(organization.inviteMember).mockRejectedValue(new AppError(409, 'ALREADY_MEMBER', 'This address already belongs to a member'));
      const res = await request(server).post('/organization/invitations').set(bearer).send({ email: 'a@b.co', role: 'viewer' });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ success: false, error: { code: 'ALREADY_MEMBER', message: 'This address already belongs to a member' } });
    });

    it('403 for an operator and a viewer, without calling the service', async () => {
      for (const role of ['operator', 'viewer'] as const) {
        setMemberRole(role);
        expect((await request(server).post('/organization/invitations').set(bearer).send({ email: 'a@b.co', role: 'viewer' })).status).toBe(403);
      }
      expect(organization.inviteMember).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /organization/invitations/:id', () => {
    it('200 after revoking, and 404 INVITATION_NOT_FOUND when there is nothing to revoke', async () => {
      vi.mocked(organization.revokePendingInvitation).mockResolvedValueOnce(undefined);
      const ok = await request(server).delete('/organization/invitations/i1').set(bearer);
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ success: true });
      expect(organization.revokePendingInvitation).toHaveBeenCalledWith(claims, 'i1');
      vi.mocked(organization.revokePendingInvitation).mockRejectedValueOnce(new AppError(404, 'INVITATION_NOT_FOUND', 'none'));
      expect((await request(server).delete('/organization/invitations/i2').set(bearer)).status).toBe(404);
    });
  });

  describe('PATCH /organization/members/:userId', () => {
    it('200 after changing the role', async () => {
      vi.mocked(organization.changeRole).mockResolvedValue(undefined);
      const res = await request(server).patch('/organization/members/u2').set(bearer).send({ role: 'operator' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(organization.changeRole).toHaveBeenCalledWith(claims, 'u2', { role: 'operator' });
    });

    it('400 for an unknown role, 409 LAST_OWNER and 404 MEMBER_NOT_FOUND from the service', async () => {
      expect((await request(server).patch('/organization/members/u2').set(bearer).send({ role: 'admin' })).status).toBe(400);
      vi.mocked(organization.changeRole).mockRejectedValueOnce(new AppError(409, 'LAST_OWNER', 'An organization needs at least one owner'));
      const last = await request(server).patch('/organization/members/u1').set(bearer).send({ role: 'viewer' });
      expect(last.status).toBe(409);
      expect(last.body.error.code).toBe('LAST_OWNER');
      vi.mocked(organization.changeRole).mockRejectedValueOnce(new AppError(404, 'MEMBER_NOT_FOUND', 'none'));
      expect((await request(server).patch('/organization/members/u9').set(bearer).send({ role: 'viewer' })).status).toBe(404);
    });
  });

  describe('DELETE /organization/members/:userId', () => {
    it('200 after removing, 409 LAST_OWNER from the service', async () => {
      vi.mocked(organization.removeFromOrganization).mockResolvedValueOnce(undefined);
      const ok = await request(server).delete('/organization/members/u2').set(bearer);
      expect(ok.status).toBe(200);
      expect(organization.removeFromOrganization).toHaveBeenCalledWith(claims, 'u2');
      vi.mocked(organization.removeFromOrganization).mockRejectedValueOnce(new AppError(409, 'LAST_OWNER', 'An organization needs at least one owner'));
      expect((await request(server).delete('/organization/members/u1').set(bearer)).status).toBe(409);
    });
  });

  describe('GET /invitations/:token (public)', () => {
    it('200 with the preview, without a token', async () => {
      const preview = { organizationName: 'Pixel Studio', email: 'ann@studio.test', role: 'viewer' as const, expiresAt: invitation.expiresAt };
      vi.mocked(organization.previewInvitation).mockResolvedValue(preview);
      const res = await request(server).get('/invitations/abc_DEF-1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: preview });
      expect(organization.previewInvitation).toHaveBeenCalledWith('abc_DEF-1');
    });

    it('404 and 410 in the standard error format', async () => {
      vi.mocked(organization.previewInvitation).mockRejectedValueOnce(new AppError(404, 'INVITATION_NOT_FOUND', 'nope'));
      expect((await request(server).get('/invitations/x')).status).toBe(404);
      vi.mocked(organization.previewInvitation).mockRejectedValueOnce(new AppError(410, 'INVITATION_EXPIRED', 'used'));
      const res = await request(server).get('/invitations/y');
      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe('INVITATION_EXPIRED');
    });
  });

  describe('POST /invitations/:token/accept', () => {
    it('401 without a token', async () => {
      expect((await request(server).post('/invitations/abc/accept')).status).toBe(401);
      expect(organization.acceptInvitation).not.toHaveBeenCalled();
    });

    it('200 with a session for the invited organization, for any signed-in role', async () => {
      vi.mocked(organization.acceptInvitation).mockResolvedValue(session);
      for (const role of ['owner', 'operator', 'viewer'] as const) {
        setMemberRole(role);
        const res = await request(server).post('/invitations/abc/accept').set(bearer);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, data: session });
      }
      expect(organization.acceptInvitation).toHaveBeenCalledWith(claims, 'abc');
    });

    it('403 INVITATION_EMAIL_MISMATCH and 410 from the service', async () => {
      vi.mocked(organization.acceptInvitation).mockRejectedValueOnce(new AppError(403, 'INVITATION_EMAIL_MISMATCH', 'other'));
      expect((await request(server).post('/invitations/abc/accept').set(bearer)).status).toBe(403);
      vi.mocked(organization.acceptInvitation).mockRejectedValueOnce(new AppError(410, 'INVITATION_EXPIRED', 'used'));
      expect((await request(server).post('/invitations/abc/accept').set(bearer)).status).toBe(410);
    });
  });
});
