/**
 * #17: Thinker makes no outbound call of its own. Upstream Manifest phoned home
 * from the backend and the CLI: usage telemetry, a daily update check against
 * GitHub releases, the setup-questionnaire forwarding, Sentry, the hourly
 * modelparams.dev catalog refresh, and a hosted Wingman origin always allowed by
 * CORS/CSP. All of it is gone; this guards against any of it coming back.
 *
 * The only outbound catalog destinations allowed are the ones in ADR 0003
 * (openrouter.ai, models.dev, and raw.githubusercontent.com for OpenCode Go).
 * #39 tightens that: the OpenCode Go doc is fetched only when an OpenCode Go
 * provider is registered, and THINKER_CATALOG_SYNC=false silences all three.
 */
import { spawn, type ChildProcess } from 'child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import { DataSource } from 'typeorm';
import { resolveE2eDatabaseUrl } from './e2e-db-guard';

const FORBIDDEN_DESTINATIONS = [
  'telemetry.manifest.build',
  'blue.manifest.build',
  'api.github.com/repos/mnfst',
  'modelparams.dev',
  'wingman.manifest.build',
  'sentry.io',
];
/**
 * Manifest Cloud's API hosts. A CLI defaulting to one sent the user's key there
 * whenever no host was configured; nothing may target them by default.
 */
const HOSTED_GATEWAY_HOSTS = ['app.manifest.build', 'gateway.manifest.build'];
/**
 * Backend production files that still name a hosted gateway host, none of them
 * as a request destination: the dashboard link fallback with the OG-tag
 * placeholder it matches in the frontend's index.html (#22, #25). The list may
 * only shrink.
 */
const BACKEND_HOSTED_GATEWAY_LEFTOVERS = [
  'backend/src/common/utils/dashboard-url.ts',
  'backend/src/common/utils/og-rewrite.ts',
];
const OPENCODE_GO_DOC_HOST = 'raw.githubusercontent.com';
const ADR_0003_CATALOG_HOSTS = new Set(['openrouter.ai', 'models.dev', OPENCODE_GO_DOC_HOST]);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const BACKEND = join(__dirname, '..');
const SOURCE_ROOTS = [
  join(BACKEND, 'src'),
  join(BACKEND, '..', 'cli', 'src'),
  join(BACKEND, '..', 'shared', 'src'),
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mjs|js|json|ya?ml)$/.test(entry) ? [path] : [];
  });
}

/** Source files (old migrations aside) whose text matches, relative to packages/. */
function filesMatching(pattern: RegExp): string[] {
  return SOURCE_ROOTS.flatMap(sourceFiles)
    .filter((file) => !file.includes(join('database', 'migrations')))
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map((file) => file.slice(join(BACKEND, '..').length + 1));
}

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

