#!/usr/bin/env node
/**
 * Runs the backend e2e suite against a disposable PostgreSQL (issue #67).
 *
 *   npm run test:e2e:docker --workspace=packages/backend [-- <jest args>]
 *
 * 1. Picks a free TCP port on 127.0.0.1 (never a fixed one like 5432).
 * 2. Starts a uniquely named postgres:16-alpine container, data on tmpfs,
 *    database `thinker_e2e_test`, published only on 127.0.0.1:<port>.
 * 3. Waits until it accepts connections, runs the migrations, then runs the
 *    e2e suite in band with DATABASE_URL and THINKER_E2E_ALLOW_DROP=1 set.
 *    Extra arguments are passed through to jest.
 * 4. Always removes the container: on success, failure, Ctrl-C or SIGTERM.
 *
 * No dependencies beyond Node and the Docker CLI.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IMAGE = process.env.THINKER_E2E_PG_IMAGE || 'postgres:16-alpine';
const DB_NAME = 'thinker_e2e_test';
const DB_USER = 'thinker_e2e';
const DB_PASSWORD = randomBytes(12).toString('hex');
const READY_TIMEOUT_MS = 90_000;
const BACKEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUN_ID = randomBytes(8).toString('hex');
const CONTAINER = `thinker-e2e-pg-${process.pid}-${RUN_ID.slice(0, 8)}`;
const LABEL = 'thinker.e2e=disposable';
// Unique per run: cleanup only ever touches the container this run created.
const RUN_LABEL = `thinker.e2e.run=${RUN_ID}`;
// Ports that belong to other local databases on developer machines.
const RESERVED_PORTS = new Set([5432, 5433]);

const jestArgs = process.argv.slice(2);
let runAttempted = false;
let containerId = null;
let cleanedUp = false;
let child = null;

function log(message) {
  process.stderr.write(`[test:e2e:docker] ${message}\n`);
}

/**
 * IDs of the containers this run created: the ID `docker run` printed, plus
 * (for an interrupt before it printed one) whatever matches this run's exact
 * name AND both of its labels. Never a container this run did not create.
 */
