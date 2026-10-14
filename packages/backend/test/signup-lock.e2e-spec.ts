/**
 * #29: public sign-up is closed; the first admin comes only from the setup
 * wizard, which needs the one-time setup token printed in the server log.
 *
 * Better Auth's ESM dependencies cannot load in Jest's CommonJS runtime, so
 * the real server (`src/main.ts`) runs in its own process, as in
 * `mcp-cimd-ssrf.e2e-spec.ts`. `egress-recorder.cjs` keeps it off the
 * network. Two servers share one disposable database:
 *   - `closed`: the default (no THINKER_ALLOW_SIGNUP);
 *   - `valve`:  THINKER_ALLOW_SIGNUP=true, the provisional escape hatch.
 */
import { spawn, type ChildProcess } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { resolveE2eDatabaseUrl } from './e2e-db-guard';

const BACKEND = join(__dirname, '..');
const TOKEN_PATTERN = /one-time setup token: ([A-Za-z0-9_-]{20,})/g;

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
  delete env['THINKER_ALLOW_SIGNUP'];
  delete env['SEED_DATA'];
  Object.assign(env, {
    NODE_ENV: 'production',
    DATABASE_URL: databaseUrl,
    PORT: String(port),
    BIND_ADDRESS: '127.0.0.1',
    BETTER_AUTH_URL: base,
    BETTER_AUTH_SECRET:
      process.env['BETTER_AUTH_SECRET'] ?? 'test-secret-for-e2e-at-least-32chars!!',
    SHUTDOWN_DRAIN_MS: '0',
    EGRESS_LOG: egressLog,
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

/** The last setup token a server printed. */
function setupToken(server: RunningServer): string {
  const matches = [...server.output().matchAll(TOKEN_PATTERN)];
  const token = matches.at(-1)?.[1];
  if (!token) throw new Error(`no setup token in the server log:\n${server.output()}`);
  return token;
}

function post(server: RunningServer, path: string, body: unknown): Promise<Response> {
  return fetch(`${server.base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: server.base },
    body: JSON.stringify(body),
  });
}

function signUp(server: RunningServer, email: string): Promise<Response> {
  return post(server, '/api/auth/sign-up/email', {
    email,
    password: 'a-long-enough-password',
    name: 'Someone',
  });
}

function setupAdmin(server: RunningServer, setupTokenValue?: string): Promise<Response> {
  return post(server, '/api/v1/setup/admin', {
    email: 'founder@example.com',
    name: 'Founder',
    password: 'founder-password',
    ...(setupTokenValue === undefined ? {} : { setupToken: setupTokenValue }),
  });
}

async function status(
  server: RunningServer,
): Promise<{ needsSetup: boolean; signupEnabled: boolean }> {
  const res = await fetch(`${server.base}/api/v1/setup/status`);
  expect(res.status).toBe(200);
  return (await res.json()) as { needsSetup: boolean; signupEnabled: boolean };
}

describe('Closed public sign-up and one-time setup token (e2e)', () => {
  let workDir: string;
  let db: DataSource;
  let closed: RunningServer | undefined;
  let valve: RunningServer | undefined;

  const userEmails = async (): Promise<string[]> =>
    ((await db.query(`SELECT email FROM "user" ORDER BY email`)) as Array<{ email: string }>).map(
      (row) => row.email,
    );

  beforeAll(async () => {
    // Refuses anything but an explicit, disposable test database (#67).
    const databaseUrl = resolveE2eDatabaseUrl();
    // Start from an empty schema: the real server migrates on boot.
    const reset = new DataSource({ type: 'postgres', url: databaseUrl, dropSchema: true });
    await reset.initialize();
    await reset.destroy();

    workDir = mkdtempSync(join(tmpdir(), 'thinker-signup-'));
    // Sequential boots: the first one applies the migrations.
    closed = await bootServer(databaseUrl, workDir, {});
    valve = await bootServer(databaseUrl, workDir, { THINKER_ALLOW_SIGNUP: 'true' });

    db = new DataSource({ type: 'postgres', url: databaseUrl });
    await db.initialize();
  }, 330_000);

  afterAll(async () => {
    await db?.destroy();
    await stopServer(closed);
    await stopServer(valve);
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  }, 30_000);

  describe('fresh install (no user yet)', () => {
    it('prints a setup token at boot and reports sign-up disabled', async () => {
      expect(setupToken(closed!)).toMatch(/^[A-Za-z0-9_-]{32}$/);
      await expect(status(closed!)).resolves.toMatchObject({
        needsSetup: true,
        signupEnabled: false,
      });
      // The valve never opens sign-up before the first admin exists.
      await expect(status(valve!)).resolves.toMatchObject({
        needsSetup: true,
        signupEnabled: false,
      });
    });

    it('refuses a direct POST /api/auth/sign-up/email with 403 and creates no user', async () => {
      const res = await signUp(closed!, 'squatter@example.com');
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'SIGNUP_DISABLED' });
      expect(await userEmails()).toEqual([]);
    });

    it('refuses it even with THINKER_ALLOW_SIGNUP=true: the first account comes from the wizard', async () => {
      const res = await signUp(valve!, 'squatter@example.com');
      expect(res.status).toBe(403);
      expect(await userEmails()).toEqual([]);
    });

    it('refuses the wizard without a token or with a wrong token', async () => {
      expect((await setupAdmin(closed!)).status).toBe(403);
      expect((await setupAdmin(closed!, 'not-the-token')).status).toBe(403);
      // Another process's token is not this one's.
      expect((await setupAdmin(closed!, setupToken(valve!))).status).toBe(403);
      expect(await userEmails()).toEqual([]);
    });

    it('creates exactly one admin when two setups race with the right token', async () => {
      const token = setupToken(closed!);
      const results = await Promise.all([setupAdmin(closed!, token), setupAdmin(closed!, token)]);
      expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
      expect(await userEmails()).toEqual(['founder@example.com']);
      const verified = (await db.query(`SELECT "emailVerified" FROM "user"`)) as Array<{
        emailVerified: boolean;
      }>;
      expect(verified).toEqual([{ emailVerified: true }]);
    }, 30_000);

    it('does not accept the token a second time', async () => {
      await db.query(`DELETE FROM "user"`);
      try {
        const res = await setupAdmin(closed!, setupToken(closed!));
        // The token was consumed: refused, and a fresh one is printed instead.
        expect(res.status).toBe(403);
        expect(await userEmails()).toEqual([]);
      } finally {
        const res = await setupAdmin(closed!, setupToken(closed!));
        expect(res.status).toBe(201);
      }
    }, 30_000);
  });

  describe('after the first admin exists', () => {
    it('the admin can sign in', async () => {
      const res = await post(closed!, '/api/auth/sign-in/email', {
        email: 'founder@example.com',
        password: 'founder-password',
      });
      expect(res.status).toBe(200);
    });

    it('refuses POST /api/auth/sign-up/email with 403 by default', async () => {
      await expect(status(closed!)).resolves.toMatchObject({
        needsSetup: false,
        signupEnabled: false,
      });
      const res = await signUp(closed!, 'second@example.com');
      expect(res.status).toBe(403);
      expect(await userEmails()).toEqual(['founder@example.com']);
    });

    it('refuses the wizard with 409', async () => {
      expect((await setupAdmin(closed!, 'anything')).status).toBe(409);
    });

    it('accepts sign-up with THINKER_ALLOW_SIGNUP=true', async () => {
      await expect(status(valve!)).resolves.toMatchObject({
        needsSetup: false,
        signupEnabled: true,
      });
      const res = await signUp(valve!, 'second@example.com');
      expect(res.status).toBe(200);
      expect(await userEmails()).toEqual(['founder@example.com', 'second@example.com']);
    });
  });
});
