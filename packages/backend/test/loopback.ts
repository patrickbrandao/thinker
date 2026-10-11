import type { INestApplication } from '@nestjs/common';
import { createServer, type RequestListener, type Server } from 'http';

/**
 * The address supertest always dials: `http://127.0.0.1:<port>`.
 *
 * Never hand supertest a server that is not listening yet. In that case
 * supertest calls `server.listen(0)` on every request, which binds the
 * wildcard address (`::`), and then dials 127.0.0.1. macOS hands out
 * ephemeral ports in sequence, and it can give that wildcard listener a port
 * another process already holds on 127.0.0.1 alone (Docker Desktop publishing
 * a compose stack, a browser, an editor's local server). The more specific
 * 127.0.0.1 binding wins the connection, so the request lands in the other
 * process. That is issue #62: a POST from agent-duplication.e2e-spec reached
 * a locally running Thinker, whose real ApiKeyGuard answered 401 to the test
 * key.
 *
 * Binding 127.0.0.1 explicitly closes the hole: the kernel never gives out a
 * port that is already bound on that address, and supertest reuses the
 * listening server for every request instead of re-listening each time.
 */
export const LOOPBACK_HOST = '127.0.0.1';

/** Starts a Nest app's HTTP server on an ephemeral loopback port. */
export async function listenOnLoopback(app: INestApplication): Promise<void> {
  await app.listen(0, LOOPBACK_HOST);
}

/** Serves a plain request handler (e.g. an Express app) on an ephemeral loopback port. */
export async function serveOnLoopback(handler: RequestListener): Promise<Server> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, LOOPBACK_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}

export async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
}
