/**
 * #17: Thinker makes no outbound call of its own. Upstream Manifest phoned home
 * from the backend and the CLI: usage telemetry, a daily update check against
 * GitHub releases, the setup-questionnaire forwarding, Sentry, the hourly
 * modelparams.dev catalog refresh, and a hosted Wingman origin always allowed by
 * CORS/CSP. All of it is gone; this guards against any of it coming back.
 *
 * The only outbound catalog destinations allowed are the ones in ADR 0003
 * (openrouter.ai, models.dev, and raw.githubusercontent.com for OpenCode Go).
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
const ADR_0003_CATALOG_HOSTS = new Set([
  'openrouter.ai',
  'models.dev',
  'raw.githubusercontent.com',
]);
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

interface EgressRecord {
  kind: 'fetch' | 'dns';
  target: string;
}

describe('no phone-home egress', () => {
  it.each(FORBIDDEN_DESTINATIONS)(
    'names %s nowhere in the backend, CLI or shared source',
    (host) => {
      expect(filesMatching(new RegExp(host.replace(/[.]/g, '\\.')))).toEqual([]);
    },
  );

  it('names no hosted gateway host anywhere in the CLI or shared source, tests included', () => {
    const pattern = new RegExp(HOSTED_GATEWAY_HOSTS.map((h) => h.replace(/[.]/g, '\\.')).join('|'));
    expect(filesMatching(pattern).filter((file) => /^(cli|shared)[\\/]/.test(file))).toEqual([]);
  });

  it('adds no backend production file naming a hosted gateway host', () => {
    const pattern = new RegExp(HOSTED_GATEWAY_HOSTS.map((h) => h.replace(/[.]/g, '\\.')).join('|'));
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
   * Boots the real server (`src/main.ts`, every module of AppModule) in its own
   * process, in production mode and with none of upstream's opt-out variables,
   * with `test/support/egress-recorder.cjs` preloaded to record every fetch and
   * DNS lookup while keeping the process off the network.
   */
  describe('at boot (production mode, no opt-out variable)', () => {
    let child: ChildProcess | undefined;
    let workDir: string;
    let base: string;
    let output = '';
    let records: EgressRecord[] = [];

    beforeAll(async () => {
      const databaseUrl = resolveE2eDatabaseUrl();
      // Start from an empty schema: the real server migrates on boot, and
      // earlier suites leave a synchronize()-built schema behind.
      const reset = new DataSource({ type: 'postgres', url: databaseUrl, dropSchema: true });
      await reset.initialize();
      await reset.destroy();

      workDir = mkdtempSync(join(tmpdir(), 'thinker-egress-'));
      const egressLog = join(workDir, 'egress.jsonl');
      writeFileSync(egressLog, '');
      const port = await freePort();
      base = `http://127.0.0.1:${port}`;

      const env: NodeJS.ProcessEnv = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (!/TELEMETRY|UPDATE_CHECK|DISCOVERY|SENTRY|MODELPARAMS|WINGMAN|EMBEDDED/.test(key)) {
          env[key] = value;
        }
      }
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
      });

      child = spawn(
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

      await waitForHealth(base, child, () => output);
      // Let fire-and-forget onModuleInit / onApplicationBootstrap work start.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      records = readFileSync(egressLog, 'utf8')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as EgressRecord);
    }, 180_000);

    afterAll(async () => {
      if (child && child.exitCode === null) {
        const exited = new Promise((resolve) => child!.once('exit', resolve));
        child.kill('SIGTERM');
        const timer = setTimeout(() => child!.kill('SIGKILL'), 10_000);
        await exited;
        clearTimeout(timer);
      }
      if (workDir) rmSync(workDir, { recursive: true, force: true });
    }, 30_000);

    it('boots and runs the egress recorder', () => {
      expect(output).toContain('Server running on');
      expect(records.length).toBeGreaterThan(0);
    });

    it('makes no request to a phone-home destination', () => {
      const offenders = records.filter((record) =>
        [...FORBIDDEN_DESTINATIONS, ...HOSTED_GATEWAY_HOSTS].some((destination) =>
          record.target.includes(destination),
        ),
      );
      expect(offenders).toEqual([]);
    });

    it('fetches nothing outside the ADR 0003 catalogs', () => {
      const remote = records
        .filter((record) => record.kind === 'fetch')
        .map((record) => new URL(record.target).hostname)
        .filter((host) => !LOCAL_HOSTS.has(host));
      expect(remote.filter((host) => !ADR_0003_CATALOG_HOSTS.has(host))).toEqual([]);
    });

    it('resolves no remote hostname, so nothing bypasses fetch to reach the network', () => {
      const remote = records
        .filter((record) => record.kind === 'dns')
        .map((record) => record.target)
        .filter((host) => !LOCAL_HOSTS.has(host));
      expect(remote).toEqual([]);
    });

    it('no longer serves the update-check or discovery routes', async () => {
      const version = await fetch(`${base}/api/v1/version`);
      const discovery = await fetch(`${base}/api/v1/discovery/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(version.status).toBe(404);
      expect(discovery.status).toBe(404);
    });
  });
});
