import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { MAX_VIRTUAL_MODEL_FALLBACKS, VIRTUAL_MODEL_NAME_MAX_LENGTH } from 'thinker-shared';
import ModelPickerModal from './ModelPickerModal.js';
import VirtualModelShadowWarning from './VirtualModelShadowWarning.js';
import {
  createVirtualModel,
  setVirtualModelResponseMode,
  updateVirtualModel,
  type VirtualModel,
} from '../services/api/virtual-models.js';
import type {
  AuthType,
  AvailableModel,
  CustomProviderData,
  ResponseMode,
  RoutingProvider,
} from '../services/api.js';
import type { VirtualModelRouteInput } from 'thinker-shared';
import {
  deleteVirtualModelPrompt,
  mapVirtualModelError,
  nonStreamingRoutes,
  previewShadows,
  virtualModelNameError,
  type VirtualModelFormErrors,
} from '../services/virtual-model-form.js';
import { t } from '../i18n/index.js';
import { Button, IconButton, Modal, cx } from './ui.js';

interface Props {
  agentName: string;
  existing: VirtualModel[];
  /** When set, the modal edits this virtual model. */
  editing?: VirtualModel;
  models: AvailableModel[];
  customProviders: CustomProviderData[];
  connectedProviders: RoutingProvider[];
  onClose: () => void;
  onSaved: (saved: VirtualModel) => void;
  /**
   * Edit only: part of the save went through (the rename or switch) before a
   * later step failed. The modal stays open with the error inline; the card
   * takes what was saved.
   */
  onPartialSave?: (saved: VirtualModel) => void;
  onDelete?: (id: string) => void;
}

type PickerTarget = 'primary' | 'fallback' | null;

const NO_ERRORS: VirtualModelFormErrors = { invalidModels: [] };

/**
 * Create or edit a virtual model (ADR 0004). Create takes the whole chain;
 * edit changes the name and the switches, and the chain is edited on the card,
 * as for custom tiers.
 */
