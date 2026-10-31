import http, { type RequestListener, type Server } from 'node:http';

/**
 * Starts `app` on 127.0.0.1 for supertest (REV-74).
 *
 * `request(app)` listens on the wildcard address and sends to 127.0.0.1:<port>. On macOS the OS
 * can hand that wildcard listener a port another process already holds on 127.0.0.1, and the
 * request then reaches that process (a stray 401 or empty 404). Binding 127.0.0.1 itself makes the
 * OS pick a port nobody holds there. Pass the returned server to `request(server)`.
 */
export const listenOnLoopback = (app: RequestListener, port = 0): Promise<Server> =>
  new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server);
    });
  });

export const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    server.closeAllConnections();
    server.close((err) => (err ? reject(err) : resolve()));
  });
