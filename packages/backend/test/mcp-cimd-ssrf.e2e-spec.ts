/**
 * #18: CIMD SSRF guard on the real MCP OAuth flow.
 *
 * During OAuth an MCP client may use an HTTPS URL as its `client_id`, and the
 * authorization server then fetches that Client ID Metadata Document. The URL
 * is chosen by an unauthenticated client, so by default Thinker must refuse to
 * fetch it when the name resolves to a private or loopback address. Operators
 * who host MCP clients on their LAN opt in with THINKER_CIMD_ALLOW_PRIVATE=true.
 *
 * The real server (`src/main.ts`, Better Auth and its MCP/CIMD plugins) runs in
 * its own process, because Better Auth's ESM dependencies cannot load in Jest's
 * CommonJS runtime. Two preloads keep it hermetic: `egress-recorder.cjs` keeps
 * it off the network and `cimd-dns-pin.cjs` resolves a public-looking client
 * hostname to 127.0.0.1.
 *
 * Better Auth collapses every fetch failure into the same OAuth error, so the
 * decisive observable is the private host itself: a TCP listener on 127.0.0.1
 * counts the connections it receives. By default it must receive none.
 */
import { spawn, type ChildProcess } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { createServer, type AddressInfo, type Server, type Socket } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';

const BACKEND = join(__dirname, '..');
// Better Auth's own client_id check rejects localhost, IP literals and metadata
// names, so the URL needs a public-looking name; DNS pins it to loopback.
const CLIENT_HOST = 'mcp-client.thinker-e2e.example';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('no port')),
      );
    });
  });
}

interface RunningServer {
  base: string;
  child: ChildProcess;
  output: () => string;
}

async function waitForHealth(server: RunningServer): Promise<void> {
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(`server exited with ${server.child.exitCode}:\n${server.output()}`);
    }
    try {
      const res = await fetch(`${server.base}/api/v1/health`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`server did not become healthy:\n${server.output()}`);
}

async function bootServer(
  databaseUrl: string,
  workDir: string,
  extraEnv: NodeJS.ProcessEnv,
): Promise<RunningServer> {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const egressLog = join(workDir, `egress-${port}.jsonl`);
  writeFileSync(egressLog, '');

  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['THINKER_CIMD_ALLOW_PRIVATE'];
  delete env['MCP_ENABLED'];
  Object.assign(env, {
    NODE_ENV: 'production',
    DATABASE_URL: databaseUrl,
    PORT: String(port),
    BIND_ADDRESS: '127.0.0.1',
    // A loopback origin keeps the MCP plugins (and CIMD) enabled over http.
    BETTER_AUTH_URL: base,
    BETTER_AUTH_SECRET:
      process.env['BETTER_AUTH_SECRET'] ?? 'test-secret-for-e2e-at-least-32chars!!',
    SHUTDOWN_DRAIN_MS: '0',
    EGRESS_LOG: egressLog,
    CIMD_PINNED_HOST: CLIENT_HOST,
    ...extraEnv,
  });

  let output = '';
  const child = spawn(
    process.execPath,
    [
      '-r',
      require.resolve('ts-node/register/transpile-only'),
      '-r',
      join(__dirname, 'support', 'egress-recorder.cjs'),
      '-r',
      join(__dirname, 'support', 'cimd-dns-pin.cjs'),
      join('src', 'main.ts'),
    ],
    { cwd: BACKEND, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const server = { base, child, output: () => output };
  await waitForHealth(server);
  return server;
}

async function stopServer(server: RunningServer | undefined): Promise<void> {
  const child = server?.child;
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  await exited;
  clearTimeout(timer);
}

describe('MCP OAuth CIMD client_id SSRF guard (e2e)', () => {
  let workDir: string;
  let defaultServer: RunningServer | undefined;
  let optInServer: RunningServer | undefined;
  let privateHost: Server;
  let privatePort: number;
  let connections = 0;
  const sockets = new Set<Socket>();

  beforeAll(async () => {
    privateHost = createServer((socket) => {
      connections += 1;
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      // Not a TLS server: the handshake fails, which is all the opt-in case needs.
      socket.destroy();
    });
    await new Promise<void>((resolve) => privateHost.listen(0, '127.0.0.1', resolve));
    privatePort = (privateHost.address() as AddressInfo).port;

    const databaseUrl =
      process.env['DATABASE_URL'] ?? 'postgresql://myuser:mypassword@localhost:5432/mydatabase';
    // Start from an empty schema: the real server migrates on boot, and earlier
    // suites leave a synchronize()-built schema behind.
    const reset = new DataSource({ type: 'postgres', url: databaseUrl, dropSchema: true });
    await reset.initialize();
    await reset.destroy();

    workDir = mkdtempSync(join(tmpdir(), 'thinker-cimd-'));
    // Sequential boots: the first one applies the migrations.
    defaultServer = await bootServer(databaseUrl, workDir, {});
    optInServer = await bootServer(databaseUrl, workDir, { THINKER_CIMD_ALLOW_PRIVATE: 'true' });
  }, 330_000);

  afterAll(async () => {
    await stopServer(defaultServer);
    await stopServer(optInServer);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => privateHost?.close(() => resolve()));
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  }, 30_000);

  beforeEach(() => {
    connections = 0;
  });

  /** Starts an authorization-code flow whose client_id is a CIMD URL on the private host. */
  async function authorize(server: RunningServer, path: string): Promise<string> {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: `https://${CLIENT_HOST}:${privatePort}/${path}/client.json`,
      redirect_uri: `https://${CLIENT_HOST}:${privatePort}/callback`,
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
      scope: 'mcp:read',
      state: 'e2e-state',
      resource: `${server.base}/api/v1/mcp`,
    });
    const res = await fetch(`${server.base}/api/auth/oauth2/authorize?${params}`, {
      redirect: 'manual',
    });
    const location = res.headers.get('location');
    const body = await res.text();
    return `${res.status} ${location ?? ''} ${body}`;
  }

  it('refuses a client_id URL that resolves to a private address by default', async () => {
    const outcome = await authorize(defaultServer!, 'default-policy');

    expect(outcome).toMatch(/invalid_client/);
    // The decisive check: the server never opened a connection to the private host.
    expect(connections).toBe(0);
  });

  it('reaches a LAN-hosted client only with THINKER_CIMD_ALLOW_PRIVATE=true', async () => {
    const outcome = await authorize(optInServer!, 'opt-in');

    // The fetch is attempted (and fails on the non-TLS listener), proving the
    // refusal above came from the private-address policy and nothing else.
    expect(outcome).toMatch(/invalid_client/);
    expect(connections).toBeGreaterThan(0);
  });
});
