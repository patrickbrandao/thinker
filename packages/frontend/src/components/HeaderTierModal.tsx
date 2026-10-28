import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { TIER_COLORS, type TierColor } from 'thinker-shared';
import HeaderComboBox, { type HeaderSuggestion } from './HeaderComboBox.js';
import {
  createHeaderTier,
  getSeenHeaders,
  setHeaderTierResponseMode,
  setHeaderTierStreamWarmup,
  updateHeaderTier,
  type HeaderTier,
  type SeenHeader,
} from '../services/api/header-tiers.js';
import { toast } from '../services/toast-store.js';
import { t, tMaybe } from '../i18n/index.js';
import { positionLabel } from '../services/routing.js';
import {
  MAX_STREAM_WARMUP_SECONDS,
  MIN_STREAM_WARMUP_SECONDS,
  streamWarmupError,
  parseWarmupSeconds,
  warmupMsToSecondsInput,
} from '../services/stream-warmup.js';
import type { AvailableModel, ModelCapability, ResponseMode } from '../services/api.js';
import { useResource } from '../lib/use-resource.js';
import { Button, IconButton, Modal, cx } from './ui.js';

const RESERVED_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
]);
const HEADER_KEY_RE = /^[a-z0-9-]+$/;
const MAX_NAME_LEN = 32;
const MAX_HEADER_VALUE_LEN = 128;

/**
 * Swatch fills. These are the tier palette the user picks from (data, not
 * theme), so they are the same in light and dark mode.
 */
const SWATCH_FILL: Record<string, string> = {
  slate: 'hsl(215 16% 47%)',
  gray: 'hsl(220 9% 46%)',
  zinc: 'hsl(240 4% 46%)',
  stone: 'hsl(25 6% 45%)',
  red: 'hsl(0 72% 51%)',
  orange: 'hsl(25 95% 53%)',
  amber: 'hsl(38 92% 50%)',
  yellow: 'hsl(48 96% 53%)',
  lime: 'hsl(84 81% 44%)',
  green: 'hsl(142 71% 45%)',
  emerald: 'hsl(160 84% 39%)',
  teal: 'hsl(174 66% 42%)',
  cyan: 'hsl(188 86% 43%)',
  sky: 'hsl(199 89% 48%)',
  blue: 'hsl(217 91% 60%)',
  indigo: 'hsl(239 68% 56%)',
  violet: 'hsl(270 67% 55%)',
  purple: 'hsl(271 81% 56%)',
  fuchsia: 'hsl(292 84% 61%)',
  pink: 'hsl(330 81% 60%)',
  rose: 'hsl(351 83% 58%)',
  coral: 'hsl(16 85% 58%)',
  brown: 'hsl(28 56% 40%)',
  navy: 'hsl(224 64% 33%)',
};

interface Props {
  agentName: string;
  existingTiers: HeaderTier[];
  /** When set, the modal is in edit mode and prefills from this tier. */
  editing?: HeaderTier;
  onClose: () => void;
  onSaved: (tier: HeaderTier) => void;
  /** When set, shows a back arrow instead of close button. */
  onBack?: () => void;
  /** When set and editing, shows a Delete tier button. */
  onDelete?: (id: string) => void;
  /** Available models for stream compatibility check. */
  models?: AvailableModel[];
}

const labelClass = 'label mt-4';
const errorClass = 'header-tier-modal__error hint text-danger';

