import { createResource, createSignal, Index, Show, type Component } from 'solid-js';
import { deriveCustomProviderAlias, normalizeCustomProviderAlias } from 'thinker-shared';
import {
  createCustomProvider,
  deleteCustomProvider,
  getProviders,
  probeCustomProvider,
  updateCustomProvider,
  type CustomProviderApiKind,
  type CustomProviderModel,
  type CustomProviderData,
  type RoutingProvider,
} from '../services/api.js';
import { toast } from '../services/toast-store.js';
import { t } from '../i18n/index.js';
import {
  MAX_STREAM_WARMUP_SECONDS,
  MIN_STREAM_WARMUP_SECONDS,
  parseWarmupSeconds,
  warmupMsToSecondsInput,
  streamWarmupError,
} from '../services/stream-warmup.js';
import { customProviderColor } from '../services/formatters.js';
import type { ProviderDef } from '../services/providers.js';
import type { CustomProviderPrefill } from '../services/routing-params.js';
import InfoTooltip from './InfoTooltip.jsx';
import ProviderKeyForm, { MAX_KEYS_PER_PROVIDER } from './ProviderKeyForm.jsx';

const BASE_URL_PLACEHOLDERS: Record<CustomProviderApiKind, string> = {
  openai: 'https://api.example.com/v1',
  anthropic: 'https://api.anthropic.com',
};

interface Props {
  agentName: string;
  onCreated: () => void;
  onBack: () => void;
  initialData?: CustomProviderData;
  prefill?: CustomProviderPrefill;
  onDeleted?: () => void;
}

interface ModelRow {
  model_name: string;
  input_price: string;
  output_price: string;
  context_window: string;
  price_estimated: boolean;
}

const emptyRow = (): ModelRow => ({
  model_name: '',
  input_price: '',
  output_price: '',
  context_window: '',
  price_estimated: false,
});

const toModelRows = (models: CustomProviderModel[] | undefined): ModelRow[] =>
  (models ?? []).map((m) => ({
    model_name: m.model_name,
    input_price:
      m.input_price_per_million_tokens != null ? String(m.input_price_per_million_tokens) : '',
    output_price:
      m.output_price_per_million_tokens != null ? String(m.output_price_per_million_tokens) : '',
    context_window: m.context_window != null ? String(m.context_window) : '',
    price_estimated: m.price_estimated === true,
  }));

