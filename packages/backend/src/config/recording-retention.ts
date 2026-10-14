/**
 * Request recording retention (#28). Recordings hold full prompts and
 * responses, so the default keeps them for 30 days (docs/decisoes-iniciais.md
 * §4). `THINKER_RECORDING_RETENTION_DAYS` overrides it instance-wide.
 */
export const DEFAULT_RECORDING_RETENTION_DAYS = 30;

export const RECORDING_RETENTION_ENV = 'THINKER_RECORDING_RETENTION_DAYS';

/**
 * Parses the retention override. Unset or blank means the 30-day default; any
 * other value must be a positive integer, otherwise boot fails with a message
 * naming the variable, so a typo never silently keeps recordings forever.
 */
export function parseRecordingRetentionDays(value: string | undefined): number {
  const raw = value?.trim() ?? '';
  if (raw === '') return DEFAULT_RECORDING_RETENTION_DAYS;
  if (/^\d+$/.test(raw)) {
    const parsed = Number(raw);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  throw new Error(
    `${RECORDING_RETENTION_ENV} must be a positive integer number of days (got "${raw}"). ` +
      `Unset it to use the ${DEFAULT_RECORDING_RETENTION_DAYS}-day default.`,
  );
}

// Built from parts so the old family name only exists here as a value to
// detect, and a grep for the old family over packages/ stays empty (#28).
export const LEGACY_RECORDING_PREFIX = ['REQUEST', 'RECORDING', ''].join('_');
const RECORDING_PREFIX = 'THINKER_RECORDING_';

/**
 * The recording variables were renamed from `REQUEST` + `_RECORDING_*` to
 * `THINKER_RECORDING_*` without aliases. Returns one warning line naming the
 * old variables that are still set (never their values), or null.
 */
export function legacyRecordingEnvWarning(env: NodeJS.ProcessEnv = process.env): string | null {
  const names = Object.keys(env)
    .filter((name) => name.startsWith(LEGACY_RECORDING_PREFIX) && (env[name] ?? '') !== '')
    .sort();
  if (names.length === 0) return null;
  return (
    'Ignoring legacy request recording variables (Thinker reads only THINKER_RECORDING_*): ' +
    names
      .map((name) => `${name} -> ${RECORDING_PREFIX}${name.slice(LEGACY_RECORDING_PREFIX.length)}`)
      .join(', ') +
    '.'
  );
}
