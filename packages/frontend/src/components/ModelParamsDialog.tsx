import {
  compareProviderParamSpecs,
  deleteProviderParamValue,
  getProviderParamValue,
  providerParamIsApplicable,
  setProviderParamValue,
  type JsonValue,
  type ModelParamGroup,
  type ProviderParamSpec,
} from 'thinker-shared';
import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CircleHelp } from 'lucide-react';
import type { RequestParamDefaults } from '../services/api.js';
import Select from './Select.jsx';
import { t } from '../i18n/index.js';
import { Button, Modal, cx } from './ui.js';

interface Props {
  open: boolean;
  slotLabel: string;
  current: RequestParamDefaults | null;
  specs: readonly ProviderParamSpec[];
  // True while the per-model specs are still being fetched (dialog opens
  // immediately, specs arrive async).
  loading?: boolean;
  onSave: (paramDefaults: RequestParamDefaults | null) => Promise<unknown>;
  onClose: () => void;
}

type DraftState = Record<string, JsonValue>;

const UNSET_OPTION_VALUE = '__thinker_param_unset__';

const groupLabel = (group: ModelParamGroup): string => t(`models.params.group.${group}`);

const trimTrailingPunct = (text: string): string => text.replace(/[.\s]+$/, '');

const GROUP_ORDER: readonly ModelParamGroup[] = [
  'generation_length',
  'sampling',
  'reasoning',
  'tooling',
  'output_format',
  'observability',
  'provider_metadata',
];

const stateFromCurrent = (
  specs: readonly ProviderParamSpec[],
  current: RequestParamDefaults | null,
): DraftState => {
  let draft: DraftState = {};
  for (const spec of specs) {
    if (spec.default !== undefined) {
      draft = setProviderParamValue(draft, spec.path, spec.default);
    }
  }
  if (!current) return draft;
  for (const spec of specs) {
    const stored = getProviderParamValue(current, spec.path);
    if (stored !== undefined) draft = setProviderParamValue(draft, spec.path, stored as JsonValue);
  }
  return draft;
};

// Paths the harness actually stores. Only these (and whatever the user edits)
// are saved: a value equal to the provider default is still an explicit choice.
const setPathsFromCurrent = (
  specs: readonly ProviderParamSpec[],
  current: RequestParamDefaults | null,
): Set<string> =>
  new Set(
    current
      ? specs
          .filter((spec) => getProviderParamValue(current, spec.path) !== undefined)
          .map((spec) => spec.path)
      : [],
  );

const groupSpecs = (specs: readonly ProviderParamSpec[]) =>
  GROUP_ORDER.map((group) => ({
    group,
    specs: specs.filter((spec) => spec.group === group).sort(compareProviderParamSpecs),
  })).filter((item) => item.specs.length > 0);

const valuesEqual = (a: unknown, b: unknown) =>
  typeof a === 'object' || typeof b === 'object'
    ? /* v8 ignore next -- current MPS entries compare primitives; keep defensive JsonValue equality. */
      JSON.stringify(a) === JSON.stringify(b)
    : a === b;

const clampNumber = (value: number, fallback: number, min?: number, max?: number): number => {
  if (!Number.isFinite(value)) return fallback;
  let next = value;
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  return next;
};

const decimalPlaces = (value: number): number => {
  const text = String(value);
  return text.includes('.') ? (text.split('.')[1]?.length ?? 0) : 0;
};

const numberDefault = (spec: ProviderParamSpec): number =>
  typeof spec.default === 'number' ? spec.default : 0;

/**
 * Text box beside a slider. Uncontrolled so a half-typed value ("0,", "-")
 * survives; it re-syncs from state whenever it is not focused.
 */
function SliderTextInput(props: {
  text: string;
  placeholder: string;
  disabled: boolean;
  label: string;
  onCommit: (raw: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el) el.value = props.text;
  });
  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      className="model-params__number field h-8 w-20 text-right font-mono"
      defaultValue={props.text}
      placeholder={props.placeholder}
      disabled={props.disabled}
      aria-label={props.label}
      onBlur={(e) => (e.currentTarget.value = props.text)}
      onChange={(e) => props.onCommit(e.currentTarget.value)}
    />
  );
}