function ownedContainerIds() {
  const ids = new Set(containerId ? [containerId] : []);
  const found = docker(
    [
      'ps',
      '--all',
      '--quiet',
      '--no-trunc',
      '--filter',
      `name=^/${CONTAINER}$`,
      '--filter',
      `label=${LABEL}`,
      '--filter',
      `label=${RUN_LABEL}`,
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  if (found.status === 0) {
    for (const id of found.stdout.split(/\s+/).filter(Boolean)) ids.add(id);
  }
  return [...ids];
}

function removeOwnedContainers() {
  for (const id of ownedContainerIds()) {
    const result = docker(['rm', '--force', '--volumes', id], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    if (result.status !== 0) {
      log(
        `WARNING: could not remove ${CONTAINER} (${id.slice(0, 12)}): ${result.stderr?.trim() || result.error}`,
      );
      log(`Remove it by hand: docker rm -f ${id}`);
    }
  }
}

function removeContainer() {
  if (cleanedUp) return;
  cleanedUp = true;
  if (!runAttempted) return;
  log(`Removing container ${CONTAINER}`);
  removeOwnedContainers();
}

function onSignal(signal, code) {
  log(`Received ${signal}, stopping`);
  if (child && child.exitCode === null) child.kill(signal);
  removeContainer();
  process.exit(code);
}

process.on('SIGINT', () => onSignal('SIGINT', 130));
process.on('SIGTERM', () => onSignal('SIGTERM', 143));
process.on('SIGHUP', () => onSignal('SIGHUP', 129));
process.on('exit', removeContainer);

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

function docker(args, options = {}) {
  return spawnSync('docker', args, { encoding: 'utf8', ...options });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startContainer() {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const port = await freePort();
    if (RESERVED_PORTS.has(port)) continue;
    // Mark before `docker run` so an interrupt during the pull or the start
    // still looks for this run's container (by exact name and run label).
    runAttempted = true;
    const result = docker(
      [
        'run',
        '--detach',
        '--name',
        CONTAINER,
        '--label',
        LABEL,
        '--label',
        RUN_LABEL,
        '--tmpfs',
        '/var/lib/postgresql/data:rw',
        '--publish',
        `127.0.0.1:${port}:5432`,
        '--env',
        `POSTGRES_USER=${DB_USER}`,
        '--env',
        `POSTGRES_PASSWORD=${DB_PASSWORD}`,
        '--env',
        `POSTGRES_DB=${DB_NAME}`,
        IMAGE,
        // Durability is pointless for a throwaway database; trade it for speed.
        '-c',
        'fsync=off',
        '-c',
        'synchronous_commit=off',
        '-c',
        'full_page_writes=off',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    if (result.status === 0) {
      containerId = result.stdout.trim().split(/\s+/).pop() || null;
      return port;
    }

    const stderr = (result.stderr || String(result.error || '')).trim();
    // A failed `docker run` can leave a created-but-not-started container.
    removeOwnedContainers();
    if (/port is already allocated|address already in use/i.test(stderr)) {
      log(`Port ${port} was taken meanwhile, retrying (${attempt}/5)`);
      continue;
    }
    throw new Error(`docker run failed: ${stderr}`);
  }
  throw new Error('Could not find a free port for the e2e database');
}

async function waitUntilReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // TCP on 127.0.0.1 inside the container only answers once the final server
    // is up: the entrypoint's init-time server listens on the Unix socket only.
    const ready = docker(
      ['exec', CONTAINER, 'pg_isready', '--quiet', '-h', '127.0.0.1', '-U', DB_USER, '-d', DB_NAME],
      { stdio: 'ignore' },
    );
    if (ready.status === 0) {
      const probe = docker(
        [
          'exec',
          CONTAINER,
          'psql',
          '-h',
          '127.0.0.1',
          '-U',
          DB_USER,
          '-d',
          DB_NAME,
          '-tAc',
          'SELECT 1',
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      );
      if (probe.status === 0 && probe.stdout.trim() === '1') return;
    }
    const state = docker(['inspect', '--format', '{{.State.Status}}', CONTAINER], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (state.status !== 0 || state.stdout.trim() === 'exited') {
      const logs = docker(['logs', '--tail', '30', CONTAINER], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      throw new Error(`Postgres container stopped:\n${logs.stdout}${logs.stderr}`);
    }
    await sleep(500);
  }
  throw new Error(`Postgres was not ready after ${READY_TIMEOUT_MS / 1000}s`);
}

function run(command, args, env) {
  return new Promise((resolveRun, reject) => {
    child = spawn(command, args, { cwd: BACKEND_DIR, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      child = null;
      resolveRun(code ?? (signal ? 1 : 0));
    });
  });
}

async function main() {
  const version = docker(['version', '--format', '{{.Server.Version}}'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (version.status !== 0) {
    throw new Error(
      `Docker is not available (${(version.stderr || String(version.error)).trim()}). Start Docker and retry.`,
    );
  }

  log(`Starting ${IMAGE} as ${CONTAINER}`);
  const port = await startContainer();
  log(`Waiting for Postgres on 127.0.0.1:${port}`);
  await waitUntilReady();

  const databaseUrl = `postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${port}/${DB_NAME}`;
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    // datasource.ts prefers these over DATABASE_URL; pin them so a value from
    // the shell or a .env file can never redirect the migrations elsewhere.
    MIGRATION_DATABASE_URL: databaseUrl,
    DATABASE_UNPOOLED_URL: databaseUrl,
    THINKER_E2E_ALLOW_DROP: '1',
    BETTER_AUTH_SECRET:
      process.env.BETTER_AUTH_SECRET || 'e2e-docker-secret-at-least-32-characters!!',
  };

  log('Running migrations');
  const migrations = await run('npm', ['run', '--silent', 'migration:run'], env);
  if (migrations !== 0) return migrations;

  log(`Running the e2e suite${jestArgs.length ? ` (jest args: ${jestArgs.join(' ')})` : ''}`);
  return run('npm', ['run', 'test:e2e', '--', ...jestArgs], env);
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (err) {
  log(err instanceof Error ? err.message : String(err));
  exitCode = 1;
} finally {
  removeContainer();
}
process.exit(exitCode);
