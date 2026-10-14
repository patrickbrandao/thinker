/**
 * #27: `THINKER_ENCRYPTION_KEY` is required and separate from
 * `BETTER_AUTH_SECRET`.
 *
 * - The real server (`src/main.ts`, in its own process) refuses to start, with
 *   a non-zero exit code and an actionable message, when the key is missing,
 *   shorter than 32 characters, equal to `BETTER_AUTH_SECRET`, or when
 *   `THINKER_ENCRYPTION_KEY_PREVIOUS` is set but too short. The check runs
 *   before the app, so nothing reaches the database.
 * - With a valid key, a provider key saved through the API is stored
 *   encrypted under that key and does not decrypt with `BETTER_AUTH_SECRET`.
 */
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestApp, stubProviderDiscoveryFetch, TEST_API_KEY } from './helpers';
import { resolveE2eDatabaseUrl } from './e2e-db-guard';
import { decrypt, decryptWithAny, getDecryptionSecrets } from '../src/common/utils/crypto.util';
import { TenantProvider } from '../src/entities/tenant-provider.entity';

const BACKEND = join(__dirname, '..');
const SESSION_SECRET = 'e2e-session-secret-at-least-32-characters-long';
const VALID_KEY = 'e2e-encryption-key-distinct-from-session-secret';

interface BootResult {
  code: number | null;
  output: string;
}

/**
 * Starts `src/main.ts` with exactly the given encryption-related variables
 * (everything else inherited, minus any key the runner set) and waits for it
 * to exit. `egress-recorder.cjs` keeps the child off the network.
 */
function bootExpectingExit(extraEnv: NodeJS.ProcessEnv): Promise<BootResult> {
  const workDir = mkdtempSync(join(tmpdir(), 'thinker-enc-key-'));
  const egressLog = join(workDir, 'egress.jsonl');
  writeFileSync(egressLog, '');

  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/ENCRYPTION_KEY|BETTER_AUTH_SECRET|EMBEDDED/.test(key)) env[key] = value;
  }
  Object.assign(env, {
    NODE_ENV: 'production',
    DATABASE_URL: resolveE2eDatabaseUrl(),
    // Port 0 is never reached: the check fails before the app is created. If
    // it did not, the child would bind an ephemeral loopback port and the
    // timeout below would kill it.
    PORT: '0',
    BIND_ADDRESS: '127.0.0.1',
    BETTER_AUTH_URL: 'http://127.0.0.1:1',
    BETTER_AUTH_SECRET: SESSION_SECRET,
    THINKER_CATALOG_SYNC: 'false',
    EGRESS_LOG: egressLog,
    ...extraEnv,
  });
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];

  return new Promise((resolve, reject) => {
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
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`server did not exit on its own:\n${output}`));
    }, 90_000);
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      rmSync(workDir, { recursive: true, force: true });
      resolve({ code, output });
    });
  });
}

function expectConfigFailure(result: BootResult, expected: RegExp): void {
  expect(result.code).not.toBe(0);
  expect(result.code).not.toBeNull();
  expect(result.output).toContain('Configuration error');
  expect(result.output).toMatch(expected);
  // Not the generic "failed database migration" hint: this is a config error.
  expect(result.output).not.toContain('database migration');
  expect(result.output).not.toContain('Server running');
}

describe('THINKER_ENCRYPTION_KEY is required at boot', () => {
  jest.setTimeout(120_000);

  it('refuses to start without the key, even with BETTER_AUTH_SECRET set', async () => {
    const result = await bootExpectingExit({});
    expectConfigFailure(result, /THINKER_ENCRYPTION_KEY is not set/);
    expect(result.output).toContain('openssl rand -hex 32');
  });

  it('refuses to start with a key shorter than 32 characters', async () => {
    const shortKey = 'x'.repeat(31);
    const result = await bootExpectingExit({ THINKER_ENCRYPTION_KEY: shortKey });
    expectConfigFailure(result, /THINKER_ENCRYPTION_KEY is too short \(31 chars\)/);
    expect(result.output).not.toContain(shortKey);
  });

  it('refuses to start when the key equals BETTER_AUTH_SECRET', async () => {
    const result = await bootExpectingExit({ THINKER_ENCRYPTION_KEY: SESSION_SECRET });
    expectConfigFailure(result, /THINKER_ENCRYPTION_KEY must differ from BETTER_AUTH_SECRET/);
    expect(result.output).not.toContain(SESSION_SECRET);
  });

  it('refuses to start with a THINKER_ENCRYPTION_KEY_PREVIOUS shorter than 32 characters', async () => {
    const result = await bootExpectingExit({
      THINKER_ENCRYPTION_KEY: VALID_KEY,
      THINKER_ENCRYPTION_KEY_PREVIOUS: 'too-short',
    });
    expectConfigFailure(result, /THINKER_ENCRYPTION_KEY_PREVIOUS is too short/);
  });
});

describe('THINKER_ENCRYPTION_KEY encrypts stored provider keys on its own', () => {
  const PROVIDER_KEY = 'sk-e2e-encryption-key-check-0123456789';
  let app: INestApplication;
  let ds: DataSource;
  let restoreDiscoveryFetch: () => void;
  let originalKey: string | undefined;
  let originalSession: string | undefined;

  beforeAll(async () => {
    originalKey = process.env['THINKER_ENCRYPTION_KEY'];
    originalSession = process.env['BETTER_AUTH_SECRET'];
    process.env['THINKER_ENCRYPTION_KEY'] = VALID_KEY;
    process.env['BETTER_AUTH_SECRET'] = SESSION_SECRET;
    app = await createTestApp();
    restoreDiscoveryFetch = stubProviderDiscoveryFetch();
    ds = app.get(DataSource);
  }, 60_000);

  afterAll(async () => {
    restoreDiscoveryFetch?.();
    await app?.close();
    if (originalKey === undefined) delete process.env['THINKER_ENCRYPTION_KEY'];
    else process.env['THINKER_ENCRYPTION_KEY'] = originalKey;
    if (originalSession === undefined) delete process.env['BETTER_AUTH_SECRET'];
    else process.env['BETTER_AUTH_SECRET'] = originalSession;
  });

  it('stores the provider key under THINKER_ENCRYPTION_KEY, never under BETTER_AUTH_SECRET', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/routing/test-agent/providers')
      .set('x-api-key', TEST_API_KEY)
      .send({ provider: 'openai', apiKey: PROVIDER_KEY })
      .expect(201);

    const row = await ds
      .getRepository(TenantProvider)
      .findOneOrFail({ where: { id: res.body.id as string } });
    const stored = row.api_key_encrypted as string;

    expect(stored).toBeTruthy();
    expect(stored).not.toContain(PROVIDER_KEY);
    expect(decrypt(stored, VALID_KEY)).toBe(PROVIDER_KEY);
    expect(() => decrypt(stored, SESSION_SECRET)).toThrow();

    // The read path only ever tries the dedicated key (and PREVIOUS).
    expect(getDecryptionSecrets()).toEqual([VALID_KEY]);
    expect(decryptWithAny(stored, getDecryptionSecrets()).plaintext).toBe(PROVIDER_KEY);
  });
});
