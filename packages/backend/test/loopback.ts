import type { INestApplication } from '@nestjs/common';
import { createServer, type RequestListener, type Server } from 'http';
import type { AddressInfo } from 'net';

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

/**
 * Routes every `global.fetch` call aimed at `origin` (e.g.
 * `https://api.openai.com`) to the same path on a loopback server, so a spec
 * can exercise a built-in provider's real endpoint config without the
 * internet (issue #114). Returns the restore function; call it in afterAll.
 */
export function redirectFetchToLoopback(origin: string, server: Server): () => void {
  const { port } = server.address() as AddressInfo;
  const target = `http://${LOOPBACK_HOST}:${port}`;
  const originalFetch = global.fetch;

  global.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === origin || url.startsWith(`${origin}/`)) {
      const rewritten = `${target}${url.slice(origin.length)}`;
      return originalFetch(
        typeof input === 'string' || input instanceof URL
          ? rewritten
          : new Request(rewritten, input),
        init,
      );
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  return () => {
    global.fetch = originalFetch;
  };
}
