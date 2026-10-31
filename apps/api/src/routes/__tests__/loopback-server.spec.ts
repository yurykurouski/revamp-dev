import { describe, it, expect, afterEach } from 'vitest';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { listenOnLoopback, closeServer } from './loopback-server.js';

// supertest's request(app) listens on the wildcard address but sends to 127.0.0.1. On macOS a
// wildcard listener can share its port with another process's 127.0.0.1 listener, and the request
// then reaches that process (REV-74). These tests pin the hazard and the helper that avoids it.
const listening: Server[] = [];
const track = (server: Server) => {
  listening.push(server);
  return server;
};
const loopbackServer = async (status: number, body: string) => {
  const server = track(http.createServer((_req, res) => { res.statusCode = status; res.end(body); }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
};
const portOf = (server: Server) => (server.address() as AddressInfo).port;
const app = (_req: http.IncomingMessage, res: http.ServerResponse) => res.end('app');

afterEach(async () => {
  await Promise.all(listening.splice(0).map((server) => closeServer(server)));
});

describe('listenOnLoopback (REV-74)', () => {
  it('shows the hazard: a wildcard listener on a port held on 127.0.0.1 loses its requests', async () => {
    const other = await loopbackServer(401, 'other');
    const wildcard = track(http.createServer(app));
    const bound = await new Promise<boolean>((resolve) => {
      wildcard.once('error', () => resolve(false));
      wildcard.listen(portOf(other), () => resolve(true));
    });
    // Where the OS refuses the shared port the hazard cannot happen; where it allows it, the
    // request to 127.0.0.1 goes to the other server, never to the app.
    if (bound) {
      const res = await request(wildcard).get('/');
      expect(res.status).toBe(401);
      expect(res.text).toBe('other');
    }
  });

  it('listens on 127.0.0.1 only, the address supertest sends to', async () => {
    const server = track(await listenOnLoopback(app));
    expect(server.address()).toMatchObject({ address: '127.0.0.1' });
    const res = await request(server).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toBe('app');
  });

  it('refuses a port another 127.0.0.1 listener holds instead of sharing it', async () => {
    const other = await loopbackServer(401, 'other');
    await expect(listenOnLoopback(app, portOf(other))).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });

  it('closes the server so its port is released', async () => {
    const server = await listenOnLoopback(app);
    await closeServer(server);
    expect(server.listening).toBe(false);
  });
});
