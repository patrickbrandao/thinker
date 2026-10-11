import { E2eDatabaseGuardError, checkE2eDatabaseEnv, resolveE2eDatabaseUrl } from './e2e-db-guard';

const SAFE_URL = 'postgresql://thinker:thinker@127.0.0.1:55432/thinker_e2e_test';

function reasonOf(env: Record<string, string | undefined>): string {
  const check = checkE2eDatabaseEnv(env);
  if (check.ok) throw new Error('expected the guard to refuse');
  return check.reason;
}

describe('checkE2eDatabaseEnv', () => {
  it('accepts a test database with explicit consent', () => {
    expect(checkE2eDatabaseEnv({ DATABASE_URL: SAFE_URL, THINKER_E2E_ALLOW_DROP: '1' })).toEqual({
      ok: true,
      url: SAFE_URL,
      database: 'thinker_e2e_test',
    });
  });

  it.each(['thinker_e2e_test', 'test', 'TEST_db', 'my-testing', 'e2e%5Ftest'])(
    'accepts database name %s',
    (name) => {
      const check = checkE2eDatabaseEnv({
        DATABASE_URL: `postgres://u:p@localhost:6000/${name}`,
        THINKER_E2E_ALLOW_DROP: '1',
      });
      expect(check.ok).toBe(true);
    },
  );

  it('refuses when DATABASE_URL is missing (no default database)', () => {
    expect(reasonOf({ THINKER_E2E_ALLOW_DROP: '1' })).toMatch(/DATABASE_URL is not set/);
  });

  it('refuses an empty or blank DATABASE_URL', () => {
    expect(reasonOf({ DATABASE_URL: '', THINKER_E2E_ALLOW_DROP: '1' })).toMatch(/not set/);
    expect(reasonOf({ DATABASE_URL: '   ', THINKER_E2E_ALLOW_DROP: '1' })).toMatch(/not set/);
  });

  it.each(['mydatabase', 'thinker', 'manifest_duprepro', 'moneyflow', 'tst'])(
    'refuses non-test database name %s',
    (name) => {
      expect(
        reasonOf({
          DATABASE_URL: `postgresql://myuser:mypassword@localhost:5432/${name}`,
          THINKER_E2E_ALLOW_DROP: '1',
        }),
      ).toMatch(/does not look like a test database/);
    },
  );

  it('does not accept "test" found only in the user, password, host or query', () => {
    expect(
      reasonOf({
        DATABASE_URL: 'postgresql://test:test@test-host:5432/prod?application_name=test',
        THINKER_E2E_ALLOW_DROP: '1',
      }),
    ).toMatch(/"prod" does not look like a test database/);
  });

  it('refuses a URL without a database name', () => {
    expect(
      reasonOf({ DATABASE_URL: 'postgresql://u:p@localhost:5432', THINKER_E2E_ALLOW_DROP: '1' }),
    ).toMatch(/does not name a database/);
    expect(
      reasonOf({ DATABASE_URL: 'postgresql://u:p@localhost:5432/', THINKER_E2E_ALLOW_DROP: '1' }),
    ).toMatch(/does not name a database/);
  });

  it('refuses a database override in the query string', () => {
    expect(
      reasonOf({
        DATABASE_URL: `${SAFE_URL}?database=mydatabase`,
        THINKER_E2E_ALLOW_DROP: '1',
      }),
    ).toMatch(/only in its path/);
    expect(
      reasonOf({ DATABASE_URL: `${SAFE_URL}?DBNAME=prod`, THINKER_E2E_ALLOW_DROP: '1' }),
    ).toMatch(/only in its path/);
  });

  it('refuses an invalid URL', () => {
    expect(reasonOf({ DATABASE_URL: 'not a url', THINKER_E2E_ALLOW_DROP: '1' })).toMatch(
      /not a valid URL/,
    );
  });

  it('refuses an invalid percent-encoded database name', () => {
    expect(
      reasonOf({ DATABASE_URL: 'postgresql://u:p@h:1/test%E0', THINKER_E2E_ALLOW_DROP: '1' }),
    ).toMatch(/invalid database name/);
  });

  it('refuses a non-postgres URL', () => {
    expect(
      reasonOf({
        DATABASE_URL: 'mysql://u:p@localhost:3306/app_test',
        THINKER_E2E_ALLOW_DROP: '1',
      }),
    ).toMatch(/postgres:\/\/ or postgresql:\/\//);
  });

  it.each([undefined, '', '0', 'true', 'yes', ' 1'])(
    'refuses when THINKER_E2E_ALLOW_DROP is %p',
    (value) => {
      expect(reasonOf({ DATABASE_URL: SAFE_URL, THINKER_E2E_ALLOW_DROP: value })).toMatch(
        /THINKER_E2E_ALLOW_DROP=1 is not set/,
      );
    },
  );
});

describe('resolveE2eDatabaseUrl', () => {
  it('returns the URL when the guard passes', () => {
    expect(resolveE2eDatabaseUrl({ DATABASE_URL: SAFE_URL, THINKER_E2E_ALLOW_DROP: '1' })).toBe(
      SAFE_URL,
    );
  });

  it('throws an error that explains how to run the suite safely', () => {
    let error: unknown;
    try {
      resolveE2eDatabaseUrl({});
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(E2eDatabaseGuardError);
    const message = (error as Error).message;
    expect(message).toContain('Refusing to run the backend e2e suite');
    expect(message).toContain('npm run test:e2e:docker');
    expect(message).toContain('THINKER_E2E_ALLOW_DROP=1');
  });

  it('never echoes credentials from DATABASE_URL', () => {
    expect(() =>
      resolveE2eDatabaseUrl({
        DATABASE_URL: 'postgresql://admin:s3cret-pass@db.internal:5432/prod',
        THINKER_E2E_ALLOW_DROP: '1',
      }),
    ).toThrow(expect.objectContaining({ message: expect.not.stringContaining('s3cret-pass') }));
  });

  it('reads process.env by default', () => {
    const saved = {
      url: process.env['DATABASE_URL'],
      allow: process.env['THINKER_E2E_ALLOW_DROP'],
    };
    try {
      process.env['DATABASE_URL'] = SAFE_URL;
      process.env['THINKER_E2E_ALLOW_DROP'] = '1';
      expect(resolveE2eDatabaseUrl()).toBe(SAFE_URL);
    } finally {
      if (saved.url === undefined) delete process.env['DATABASE_URL'];
      else process.env['DATABASE_URL'] = saved.url;
      if (saved.allow === undefined) delete process.env['THINKER_E2E_ALLOW_DROP'];
      else process.env['THINKER_E2E_ALLOW_DROP'] = saved.allow;
    }
  });
});
