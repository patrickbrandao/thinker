import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ListPlus, X } from 'lucide-react';
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
import { useResource } from '../lib/use-resource.js';
import InfoTooltip from './InfoTooltip.js';
import ProviderKeyForm, { MAX_KEYS_PER_PROVIDER } from './ProviderKeyForm.js';
import { Button, Modal, cx } from './ui.js';

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

const prefillRows = (prefill: CustomProviderPrefill | undefined): ModelRow[] => {
  if (!prefill?.models?.length) return [emptyRow()];
  return prefill.models.map((m) => ({
    model_name: m.model_name,
    input_price: m.input_price ?? '',
    output_price: m.output_price ?? '',
    context_window: '',
    price_estimated: false,
  }));
};

const parsePrice = (v: string): number => Number(v.replace(',', '.'));
// Digits only (thousands separators dropped); blank or invalid means unknown.
const parseContextWindow = (v: string): number | null => {
  const n = Number(v.replace(/[\s,._]/g, ''));
  return Number.isInteger(n) && n >= 1 ? n : null;
};

export default function CustomProviderForm(props: Props) {
  const { initialData, agentName } = props;
  const isEdit = !!initialData;

  const [name, setName] = useState(initialData?.name ?? props.prefill?.name ?? '');
  // The alias follows the name while creating, until the user edits it by
  // hand. In edit mode it is the stored value: a rename must never rewrite
  // the model ids clients already use.
  const [alias, setAlias] = useState(() =>
    initialData ? (initialData.alias ?? '') : (deriveCustomProviderAlias(name) ?? ''),
  );
  const [aliasTouched, setAliasTouched] = useState(isEdit);
  const normalizedAlias = normalizeCustomProviderAlias(alias);
  const modelIdPreview = normalizedAlias
    ? `${normalizedAlias}/<model>`
    : 'custom:<provider-id>/<model>';
  const [baseUrl, setBaseUrl] = useState(initialData?.base_url ?? props.prefill?.baseUrl ?? '');
  const [apiKind, setApiKind] = useState<CustomProviderApiKind>(initialData?.api_kind ?? 'openai');
  const [apiKey, setApiKey] = useState(props.prefill?.apiKey ?? '');
  const [editingKey, setEditingKey] = useState(false);
  const initialWarmupMs = initialData?.stream_warmup_ms ?? null;
  const [warmupSeconds, setWarmupSeconds] = useState(() => warmupMsToSecondsInput(initialWarmupMs));
  const [rows, setRows] = useState<ModelRow[]>(() =>
    initialData ? toModelRows(initialData.models) : prefillRows(props.prefill),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => nameRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  // In edit mode an API-key provider manages its keys the way native providers
  // do: each key is a connection, added, renamed, replaced and removed on the
  // spot through ProviderKeyForm, independently of "Save changes". Local-style
  // providers (LM Studio, Ollama names) keep the single optional key field.
  const connectionsRef = useRef<RoutingProvider[] | undefined>(undefined);
  const connections = useResource(
    async () => {
      // A failed refresh after a key change keeps the list already on screen.
      try {
        return await getProviders(agentName);
      } catch (err) {
        if (connectionsRef.current) return connectionsRef.current;
        throw err;
      }
    },
    [agentName],
    { enabled: isEdit },
  );
  connectionsRef.current = connections.data;
  const loadedConnections = connections.error ? undefined : connections.data;
  const ownConnections = (loadedConnections ?? []).filter(
    (p) => p.provider === `custom:${initialData?.id}`,
  );
  const isLocalConnection = ownConnections.some((p) => p.auth_type === 'local');
  const showConnections = isEdit && ownConnections.length > 0 && !isLocalConnection;
  // Fall back to the single field whenever the connection list can't drive
  // the key section (fetch failed, or no row for this provider).
  const showKeyField =
    !isEdit ||
    isLocalConnection ||
    (!!connections.error && !connections.loading) ||
    (loadedConnections !== undefined && ownConnections.length === 0);
  const activeKeys = ownConnections
    .filter((p) => p.auth_type === 'api_key' && p.is_active && p.has_api_key)
    .sort((a, b) => a.priority - b.priority);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [keyEditing, setKeyEditing] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [addKeyOpen, setAddKeyOpen] = useState(false);
  const keysConnected = activeKeys.length > 0;
  const showAddKeyButton =
    keysConnected && activeKeys.length < MAX_KEYS_PER_PROVIDER && !addKeyOpen;
  const cpName = initialData?.name ?? '';
  const keyProviderDef: ProviderDef = {
    id: `custom:${initialData?.id}`,
    name: cpName,
    color: customProviderColor(cpName),
    initial: cpName.charAt(0).toUpperCase(),
    subtitle: '',
    models: [],
    keyPrefix: '',
    minKeyLength: 0,
    keyPlaceholder: 'sk-...',
  };
  const keyPrefix = activeKeys[0]?.key_prefix;
  const keyPrefixDisplay = () => (keyPrefix ? `${keyPrefix}${'•'.repeat(8)}` : '••••••••••••');

  const handleProbe = async () => {
    const url = baseUrl.trim();
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
      const typedKey = apiKey.trim() || undefined;
      const probeId = !typedKey && isEdit ? initialData?.id : undefined;
      const { models } = await probeCustomProvider(
        agentName,
        url,
        typedKey,
        apiKind,
        name.trim() || undefined,
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

  const validModels = rows.filter((r) => r.model_name.trim());
  const hasEstimatedPrices = rows.some((r) => r.price_estimated);

  const canSubmit = !!name.trim() && !!baseUrl.trim() && validModels.length > 0 && !busy;

  const buildModels = (): CustomProviderModel[] =>
    validModels.map((r) => {
      const contextWindow = parseContextWindow(r.context_window);
      return {
        model_name: r.model_name.trim(),
        ...(r.input_price !== ''
          ? { input_price_per_million_tokens: parsePrice(r.input_price) }
          : {}),
        ...(r.output_price !== ''
          ? { output_price_per_million_tokens: parsePrice(r.output_price) }
          : {}),
        ...(contextWindow !== null ? { context_window: contextWindow } : {}),
        ...(r.price_estimated && (r.input_price !== '' || r.output_price !== '')
          ? { price_estimated: true }
          : {}),
      };
    });

  const handleCreate = async () => {
    setError(null);
    setBusy(true);
    try {
      await createCustomProvider(agentName, {
        name: name.trim(),
        alias: normalizedAlias,
        base_url: baseUrl.trim(),
        api_kind: apiKind,
        apiKey: apiKey.trim() || undefined,
        models: buildModels(),
      });
      toast.success(t('providers.customForm.connectedToast', { name: name.trim() }));
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
      name: name.trim(),
      alias: normalizedAlias,
      base_url: baseUrl.trim(),
      models: buildModels(),
    };
    if (editingKey) {
      data.apiKey = apiKey.trim() || undefined;
    }
    const warmupMs = parseWarmupSeconds(warmupSeconds);
    if (warmupMs === undefined) {
      setError(streamWarmupError());
      return;
    }
    if (warmupMs !== initialWarmupMs) data.stream_warmup_ms = warmupMs;

    setBusy(true);
    try {
      await updateCustomProvider(agentName, initialData!.id, data as never);
      toast.success(t('providers.customForm.updatedToast', { name: name.trim() }));
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
      await deleteCustomProvider(agentName, initialData!.id);
      toast.success(t('providers.customForm.removedToast', { name: initialData!.name }));
      props.onDeleted?.();
    } catch {
      // error toast from fetchMutate
    } finally {
      setBusy(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleSubmit = () => {
    if (isEdit) void handleUpdate();
    else void handleCreate();
  };

  const formatOption = (kind: CustomProviderApiKind, title: string, path: string) => (
    <label
      className={cx(
        'flex flex-col gap-0.5 rounded-control border px-3 py-2',
        apiKind === kind ? 'border-accent bg-accent-tint' : 'border-line bg-elev',
        isEdit ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium text-ink">
        <input
          type="radio"
          name="cp-api-format"
          value={kind}
          checked={apiKind === kind}
          disabled={isEdit}
          onChange={() => setApiKind(kind)}
          className="accent-[var(--accent)]"
        />
        {title}
      </span>
      <span className="font-mono text-xs text-muted">{path}</span>
    </label>
  );

  return (
    <div className="flex flex-col">
      <button
        type="button"
        className="icon-btn modal-back-btn mb-2 self-start"
        onClick={props.onBack}
        aria-label={t('providers.customForm.backToProviders')}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>

      <div className="mb-5">
        <h2 className="text-base font-semibold text-ink">
          {isEdit ? t('providers.customForm.editTitle') : t('providers.customForm.addTitle')}
        </h2>
        <p className="mt-0.5 text-sm text-muted">{t('providers.customForm.subtitle')}</p>
      </div>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) handleSubmit();
        }}
      >
        <div>
          <label className="label" htmlFor="cp-name">
            {t('providers.customForm.providerName')}
          </label>
          <input
            ref={nameRef}
            id="cp-name"
            className="field"
            type="text"
            placeholder={t('providers.customForm.providerNamePlaceholder')}
            value={name}
            onChange={(e) => {
              const value = e.currentTarget.value;
              setName(value);
              if (!aliasTouched) setAlias(deriveCustomProviderAlias(value) ?? '');
              setError(null);
            }}
          />
        </div>

        <div>
          <label className="label" htmlFor="cp-alias">
            {t('providers.customForm.alias')}
          </label>
          <input
            id="cp-alias"
            className="field"
            type="text"
            placeholder={t('providers.customForm.aliasPlaceholder')}
            value={alias}
            onChange={(e) => {
              setAlias(e.currentTarget.value);
              setAliasTouched(true);
              setError(null);
            }}
          />
          <p className="hint" data-testid="cp-alias-hint">
            {t('providers.customForm.aliasHintBefore')}
            <code className="font-mono">{modelIdPreview}</code>
            {t('providers.customForm.aliasHintMiddle')}
            <code className="font-mono">/v1/models</code>
            {t('providers.customForm.aliasHintAfter')}
            {isEdit ? t('providers.customForm.aliasHintEdit') : null}
          </p>
        </div>

        <fieldset className="m-0 border-0 p-0" aria-describedby="cp-format-help" disabled={isEdit}>
          <legend className="label">{t('providers.customForm.apiFormat')}</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup">
            {/* i18n-ignore: API path */}
            {formatOption('openai', 'OpenAI', '/v1/chat/completions')}
            {/* i18n-ignore: API path */}
            {formatOption('anthropic', 'Anthropic', '/v1/messages')}
          </div>
          <p id="cp-format-help" className="hint">
            {isEdit
              ? t('providers.customForm.formatHelpEdit')
              : t('providers.customForm.formatHelpCreate')}
          </p>
        </fieldset>

        <div>
          <label className="label" htmlFor="cp-base-url">
            {t('providers.customForm.baseUrl')}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="cp-base-url"
              className="field"
              type="url"
              placeholder={BASE_URL_PLACEHOLDERS[apiKind]}
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.currentTarget.value);
                setError(null);
                setProbeError(null);
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => void handleProbe()}
              disabled={probeBusy || !baseUrl.trim()}
              aria-label={
                apiKind === 'anthropic'
                  ? t('providers.customForm.fetchModelsAnthropic')
                  : t('providers.customForm.fetchModelsOpenai')
              }
            >
              {probeBusy ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                t('providers.customForm.fetchModels')
              )}
            </Button>
          </div>
          <p className="hint">
            {t('providers.customForm.localHintBefore')}
            <code className="font-mono">http://host.docker.internal:&lt;port&gt;</code>
            {t('providers.customForm.localHintDocker')}{' '}
            <code className="font-mono">http://host.containers.internal:&lt;port&gt;</code>
            {t('providers.customForm.localHintPodman')}{' '}
            <code className="font-mono">http://localhost:&lt;port&gt;</code>
            {t('providers.customForm.localHintAfter')}
          </p>
          {probeError ? (
            <p className="mt-1 text-xs text-danger" role="alert">
              {probeError}
            </p>
          ) : null}
        </div>

        {isEdit ? (
          <div>
            <label className="label" htmlFor="cp-stream-warmup">
              {t('providers.customForm.streamWarmup')}{' '}
              <span className="font-normal text-muted">{t('providers.customForm.optional')}</span>
            </label>
            <input
              id="cp-stream-warmup"
              className="field"
              type="number"
              min={MIN_STREAM_WARMUP_SECONDS}
              max={MAX_STREAM_WARMUP_SECONDS}
              step="1"
              placeholder={t('providers.customForm.inherit')}
              value={warmupSeconds}
              onChange={(e) => {
                setWarmupSeconds(e.currentTarget.value);
                setError(null);
              }}
            />
            <p className="hint">{t('providers.customForm.warmupHint')}</p>
          </div>
        ) : null}

        {showKeyField ? (
          <div>
            <label className="label" htmlFor="cp-api-key">
              {t('providers.customForm.apiKey')}{' '}
              <span className="font-normal text-muted">
                {t('providers.customForm.apiKeyOptional')}
              </span>
            </label>
            {isEdit && !editingKey ? (
              <div className="flex items-center gap-2">
                <input
                  id="cp-api-key"
                  className="field font-mono"
                  type="text"
                  value={
                    initialData?.has_api_key ? '••••••••••••' : t('providers.customForm.noKeySet')
                  }
                  disabled
                  aria-label={t('providers.customForm.currentKeyAria')}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    setEditingKey(true);
                    setApiKey('');
                  }}
                >
                  {t('providers.customForm.change')}
                </Button>
              </div>
            ) : (
              <input
                id="cp-api-key"
                className="field provider-detail__input--masked font-mono"
                type="text"
                autoComplete="off"
                // i18n-ignore: key format sample
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.currentTarget.value)}
              />
            )}
          </div>
        ) : null}

        <div>
          <div id="cp-models-label" className="label flex items-center gap-1">
            {t('providers.customForm.models')}
            {hasEstimatedPrices ? (
              <InfoTooltip text={t('providers.customForm.estimatedPrice')} />
            ) : null}
          </div>
          <div className="flex flex-col gap-2" aria-labelledby="cp-models-label">
            <div
              className="hidden grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_28px] gap-2 text-xs text-muted sm:grid"
              aria-hidden="true"
            >
              <span>{t('providers.customForm.modelName')}</span>
              <span>{t('providers.customForm.inputPerM')}</span>
              <span>{t('providers.customForm.outputPerM')}</span>
              <span>{t('providers.customForm.contextWindow')}</span>
              <span />
            </div>
            {rows.map((row, i) => (
              <div
                key={i}
                className="grid grid-cols-[repeat(3,minmax(0,1fr))_28px] items-center gap-2 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_28px]"
              >
                <input
                  className="field col-span-3 sm:col-span-1"
                  type="text"
                  placeholder={t('providers.customForm.modelName')}
                  aria-label={t('providers.customForm.modelNameAria', { n: i + 1 })}
                  value={row.model_name}
                  onChange={(e) => updateRow(i, 'model_name', e.currentTarget.value)}
                />
                <input
                  className="field col-start-1 sm:col-start-auto"
                  type="text"
                  inputMode="decimal"
                  placeholder={t('providers.customForm.inputPlaceholder')}
                  aria-label={t('providers.customForm.inputAria', { n: i + 1 })}
                  value={row.input_price}
                  onChange={(e) => updateRow(i, 'input_price', e.currentTarget.value)}
                />
                <input
                  className="field"
                  type="text"
                  inputMode="decimal"
                  placeholder={t('providers.customForm.outputPlaceholder')}
                  aria-label={t('providers.customForm.outputAria', { n: i + 1 })}
                  value={row.output_price}
                  onChange={(e) => updateRow(i, 'output_price', e.currentTarget.value)}
                />
                <input
                  className="field"
                  type="text"
                  inputMode="numeric"
                  placeholder={t('providers.customForm.tokensPlaceholder')}
                  aria-label={t('providers.customForm.contextAria', { n: i + 1 })}
                  value={row.context_window}
                  onChange={(e) => updateRow(i, 'context_window', e.currentTarget.value)}
                />
                <button
                  type="button"
                  className="icon-btn row-start-1 col-start-4 sm:row-start-auto sm:col-start-auto"
                  onClick={() => removeRow(i)}
                  disabled={rows.length <= 1}
                  aria-label={t('providers.customForm.removeModelAria', { n: i + 1 })}
                  title={t('providers.customForm.remove')}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={addRow}
              disabled={!rows.at(-1)?.model_name.trim()}
            >
              {t('providers.customForm.addModel')}
            </Button>
          </div>
        </div>

        {error ? (
          <div className="form-error" role="alert">
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          {isEdit ? (
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() => setShowDeleteConfirm(true)}
            >
              {t('providers.customForm.deleteProvider')}
            </Button>
          ) : (
            <div />
          )}
          <Button
            type="submit"
            size="sm"
            className="provider-detail__action"
            busy={busy}
            disabled={!canSubmit}
          >
            {isEdit ? t('providers.customForm.saveChanges') : t('providers.customForm.connect')}
          </Button>
        </div>
      </form>

      {showConnections ? (
        <div className="mt-5 border-t border-line pt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs text-muted">{t('providers.customForm.keyPoolHint')}</span>
            {showAddKeyButton ? (
              <Button size="sm" className="shrink-0" onClick={() => setAddKeyOpen(true)}>
                <ListPlus size={14} aria-hidden="true" />
                {t('providers.customForm.addAnotherKey')}
              </Button>
            ) : null}
          </div>
          <ProviderKeyForm
            provDef={keyProviderDef}
            provId={`custom:${initialData!.id}`}
            agentName={agentName}
            isSubMode={false}
            connected={keysConnected}
            selectedAuthType="api_key"
            busy={keyBusy}
            setBusy={setKeyBusy}
            keyInput={keyInput}
            setKeyInput={setKeyInput}
            editing={keyEditing}
            setEditing={setKeyEditing}
            validationError={keyError}
            setValidationError={setKeyError}
            getKeyPrefixDisplay={keyPrefixDisplay}
            providers={loadedConnections ?? []}
            addKeyOpen={addKeyOpen}
            setAddKeyOpen={setAddKeyOpen}
            canDisconnect={false}
            onBack={() => {
              setKeyEditing(false);
              setKeyInput('');
            }}
            onUpdate={() => void connections.reload()}
          />
        </div>
      ) : null}

      <Modal
        open={showDeleteConfirm}
        title={t('providers.customForm.deleteProvider')}
        onClose={() => setShowDeleteConfirm(false)}
      >
        <p className="text-sm text-dim">
          {t('providers.customForm.deleteConfirmBefore')}{' '}
          <strong className="text-ink">{initialData?.name}</strong>
          {t('providers.customForm.deleteConfirmAfter')}
        </p>
        <div className="actions mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDeleteConfirm(false)}
            disabled={busy}
          >
            {t('providers.customForm.cancel')}
          </Button>
          <Button variant="danger" size="sm" onClick={() => void handleDelete()} busy={busy}>
            {t('providers.customForm.delete')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
