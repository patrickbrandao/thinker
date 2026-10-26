import { createMemo, createSignal, For, Show, type Component } from 'solid-js';
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
const VirtualModelModal: Component<Props> = (props) => {
  const editing = props.editing;

  const [name, setName] = createSignal(editing?.name ?? '');
  const [touched, setTouched] = createSignal(false);
  const [continueOnDefault, setContinueOnDefault] = createSignal(
    editing?.continue_on_default ?? false,
  );
  const [streamMode, setStreamMode] = createSignal(editing?.response_mode === 'stream');
  const [primary, setPrimary] = createSignal<VirtualModelRouteInput | null>(null);
  const [fallbacks, setFallbacks] = createSignal<VirtualModelRouteInput[]>([]);
  const [picker, setPicker] = createSignal<PickerTarget>(null);
  const [submitting, setSubmitting] = createSignal(false);
  const [serverErrors, setServerErrors] = createSignal<VirtualModelFormErrors>(NO_ERRORS);

  const otherNames = createMemo(() =>
    props.existing.filter((v) => v.id !== editing?.id).map((v) => v.name),
  );

  const nameError = (): string | undefined =>
    touched() ? (virtualModelNameError(name(), otherNames()) ?? serverErrors().name) : undefined;

  /** Saved shadows while the name is unchanged; a catalog preview otherwise. */
  const shadows = (): { ids: string[]; preview: boolean } => {
    const typed = name().trim();
    if (editing && typed.toLowerCase() === editing.name.toLowerCase()) {
      return { ids: editing.shadows ?? [], preview: false };
    }
    if (virtualModelNameError(typed, []) !== undefined) return { ids: [], preview: true };
    return { ids: previewShadows(typed, props.models, props.customProviders), preview: true };
  };

  const chainRows = (): { route: VirtualModelRouteInput; position: string }[] => {
    if (editing) {
      const rows: { route: VirtualModelRouteInput; position: string }[] = [];
      if (editing.override_route) rows.push({ route: editing.override_route, position: 'Primary' });
      (editing.fallback_routes ?? []).forEach((r, i) =>
        rows.push({ route: r, position: `Fallback ${i + 1}` }),
      );
      return rows;
    }
    const p = primary();
    if (!p) return [];
    return [
      { route: p, position: 'Primary' },
      ...fallbacks().map((r, i) => ({ route: r, position: `Fallback ${i + 1}` })),
    ];
  };

  const incompatible = () => nonStreamingRoutes(chainRows(), props.models);
  const canEnableStream = () => incompatible().length === 0;

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
    const target = picker();
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
      if (streamMode() && !canEnableStream()) setStreamMode(false);
      return;
    }
    setFallbacks((prev) => prev.filter((_, i) => i !== index - 1));
  };

  /** The latest row the backend returned during this edit, if any. */
  let savedBase: VirtualModel | undefined;

  const isValid = () => virtualModelNameError(name(), otherNames()) === undefined;

  const submit = async (): Promise<void> => {
    setTouched(true);
    if (!isValid() || submitting()) return;
    setSubmitting(true);
    clearServerErrors();
    const responseMode: ResponseMode = streamMode() ? 'stream' : 'buffered';
    // Set once the PUT went through, so a failed PATCH after it still reaches
    // the card (and a retry only sends what is left).
    let partial: VirtualModel | undefined;
    try {
      let saved: VirtualModel;
      if (editing) {
        const base = savedBase ?? editing;
        const patch: { name?: string; continue_on_default?: boolean } = {};
        if (name().trim() !== base.name) patch.name = name().trim();
        if (continueOnDefault() !== base.continue_on_default) {
          patch.continue_on_default = continueOnDefault();
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
        const p = primary();
        saved = await createVirtualModel(props.agentName, {
          name: name().trim(),
          override_route: p,
          fallback_routes: p ? fallbacks() : [],
          continue_on_default: continueOnDefault(),
          response_mode: responseMode,
        });
      }
      props.onSaved(saved);
    } catch (err) {
      if (partial) {
        savedBase = partial;
        props.onPartialSave?.(partial);
      }
      const mapped = mapVirtualModelError(
        err,
        chainRows().map((r) => r.route.model),
      );
      setServerErrors(mapped);
    } finally {
      setSubmitting(false);
    }
  };

  const title = editing ? 'Edit virtual model' : 'Create virtual model';
  const submitLabel = (): string => {
    if (editing) return submitting() ? 'Saving…' : 'Save changes';
    return submitting() ? 'Creating…' : 'Create virtual model';
  };

  return (
    <>
      <div
        class="modal-overlay"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
      >
        <div
          class="modal-card virtual-model-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="virtual-model-modal-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !e.defaultPrevented) props.onClose();
            if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
              e.preventDefault();
              void submit();
            }
          }}
        >
          <button
            type="button"
            class="modal__close virtual-model-modal__close"
            onClick={props.onClose}
            aria-label="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="m9.17 13.41-3.54 3.54a.996.996 0 0 0 .71 1.7c.26 0 .51-.1.71-.29l2.83-2.83L12 13.41l2.83 2.83 2.12 2.12c.2.2.45.29.71.29s.51-.1.71-.29a.996.996 0 0 0 0-1.41l-3.54-3.54L13.42 12l4.95-4.95a.996.996 0 1 0-1.41-1.41l-4.95 4.95-4.95-4.95a.996.996 0 1 0-1.41 1.41L10.6 12l-1.41 1.41Z" />
            </svg>
          </button>
          <h2 class="modal-card__title" id="virtual-model-modal-title">
            {title}
          </h2>
          <p class="modal-card__desc">
            {editing
              ? 'Rename the virtual model or change how it routes. The primary model and fallbacks are managed on the card.'
              : 'A virtual model is a model name this harness can send in the "model" field. It routes through its own primary model and fallbacks, with no header needed.'}
          </p>

          <label class="modal-card__field-label" for="virtual-model-name">
            Name
          </label>
          <input
            ref={(el) => requestAnimationFrame(() => el.focus())}
            id="virtual-model-name"
            class="modal-card__input virtual-model-modal__name"
            classList={{ 'modal-card__input--error': nameError() !== undefined }}
            type="text"
            value={name()}
            placeholder="deepseek/flash"
            maxlength={VIRTUAL_MODEL_NAME_MAX_LENGTH}
            autocomplete="off"
            spellcheck={false}
            aria-invalid={nameError() !== undefined}
            aria-describedby="virtual-model-name-hint"
            onInput={(e) => {
              setName(e.currentTarget.value);
              setTouched(true);
              if (serverErrors().name) clearServerErrors();
            }}
          />
          <Show
            when={nameError()}
            fallback={
              <div id="virtual-model-name-hint" class="virtual-model-modal__hint">
                Letters, numbers, dots, underscores, colons, hyphens and single slashes, up to{' '}
                {VIRTUAL_MODEL_NAME_MAX_LENGTH} characters. "auto" is reserved.
              </div>
            }
          >
            <div id="virtual-model-name-hint" class="header-tier-modal__error" role="alert">
              {nameError()}
            </div>
          </Show>

          <VirtualModelShadowWarning
            shadows={shadows().ids}
            enabled={editing?.enabled ?? true}
            preview={shadows().preview}
          />

          <Show when={!editing}>
            <div class="modal-card__field-label">Models</div>
            <div class="virtual-model-modal__chain">
              <For each={chainRows()}>
                {(row, i) => (
                  <div
                    class="virtual-model-modal__route"
                    classList={{
                      'virtual-model-modal__route--invalid': serverErrors().invalidModels.includes(
                        row.route.model,
                      ),
                    }}
                  >
                    <span class="virtual-model-modal__route-position">{row.position}</span>
                    <span class="virtual-model-modal__route-model" title={row.route.model}>
                      {modelLabel(row.route)}
                    </span>
                    <span class="virtual-model-modal__route-provider">
                      {providerLabel(row.route)}
                    </span>
                    <button
                      type="button"
                      class="virtual-model-modal__route-remove"
                      aria-label={`Remove ${row.position.toLowerCase()} ${row.route.model}`}
                      onClick={() => removeRow(i())}
                    >
                      ×
                    </button>
                  </div>
                )}
              </For>
              <Show
                when={primary()}
                fallback={
                  <button
                    type="button"
                    class="btn btn--outline btn--sm"
                    onClick={() => setPicker('primary')}
                  >
                    + Choose primary model
                  </button>
                }
              >
                <Show when={fallbacks().length < MAX_VIRTUAL_MODEL_FALLBACKS}>
                  <button
                    type="button"
                    class="btn btn--outline btn--sm"
                    onClick={() => setPicker('fallback')}
                  >
                    + Add fallback ({fallbacks().length}/{MAX_VIRTUAL_MODEL_FALLBACKS})
                  </button>
                </Show>
              </Show>
              <Show when={!primary()}>
                <div class="virtual-model-modal__hint">
                  Optional. Without models, requests for this name fail with M301 unless Continue on
                  Default is on.
                </div>
              </Show>
            </div>
          </Show>

          <div class="virtual-model-modal__switch-row">
            <div>
              <span class="response-mode-modal__field-title">Continue on Default</span>
              <p class="response-mode-modal__desc">
                When every model of this chain is unavailable or fails, continue with the Default
                tier's models.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={continueOnDefault()}
              aria-label="Continue on Default"
              class="routing-switch"
              classList={{ 'routing-switch--on': continueOnDefault() }}
              onClick={() => setContinueOnDefault(!continueOnDefault())}
            >
              <span class="routing-switch__track">
                <span class="routing-switch__thumb" />
              </span>
            </button>
          </div>

          <div class="virtual-model-modal__switch-row">
            <div>
              <span class="response-mode-modal__field-title">Stream mode</span>
              <p class="response-mode-modal__desc">
                {streamMode()
                  ? 'Responses are streamed token by token as the model generates them.'
                  : 'Responses are returned as a single payload once the model finishes generating.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={streamMode()}
              aria-label="Stream mode"
              class="routing-switch"
              classList={{
                'routing-switch--on': streamMode(),
                'routing-switch--disabled': !streamMode() && !canEnableStream(),
              }}
              disabled={!streamMode() && !canEnableStream()}
              onClick={() => setStreamMode(!streamMode())}
            >
              <span class="routing-switch__track">
                <span class="routing-switch__thumb" />
              </span>
            </button>
          </div>
          <Show when={!streamMode() && incompatible().length > 0}>
            <div class="response-mode-modal__blocker">
              <p class="response-mode-modal__blocker-text">
                {incompatible().length === 1 ? 'This model does' : 'These models do'} not support
                streaming.
              </p>
              <div class="response-mode-modal__blocker-list">
                <For each={incompatible()}>
                  {(item) => (
                    <div class="response-mode-modal__blocker-row">
                      <span class="response-mode-modal__blocker-model">{item.model}</span>
                      <span class="response-mode-modal__blocker-meta">{item.position}</span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <Show when={serverErrors().general}>
            <div class="virtual-model-modal__server-error" role="alert">
              {serverErrors().general}
            </div>
          </Show>

          <div class="header-tier-modal__footer">
            <Show when={editing && props.onDelete}>
              <button
                type="button"
                class="btn btn--outline header-tier-modal__delete-btn"
                onClick={() => {
                  if (confirm(deleteVirtualModelPrompt(editing!.name))) {
                    props.onDelete!(editing!.id);
                  }
                }}
              >
                Delete
              </button>
            </Show>
            <div class="header-tier-modal__footer-right">
              <button type="button" class="btn btn--ghost" onClick={props.onClose}>
                Cancel
              </button>
              <button
                type="button"
                class="btn btn--primary"
                disabled={submitting()}
                onClick={() => void submit()}
              >
                {submitLabel()}
              </button>
            </div>
          </div>
        </div>
      </div>

      <Show when={picker() !== null}>
        <ModelPickerModal
          tierId={editing?.id ?? 'new-virtual-model'}
          agentName={props.agentName}
          models={props.models}
          tiers={[]}
          customProviders={props.customProviders}
          connectedProviders={props.connectedProviders}
          requiredCapability={streamMode() ? 'stream' : undefined}
          onClose={() => setPicker(null)}
          onSelect={handlePick}
        />
      </Show>
    </>
  );
};

export default VirtualModelModal;
