import { Logger } from '@nestjs/common';

/**
 * Boot-time notice for configuration still written with the upstream project's
 * variable names (#21). Thinker reads only `THINKER_*`: an old name is NOT an
 * alias and is never read. This only tells the operator which names are set
 * and what replaced them, so a stale `.env` does not fail silently. Values are
 * never logged.
 */

const LEGACY_PREFIX = 'MANIFEST_';
const CURRENT_PREFIX = 'THINKER_';

/** Suffixes whose variable kept its meaning under the `THINKER_` prefix. */
const RENAMED_SUFFIXES: ReadonlySet<string> = new Set([
  'ENCRYPTION_KEY',
  'ENCRYPTION_KEY_PREVIOUS',
  'CONCURRENCY_MAX',
  'RATE_MAX_REQUESTS',
  'IP_RATE_MAX_REQUESTS',
  'DISABLE_HSTS',
  'FRONTEND_DIR',
  'EMBEDDED',
  'MIGRATION_FORCE',
]);

export interface LegacyEnvVar {
  /** The legacy name that is set. */
  name: string;
  /** The name Thinker reads instead, or null when the setting no longer exists. */
  replacement: string | null;
}

/** Legacy-prefixed variables that are set (non-empty), sorted by name. */
export function findLegacyEnvVars(env: NodeJS.ProcessEnv = process.env): LegacyEnvVar[] {
  return Object.keys(env)
    .filter((name) => name.startsWith(LEGACY_PREFIX) && (env[name] ?? '') !== '')
    .sort()
    .map((name) => {
      const suffix = name.slice(LEGACY_PREFIX.length);
      return {
        name,
        replacement: RENAMED_SUFFIXES.has(suffix) ? `${CURRENT_PREFIX}${suffix}` : null,
      };
    });
}

/**
 * Builds the warning lines for the legacy variables that are set. Empty when
 * there is nothing to report. Exported for tests.
 */
export function legacyEnvWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
  const found = findLegacyEnvVars(env);
  if (found.length === 0) return [];

  const renamed = found.filter((v) => v.replacement !== null);
  const removed = found.filter((v) => v.replacement === null);
  const lines: string[] = [];

  const legacyKey = `${LEGACY_PREFIX}ENCRYPTION_KEY`;
  const currentKey = `${CURRENT_PREFIX}ENCRYPTION_KEY`;
  if (found.some((v) => v.name === legacyKey) && (env[currentKey] ?? '') === '') {
    lines.push(
      `${legacyKey} is set but ${currentKey} is not: the old name is ignored, so stored ` +
        `provider credentials encrypted with it will not decrypt and new ones are encrypted ` +
        `under BETTER_AUTH_SECRET. Rename it to ${currentKey} (same value) and restart.`,
    );
  }
  if (renamed.length > 0) {
    lines.push(
      'Ignoring legacy environment variables (Thinker reads only THINKER_* names): ' +
        renamed.map((v) => `${v.name} -> ${v.replacement}`).join(', ') +
        '.',
    );
  }
  if (removed.length > 0) {
    lines.push(
      'Ignoring legacy environment variables that no longer exist: ' +
        removed.map((v) => v.name).join(', ') +
        '.',
    );
  }
  return lines;
}

/** Logs the legacy-variable warnings once, at boot. */
export function warnLegacyEnvVars(
  env: NodeJS.ProcessEnv = process.env,
  logger: Pick<Logger, 'warn'> = new Logger('Bootstrap'),
): void {
  for (const line of legacyEnvWarnings(env)) logger.warn(line);
}