export default function HeaderTierModal(props: Props) {
  const editingTier = props.editing;

  const [name, setName] = useState(editingTier?.name ?? '');
  const [headerKey, setHeaderKey] = useState(editingTier?.header_key ?? '');
  const [headerValue, setHeaderValue] = useState(editingTier?.header_value ?? '');
  const [badgeColor, setBadgeColor] = useState<TierColor>(
    (editingTier?.badge_color as TierColor | undefined) ?? 'indigo',
  );
  const [streamMode, setStreamMode] = useState<boolean>(editingTier?.response_mode === 'stream');
  const [warmupSeconds, setWarmupSeconds] = useState(
    warmupMsToSecondsInput(editingTier?.stream_warmup_ms),
  );
  const [submitting, setSubmitting] = useState(false);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const { data: seen } = useResource<SeenHeader[]>(
    () => getSeenHeaders(props.agentName).catch(() => []),
    [props.agentName],
  );

  useEffect(() => {
    const id = requestAnimationFrame(() => nameRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  // When editing, exclude the row being edited from uniqueness checks so its
  // own current values don't trip the "already exists" errors.
  const otherTiers = editingTier
    ? props.existingTiers.filter((tier) => tier.id !== editingTier.id)
    : props.existingTiers;

  /** Models in this tier that don't support streaming. */
  const incompatibleModels = (() => {
    if (!editingTier) return [];
    const caps = new Map<string, readonly ModelCapability[]>();
    for (const m of props.models ?? []) {
      if (m.capabilities) caps.set(m.model_name, m.capabilities);
    }
    const hasStream = (model: string) => caps.get(model)?.includes('stream') ?? false;
    const result: { model: string; position: string }[] = [];
    const route = editingTier.override_route;
    if (route && !hasStream(route.model)) {
      result.push({ model: route.model, position: 'Primary' });
    }
    for (const [i, fb] of (editingTier.fallback_routes ?? []).entries()) {
      if (!hasStream(fb.model)) {
        result.push({ model: fb.model, position: `Fallback ${i + 1}` });
      }
    }
    return result;
  })();
  const canEnableStream = incompatibleModels.length === 0;

  const keySuggestions: HeaderSuggestion[] = (seen ?? [])
    .filter((r) => !RESERVED_KEYS.has(r.key))
    .map((r) => ({
      label: r.key,
      value: r.key,
      group: r.sdks[0],
      sublabel:
        r.top_values.length > 0
          ? `${r.count}× · ${r.top_values.slice(0, 3).join(' · ')}`
          : t('routing.headerTierModal.seenCount', { count: r.count }),
    }));

  const valueSuggestions = ((): HeaderSuggestion[] => {
    const key = headerKey.trim().toLowerCase();
    if (!key) return [];
    const row = (seen ?? []).find((r) => r.key === key);
    return (row?.top_values ?? []).map((v) => ({ label: v, value: v }));
  })();

  const validateName = (raw: string): string | undefined => {
    const trimmed = raw.trim();
    if (!trimmed) return t('routing.headerTierModal.nameRequired');
    if (trimmed.length > MAX_NAME_LEN) {
      return t('routing.headerTierModal.nameTooLong', { max: MAX_NAME_LEN });
    }
    const lower = trimmed.toLowerCase();
    if (otherTiers.some((tier) => tier.name.toLowerCase() === lower)) {
      return t('routing.headerTierModal.nameTaken');
    }
    return undefined;
  };

  const validateKey = (raw: string): string | undefined => {
    const key = raw.trim().toLowerCase();
    if (!key) return t('routing.headerTierModal.keyRequired');
    if (!HEADER_KEY_RE.test(key)) {
      return t('routing.headerTierModal.keyInvalid');
    }
    if (RESERVED_KEYS.has(key)) {
      return t('routing.headerTierModal.keyReserved');
    }
    return undefined;
  };

  const validateValue = (rawValue: string, rawKey: string): string | undefined => {
    const v = rawValue.trim();
    if (!v) return t('routing.headerTierModal.valueRequired');
    if (v.length > MAX_HEADER_VALUE_LEN) {
      return t('routing.headerTierModal.valueTooLong', { max: MAX_HEADER_VALUE_LEN });
    }
    // Quotes and backslashes would break the rendered SDK snippets (Python/TS
    // wrap the value in `"..."`, cURL wraps it in `'...'`). Reject up front
    // instead of escaping inside every snippet generator.
    if (v.includes('"') || v.includes("'") || v.includes('\\')) {
      return t('routing.headerTierModal.valueQuotes');
    }
    const key = rawKey.trim().toLowerCase();
    if (otherTiers.some((tier) => tier.header_key === key && tier.header_value === v)) {
      return t('routing.headerTierModal.valueTaken');
    }
    return undefined;
  };

  const nameError = triedSubmit ? validateName(name) : undefined;
  const keyError = triedSubmit ? validateKey(headerKey) : undefined;
  const valueError = triedSubmit ? validateValue(headerValue, headerKey) : undefined;
  const warmupError =
    triedSubmit && parseWarmupSeconds(warmupSeconds) === undefined
      ? streamWarmupError()
      : undefined;

  const isValid = (): boolean =>
    validateName(name) === undefined &&
    validateKey(headerKey) === undefined &&
    validateValue(headerValue, headerKey) === undefined &&
    parseWarmupSeconds(warmupSeconds) !== undefined;

  const submit = async (): Promise<void> => {
    setTriedSubmit(true);
    if (!isValid() || submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        header_key: headerKey.trim().toLowerCase(),
        header_value: headerValue.trim(),
        badge_color: badgeColor,
      };
      let saved = editingTier
        ? await updateHeaderTier(props.agentName, editingTier.id, payload)
        : await createHeaderTier(props.agentName, payload);
      // Persist response mode change if toggled
      const newMode: ResponseMode = streamMode ? 'stream' : 'buffered';
      if (saved.response_mode !== newMode) {
        saved = await setHeaderTierResponseMode(props.agentName, saved.id, newMode);
      }
      // Persist the stream warm-up override if it changed (validated above).
      const warmupMs = parseWarmupSeconds(warmupSeconds) ?? null;
      if (warmupMs !== (saved.stream_warmup_ms ?? null)) {
        saved = await setHeaderTierStreamWarmup(props.agentName, saved.id, warmupMs);
      }
      props.onSaved(saved);
      props.onClose();
    } catch (err) {
      const fallback = editingTier
        ? t('routing.updateTierFailed')
        : t('routing.headerTierModal.createFailed');
      toast.error(err instanceof Error ? err.message : fallback);
    } finally {
      setSubmitting(false);
    }
  };

  const titleText = editingTier
    ? t('routing.headerTierModal.editTitle')
    : t('routing.createCustomTier');
  const descText = editingTier
    ? t('routing.headerTierModal.editDesc')
    : t('routing.headerTierModal.createDesc');
  const submitLabel = editingTier
    ? submitting
      ? t('routing.headerTierModal.saving')
      : t('common.saveChanges')
    : submitting
      ? t('routing.headerTierModal.creating')
      : t('routing.headerTierModal.create');

  const streamDisabled = !streamMode && !canEnableStream;

  return (
    <Modal open onClose={props.onClose} label={titleText}>
      <div
        className="header-tier-modal"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.defaultPrevented && e.target instanceof HTMLInputElement) {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <div className="mb-1 flex items-center gap-2">
          {props.onBack ? (
            <IconButton className="modal-back-btn" label={t('common.back')} onClick={props.onBack}>
              <ArrowLeft aria-hidden="true" />
            </IconButton>
          ) : null}
          <h2 className="flex-1 text-[15px] font-semibold text-ink" id="header-tier-modal-title">
            {titleText}
          </h2>
          {!props.onBack ? (
            <IconButton
              className="header-tier-modal__close"
              label={t('common.close')}
              onClick={props.onClose}
            >
              <X aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
        <p className="text-sm text-dim">{descText}</p>

        <label className={labelClass} htmlFor="header-tier-name">
          {t('routing.headerTierModal.tierName')}
        </label>
        <input
          ref={nameRef}
          id="header-tier-name"
          className={cx('field', nameError !== undefined && 'border-danger')}
          type="text"
          value={name}
          placeholder={t('routing.headerTierModal.tierNamePlaceholder')}
          maxLength={MAX_NAME_LEN}
          aria-invalid={nameError !== undefined || undefined}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        {nameError ? <div className={errorClass}>{nameError}</div> : null}

        <label className={labelClass} htmlFor="header-tier-key">
          {t('routing.headerTierModal.headerKey')}
        </label>
        <HeaderComboBox
          id="header-tier-key"
          value={headerKey}
          onInput={setHeaderKey}
          suggestions={keySuggestions}
          placeholder="x-thinker-tier"
          invalid={keyError !== undefined}
          errorMessage={keyError}
          freeFormHint={t('routing.headerTierModal.useCustomHeader', { value: headerKey.trim() })}
        />

        <label className={labelClass} htmlFor="header-tier-value">
          {t('routing.headerTierModal.headerValue')}
        </label>
        <HeaderComboBox
          id="header-tier-value"
          value={headerValue}
          onInput={setHeaderValue}
          suggestions={valueSuggestions}
          placeholder="custom-value"
          invalid={valueError !== undefined}
          errorMessage={valueError}
          disabled={!headerKey.trim()}
          freeFormHint={t('routing.headerTierModal.useCustomValue', {
            value: headerValue.trim(),
          })}
        />

        <div className={labelClass}>{t('routing.headerTierModal.badgeColor')}</div>
        <div
          className="header-tier-modal__swatches flex flex-wrap gap-1.5"
          role="radiogroup"
          aria-label={t('routing.headerTierModal.badgeColor')}
        >
          {TIER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={badgeColor === c}
              aria-label={tMaybe(`routing.colors.${c}`) ?? c}
              className={cx(
                'header-tier-modal__swatch size-6 cursor-pointer rounded-full border border-line p-0 transition-transform hover:scale-105',
                `header-tier-modal__swatch--${c}`,
                badgeColor === c &&
                  'header-tier-modal__swatch--active outline-2 outline-offset-2 outline-[var(--text)]',
              )}
              style={{ background: SWATCH_FILL[c] }}
              onClick={() => setBadgeColor(c)}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-ink">
            {t('routing.responseMode.streamMode')}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={streamMode}
            aria-label={t('routing.responseMode.streamMode')}
            className={cx(
              'switch routing-switch',
              streamMode && 'routing-switch--on',
              streamDisabled && 'routing-switch--disabled',
            )}
            disabled={streamDisabled}
            onClick={() => {
              if (streamMode) setStreamMode(false);
              else if (canEnableStream) setStreamMode(true);
            }}
          />
        </div>
        <p className="hint">
          {streamMode
            ? t('routing.responseMode.streamDesc')
            : t('routing.responseMode.bufferedDesc')}
        </p>
        {!streamMode && incompatibleModels.length > 0 ? (
          <div className="response-mode-modal__blocker notice is-warn mt-2 flex-col gap-2">
            <p className="response-mode-modal__blocker-text">
              {t('routing.headerTierModal.incompatible', incompatibleModels.length)}
            </p>
            <div className="response-mode-modal__blocker-list flex w-full flex-col gap-1">
              {incompatibleModels.map((item) => (
                <div
                  key={`${item.position}-${item.model}`}
                  className="response-mode-modal__blocker-row flex items-center justify-between gap-2"
                >
                  <span className="response-mode-modal__blocker-model truncate font-mono text-xs">
                    {item.model}
                  </span>
                  <span className="response-mode-modal__blocker-meta shrink-0 text-xs text-muted">
                    {positionLabel(item.position)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <label className={labelClass} htmlFor="header-tier-stream-warmup">
          {t('routing.headerTierModal.warmupLabel')}
        </label>
        <input
          id="header-tier-stream-warmup"
          className={cx('field', warmupError !== undefined && 'border-danger')}
          type="number"
          min={MIN_STREAM_WARMUP_SECONDS}
          max={MAX_STREAM_WARMUP_SECONDS}
          step="1"
          value={warmupSeconds}
          placeholder={t('routing.headerTierModal.warmupPlaceholder')}
          aria-invalid={warmupError !== undefined || undefined}
          onChange={(e) => setWarmupSeconds(e.currentTarget.value)}
        />
        {warmupError ? <div className={errorClass}>{warmupError}</div> : null}
        <p className="hint">{t('routing.headerTierModal.warmupHelp')}</p>

        <div className="actions flex-wrap items-center">
          {editingTier && props.onDelete ? (
            <Button
              variant="danger"
              className="header-tier-modal__delete-btn mr-auto"
              onClick={() => {
                if (
                  confirm(t('routing.headerTierModal.confirmDelete', { name: editingTier.name }))
                ) {
                  props.onDelete!(editingTier.id);
                }
              }}
            >
              {t('routing.headerTierModal.deleteTier')}
            </Button>
          ) : null}
          {!props.onBack ? (
            <Button variant="ghost" onClick={props.onClose}>
              {t('common.cancel')}
            </Button>
          ) : null}
          <Button disabled={submitting} onClick={() => void submit()}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
