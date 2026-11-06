import {
  getProviderParamValue,
  providerParamValueIsValid,
  setProviderParamValue,
  type JsonValue,
  type ProviderParamSpec,
} from 'thinker-shared';
import { t } from '../i18n/index.js';

/**
 * OpenRouter provider routing (P8): the params with their own field in the
 * dialog. Every other `provider_routing` param is edited as JSON.
 */
export const PROVIDER_ROUTING_BASIC_PATHS: ReadonlySet<string> = new Set([
  'provider.order',
  'provider.only',
  'provider.ignore',
  'provider.allow_fallbacks',
  'provider.sort',
  'provider.data_collection',
  'provider.zdr',
]);

/** Most items and longest item of a `string_list` value (shared validator limits). */
export const STRING_LIST_MAX_ITEMS = 64;
export const STRING_LIST_MAX_ITEM_LENGTH = 120;

/** Params of the provider routing group edited in the "Advanced (JSON)" box. */
export const advancedRoutingSpecs = (specs: readonly ProviderParamSpec[]): ProviderParamSpec[] =>
  specs.filter(
    (spec) => spec.group === 'provider_routing' && !PROVIDER_ROUTING_BASIC_PATHS.has(spec.path),
  );

export const pathRoot = (path: string): string => path.split('.')[0] ?? path;

/**
 * Adds the comma-separated entries of `raw` to a string list: trimmed, empty
 * and duplicate entries dropped, capped at the shared validator's limits.
 */
export function addToStringList(list: readonly string[], raw: string): string[] {
  const next = [...list];
  for (const part of raw.split(',')) {
    const item = part.trim().slice(0, STRING_LIST_MAX_ITEM_LENGTH);
    if (!item || next.includes(item)) continue;
    if (next.length >= STRING_LIST_MAX_ITEMS) break;
    next.push(item);
  }
  return next;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The JSON text of the advanced box: the set values of `specs`, relative to
 * their shared root (e.g. `provider`). Empty when nothing is set.
 */
export function advancedJsonText(
  specs: readonly ProviderParamSpec[],
  draft: Record<string, JsonValue>,
  isSet: (path: string) => boolean,
): string {
  let out: Record<string, JsonValue> = {};
  for (const spec of specs) {
    if (!isSet(spec.path)) continue;
    const value = getProviderParamValue(draft, spec.path);
    if (value === undefined) continue;
    const relative = spec.path.slice(pathRoot(spec.path).length + 1);
    out = setProviderParamValue(out, relative, value as JsonValue);
  }
  return Object.keys(out).length === 0 ? '' : JSON.stringify(out, null, 2);
}

const expectedFor = (spec: ProviderParamSpec): string => {
  if (spec.type === 'boolean') return t('models.params.advanced.expectBoolean');
  if (spec.type === 'string_list') return t('models.params.advanced.expectStringList');
  if (spec.type === 'enum') {
    return t('models.params.advanced.expectEnum', {
      values: (spec.values ?? []).map((v) => JSON.stringify(v)).join(', '),
    });
  }
  if (spec.type === 'integer' || spec.type === 'number') {
    return spec.range?.min !== undefined
      ? t('models.params.advanced.expectNumberMin', { min: String(spec.range.min) })
      : t('models.params.advanced.expectNumber');
  }
  return t('models.params.advanced.expectString');
};

export type AdvancedJsonResult =
  { ok: true; values: Map<string, JsonValue> } | { ok: false; error: string };

/**
 * Parses and validates the advanced JSON box against `specs` (all under one
 * root, e.g. `provider`). Keys are relative to that root and may nest (e.g.
 * `max_price.prompt`). Returns the value of every full path it sets.
 */
export function parseAdvancedJson(
  text: string,
  specs: readonly ProviderParamSpec[],
): AdvancedJsonResult {
  const values = new Map<string, JsonValue>();
  if (text.trim() === '' || specs.length === 0) return { ok: true, values };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: t('models.params.advanced.invalidJson') };
  }
  if (!isPlainObject(parsed)) return { ok: false, error: t('models.params.advanced.notObject') };
  const root = pathRoot(specs[0]!.path);

  const walk = (obj: Record<string, unknown>, prefix: string): string | null => {
    for (const [key, value] of Object.entries(obj)) {
      const path = `${prefix}.${key}`;
      const relative = path.slice(root.length + 1);
      const spec = specs.find((s) => s.path === path);
      if (spec) {
        if (!providerParamValueIsValid(spec, value)) {
          return t('models.params.advanced.invalidValue', {
            key: relative,
            expected: expectedFor(spec),
          });
        }
        values.set(path, value as JsonValue);
        continue;
      }
      if (specs.some((s) => s.path.startsWith(`${path}.`))) {
        if (!isPlainObject(value)) {
          return t('models.params.advanced.invalidValue', {
            key: relative,
            expected: t('models.params.advanced.expectObject'),
          });
        }
        const nested = walk(value, path);
        if (nested) return nested;
        continue;
      }
      return t('models.params.advanced.unknownKey', { key: relative });
    }
    return null;
  };

  const error = walk(parsed, root);
  return error ? { ok: false, error } : { ok: true, values };
}