const CustomProviderForm: Component<Props> = (props) => {
  const isEdit = () => !!props.initialData;

  const prefillRows = (): ModelRow[] => {
    if (!props.prefill?.models?.length) return [emptyRow()];
    return props.prefill.models.map((m) => ({
      model_name: m.model_name,
      input_price: m.input_price ?? '',
      output_price: m.output_price ?? '',
      context_window: '',
      price_estimated: false,
    }));
  };

  const [name, setName] = createSignal(props.initialData?.name ?? props.prefill?.name ?? '');
  // The alias follows the name while creating, until the user edits it by
  // hand. In edit mode it is the stored value: a rename must never rewrite
  // the model ids clients already use.
  const [alias, setAlias] = createSignal(
    props.initialData ? (props.initialData.alias ?? '') : (deriveCustomProviderAlias(name()) ?? ''),
  );
  const [aliasTouched, setAliasTouched] = createSignal(isEdit());
  const normalizedAlias = () => normalizeCustomProviderAlias(alias());
  const modelIdPreview = () =>
    normalizedAlias() ? `${normalizedAlias()}/<model>` : 'custom:<provider-id>/<model>';
  const [baseUrl, setBaseUrl] = createSignal(
    props.initialData?.base_url ?? props.prefill?.baseUrl ?? '',
  );
  const [apiKind, setApiKind] = createSignal<CustomProviderApiKind>(
    props.initialData?.api_kind ?? 'openai',
  );
  const [apiKey, setApiKey] = createSignal(props.prefill?.apiKey ?? '');
  const [editingKey, setEditingKey] = createSignal(false);
  const initialWarmupMs = props.initialData?.stream_warmup_ms ?? null;
  const [warmupSeconds, setWarmupSeconds] = createSignal(warmupMsToSecondsInput(initialWarmupMs));
  const [rows, setRows] = createSignal<ModelRow[]>(
    props.initialData ? toModelRows(props.initialData.models) : prefillRows(),
  );
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);
  const [probeBusy, setProbeBusy] = createSignal(false);
  const [probeError, setProbeError] = createSignal<string | null>(null);

  // In edit mode an API-key provider manages its keys the way native providers
  // do: each key is a connection, added, renamed, replaced and removed on the
  // spot through ProviderKeyForm, independently of "Save changes". Local-style
  // providers (LM Studio, Ollama names) keep the single optional key field.
  const [connections, { refetch: refetchConnections }] = createResource(
    () => (props.initialData ? props.agentName : null),
    // A failed refresh after a key change keeps the list already on screen.
    async (agentName: string, { value }: { value?: RoutingProvider[] }) => {
      try {
        return await getProviders(agentName);
      } catch (err) {
        if (value) return value;
        throw err;
      }
    },
  );
  // Reading a failed resource throws, so every read goes through this guard.
  const loadedConnections = () => (connections.error ? undefined : connections.latest);
  const ownConnections = () =>
    (loadedConnections() ?? []).filter((p) => p.provider === `custom:${props.initialData?.id}`);
  const isLocalConnection = () => ownConnections().some((p) => p.auth_type === 'local');
  const showConnections = () => isEdit() && ownConnections().length > 0 && !isLocalConnection();
  // Fall back to the single field whenever the connection list can't drive
  // the key section (fetch failed, or no row for this provider).
  const showKeyField = () =>
    !isEdit() ||
    isLocalConnection() ||
    (!!connections.error && !connections.loading) ||
    (loadedConnections() !== undefined && ownConnections().length === 0);
  const activeKeys = () =>
    ownConnections()
      .filter((p) => p.auth_type === 'api_key' && p.is_active && p.has_api_key)
      .sort((a, b) => a.priority - b.priority);
  const [keyBusy, setKeyBusy] = createSignal(false);
  const [keyInput, setKeyInput] = createSignal('');
  const [keyEditing, setKeyEditing] = createSignal(false);
  const [keyError, setKeyError] = createSignal<string | null>(null);
  const [addKeyOpen, setAddKeyOpen] = createSignal(false);
  const keysConnected = () => activeKeys().length > 0;
  const showAddKeyButton = () =>
    keysConnected() && activeKeys().length < MAX_KEYS_PER_PROVIDER && !addKeyOpen();
  const keyProviderDef = (): ProviderDef => {
    const cpName = props.initialData?.name ?? '';
    return {
      id: `custom:${props.initialData?.id}`,
      name: cpName,
      color: customProviderColor(cpName),
      initial: cpName.charAt(0).toUpperCase(),
      subtitle: '',
      models: [],
      keyPrefix: '',
      minKeyLength: 0,
      keyPlaceholder: 'sk-...',
    };
  };
  const keyPrefixDisplay = () => {
    const prefix = activeKeys()[0]?.key_prefix;
    return prefix ? `${prefix}${'•'.repeat(8)}` : '••••••••••••';
  };

  const handleProbe = async () => {
    const url = baseUrl().trim();
    if (!url) {
      setProbeError(t('providers.customForm.enterBaseUrl'));
      return;
    }
    setProbeBusy(true);
    setProbeError(null);
    try {
      // Edit mode: forward provider_id so the backend can probe with the
      // stored key (the form never sees plaintext). A user-typed key still
      // wins so freshly entered keys can be verified before saving.
      const typedKey = apiKey().trim() || undefined;
      const probeId = !typedKey && isEdit() ? props.initialData?.id : undefined;
      const { models } = await probeCustomProvider(
        props.agentName,
        url,
        typedKey,
        apiKind(),
        name().trim() || undefined,
        probeId,
      );
      if (models.length === 0) {
        setProbeError(t('providers.customForm.noModels'));
        return;
      }
      setRows(toModelRows(models));
    } catch (e) {
      setProbeError(e instanceof Error ? e.message : t('providers.customForm.probeFailed'));
    } finally {
      setProbeBusy(false);
    }
  };

  const updateRow = (
    index: number,
    field: 'model_name' | 'input_price' | 'output_price' | 'context_window',
    value: string,
  ) => {
    // The context window is not a price, so editing it keeps the estimate flag.
    setRows((prev) =>
      prev.map((r, i) =>
        i === index
          ? {
              ...r,
              [field]: value,
              price_estimated: field === 'context_window' ? r.price_estimated : false,
            }
          : r,
      ),
    );
  };

  const addRow = () => setRows((prev) => [...prev, emptyRow()]);

  const removeRow = (index: number) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const validModels = () => rows().filter((r) => r.model_name.trim());
  const hasEstimatedPrices = () => rows().some((r) => r.price_estimated);

  const canSubmit = () => name().trim() && baseUrl().trim() && validModels().length > 0 && !busy();

  const parsePrice = (v: string): number => Number(v.replace(',', '.'));
  // Digits only (thousands separators dropped); blank or invalid means unknown.
  const parseContextWindow = (v: string): number | null => {
    const n = Number(v.replace(/[\s,._]/g, ''));
    return Number.isInteger(n) && n >= 1 ? n : null;
  };

  const buildModels = (): CustomProviderModel[] =>
    validModels().map((r) => ({
      model_name: r.model_name.trim(),
      ...(r.input_price !== ''
        ? { input_price_per_million_tokens: parsePrice(r.input_price) }
        : {}),
      ...(r.output_price !== ''
        ? { output_price_per_million_tokens: parsePrice(r.output_price) }
        : {}),
      ...(parseContextWindow(r.context_window) !== null
        ? { context_window: parseContextWindow(r.context_window)! }
        : {}),
      ...(r.price_estimated && (r.input_price !== '' || r.output_price !== '')
        ? { price_estimated: true }
        : {}),
    }));

  const handleCreate = async () => {
    setError(null);
    setBusy(true);
    try {
      await createCustomProvider(props.agentName, {
        name: name().trim(),
        alias: normalizedAlias(),
        base_url: baseUrl().trim(),
        api_kind: apiKind(),
        apiKey: apiKey().trim() || undefined,
        models: buildModels(),
      });
      toast.success(t('providers.customForm.connectedToast', { name: name().trim() }));
      props.onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('providers.customForm.createFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleUpdate = async () => {
    setError(null);
    const data: Record<string, unknown> = {
      name: name().trim(),
      alias: normalizedAlias(),
      base_url: baseUrl().trim(),
      models: buildModels(),
    };
    if (editingKey()) {
      data.apiKey = apiKey().trim() || undefined;
    }
    const warmupMs = parseWarmupSeconds(warmupSeconds());
    if (warmupMs === undefined) {
      setError(streamWarmupError());
      return;
    }
    if (warmupMs !== initialWarmupMs) data.stream_warmup_ms = warmupMs;

    setBusy(true);
    try {
      await updateCustomProvider(props.agentName, props.initialData!.id, data as never);
      toast.success(t('providers.customForm.updatedToast', { name: name().trim() }));
      props.onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('providers.customForm.updateFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteCustomProvider(props.agentName, props.initialData!.id);
      toast.success(t('providers.customForm.removedToast', { name: props.initialData!.name }));
      props.onDeleted?.();
    } catch {
      // error toast from fetchMutate
    } finally {
      setBusy(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleSubmit = () => {
    if (isEdit()) handleUpdate();
    else handleCreate();
  };

  return (
    <div class="provider-detail">
      <button
        class="modal-back-btn"
        onClick={props.onBack}
        aria-label={t('providers.customForm.backToProviders')}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          fill="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M14.71 7.29a.996.996 0 0 0-1.41 0l-4 4a.996.996 0 0 0 0 1.41l4 4c.2.2.45.29.71.29s.51-.1.71-.29a.996.996 0 0 0 0-1.41L11.43 12l3.29-3.29a.996.996 0 0 0 0-1.41Z" />
        </svg>
      </button>

      <div class="routing-modal__header" style="border: none; padding: 0; margin-bottom: 20px;">
        <div>
          <div class="routing-modal__title">
            {isEdit() ? t('providers.customForm.editTitle') : t('providers.customForm.addTitle')}
          </div>
          <div class="routing-modal__subtitle">{t('providers.customForm.subtitle')}</div>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit()) handleSubmit();
        }}
      >
        <div class="provider-detail__field">
          <label class="provider-detail__label" for="cp-name">
            {t('providers.customForm.providerName')}
          </label>
          <input
            ref={(el) => requestAnimationFrame(() => el.focus())}
            id="cp-name"
            class="provider-detail__input"
            type="text"
            placeholder={t('providers.customForm.providerNamePlaceholder')}
            value={name()}
            onInput={(e) => {
              setName(e.currentTarget.value);
              if (!aliasTouched()) setAlias(deriveCustomProviderAlias(e.currentTarget.value) ?? '');
              setError(null);
            }}
          />
        </div>

        <div class="provider-detail__field">
          <label class="provider-detail__label" for="cp-alias">
            {t('providers.customForm.alias')}
          </label>
          <input
            id="cp-alias"
            class="provider-detail__input"
            type="text"
            placeholder={t('providers.customForm.aliasPlaceholder')}
            value={alias()}
            onInput={(e) => {
              setAlias(e.currentTarget.value);
              setAliasTouched(true);
              setError(null);
            }}
          />
          <div class="provider-detail__hint" data-testid="cp-alias-hint">
            {t('providers.customForm.aliasHintBefore')}
            <code>{modelIdPreview()}</code>
            {t('providers.customForm.aliasHintMiddle')}
            <code>/v1/models</code>
            {t('providers.customForm.aliasHintAfter')}
            <Show when={isEdit()}>{t('providers.customForm.aliasHintEdit')}</Show>
          </div>
        </div>

        <fieldset
          class="provider-detail__format"
          aria-describedby="cp-format-help"
          disabled={isEdit()}
        >
          <legend class="provider-detail__format-legend">
            {t('providers.customForm.apiFormat')}
          </legend>
          <div class="provider-detail__format-options" role="radiogroup">
            <label
              class={`provider-detail__format-option${
                apiKind() === 'openai' ? ' provider-detail__format-option--active' : ''
              }${isEdit() ? ' provider-detail__format-option--disabled' : ''}`}
            >
              <input
                type="radio"
                name="cp-api-format"
                value="openai"
                checked={apiKind() === 'openai'}
                disabled={isEdit()}
                onChange={() => setApiKind('openai')}
              />
              <span class="provider-detail__format-option-title">OpenAI</span>
              {/* i18n-ignore: API path */}
              <span class="provider-detail__format-option-path">/v1/chat/completions</span>
            </label>
            <label
              class={`provider-detail__format-option${
                apiKind() === 'anthropic' ? ' provider-detail__format-option--active' : ''
              }${isEdit() ? ' provider-detail__format-option--disabled' : ''}`}
            >
              <input
                type="radio"
                name="cp-api-format"
                value="anthropic"
                checked={apiKind() === 'anthropic'}
                disabled={isEdit()}
                onChange={() => setApiKind('anthropic')}
              />
              <span class="provider-detail__format-option-title">Anthropic</span>
              {/* i18n-ignore: API path */}
              <span class="provider-detail__format-option-path">/v1/messages</span>
            </label>
          </div>
          <p id="cp-format-help" class="provider-detail__format-help">
            <Show when={isEdit()} fallback={t('providers.customForm.formatHelpCreate')}>
              {t('providers.customForm.formatHelpEdit')}
            </Show>
          </p>
        </fieldset>

        <div class="provider-detail__field">
          <label class="provider-detail__label" for="cp-base-url">
            {t('providers.customForm.baseUrl')}
          </label>
          <div class="provider-detail__key-row">
            <input
              id="cp-base-url"
              class="provider-detail__input"
              type="url"
              placeholder={BASE_URL_PLACEHOLDERS[apiKind()]}
              value={baseUrl()}
              onInput={(e) => {
                setBaseUrl(e.currentTarget.value);
                setError(null);
                setProbeError(null);
              }}
            />
            <button
              type="button"
              class="btn btn--outline btn--sm"
              onClick={handleProbe}
              disabled={probeBusy() || !baseUrl().trim()}
              aria-label={
                apiKind() === 'anthropic'
                  ? t('providers.customForm.fetchModelsAnthropic')
                  : t('providers.customForm.fetchModelsOpenai')
              }
            >
              {probeBusy() ? <span class="spinner" /> : t('providers.customForm.fetchModels')}
            </button>
          </div>
          <div
            class="provider-detail__hint"
            style="font-size: var(--font-size-xs); color: hsl(var(--muted-foreground)); margin-top: 4px;"
          >
            {t('providers.customForm.localHintBefore')}
            <code>http://host.docker.internal:&lt;port&gt;</code>
            {t('providers.customForm.localHintDocker')}{' '}
            <code>http://host.containers.internal:&lt;port&gt;</code>
            {t('providers.customForm.localHintPodman')} <code>http://localhost:&lt;port&gt;</code>
            {t('providers.customForm.localHintAfter')}
          </div>
          <Show when={probeError()}>
            <div class="provider-detail__error" role="alert" style="margin-top: 4px;">
              {probeError()}
            </div>
          </Show>
        </div>

        <Show when={isEdit()}>
          <div class="provider-detail__field">
            <label class="provider-detail__label" for="cp-stream-warmup">
              {t('providers.customForm.streamWarmup')}{' '}
              <span style="color: hsl(var(--muted-foreground)); font-weight: 400;">
                {t('providers.customForm.optional')}
              </span>
            </label>
            <input
              id="cp-stream-warmup"
              class="provider-detail__input"
              type="number"
              min={MIN_STREAM_WARMUP_SECONDS}
              max={MAX_STREAM_WARMUP_SECONDS}
              step="1"
              placeholder={t('providers.customForm.inherit')}
              value={warmupSeconds()}
              onInput={(e) => {
                setWarmupSeconds(e.currentTarget.value);
                setError(null);
              }}
            />
            <div
              class="provider-detail__hint"
              style="font-size: var(--font-size-xs); color: hsl(var(--muted-foreground)); margin-top: 4px;"
            >
              {t('providers.customForm.warmupHint')}
            </div>
          </div>
        </Show>

        <Show when={showKeyField()}>
          <div class="provider-detail__field">
            <label class="provider-detail__label" for="cp-api-key">
              {t('providers.customForm.apiKey')}{' '}
              <span style="color: hsl(var(--muted-foreground)); font-weight: 400;">
                {t('providers.customForm.apiKeyOptional')}
              </span>
            </label>
            <Show when={isEdit() && !editingKey()}>
              <div class="provider-detail__key-row">
                <input
                  id="cp-api-key"
                  class="provider-detail__input provider-detail__input--disabled"
                  type="text"
                  value={
                    props.initialData?.has_api_key
                      ? '••••••••••••'
                      : t('providers.customForm.noKeySet')
                  }
                  disabled
                  aria-label={t('providers.customForm.currentKeyAria')}
                />
                <button
                  type="button"
                  class="btn btn--outline btn--sm"
                  onClick={() => {
                    setEditingKey(true);
                    setApiKey('');
                  }}
                >
                  {t('providers.customForm.change')}
                </button>
              </div>
            </Show>
            <Show when={!isEdit() || editingKey()}>
              <input
                id="cp-api-key"
                class="provider-detail__input provider-detail__input--masked"
                type="text"
                autocomplete="off"
                // i18n-ignore: key format sample
                placeholder="sk-..."
                value={apiKey()}
                onInput={(e) => setApiKey(e.currentTarget.value)}
              />
            </Show>
          </div>
        </Show>

        <div class="provider-detail__field">
          <div id="cp-models-label" class="provider-detail__label custom-provider-models__label">
            {t('providers.customForm.models')}
            <Show when={hasEstimatedPrices()}>
              <InfoTooltip text={t('providers.customForm.estimatedPrice')} />
            </Show>
          </div>
          <div class="custom-provider-models" aria-labelledby="cp-models-label">
            <div class="custom-provider-models__columns" aria-hidden="true">
              <span class="custom-provider-models__column custom-provider-models__column--name">
                {t('providers.customForm.modelName')}
              </span>
              <span class="custom-provider-models__column custom-provider-models__column--price">
                {t('providers.customForm.inputPerM')}
              </span>
              <span class="custom-provider-models__column custom-provider-models__column--price">
                {t('providers.customForm.outputPerM')}
              </span>
              <span class="custom-provider-models__column custom-provider-models__column--price">
                {t('providers.customForm.contextWindow')}
              </span>
              <span class="custom-provider-models__column-spacer" />
            </div>
            <Index each={rows()}>
              {(row, i) => (
                <div class="custom-provider-model-row">
                  <input
                    class="provider-detail__input custom-provider-model-row__name"
                    type="text"
                    placeholder={t('providers.customForm.modelName')}
                    aria-label={t('providers.customForm.modelNameAria', { n: i + 1 })}
                    value={row().model_name}
                    onInput={(e) => updateRow(i, 'model_name', e.currentTarget.value)}
                  />
                  <input
                    class="provider-detail__input custom-provider-model-row__price"
                    type="text"
                    inputmode="decimal"
                    placeholder={t('providers.customForm.inputPlaceholder')}
                    aria-label={t('providers.customForm.inputAria', { n: i + 1 })}
                    value={row().input_price}
                    onInput={(e) => updateRow(i, 'input_price', e.currentTarget.value)}
                  />
                  <input
                    class="provider-detail__input custom-provider-model-row__price"
                    type="text"
                    inputmode="decimal"
                    placeholder={t('providers.customForm.outputPlaceholder')}
                    aria-label={t('providers.customForm.outputAria', { n: i + 1 })}
                    value={row().output_price}
                    onInput={(e) => updateRow(i, 'output_price', e.currentTarget.value)}
                  />
                  <input
                    class="provider-detail__input custom-provider-model-row__price"
                    type="text"
                    inputmode="numeric"
                    placeholder={t('providers.customForm.tokensPlaceholder')}
                    aria-label={t('providers.customForm.contextAria', { n: i + 1 })}
                    value={row().context_window}
                    onInput={(e) => updateRow(i, 'context_window', e.currentTarget.value)}
                  />
                  <button
                    type="button"
                    class="custom-provider-model-row__remove"
                    onClick={() => removeRow(i)}
                    disabled={rows().length <= 1}
                    aria-label={t('providers.customForm.removeModelAria', { n: i + 1 })}
                    title={t('providers.customForm.remove')}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                </div>
              )}
            </Index>
            <button
              type="button"
              class="btn btn--outline btn--sm"
              onClick={addRow}
              disabled={!rows().at(-1)?.model_name.trim()}
              style="margin-top: 4px; align-self: flex-start;"
            >
              {t('providers.customForm.addModel')}
            </button>
          </div>
        </div>

        {error() && (
          <div class="provider-detail__error" role="alert">
            {error()}
          </div>
        )}

        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 16px;">
          <Show when={isEdit()} fallback={<div />}>
            <button
              type="button"
              class="btn btn--outline btn--sm provider-detail__disconnect"
              disabled={busy()}
              onClick={() => setShowDeleteConfirm(true)}
            >
              {t('providers.customForm.deleteProvider')}
            </button>
          </Show>
          <button
            type="submit"
            class="btn btn--primary btn--sm provider-detail__action"
            disabled={!canSubmit()}
          >
            {busy() ? (
              <span class="spinner" />
            ) : isEdit() ? (
              t('providers.customForm.saveChanges')
            ) : (
              t('providers.customForm.connect')
            )}
          </button>
        </div>
      </form>

      <Show when={showConnections()}>
        <div
          class="custom-provider-connections"
          style="margin-top: 20px; padding-top: 16px; border-top: 1px solid hsl(var(--border));"
        >
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px;">
            <span style="font-size: var(--font-size-xs); color: hsl(var(--muted-foreground));">
              {t('providers.customForm.keyPoolHint')}
            </span>
            <Show when={showAddKeyButton()}>
              <button
                type="button"
                class="btn btn--sm"
                style="background: hsl(var(--foreground)); color: hsl(var(--background)); border: none; font-size: var(--font-size-xs); display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;"
                onClick={() => setAddKeyOpen(true)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M4 11h11v2H4zm0-5h16v2H4zm0 10h8v2H4zm15-3h-2v3h-3v2h3v3h2v-3h3v-2h-3z" />
                </svg>
                {t('providers.customForm.addAnotherKey')}
              </button>
            </Show>
          </div>
          <ProviderKeyForm
            provDef={keyProviderDef()}
            provId={`custom:${props.initialData!.id}`}
            agentName={props.agentName}
            isSubMode={() => false}
            connected={keysConnected}
            selectedAuthType={() => 'api_key'}
            busy={keyBusy}
            setBusy={setKeyBusy}
            keyInput={keyInput}
            setKeyInput={setKeyInput}
            editing={keyEditing}
            setEditing={setKeyEditing}
            validationError={keyError}
            setValidationError={setKeyError}
            getKeyPrefixDisplay={keyPrefixDisplay}
            providers={loadedConnections() ?? []}
            addKeyOpen={addKeyOpen}
            setAddKeyOpen={setAddKeyOpen}
            canDisconnect={false}
            onBack={() => {
              setKeyEditing(false);
              setKeyInput('');
            }}
            onUpdate={() => void refetchConnections()}
          />
        </div>
      </Show>

      {/* -- Delete Confirmation Modal -- */}
      <Show when={showDeleteConfirm()}>
        <div
          class="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowDeleteConfirm(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowDeleteConfirm(false);
          }}
        >
          <div
            class="modal-card"
            style="max-width: 400px;"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-provider-modal-title"
          >
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--gap-lg);">
              <h3
                id="delete-provider-modal-title"
                style="margin: 0; font-size: var(--font-size-lg);"
              >
                {t('providers.customForm.deleteProvider')}
              </h3>
              <button
                style="background: none; border: none; cursor: pointer; color: hsl(var(--muted-foreground)); padding: 4px;"
                onClick={() => setShowDeleteConfirm(false)}
                aria-label={t('providers.customForm.close')}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <p style="font-size: var(--font-size-sm); color: hsl(var(--muted-foreground)); margin-bottom: var(--gap-lg);">
              {t('providers.customForm.deleteConfirmBefore')}{' '}
              <strong style="color: hsl(var(--foreground));">{props.initialData?.name}</strong>
              {t('providers.customForm.deleteConfirmAfter')}
            </p>
            <div style="display: flex; gap: var(--gap-sm); justify-content: flex-end;">
              <button
                class="btn btn--outline btn--sm"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={busy()}
              >
                {t('providers.customForm.cancel')}
              </button>
              <button class="btn btn--danger btn--sm" onClick={handleDelete} disabled={busy()}>
                {busy() ? <span class="spinner" /> : t('providers.customForm.delete')}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default CustomProviderForm;