export default function VirtualModelModal(props: Props) {
  const editing = props.editing;

  const [name, setName] = useState(editing?.name ?? '');
  const [touched, setTouched] = useState(false);
  const [continueOnDefault, setContinueOnDefault] = useState(editing?.continue_on_default ?? false);
  const [streamMode, setStreamMode] = useState(editing?.response_mode === 'stream');
  const [primary, setPrimary] = useState<VirtualModelRouteInput | null>(null);
  const [fallbacks, setFallbacks] = useState<VirtualModelRouteInput[]>([]);
  const [picker, setPicker] = useState<PickerTarget>(null);
  const [submitting, setSubmitting] = useState(false);
  const [serverErrors, setServerErrors] = useState<VirtualModelFormErrors>(NO_ERRORS);
  /** The latest row the backend returned during this edit, if any. */
  const savedBase = useRef<VirtualModel | undefined>(undefined);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => nameRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const otherNames = props.existing.filter((v) => v.id !== editing?.id).map((v) => v.name);

  const nameError = touched
    ? (virtualModelNameError(name, otherNames) ?? serverErrors.name)
    : undefined;

  /** Saved shadows while the name is unchanged; a catalog preview otherwise. */
  const shadows = ((): { ids: string[]; preview: boolean } => {
    const typed = name.trim();
    if (editing && typed.toLowerCase() === editing.name.toLowerCase()) {
      return { ids: editing.shadows ?? [], preview: false };
    }
    if (virtualModelNameError(typed, []) !== undefined) return { ids: [], preview: true };
    return { ids: previewShadows(typed, props.models, props.customProviders), preview: true };
  })();

  const chainRows = ((): { route: VirtualModelRouteInput; position: string }[] => {
    if (editing) {
      const rows: { route: VirtualModelRouteInput; position: string }[] = [];
      if (editing.override_route)
        rows.push({ route: editing.override_route, position: t('models.positionPrimary') });
      (editing.fallback_routes ?? []).forEach((r, i) =>
        rows.push({ route: r, position: t('models.positionFallback', { n: i + 1 }) }),
      );
      return rows;
    }
    if (!primary) return [];
    return [
      { route: primary, position: t('models.positionPrimary') },
      ...fallbacks.map((r, i) => ({
        route: r,
        position: t('models.positionFallback', { n: i + 1 }),
      })),
    ];
  })();

  const incompatible = nonStreamingRoutes(chainRows, props.models);
  const canEnableStream = incompatible.length === 0;

  const modelLabel = (route: VirtualModelRouteInput): string =>
    props.models.find((m) => m.model_name === route.model)?.display_name ?? route.model;

  const providerLabel = (route: VirtualModelRouteInput): string => {
    const id = route.provider ?? '';
    if (id.startsWith('custom:')) {
      const cp = props.customProviders.find((p) => `custom:${p.id}` === id);
      if (cp) return cp.name;
    }
    return (
      props.models.find((m) => m.model_name === route.model && m.provider === id)
        ?.provider_display_name ?? id
    );
  };

  const clearServerErrors = () => setServerErrors(NO_ERRORS);

  const handlePick = (_target: string, model: string, provider: string, authType?: AuthType) => {
    const target = picker;
    setPicker(null);
    if (!target) return;
    const route: VirtualModelRouteInput = authType
      ? { model, provider, authType }
      : { model, provider };
    clearServerErrors();
    if (target === 'primary') setPrimary(route);
    else setFallbacks((prev) => [...prev, route].slice(0, MAX_VIRTUAL_MODEL_FALLBACKS));
  };

  const removeRow = (index: number) => {
    clearServerErrors();
    if (index === 0) {
      // The fallbacks follow the primary, as on the cards.
      setPrimary(null);
      setFallbacks([]);
      if (streamMode && !canEnableStream) setStreamMode(false);
      return;
    }
    setFallbacks((prev) => prev.filter((_, i) => i !== index - 1));
  };

  const isValid = () => virtualModelNameError(name, otherNames) === undefined;

  const submit = async (): Promise<void> => {
    setTouched(true);
    if (!isValid() || submitting) return;
    setSubmitting(true);
    clearServerErrors();
    const responseMode: ResponseMode = streamMode ? 'stream' : 'buffered';
    // Set once the PUT went through, so a failed PATCH after it still reaches
    // the card (and a retry only sends what is left).
    let partial: VirtualModel | undefined;
    try {
      let saved: VirtualModel;
      if (editing) {
        const base = savedBase.current ?? editing;
        const patch: { name?: string; continue_on_default?: boolean } = {};
        if (name.trim() !== base.name) patch.name = name.trim();
        if (continueOnDefault !== base.continue_on_default) {
          patch.continue_on_default = continueOnDefault;
        }
        if (Object.keys(patch).length > 0) {
          saved = await updateVirtualModel(props.agentName, editing.id, patch);
          partial = saved;
        } else {
          saved = base;
        }
        if (saved.response_mode !== responseMode) {
          saved = await setVirtualModelResponseMode(props.agentName, editing.id, responseMode, {
            silent: true,
          });
        }
      } else {
        saved = await createVirtualModel(props.agentName, {
          name: name.trim(),
          override_route: primary,
          fallback_routes: primary ? fallbacks : [],
          continue_on_default: continueOnDefault,
          response_mode: responseMode,
        });
      }
      props.onSaved(saved);
    } catch (err) {
      if (partial) {
        savedBase.current = partial;
        props.onPartialSave?.(partial);
      }
      setServerErrors(
        mapVirtualModelError(
          err,
          chainRows.map((r) => r.route.model),
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const title = editing ? t('models.vmModal.titleEdit') : t('models.vmModal.titleCreate');
  const submitLabel = editing
    ? submitting
      ? t('models.vmModal.saving')
      : t('models.vmModal.saveChanges')
    : submitting
      ? t('models.vmModal.creating')
      : t('models.vmModal.create');

  const streamDisabled = !streamMode && !canEnableStream;

  return (
    <>
      <Modal
        open
        // While the picker is open, Escape belongs to it.
        onClose={() => {
          if (picker === null) props.onClose();
        }}
        label={title}
      >
        <div
          className="virtual-model-modal"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
              e.preventDefault();
              void submit();
            }
          }}
        >
          <div className="mb-1 flex items-center gap-2">
            <h2
              className="flex-1 text-[15px] font-semibold text-ink"
              id="virtual-model-modal-title"
            >
              {title}
            </h2>
            <IconButton
              className="virtual-model-modal__close"
              label={t('common.close')}
              onClick={props.onClose}
            >
              <X aria-hidden="true" />
            </IconButton>
          </div>
          <p className="text-sm text-dim">
            {editing ? t('models.vmModal.descEdit') : t('models.vmModal.descCreate')}
          </p>

          <label className="label mt-4" htmlFor="virtual-model-name">
            {t('models.vmModal.name')}
          </label>
          <input
            ref={nameRef}
            id="virtual-model-name"
            className={cx(
              'field virtual-model-modal__name font-mono',
              nameError !== undefined && 'border-danger',
            )}
            type="text"
            value={name}
            placeholder="deepseek/flash" // i18n-ignore
            maxLength={VIRTUAL_MODEL_NAME_MAX_LENGTH}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={nameError !== undefined}
            aria-describedby="virtual-model-name-hint"
            onChange={(e) => {
              setName(e.currentTarget.value);
              setTouched(true);
              if (serverErrors.name) clearServerErrors();
            }}
          />
          {nameError ? (
            <div
              id="virtual-model-name-hint"
              className="header-tier-modal__error hint text-danger"
              role="alert"
            >
              {nameError}
            </div>
          ) : (
            <div id="virtual-model-name-hint" className="virtual-model-modal__hint hint">
              {t('models.vmModal.nameHint', { max: VIRTUAL_MODEL_NAME_MAX_LENGTH })}
            </div>
          )}

          <div className="mt-3">
            <VirtualModelShadowWarning
              shadows={shadows.ids}
              enabled={editing?.enabled ?? true}
              preview={shadows.preview}
            />
          </div>

          {!editing ? (
            <>
              <div className="label mt-4">{t('models.vmModal.models')}</div>
              <div className="virtual-model-modal__chain flex flex-col items-start gap-1.5">
                {chainRows.map((row, i) => (
                  <div
                    key={`${i}-${row.route.provider}-${row.route.model}`}
                    className={cx(
                      'virtual-model-modal__route well flex w-full items-center gap-2 px-2.5 py-1.5 text-sm',
                      serverErrors.invalidModels.includes(row.route.model) &&
                        'virtual-model-modal__route--invalid border-danger',
                    )}
                  >
                    <span className="virtual-model-modal__route-position w-20 shrink-0 text-xs text-muted">
                      {row.position}
                    </span>
                    <span
                      className="virtual-model-modal__route-model min-w-0 flex-1 truncate text-ink"
                      title={row.route.model}
                    >
                      {modelLabel(row.route)}
                    </span>
                    <span className="virtual-model-modal__route-provider shrink-0 truncate text-xs text-muted">
                      {providerLabel(row.route)}
                    </span>
                    <IconButton
                      className="virtual-model-modal__route-remove"
                      label={t('models.vmModal.removeRoute', {
                        position: row.position.toLowerCase(),
                        model: row.route.model,
                      })}
                      onClick={() => removeRow(i)}
                    >
                      <X aria-hidden="true" />
                    </IconButton>
                  </div>
                ))}
                {!primary ? (
                  <Button variant="ghost" size="sm" onClick={() => setPicker('primary')}>
                    {t('models.vmModal.choosePrimary')}
                  </Button>
                ) : fallbacks.length < MAX_VIRTUAL_MODEL_FALLBACKS ? (
                  <Button variant="ghost" size="sm" onClick={() => setPicker('fallback')}>
                    {t('models.vmModal.addFallback', {
                      count: fallbacks.length,
                      max: MAX_VIRTUAL_MODEL_FALLBACKS,
                    })}
                  </Button>
                ) : null}
                {!primary ? (
                  <div className="virtual-model-modal__hint hint">
                    {t('models.vmModal.noModelsHint')}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          <div className="virtual-model-modal__switch-row mt-4 flex items-start justify-between gap-3">
            <div>
              <span className="text-sm font-medium text-ink">
                {t('models.vmModal.continueOnDefault')}
              </span>
              <p className="hint mt-0.5">{t('models.vmModal.continueDesc')}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={continueOnDefault}
              aria-label={t('models.vmModal.continueOnDefault')}
              className={cx(
                'switch routing-switch shrink-0',
                continueOnDefault && 'routing-switch--on',
              )}
              onClick={() => setContinueOnDefault(!continueOnDefault)}
            />
          </div>

          <div className="virtual-model-modal__switch-row mt-4 flex items-start justify-between gap-3">
            <div>
              <span className="text-sm font-medium text-ink">{t('models.vmModal.streamMode')}</span>
              <p className="hint mt-0.5">
                {streamMode ? t('models.vmModal.streamOn') : t('models.vmModal.streamOff')}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={streamMode}
              aria-label={t('models.vmModal.streamMode')}
              className={cx(
                'switch routing-switch shrink-0',
                streamMode && 'routing-switch--on',
                streamDisabled && 'routing-switch--disabled',
              )}
              disabled={streamDisabled}
              onClick={() => setStreamMode(!streamMode)}
            />
          </div>
          {!streamMode && incompatible.length > 0 ? (
            <div className="response-mode-modal__blocker notice is-warn mt-2 flex-col gap-2">
              <p className="response-mode-modal__blocker-text">
                {incompatible.length === 1
                  ? t('models.vmModal.noStreamOne')
                  : t('models.vmModal.noStreamMany')}
              </p>
              <div className="response-mode-modal__blocker-list flex w-full flex-col gap-1">
                {incompatible.map((item) => (
                  <div
                    key={`${item.position}-${item.model}`}
                    className="response-mode-modal__blocker-row flex items-center justify-between gap-2"
                  >
                    <span className="response-mode-modal__blocker-model truncate font-mono text-xs">
                      {item.model}
                    </span>
                    <span className="response-mode-modal__blocker-meta shrink-0 text-xs text-muted">
                      {item.position}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {serverErrors.general ? (
            <div className="virtual-model-modal__server-error form-error mt-3" role="alert">
              {serverErrors.general}
            </div>
          ) : null}

          <div className="actions flex-wrap items-center">
            {editing && props.onDelete ? (
              <Button
                variant="danger"
                className="header-tier-modal__delete-btn mr-auto"
                onClick={() => {
                  if (confirm(deleteVirtualModelPrompt(editing.name))) {
                    props.onDelete!(editing.id);
                  }
                }}
              >
                {t('common.delete')}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={props.onClose}>
              {t('common.cancel')}
            </Button>
            <Button disabled={submitting} onClick={() => void submit()}>
              {submitLabel}
            </Button>
          </div>
        </div>
      </Modal>

      {picker !== null ? (
        <ModelPickerModal
          tierId={editing?.id ?? 'new-virtual-model'}
          agentName={props.agentName}
          models={props.models}
          tiers={[]}
          customProviders={props.customProviders}
          connectedProviders={props.connectedProviders}
          requiredCapability={streamMode ? 'stream' : undefined}
          onClose={() => setPicker(null)}
          onSelect={handlePick}
        />
      ) : null}
    </>
  );
}
