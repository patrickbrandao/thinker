import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEYS = ['LOAD_ENV_SPEC_A', 'LOAD_ENV_SPEC_B', 'LOAD_ENV_SPEC_QUOTED'];

describe('load-env-file (side-effect import for the standalone CLIs)', () => {
  const originalCwd = process.cwd();
  const originalTz = process.env['TZ'];
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'thinker-envfile-'));
    process.chdir(dir);
    for (const key of KEYS) delete process.env[key];
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
    for (const key of KEYS) delete process.env[key];
    if (originalTz === undefined) delete process.env['TZ'];
    else process.env['TZ'] = originalTz;
  });

  const load = () =>
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./load-env-file');
    });

  // Jest gives each test file its own copy of process.env, so the loader is
  // observed through the native call it makes instead of the resulting values.
  it('loads .env from the working directory with the native loader', () => {
    writeFileSync(join(dir, '.env'), 'LOAD_ENV_SPEC_A=from-file\n');
    const loadEnvFile = jest.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);
    load();
    expect(loadEnvFile).toHaveBeenCalledTimes(1);
    expect(loadEnvFile).toHaveBeenCalledWith('.env');
  });

  it('does not touch the loader when there is no .env', () => {
    const loadEnvFile = jest.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);
    load();
    expect(loadEnvFile).not.toHaveBeenCalled();
  });

  it('propagates a malformed or unreadable .env instead of swallowing it', () => {
    writeFileSync(join(dir, '.env'), 'X=1\n');
    jest.spyOn(process, 'loadEnvFile').mockImplementation(() => {
      throw new Error('EACCES');
    });
    expect(load).toThrow('EACCES');
  });

  it('is not an error when there is no .env', () => {
    expect(load).not.toThrow();
    expect(process.env['LOAD_ENV_SPEC_A']).toBeUndefined();
  });

  it('pins the process clock to UTC whatever TZ the operator set', () => {
    process.env['TZ'] = 'America/Sao_Paulo';
    load();
    expect(process.env['TZ']).toBe('UTC');
  });

  it('pins UTC after the file is loaded, so a TZ line in .env cannot change the clock', () => {
    writeFileSync(join(dir, '.env'), 'TZ=Asia/Tokyo\n');
    jest.spyOn(process, 'loadEnvFile').mockImplementation(() => {
      process.env['TZ'] = 'Asia/Tokyo';
    });
    load();
    expect(process.env['TZ']).toBe('UTC');
  });
});