async function waitForHealth(base: string, child: ChildProcess, output: () => string) {
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited with ${child.exitCode}:\n${output()}`);
    }
    try {
      const res = await fetch(`${base}/api/v1/health`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`server did not become healthy:\n${output()}`);
}

/** Escapes every RegExp metacharacter so a host name matches literally. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface EgressRecord {
  kind: 'boot' | 'fetch' | 'dns';
  target: string;
}

/** Hostnames of the remote (non-loopback) fetches in a run. */
function remoteFetchHosts(records: EgressRecord[]): string[] {
  return records
    .filter((record) => record.kind === 'fetch')
    .map((record) => new URL(record.target).hostname)
    .filter((host) => !LOCAL_HOSTS.has(host));
}

/**
 * Opens a connection to the e2e database. The URL goes through the e2e guard
 * (#67) on every call, so `dropSchema` can only ever wipe a disposable test
 * database.
 */
async function withDatabase(run: (db: DataSource) => Promise<void>, dropSchema = false) {
  const db = new DataSource({ type: 'postgres', url: resolveE2eDatabaseUrl(), dropSchema });
  await db.initialize();
  try {
    await run(db);
  } finally {
    await db.destroy();
  }
}

interface BootedServer {
  base: string;
  output: () => string;
  records: EgressRecord[];
  stop: () => Promise<void>;
}

/**
 * Boots the real server (`src/main.ts`, every module of AppModule) in its own
 * process, in production mode and with none of upstream's opt-out variables,
 * with `test/support/egress-recorder.cjs` preloaded to record every fetch and
 * DNS lookup while keeping the process off the network. Returns what it
 * recorded once health passed and the fire-and-forget boot work had started.
 */
async function bootServer(extraEnv: NodeJS.ProcessEnv = {}): Promise<BootedServer> {
  const workDir = mkdtempSync(join(tmpdir(), 'thinker-egress-'));
  const egressLog = join(workDir, 'egress.jsonl');
  writeFileSync(egressLog, '');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;

  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      !/TELEMETRY|UPDATE_CHECK|DISCOVERY|SENTRY|MODELPARAMS|WINGMAN|EMBEDDED|CATALOG_SYNC/.test(key)
    ) {
      env[key] = value;
    }
  }
  Object.assign(env, {
    NODE_ENV: 'production',
    DATABASE_URL: resolveE2eDatabaseUrl(),
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
  const child: ChildProcess = spawn(
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

  const stop = async () => {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      await exited;
      clearTimeout(timer);
    }
    rmSync(workDir, { recursive: true, force: true });
  };

  try {
    await waitForHealth(base, child, () => output);
    // Let fire-and-forget onModuleInit / onApplicationBootstrap work start.
    await new Promise((resolve) => setTimeout(resolve, 3000));
  } catch (err) {
    await stop();
    throw err;
  }
  const records = readFileSync(egressLog, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as EgressRecord);
  return { base, output: () => output, records, stop };
}

describe('no phone-home egress', () => {
  it.each(FORBIDDEN_DESTINATIONS)(
    'names %s nowhere in the backend, CLI or shared source',
    (host) => {
      expect(filesMatching(new RegExp(escapeRegExp(host)))).toEqual([]);
    },
  );

  it('names no hosted gateway host anywhere in the CLI or shared source, tests included', () => {
    const pattern = new RegExp(HOSTED_GATEWAY_HOSTS.map(escapeRegExp).join('|'));
    expect(filesMatching(pattern).filter((file) => /^(cli|shared)[\\/]/.test(file))).toEqual([]);
  });

  it('adds no backend production file naming a hosted gateway host', () => {
    const pattern = new RegExp(HOSTED_GATEWAY_HOSTS.map(escapeRegExp).join('|'));
    const backendFiles = filesMatching(pattern)
      .map((file) => file.split(sep).join('/'))
      .filter((file) => file.startsWith('backend/') && !/\.spec\.tsx?$/.test(file));
    expect(backendFiles.sort()).toEqual(BACKEND_HOSTED_GATEWAY_LEFTOVERS);
  });

  it('defaults the CLI to a local gateway', () => {
    const config = readFileSync(join(BACKEND, '..', 'cli', 'src', 'config.ts'), 'utf8');
    expect(config).toMatch(/export const DEFAULT_URL = 'http:\/\/localhost:2099';/);
  });

  it('ships no telemetry, update check, discovery forwarding, Sentry or Wingman code', () => {
    expect(
      filesMatching(
        /TelemetryService|InstallIdService|VersionCheckService|DiscoverySyncService|@sentry\/|SENTRY_DSN|MANIFEST_TELEMETRY|TELEMETRY_ENDPOINT|UPDATE_CHECK|DISCOVERY_ENDPOINT|MODELPARAMS_API|WINGMAN_/,
      ),
    ).toEqual([]);
  });

  it('does not depend on the Sentry SDK', () => {
    const pkg = JSON.parse(readFileSync(join(BACKEND, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((name) => name.startsWith('@sentry/'))).toEqual([]);
  });

  /**
   * Each block boots the real server against the same database, in order: the
   * first starts from an empty schema (the server migrates on boot), and the
   * later ones register an OpenCode Go provider in it.
   */
  describe('at boot (production mode, no opt-out variable)', () => {
    let server: BootedServer | undefined;

    beforeAll(async () => {
      // Start from an empty schema: the real server migrates on boot, and
      // earlier suites leave a synchronize()-built schema behind.
      await withDatabase(async () => undefined, true);
      server = await bootServer();
    }, 180_000);

    afterAll(async () => {
      await server?.stop();
    }, 30_000);

    it('boots and runs the egress recorder', () => {
      expect(server!.output()).toContain('Server running on');
      expect(server!.records.some((record) => record.kind === 'boot')).toBe(true);
    });

    it('makes no request to a phone-home destination', () => {
      const offenders = server!.records.filter((record) =>
        [...FORBIDDEN_DESTINATIONS, ...HOSTED_GATEWAY_HOSTS].some((destination) =>
          record.target.includes(destination),
        ),
      );
      expect(offenders).toEqual([]);
    });

    it('fetches nothing outside the ADR 0003 catalogs', () => {
      const remote = remoteFetchHosts(server!.records);
      expect(remote.filter((host) => !ADR_0003_CATALOG_HOSTS.has(host))).toEqual([]);
    });

    it('syncs the OpenRouter and models.dev catalogs by default', () => {
      const remote = new Set(remoteFetchHosts(server!.records));
      expect(remote.has('openrouter.ai')).toBe(true);
      expect(remote.has('models.dev')).toBe(true);
    });

    it('does not fetch the OpenCode Go doc without an OpenCode Go provider', () => {
      expect(remoteFetchHosts(server!.records)).not.toContain(OPENCODE_GO_DOC_HOST);
    });

    it('resolves no remote hostname, so nothing bypasses fetch to reach the network', () => {
      const remote = server!.records
        .filter((record) => record.kind === 'dns')
        .map((record) => record.target)
        .filter((host) => !LOCAL_HOSTS.has(host));
      expect(remote).toEqual([]);
    });

    it('no longer serves the update-check or discovery routes', async () => {
      const version = await fetch(`${server!.base}/api/v1/version`);
      const discovery = await fetch(`${server!.base}/api/v1/discovery/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(version.status).toBe(404);
      expect(discovery.status).toBe(404);
    });
  });

  describe('with an OpenCode Go provider registered', () => {
    beforeAll(async () => {
      // The schema exists: the boot above migrated it.
      await withDatabase(async (db) => {
        await db.query(
          `INSERT INTO tenants (id, name) VALUES ('egress-tenant', 'egress-tenant')
           ON CONFLICT (id) DO NOTHING`,
        );
        await db.query(
          `INSERT INTO tenant_providers (id, tenant_id, provider, auth_type, label)
           VALUES ('egress-opencode-go', 'egress-tenant', 'opencode-go', 'api_key', 'Default')
           ON CONFLICT (id) DO NOTHING`,
        );
      });
    }, 30_000);

    describe('and THINKER_CATALOG_SYNC=false', () => {
      let server: BootedServer | undefined;

      beforeAll(async () => {
        server = await bootServer({ THINKER_CATALOG_SYNC: 'false' });
      }, 180_000);

      afterAll(async () => {
        await server?.stop();
      }, 30_000);

      it('boots and runs the egress recorder', () => {
        expect(server!.output()).toContain('Server running on');
        expect(server!.records.some((record) => record.kind === 'boot')).toBe(true);
      });

      it('fetches no catalog at all, nor anything else remote', () => {
        expect(remoteFetchHosts(server!.records)).toEqual([]);
      });
    });

    describe('and catalog sync on (default)', () => {
      let server: BootedServer | undefined;

      beforeAll(async () => {
        server = await bootServer();
      }, 180_000);

      afterAll(async () => {
        await server?.stop();
      }, 30_000);

      it('warms the OpenCode Go doc, and fetches nothing outside the ADR 0003 catalogs', () => {
        const remote = remoteFetchHosts(server!.records);
        expect(remote).toContain(OPENCODE_GO_DOC_HOST);
        expect(remote.filter((host) => !ADR_0003_CATALOG_HOSTS.has(host))).toEqual([]);
      });
    });
  });
});