export default function ModelParamsDialog(props: Props) {
  const [draft, setDraft] = useState<DraftState>(() =>
    stateFromCurrent(props.specs, props.current),
  );
  const [setPaths, setSetPaths] = useState<Set<string>>(() =>
    setPathsFromCurrent(props.specs, props.current),
  );
  const [saving, setSaving] = useState(false);
  const hasSpecs = props.specs.length > 0;

  // Re-seed the draft when the dialog opens or its inputs change. `current`
  // is compared by value: callers rebuild it on every render.
  const currentKey = JSON.stringify(props.current);
  useEffect(() => {
    if (props.open) {
      setDraft(stateFromCurrent(props.specs, props.current));
      setSetPaths(setPathsFromCurrent(props.specs, props.current));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.specs, currentKey]);

  const isApplicable = (spec: ProviderParamSpec): boolean => providerParamIsApplicable(spec, draft);
  const isDisabled = (spec: ProviderParamSpec): boolean => saving || !isApplicable(spec);

  const valueFor = (spec: ProviderParamSpec): JsonValue | undefined => {
    if (!providerParamIsApplicable(spec, draft)) {
      return spec.default as JsonValue | undefined;
    }
    const value = getProviderParamValue(draft, spec.path);
    return (value === undefined ? spec.default : value) as JsonValue | undefined;
  };

  const isSet = (spec: ProviderParamSpec): boolean => setPaths.has(spec.path);

  const pathRoot = (path: string): string => path.split('.')[0] ?? path;

  // The proxy fills in the default of every applicable sibling under a nested
  // root that has a value set (e.g. thinking.budget_tokens with thinking.type),
  // so such a row is sent even though the user never set it.
  const sentWithRoot = (spec: ProviderParamSpec): boolean =>
    spec.path.includes('.') &&
    spec.default !== undefined &&
    props.specs.some(
      (other) =>
        other.path !== spec.path &&
        pathRoot(other.path) === pathRoot(spec.path) &&
        isSet(other) &&
        isApplicable(other),
    );

  const setValue = (spec: ProviderParamSpec, value: JsonValue) => {
    setDraft((prev) => setProviderParamValue(prev, spec.path, value));
    setSetPaths((prev) => new Set([...prev, spec.path]));
  };

  // Back to "not set": the client's value passes through. The draft keeps the
  // provider default so dependent params still evaluate their availability.
  const unsetValue = (spec: ProviderParamSpec) => {
    setDraft((prev) =>
      spec.default === undefined
        ? deleteProviderParamValue(prev, spec.path)
        : setProviderParamValue(prev, spec.path, spec.default),
    );
    setSetPaths((prev) => {
      const next = new Set(prev);
      next.delete(spec.path);
      return next;
    });
  };

  const labelForPath = (path: string): string =>
    props.specs.find((s) => s.path === path)?.label ?? path;

  const formatValueList = (values: readonly JsonValue[]): string => {
    const quoted = values.map((v) => `"${String(v)}"`);
    if (quoted.length === 1) return quoted[0]!;
    if (quoted.length === 2) return t('models.params.or', { a: quoted[0]!, b: quoted[1]! });
    return t('models.params.orList', {
      list: quoted.slice(0, -1).join(', '),
      last: quoted[quoted.length - 1]!,
    });
  };

  const describeBlocker = (spec: ProviderParamSpec): string | null => {
    if (!spec.applicability) return null;
    const { only, except } = spec.applicability;
    if (only) {
      const rules = Array.isArray(only) ? only : [only];
      const rule = rules[0];
      if (!rule) return null;
      const parts = Object.entries(rule).map(([path, value]) => {
        const label = labelForPath(path);
        const list = Array.isArray(value) ? (value as readonly JsonValue[]) : [value as JsonValue];
        return t('models.params.setTo', { label, values: formatValueList(list) });
      });
      return t('models.params.toConfigure', { parts: parts.join(t('models.params.and')) });
    }
    if (except) {
      const rules = Array.isArray(except) ? except : [except];
      const active = rules.find((rule) =>
        Object.entries(rule).every(([path, value]) => {
          const current = getProviderParamValue(draft, path);
          if (Array.isArray(value))
            return (value as readonly JsonValue[]).includes(current as JsonValue);
          if (value !== null && typeof value === 'object' && 'not' in value) {
            const notVal = (value as { not: JsonValue | readonly JsonValue[] }).not;
            if (Array.isArray(notVal))
              return !(notVal as readonly JsonValue[]).includes(current as JsonValue);
            return current !== notVal;
          }
          return current === value;
        }),
      );
      if (!active) return null;
      const parts = Object.entries(active).map(([path, value]) => {
        const label = labelForPath(path);
        if (Array.isArray(value)) {
          return t('models.params.isValues', {
            label,
            values: formatValueList(value as readonly JsonValue[]),
          });
        }
        if (value !== null && typeof value === 'object' && 'not' in value) {
          return t('models.params.isCustom', { label });
        }
        return t('models.params.isValue', { label, value: String(value) });
      });
      return t('models.params.unavailableWhile', { parts: parts.join(t('models.params.and')) });
    }
    return null;
  };

  const canUnset = (spec: ProviderParamSpec): boolean => spec.default === undefined;

  const selectValue = (spec: ProviderParamSpec): string => {
    const value = valueFor(spec);
    if (value === undefined && canUnset(spec)) return UNSET_OPTION_VALUE;
    return typeof value === 'string' ? value : String(spec.default ?? '');
  };

  const selectOptions = (spec: ProviderParamSpec) => [
    ...(canUnset(spec) ? [{ label: t('models.params.none'), value: UNSET_OPTION_VALUE }] : []),
    ...(spec.values ?? []).map((v) => ({ label: String(v), value: String(v) })),
  ];

  const numericValue = (spec: ProviderParamSpec): number => {
    const value = valueFor(spec);
    return typeof value === 'number' && Number.isFinite(value) ? value : numberDefault(spec);
  };

  const sliderStep = (spec: ProviderParamSpec): number => spec.range?.step ?? 1;

  const sliderValue = (raw: number, spec: ProviderParamSpec): number => {
    const min = spec.range?.min ?? 0;
    const max = spec.range?.max ?? 100;
    const step = sliderStep(spec);
    const snapped = Math.round((raw - min) / step) * step + min;
    const clamped = clampNumber(snapped, numberDefault(spec), min, max);
    return Number(clamped.toFixed(decimalPlaces(step)));
  };

  const toggleRow = (spec: ProviderParamSpec) => {
    const currentValue = valueFor(spec);
    const values = (spec.values ?? []) as readonly JsonValue[];
    const onValue = values.find((v) => String(v) === 'enabled') ?? values[0] ?? true;
    const offValue = values.find((v) => String(v) === 'disabled') ?? values[1] ?? false;
    const isOn = valuesEqual(currentValue, onValue);
    return (
      <button
        type="button"
        className="model-params__toggle inline-flex cursor-pointer border-0 bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-50"
        aria-pressed={isOn}
        aria-label={`${spec.label}: ${String(currentValue)}`}
        disabled={isDisabled(spec)}
        onClick={() => setValue(spec, isOn ? offValue : onValue)}
      >
        <span
          aria-hidden="true"
          className={cx(
            'switch pointer-events-none block',
            isOn && 'provider-toggle__switch--on bg-accent after:translate-x-3.5',
          )}
        />
      </button>
    );
  };

  const selectRow = (spec: ProviderParamSpec) => (
    <div className="w-44 max-w-full">
      <Select
        label={spec.label}
        options={selectOptions(spec)}
        value={selectValue(spec)}
        disabled={isDisabled(spec)}
        portal
        onChange={(v) => {
          if (v === UNSET_OPTION_VALUE && canUnset(spec)) {
            unsetValue(spec);
            return;
          }
          setValue(spec, v);
        }}
      />
    </div>
  );

  const sliderRow = (spec: ProviderParamSpec) => {
    const min = spec.range?.min ?? 0;
    const max = spec.range?.max ?? 100;
    const value = numericValue(spec);
    const disabled = isDisabled(spec);
    const setSliderVal = (next: number) => {
      if (disabled) return;
      setValue(spec, sliderValue(next, spec));
    };
    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (disabled) return;
      const step = sliderStep(spec);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        setSliderVal(value - step);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSliderVal(value + step);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setSliderVal(min);
      } else if (e.key === 'End') {
        e.preventDefault();
        setSliderVal(max);
      }
    };

    const commitFromText = (raw: string) => {
      if (disabled) return;
      const normalized = raw.replace(',', '.').trim();
      if (normalized === '') {
        unsetValue(spec);
        return;
      }
      if (normalized === '-' || normalized === '.' || normalized === '-.') {
        return;
      }
      const parsed = Number.parseFloat(normalized);
      if (!Number.isFinite(parsed)) return;
      setValue(spec, sliderValue(parsed, spec));
    };

    return (
      <div className={cx('flex w-64 max-w-full items-start gap-2', disabled && 'opacity-60')}>
        {/* Unset: the text box stays empty (default as placeholder) while the
            thumb rests on the default, since a slider always needs a position. */}
        <SliderTextInput
          text={isSet(spec) ? String(value) : ''}
          placeholder={String(value)}
          disabled={disabled}
          label={t('models.params.valueLabel', { label: spec.label })}
          onCommit={commitFromText}
        />
        <div className="model-params__slider-field flex min-w-0 flex-1 flex-col">
          <input
            type="range"
            className="h-8 w-full cursor-pointer accent-accent disabled:cursor-not-allowed"
            min={min}
            max={max}
            step={sliderStep(spec)}
            value={value}
            disabled={disabled}
            aria-label={spec.label}
            aria-disabled={disabled}
            onChange={(e) => setSliderVal(Number.parseFloat(e.currentTarget.value))}
            onKeyDown={handleKeyDown}
          />
          <div className="flex justify-between font-mono text-xs text-faint">
            <span className="model-params__slider-bound">{min}</span>
            <span className="model-params__slider-bound">{max}</span>
          </div>
        </div>
      </div>
    );
  };

  const numberRow = (spec: ProviderParamSpec) => {
    const value = isSet(spec) ? numericValue(spec) : '';
    const setFromInput = (raw: string) => {
      if (isDisabled(spec)) return;
      if (raw.trim() === '') {
        unsetValue(spec);
        return;
      }
      const parsed = Number.parseFloat(raw);
      const clamped = clampNumber(parsed, numberDefault(spec), spec.range?.min, spec.range?.max);
      setValue(spec, spec.type === 'integer' ? Math.trunc(clamped) : clamped);
    };
    return (
      <input
        className="model-params__number field h-8 w-32 font-mono"
        type="number"
        min={spec.range?.min}
        max={spec.range?.max}
        value={value}
        placeholder={spec.default === undefined ? t('models.params.notSet') : String(spec.default)}
        disabled={isDisabled(spec)}
        aria-label={spec.label}
        onChange={(e) => setFromInput(e.currentTarget.value)}
      />
    );
  };

  const renderControl = (spec: ProviderParamSpec) => {
    if (spec.type === 'boolean') return toggleRow(spec);
    if (spec.type === 'enum') {
      const values = spec.values?.map(String) ?? [];
      if (values.length === 2 && values.includes('enabled') && values.includes('disabled')) {
        return toggleRow(spec);
      }
      return selectRow(spec);
    }
    if ((spec.type === 'integer' || spec.type === 'number') && spec.range?.max !== undefined) {
      return sliderRow(spec);
    }
    return numberRow(spec);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      let out: RequestParamDefaults = {};
      const nestedRootsWithOverrides = new Set(
        props.specs
          .filter((spec) => spec.path.includes('.'))
          .filter((spec) => isApplicable(spec))
          .filter((spec) => isSet(spec))
          .map((spec) => spec.path.split('.')[0]),
      );

      for (const spec of props.specs) {
        if (!isApplicable(spec)) continue;
        const value = valueFor(spec);
        if (value === undefined) continue;
        const root = spec.path.split('.')[0];
        const includeNestedDefault =
          spec.path.includes('.') && nestedRootsWithOverrides.has(root) && value !== undefined;
        if (includeNestedDefault || isSet(spec)) {
          out = setProviderParamValue(out, spec.path, value);
        }
      }

      await props.onSave(Object.keys(out).length === 0 ? null : out);
      props.onClose();
    } finally {
      setSaving(false);
    }
  };

  const paramRow = (spec: ProviderParamSpec) => {
    const applicable = isApplicable(spec);
    const blocker = applicable ? null : describeBlocker(spec);
    const description = trimTrailingPunct(spec.description) + '.';
    const defaultLabel =
      spec.default === undefined ? t('models.params.noneLower') : String(spec.default);
    return (
      <div
        className={cx(
          'flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between',
          !applicable && 'model-params__row--disabled',
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx('font-medium', applicable ? 'text-ink' : 'text-muted')}>
              {spec.label}
            </span>
            <code className="font-mono text-xs text-faint">{spec.path}</code>
            {blocker ? (
              <span
                className="model-params__help inline-flex text-muted"
                tabIndex={0}
                aria-label={blocker}
                title={blocker}
              >
                <CircleHelp aria-hidden="true" className="size-3.5" />
              </span>
            ) : null}
          </div>
          <div className="text-sm text-muted">{description}</div>
          <div className="text-xs text-faint">
            {t('models.params.defaultLabel', { value: defaultLabel })}
            {applicable ? (
              <>
                {' · '}
                {isSet(spec) ? (
                  <>
                    {t('models.params.set')}
                    {' · '}
                    <button
                      type="button"
                      className="link-action text-xs"
                      disabled={saving}
                      aria-label={t('models.params.resetLabel', { label: spec.label })}
                      onClick={() => unsetValue(spec)}
                    >
                      {t('models.params.reset')}
                    </button>
                  </>
                ) : sentWithRoot(spec) ? (
                  t('models.params.defaultSentWith', { root: pathRoot(spec.path) })
                ) : (
                  t('models.params.notSet')
                )}
              </>
            ) : null}
          </div>
        </div>
        <div className="shrink-0">{renderControl(spec)}</div>
      </div>
    );
  };

  const close = () => {
    if (!saving) props.onClose();
  };

  return (
    <Modal open={props.open} onClose={close} wide label={t('models.params.title')}>
      <div className="model-params-modal flex select-none flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold text-ink">{t('models.params.title')}</h2>
          <p className="mt-1 text-sm text-muted">
            {props.loading
              ? t('models.params.loadingFor', { slot: props.slotLabel })
              : hasSpecs
                ? t('models.params.desc', { slot: props.slotLabel })
                : t('models.params.noneFor', { slot: props.slotLabel })}
          </p>
        </div>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {props.loading ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <span className="spinner" />
              <span>{t('models.params.loading')}</span>
            </div>
          ) : !hasSpecs ? (
            <p className="text-sm text-muted">{t('models.params.noParams')}</p>
          ) : (
            groupSpecs(props.specs).map((group) => (
              <div key={group.group} className="flex flex-col gap-2">
                <div className="eyebrow">{groupLabel(group.group)}</div>
                <div className="rounded-surface border border-line">
                  {group.specs.map((spec, index) => (
                    <Fragment key={spec.path}>
                      {index > 0 ? <div className="border-t border-line" /> : null}
                      {paramRow(spec)}
                    </Fragment>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="actions flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={props.onClose} disabled={saving}>
            {!props.loading && hasSpecs ? t('models.params.cancel') : t('models.params.close')}
          </Button>
          {!props.loading && hasSpecs ? (
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? <span className="spinner" /> : t('models.params.save')}
            </Button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
