import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  DEFAULT_DATABASE_STRING_EXEMPT,
  SCAN_EXEMPT,
  GuardScanViolation,
  formatViolations,
  listTestSources,
  scanSource,
  scanTestTree,
} from './e2e-db-guard-scan';

const TEST_DIR = __dirname;
const FIXTURES = join(__dirname, 'fixtures', 'e2e-db-guard');

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

function rules(violations: readonly GuardScanViolation[]): string[] {
  return violations.map((v) => v.rule).sort();
}

describe('e2e database guard scan (issue #108)', () => {
  describe('the backend test tree', () => {
    it('has no spec that bypasses resolveE2eDatabaseUrl()/createTestApp()', () => {
      const violations = scanTestTree(TEST_DIR);
      // On failure the message lists file:line and the rule for each hit.
      expect(formatViolations(violations)).toBe('');
    });

    it('actually sees the specs that drop the schema', () => {
      const files = listTestSources(TEST_DIR);
      expect(files).toEqual(
        expect.arrayContaining([
          'helpers.ts',
          'e2e-db-guard.spec.ts',
          'request-backfill-fallbacks.e2e-spec.ts',
          'drop-saas-feature-schema-migration.e2e-spec.ts',
        ]),
      );
      expect(files.length).toBeGreaterThan(50);
      expect(files.some((f) => f.includes('fixtures/'))).toBe(false);
    });

    it('only exempts files that exist', () => {
      const files = listTestSources(TEST_DIR);
      for (const exempt of [...DEFAULT_DATABASE_STRING_EXEMPT, ...SCAN_EXEMPT]) {
        expect(files).toContain(exempt);
      }
    });
  });

  describe('fixtures', () => {
    it('catches the legacy migration-spec pattern', () => {
      const violations = scanSource(
        'legacy-migration.e2e-spec.ts',
        fixture('legacy-migration.e2e-spec.ts.fixture'),
      );
      expect(rules(violations)).toEqual([
        'database-url-fallback',
        'default-database',
        'unguarded-drop',
      ]);
      expect(violations.find((v) => v.rule === 'unguarded-drop')).toMatchObject({
        line: 15,
        detail: expect.stringContaining('dropSchema: true'),
      });
      expect(violations.find((v) => v.rule === 'database-url-fallback')?.line).toBe(6);
    });

    it('catches raw DROP SCHEMA SQL and a || fallback', () => {
      const violations = scanSource(
        'raw-drop-schema.e2e-spec.ts',
        fixture('raw-drop-schema.e2e-spec.ts.fixture'),
      );
      expect(rules(violations)).toEqual(['database-url-fallback', 'unguarded-drop']);
      expect(violations.find((v) => v.rule === 'unguarded-drop')).toMatchObject({
        line: 9,
        detail: expect.stringContaining('"DROP SCHEMA" SQL'),
      });
    });

    it('accepts the guarded pattern and ignores comments', () => {
      expect(
        scanSource(
          'guarded-migration.e2e-spec.ts',
          fixture('guarded-migration.e2e-spec.ts.fixture'),
        ),
      ).toEqual([]);
    });

    it('fails a tree scan when a legacy spec is added', () => {
      const dir = mkdtempSync(join(tmpdir(), 'thinker-e2e-guard-scan-'));
      try {
        mkdirSync(join(dir, 'nested'));
        copyFileSync(
          join(FIXTURES, 'guarded-migration.e2e-spec.ts.fixture'),
          join(dir, 'guarded-migration.e2e-spec.ts'),
        );
        expect(scanTestTree(dir)).toEqual([]);

        copyFileSync(
          join(FIXTURES, 'legacy-migration.e2e-spec.ts.fixture'),
          join(dir, 'nested', 'legacy-migration.e2e-spec.ts'),
        );
        const violations = scanTestTree(dir);
        expect(new Set(violations.map((v) => v.file))).toEqual(
          new Set(['nested/legacy-migration.e2e-spec.ts']),
        );
        expect(formatViolations(violations)).toContain(
          'test/nested/legacy-migration.e2e-spec.ts:15 [unguarded-drop]',
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('scanSource rules', () => {
    const scan = (source: string) => rules(scanSource('inline.ts', source));

    it('treats dropSchema: false as safe and any other value as a drop', () => {
      expect(scan(`new DataSource({ url, dropSchema: false });`)).toEqual([]);
      expect(scan(`new DataSource({ url, dropSchema: reset });`)).toEqual(['unguarded-drop']);
      expect(scan(`new DataSource({ url, 'dropSchema': true });`)).toEqual(['unguarded-drop']);
      expect(scan(`const dropSchema = true; new DataSource({ url, dropSchema });`)).toEqual([
        'unguarded-drop',
      ]);
    });

    it('flags other ways to wipe the database', () => {
      expect(scan(`await ds.dropDatabase();`)).toEqual(['unguarded-drop']);
      expect(scan(`await queryRunner.dropSchema('public', true, true);`)).toEqual([
        'unguarded-drop',
      ]);
      expect(scan(`await ds.synchronize(true);`)).toEqual(['unguarded-drop']);
      expect(scan(`await ds.synchronize();`)).toEqual([]);
      expect(scan('await ds.query(`drop  schema public cascade`);')).toEqual(['unguarded-drop']);
      expect(scan(`await ds.query('DROP DATABASE x');`)).toEqual(['unguarded-drop']);
    });

    it('needs a call to the guard, not just an import', () => {
      const importOnly = `import { resolveE2eDatabaseUrl } from './e2e-db-guard';
        new DataSource({ url: process.env['E2E_URL'], dropSchema: true });`;
      expect(scan(importOnly)).toEqual(['unguarded-drop']);
      expect(scan(`new DataSource({ url: resolveE2eDatabaseUrl(), dropSchema: true });`)).toEqual(
        [],
      );
      expect(scan(`app = await createTestApp(); await ds.query('DROP SCHEMA x CASCADE');`)).toEqual(
        [],
      );
      expect(scan(`app = await helpers.createTestApp({ dropSchema: true });`)).toEqual([]);
    });

    it('flags any DATABASE_URL fallback, guarded or not', () => {
      expect(scan(`const u = process.env.DATABASE_URL ?? other;`)).toEqual([
        'database-url-fallback',
      ]);
      expect(scan(`const u = process.env['DATABASE_URL']! || other;`)).toEqual([
        'database-url-fallback',
      ]);
      expect(scan(`const u = process.env['OTHER_URL'] ?? other;`)).toEqual([]);
      expect(scan(`const saved = process.env['DATABASE_URL'];`)).toEqual([]);
    });

    it('flags strings naming the development database unless exempt', () => {
      const source = 'const u = `postgresql://u:p@localhost:5432/${name}`;';
      expect(scan(source)).toEqual(['default-database']);
      expect(scan(`const db = 'MyDatabase';`)).toEqual(['default-database']);
      expect(
        scanSource('e2e-db-guard.spec.ts', source, { allowDefaultDatabaseStrings: true }),
      ).toEqual([]);
      expect(scan(`// localhost:5432/mydatabase in a comment\nconst port = 5432;`)).toEqual([]);
    });
  });
});
