/**
 * Static check for the e2e database guard (issue #108).
 *
 * `resolveE2eDatabaseUrl()` (issue #67) only protects the code that calls it.
 * This scanner reads every `.ts` file under `packages/backend/test` and
 * reports code that could wipe a database without going through the guard:
 *
 *   - `unguarded-drop`: the file wipes a schema (`dropSchema` not literally
 *     `false`, `DROP SCHEMA`/`DROP DATABASE` SQL, `.dropDatabase()`,
 *     `.synchronize(true)`) but never calls `resolveE2eDatabaseUrl()` or
 *     `createTestApp()`;
 *   - `database-url-fallback`: `process.env.DATABASE_URL ?? ...` or `|| ...`,
 *     i.e. a default database when the variable is unset;
 *   - `default-database`: a string that names the inherited development
 *     database (`localhost:5432`, `mydatabase`).
 *
 * It walks the TypeScript AST, so comments never count, and is run by
 * `e2e-db-guard-scan.spec.ts` in the unit suite.
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative, sep } from 'path';
import * as ts from 'typescript';

export type GuardScanRule = 'unguarded-drop' | 'database-url-fallback' | 'default-database';

export interface GuardScanViolation {
  file: string;
  line: number;
  rule: GuardScanRule;
  detail: string;
}

export interface ScanOptions {
  /** Allow strings naming the development database (the guard's own spec). */
  allowDefaultDatabaseStrings?: boolean;
}

const GUARD_CALLS = new Set(['resolveE2eDatabaseUrl', 'createTestApp']);
const DESTRUCTIVE_SQL = /\bDROP\s+(SCHEMA|DATABASE)\b/i;
const DEFAULT_DATABASE = /localhost:5432|mydatabase/i;

/**
 * Files allowed to contain `localhost:5432`/`mydatabase` strings: the guard's
 * unit spec feeds them to `checkE2eDatabaseEnv` to prove they are refused.
 */
export const DEFAULT_DATABASE_STRING_EXEMPT: ReadonlySet<string> = new Set([
  'e2e-db-guard.spec.ts',
]);

/**
 * Files not scanned at all: this scanner's own spec, whose strings are sample
 * sources fed to `scanSource`.
 */
export const SCAN_EXEMPT: ReadonlySet<string> = new Set(['e2e-db-guard-scan.spec.ts']);

function calleeName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return undefined;
}

/** `process.env.DATABASE_URL` or `process.env['DATABASE_URL']`. */
function isDatabaseUrlEnv(node: ts.Expression): boolean {
  let inner: ts.Expression = node;
  while (ts.isParenthesizedExpression(inner) || ts.isNonNullExpression(inner)) {
    inner = inner.expression;
  }
  let target: ts.Expression;
  let key: string | undefined;
  if (ts.isPropertyAccessExpression(inner)) {
    target = inner.expression;
    key = inner.name.text;
  } else if (ts.isElementAccessExpression(inner)) {
    target = inner.expression;
    key = ts.isStringLiteralLike(inner.argumentExpression)
      ? inner.argumentExpression.text
      : undefined;
  } else {
    return false;
  }
  return key === 'DATABASE_URL' && target.getText().replace(/\s+/g, '') === 'process.env';
}

function stringText(node: ts.Node): string | undefined {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
    return node.text;
  }
  return undefined;
}

/** Scans one file's source text. `file` is only used in the report. */
export function scanSource(
  file: string,
  source: string,
  options: ScanOptions = {},
): GuardScanViolation[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const lineOf = (node: ts.Node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const violations: GuardScanViolation[] = [];
  const drops: { line: number; what: string }[] = [];
  let callsGuard = false;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name && GUARD_CALLS.has(name)) callsGuard = true;
      if (name === 'dropDatabase' && ts.isPropertyAccessExpression(node.expression)) {
        drops.push({ line: lineOf(node), what: '.dropDatabase()' });
      }
      if (
        name === 'synchronize' &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.arguments[0]?.kind === ts.SyntaxKind.TrueKeyword
      ) {
        drops.push({ line: lineOf(node), what: '.synchronize(true)' });
      }
    }

    if (
      ts.isPropertyAssignment(node) &&
      propertyName(node.name) === 'dropSchema' &&
      node.initializer.kind !== ts.SyntaxKind.FalseKeyword
    ) {
      drops.push({ line: lineOf(node), what: `dropSchema: ${node.initializer.getText()}` });
    }
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'dropSchema') {
      drops.push({ line: lineOf(node), what: 'dropSchema' });
    }

    const text = stringText(node);
    if (text !== undefined) {
      const sql = DESTRUCTIVE_SQL.exec(text);
      if (sql) drops.push({ line: lineOf(node), what: `"${sql[0]}" SQL` });
      const database = DEFAULT_DATABASE.exec(text);
      if (database && !options.allowDefaultDatabaseStrings) {
        violations.push({
          file,
          line: lineOf(node),
          rule: 'default-database',
          detail: `string names the development database ("${database[0]}"); use resolveE2eDatabaseUrl()`,
        });
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken) &&
      isDatabaseUrlEnv(node.left)
    ) {
      violations.push({
        file,
        line: lineOf(node),
        rule: 'database-url-fallback',
        detail: `DATABASE_URL has a fallback (${node.getText().replace(/\s+/g, ' ')}); use resolveE2eDatabaseUrl()`,
      });
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (!callsGuard && drops.length > 0) {
    const first = drops[0]!;
    violations.push({
      file,
      line: first.line,
      rule: 'unguarded-drop',
      detail: `${first.what} without calling resolveE2eDatabaseUrl() or createTestApp()`,
    });
  }

  return violations.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

/** Every `.ts` file under `dir`, as paths relative to it with `/` separators. */
export function listTestSources(dir: string): string[] {
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith('.ts')) {
        files.push(relative(dir, path).split(sep).join('/'));
      }
    }
  };
  walk(dir);
  return files.sort();
}

/** Scans every `.ts` file under `dir` (the backend `test/` directory). */
export function scanTestTree(dir: string): GuardScanViolation[] {
  return listTestSources(dir)
    .filter((file) => !SCAN_EXEMPT.has(file))
    .flatMap((file) =>
      scanSource(file, readFileSync(join(dir, file), 'utf8'), {
        allowDefaultDatabaseStrings: DEFAULT_DATABASE_STRING_EXEMPT.has(file),
      }),
    );
}

export function formatViolations(violations: readonly GuardScanViolation[]): string {
  return violations.map((v) => `test/${v.file}:${v.line} [${v.rule}] ${v.detail}`).join('\n');
}
