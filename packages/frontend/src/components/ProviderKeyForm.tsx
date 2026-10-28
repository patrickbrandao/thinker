import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ListPlus, Trash2 } from 'lucide-react';
import { MAX_KEYS_PER_PROVIDER as SHARED_MAX_KEYS_PER_PROVIDER } from 'thinker-shared';
import type { ProviderDef, SubscriptionEndpointRegion } from '../services/providers.js';
import { validateApiKey, validateSubscriptionKey } from '../services/provider-utils.js';
import {
  connectProvider,
  disconnectProvider,
  renameProviderKey,
  reorderProviderKeys,
  revokeOpenaiOAuth,
  type AuthType,
  type RoutingProvider,
} from '../services/api.js';
import {
  getRoutingProviderApiKeyUrl,
  getSubscriptionProviderKeyUrl,
} from '../services/provider-api-key-urls.js';
import { suggestNextProviderKeyLabel } from '../services/provider-key-labels.js';
import { toast } from '../services/toast-store.js';
import { t } from '../i18n/index.js';
import { Button, cx } from './ui.js';

export const MAX_KEYS_PER_PROVIDER = SHARED_MAX_KEYS_PER_PROVIDER;
const MAX_LABEL_LENGTH = 50;
const WORKSPACE_ID_PLACEHOLDER = '<workspace-id>';

/** A state setter; React's `useState` setters fit it. */
type SetValue<T> = (value: T) => void;

function baseUrlPlaceholderMatches(
  placeholder: string | undefined,
  baseUrl: string | null | undefined,
): boolean {
  if (!placeholder || !baseUrl) return false;
  try {
    const placeholderUrl = new URL(placeholder.replace(WORKSPACE_ID_PLACEHOLDER, 'workspace'));
    const baseUrlObject = new URL(baseUrl);
    const placeholderHostTail = placeholderUrl.hostname.split('.').slice(1).join('.');
    const baseUrlHostTail = baseUrlObject.hostname.split('.').slice(1).join('.');

    return !!placeholderHostTail && placeholderHostTail === baseUrlHostTail;
  } catch {
    return false;
  }
}

export interface ProviderKeyFormProps {
  provDef: ProviderDef;
  provId: string;
  agentName: string;
  isSubMode: boolean;
  connected: boolean;
  selectedAuthType: AuthType;
  busy: boolean;
  setBusy: SetValue<boolean>;
  keyInput: string;
  setKeyInput: SetValue<string>;
  editing: boolean;
  setEditing: SetValue<boolean>;
  validationError: string | null;
  setValidationError: SetValue<string | null>;
  getKeyPrefixDisplay: (authType: AuthType) => string;
  /**
   * Full set of providers from the modal — used to derive the active key
   * chain for the current `(provId, selectedAuthType)` tuple. Optional for
   * back-compat with callers that haven't been updated yet (in which case
   * the form falls back to legacy single-key UX).
   */
  providers?: RoutingProvider[];
  addKeyOpen?: boolean;
  setAddKeyOpen?: SetValue<boolean>;
  /**
   * False hides the single-key "Disconnect provider" action. A custom
   * provider is removed with its definition, never by dropping its last key.
   */
  canDisconnect?: boolean;
  onBack: () => void;
  onUpdate: () => void;
}

/** Link to the provider page where the user creates the credential. */
function KeyHelpLink({ url, owner, noun }: { url?: string; owner: string; noun: string }) {
  if (!url) return null;
  return (
    <p className="hint">
      <a
        className="provider-detail__key-help-link link-action"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {t('providerSetup.keyForm.getCredential', { owner, noun })}
      </a>
    </p>
  );
}

function TrashIcon() {
  return <Trash2 size={16} aria-hidden="true" />;
}

const ProviderKeyForm = (props: ProviderKeyFormProps) => {
  const { provDef, provId, isSubMode, connected, selectedAuthType } = props;
  const isPopupOAuth = provDef.subscriptionAuthMode === 'popup_oauth';
  const shouldRevokeOpenaiOAuth =
    provId === 'openai' && isPopupOAuth && selectedAuthType === 'subscription';
  const isApiKeyCredential = !isSubMode || provDef.subscriptionCredentialKind === 'api-key';
  const credentialNoun = isApiKeyCredential
    ? t('providerSetup.keyForm.nounApiKey')
    : t('providerSetup.keyForm.nounSetupToken');
  const credentialOwnerName =
    isSubMode && provDef.subscriptionCredentialName
      ? provDef.subscriptionCredentialName
      : provDef.name;
  const inputAriaLabel = t('providerSetup.keyForm.credential', {
    owner: credentialOwnerName,
    noun: credentialNoun,
  });
  const editAriaLabel = t('providerSetup.keyForm.newCredential', {
    owner: credentialOwnerName,
    noun: credentialNoun,
  });
  const placeholder = isSubMode
    ? (provDef.subscriptionKeyPlaceholder ?? t('providerSetup.keyForm.pasteToken'))
    : provDef.keyPlaceholder;
  const endpointRegions: SubscriptionEndpointRegion[] = useMemo(
    () =>
      isSubMode
        ? (provDef.subscriptionEndpointRegions ?? [])
        : (provDef.apiKeyEndpointRegions ?? []),
    [isSubMode, provDef.subscriptionEndpointRegions, provDef.apiKeyEndpointRegions],
  );
  const hasEndpointRegions = endpointRegions.length > 0;
  const defaultEndpointRegion = endpointRegions[0]?.value;
  const customEndpointOptions = endpointRegions.filter((region) => !!region.baseUrlPlaceholder);
  const customEndpointOption =
    customEndpointOptions.find((region) => region.value === 'custom') ?? customEndpointOptions[0];
  const customEndpointOptionForValue = (value: string | null | undefined) =>
    customEndpointOptions.find((region) =>
      baseUrlPlaceholderMatches(region.baseUrlPlaceholder, value),
    ) ?? customEndpointOption;
  const endpointRegionLabel = (value: string | null | undefined) =>
    endpointRegions.find((region) => region.value === value)?.label ??
    (value ? customEndpointOptionForValue(value)?.label : undefined);
  const whereToGetUrl = isSubMode
    ? getSubscriptionProviderKeyUrl(provId)
    : getRoutingProviderApiKeyUrl(provId);

  // Multi-key chains are supported for api_key and subscription. Local
  // providers (Ollama / LM Studio) don't carry credentials, so they stay
  // on the single-row surface.
  const supportsMultiKey = selectedAuthType !== 'local';

  const activeKeys = useMemo<RoutingProvider[]>(() => {
    if (!props.providers) return [];
    return props.providers
      .filter(
        (p) =>
          p.provider === provId && p.auth_type === selectedAuthType && p.is_active && p.has_api_key,
      )
      .slice()
      .sort((a, b) => a.priority - b.priority);
  }, [props.providers, provId, selectedAuthType]);

  const isListMode = supportsMultiKey && activeKeys.length > 1;
  const savedEndpointRegion = activeKeys[0]?.region;
  const hasActiveKeys = activeKeys.length > 0;
  const [selectedEndpointRegion, setSelectedEndpointRegion] = useState<string | undefined>();
  const [customEndpointUrl, setCustomEndpointUrl] = useState('');

  // Re-seed the region when the regions, the connection or the saved key
  // change. A user's pick while connected stays until one of those moves.
  const regionsKey = endpointRegions
    .map((region) => `${region.value}\u0000${region.baseUrlPlaceholder ?? ''}`)
    .join('\u0001');
  useEffect(() => {
    if (!hasEndpointRegions) {
      setSelectedEndpointRegion(undefined);
      setCustomEndpointUrl('');
      return;
    }
    if (connected) {
      if (hasActiveKeys) {
        const saved = savedEndpointRegion;
        const customOption = saved ? customEndpointOptionForValue(saved) : customEndpointOption;
        if (saved && !endpointRegions.some((region) => region.value === saved) && customOption) {
          setSelectedEndpointRegion(customOption.value);
          setCustomEndpointUrl(saved);
        } else {
          setSelectedEndpointRegion(saved ?? defaultEndpointRegion);
          if (saved !== customOption?.value) setCustomEndpointUrl('');
        }
      } else {
        setSelectedEndpointRegion(undefined);
        setCustomEndpointUrl('');
      }
      return;
    }
    setSelectedEndpointRegion((selected) =>
      selected && endpointRegions.some((region) => region.value === selected)
        ? selected
        : defaultEndpointRegion,
    );
    // The regions are tracked through `regionsKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionsKey, connected, hasActiveKeys, savedEndpointRegion]);

  const displayedEndpointRegion = selectedEndpointRegion ?? defaultEndpointRegion;
  const selectedEndpointRegionOption = endpointRegions.find(
    (region) => region.value === displayedEndpointRegion,
  );
  const isCustomEndpointSelected = !!selectedEndpointRegionOption?.baseUrlPlaceholder;
  const endpointRegionPayload = (() => {
    if (!hasEndpointRegions) return undefined;
    if (isCustomEndpointSelected) return customEndpointUrl.trim() || undefined;
    if (selectedEndpointRegion) return selectedEndpointRegion;
    return connected ? undefined : defaultEndpointRegion;
  })();
  const validateEndpointRegion = () => {
    if (isCustomEndpointSelected && !customEndpointUrl.trim()) {
      props.setValidationError(t('providerSetup.shared.baseUrlRequired'));
      return false;
    }
    return true;
  };

  const renderEndpointRegionSelect = (id: string, disabled?: boolean) => {
    if (!hasEndpointRegions) return null;
    const baseUrlPlaceholder = selectedEndpointRegionOption?.baseUrlPlaceholder;
    return (
      <div className="mb-4">
        <label className="label provider-detail__label" htmlFor={id}>
          {t('providerSetup.shared.region')}
        </label>
        <select
          id={id}
          className="field"
          value={displayedEndpointRegion}
          disabled={disabled}
          onChange={(e) => setSelectedEndpointRegion(e.currentTarget.value)}
        >
          {endpointRegions.map((region) => (
            <option key={region.value} value={region.value}>
              {region.label}
            </option>
          ))}
        </select>
        {baseUrlPlaceholder ? (
          <>
            <label className="label provider-detail__label mt-2" htmlFor={`${id}-base-url`}>
              {t('providerSetup.shared.baseUrl')}
            </label>
            <input
              id={`${id}-base-url`}
              className="field"
              aria-invalid={
                props.validationError === t('providerSetup.shared.baseUrlRequired') || undefined
              }
              type="url"
              autoComplete="off"
              placeholder={baseUrlPlaceholder}
              value={customEndpointUrl}
              disabled={disabled}
              onChange={(e) => {
                setCustomEndpointUrl(e.currentTarget.value);
                props.setValidationError(null);
              }}
            />
          </>
        ) : null}
      </div>
    );
  };

  const fieldLabel = isListMode
    ? t('providerSetup.keyForm.apiKeys')
    : isApiKeyCredential
      ? t('providerSetup.keyForm.apiKey')
      : t('providerSetup.keyForm.setupToken');

  const validateKey = (value: string) =>
    isSubMode ? validateSubscriptionKey(provDef, value) : validateApiKey(provDef, value);

  const handleConnect = async (label?: string) => {
    if (!validateEndpointRegion()) return;
    const result = validateKey(props.keyInput);
    if (!result.valid) {
      props.setValidationError(result.error!);
      return;
    }

    props.setBusy(true);
    try {
      await connectProvider(props.agentName, {
        provider: provId,
        apiKey: props.keyInput.replace(/\s/g, ''),
        authType: selectedAuthType,
        ...(endpointRegionPayload && { region: endpointRegionPayload }),
        ...(label && { label }),
      });
      toast.success(t('providerSetup.shared.connected', { name: provDef.name }));
      props.onBack();
      props.onUpdate();
    } catch {
      // error toast from fetchMutate
    } finally {
      props.setBusy(false);
    }
  };

  const handleUpdateKey = async (label?: string) => {
    if (!validateEndpointRegion()) return;
    const result = validateKey(props.keyInput);
    if (!result.valid) {
      props.setValidationError(result.error!);
      return;
    }

    // Without an explicit label the backend's legacy path writes to the row
    // labeled 'Default' — wrong target whenever the visible key is named
    // anything else. Pin the update to the key this view is showing.
    const targetLabel = label ?? activeKeys[0]?.label;
    props.setBusy(true);
    try {
      await connectProvider(props.agentName, {
        provider: provId,
        apiKey: props.keyInput.replace(/\s/g, ''),
        authType: selectedAuthType,
        ...(endpointRegionPayload && { region: endpointRegionPayload }),
        ...(targetLabel && { label: targetLabel }),
      });
      toast.success(
        isSubMode && !isApiKeyCredential
          ? t('providerSetup.keyForm.tokenUpdated', { name: provDef.name })
          : t('providerSetup.keyForm.keyUpdated', { name: provDef.name }),
      );
      props.onBack();
      props.onUpdate();
    } catch {
      // error toast from fetchMutate
    } finally {
      props.setBusy(false);
    }
  };

  const handleDisconnect = async (label?: string) => {
    props.setBusy(true);
    try {
      // OpenAI subscription OAuth needs an explicit revoke call. Skip for
      // labeled deletes inside list mode (those are api_key keys, never the
      // OAuth subscription token).
      if (!label && shouldRevokeOpenaiOAuth) {
        await revokeOpenaiOAuth(props.agentName).catch(() => {});
      }
      const result = await disconnectProvider(props.agentName, provId, selectedAuthType, label);
      if (result?.notifications?.length) {
        for (const msg of result.notifications) {
          toast.error(msg);
        }
      }
      // For labeled deletes, stay on the modal so the user can keep editing
      // the remaining chain. For full disconnects, return to the list.
      if (!label) props.onBack();
      props.onUpdate();
    } catch {
      // error toast from fetchMutate
    } finally {
      props.setBusy(false);
    }
  };

  // Subscription-mode providers (Anthropic Pro, ChatGPT Plus, etc.) often
  // validate paste tokens with a different prefix/format than their api_key
  // counterparts. Branch the validator so the chain-add flow doesn't reject
  // a valid setup token using the api-key rules.
  const handleAddKey = async (label: string, apiKey: string, region?: string) => {
    const result = validateKey(apiKey);
    if (!result.valid) {
      toast.error(result.error!);
      return false;
    }
    props.setBusy(true);
    try {
      await connectProvider(props.agentName, {
        provider: provId,
        apiKey: apiKey.replace(/\s/g, ''),
        authType: selectedAuthType,
        label,
        ...(region && { region }),
      });
      toast.success(t('providerSetup.keyForm.keyAdded', { name: provDef.name, label }));
      props.onUpdate();
      return true;
    } catch {
      return false;
    } finally {
      props.setBusy(false);
    }
  };

  const connectInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (connectInputRef.current && !connected) connectInputRef.current.focus();
    // Focus once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const keyError = props.validationError ? (
    <p className="mt-1 text-xs text-danger">{props.validationError}</p>
  ) : null;
  const helpLink = (
    <KeyHelpLink url={whereToGetUrl} owner={credentialOwnerName} noun={credentialNoun} />
  );
  const addPlaceholder = placeholder ?? t('providerSetup.keyForm.pasteApiKey');

  /* Not yet connected — first key */
  if (!connected) {
    return (
      <>
        {renderEndpointRegionSelect(`${provId}-subscription-endpoint`)}
        <div className="mb-4">
          <label className="label provider-detail__label">{fieldLabel}</label>
          <input
            ref={connectInputRef}
            className="field provider-detail__input--masked font-mono"
            aria-invalid={!!props.validationError || undefined}
            type="text"
            autoComplete="off"
            placeholder={placeholder}
            aria-label={inputAriaLabel}
            value={props.keyInput}
            onChange={(e) => {
              props.setKeyInput(e.currentTarget.value);
              props.setValidationError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleConnect();
            }}
          />
          {keyError}
          {helpLink}
        </div>
        <Button
          block
          className="provider-detail__action"
          busy={props.busy}
          disabled={!props.keyInput.trim()}
          onClick={() => void handleConnect()}
        >
          {t('providerSetup.shared.connect')}
        </Button>
      </>
    );
  }

  /* Connected — list mode (multi-key) */
  if (isListMode) {
    return (
      <KeyChainView
        provDef={provDef}
        provId={provId}
        agentName={props.agentName}
        authType={selectedAuthType}
        activeKeys={activeKeys}
        busy={props.busy}
        setBusy={props.setBusy}
        placeholder={addPlaceholder}
        credentialNoun={credentialNoun}
        credentialOwnerName={credentialOwnerName}
        whereToGetUrl={whereToGetUrl}
        addKeyOpen={props.addKeyOpen}
        setAddKeyOpen={props.setAddKeyOpen}
        endpointRegions={endpointRegions}
        endpointRegionLabel={endpointRegionLabel}
        onUpdate={props.onUpdate}
        onDelete={(label) => void handleDisconnect(label)}
      />
    );
  }

  /* Connected — single key */
  return (
    <div className="mb-4">
      <label className="label provider-detail__label">{fieldLabel}</label>
      {!props.editing ? (
        <>
          <div className="flex items-center gap-2">
            <input
              className="field font-mono"
              type="text"
              value={props.getKeyPrefixDisplay(selectedAuthType)}
              disabled
              aria-label={
                isApiKeyCredential
                  ? t('providerSetup.keyForm.currentKeyMasked')
                  : t('providerSetup.keyForm.currentTokenMasked')
              }
            />
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => {
                props.setEditing(true);
                props.setKeyInput('');
                props.setValidationError(null);
              }}
            >
              {t('providerSetup.keyForm.change')}
            </Button>
            {props.canDisconnect !== false ? (
              <button
                type="button"
                className="icon-btn provider-detail__disconnect-icon shrink-0 text-danger"
                disabled={props.busy}
                onClick={() => void handleDisconnect()}
                aria-label={t('providerSetup.keyForm.disconnectProvider')}
                title={t('providerSetup.shared.disconnect')}
              >
                {props.busy ? <span className="spinner" aria-hidden="true" /> : <TrashIcon />}
              </button>
            ) : null}
          </div>
          {supportsMultiKey && activeKeys.length < MAX_KEYS_PER_PROVIDER ? (
            <AddAnotherKeyAction
              onAdd={handleAddKey}
              busy={props.busy}
              setBusy={props.setBusy}
              provDef={provDef}
              placeholder={addPlaceholder}
              whereToGetUrl={whereToGetUrl}
              credentialNoun={credentialNoun}
              credentialOwnerName={credentialOwnerName}
              existingLabels={activeKeys.map((k) => k.label ?? '')}
              open={props.addKeyOpen}
              setOpen={props.setAddKeyOpen}
              isSubscription={isSubMode}
              endpointRegions={endpointRegions}
              initialEndpointRegion={displayedEndpointRegion}
            />
          ) : null}
        </>
      ) : (
        <>
          {renderEndpointRegionSelect(`${provId}-subscription-endpoint-edit`)}
          <input
            className="field provider-detail__input--masked font-mono"
            aria-invalid={!!props.validationError || undefined}
            type="text"
            autoComplete="off"
            placeholder={placeholder}
            aria-label={editAriaLabel}
            value={props.keyInput}
            onChange={(e) => {
              props.setKeyInput(e.currentTarget.value);
              props.setValidationError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleUpdateKey();
            }}
          />
          {keyError}
          {helpLink}
          <Button
            block
            className="provider-detail__action mt-3"
            disabled={props.busy || !props.keyInput.trim()}
            onClick={() => void handleUpdateKey()}
          >
            {t('common.save')}
          </Button>
        </>
      )}
    </div>
  );
};

/** @internal Exported for testing only. */
export interface AddAnotherKeyActionProps {
  onAdd: (label: string, apiKey: string, region?: string) => Promise<boolean>;
  busy: boolean;
  setBusy: SetValue<boolean>;
  provDef: ProviderDef;
  placeholder: string;
  whereToGetUrl?: string;
  credentialNoun: string;
  credentialOwnerName: string;
  existingLabels: string[];
  /** When set, the parent controls whether the form is open (no toggle link). */
  open?: boolean;
  setOpen?: SetValue<boolean>;
  isSubscription?: boolean;
  endpointRegions?: SubscriptionEndpointRegion[];
  initialEndpointRegion?: string;
}

/** @internal Exported for testing only. */
export function AddAnotherKeyAction(props: AddAnotherKeyActionProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const isOpen = props.open ?? localOpen;
  const setIsOpen = (v: boolean) => {
    (props.setOpen ?? setLocalOpen)(v);
  };
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [endpointRegion, setEndpointRegion] = useState<string | undefined>(
    props.initialEndpointRegion ?? props.endpointRegions?.[0]?.value,
  );
  const [customEndpointUrl, setCustomEndpointUrl] = useState('');
  const apiKeyInputRef = useRef<HTMLInputElement>(null);
  const prevOpen = useRef<boolean | undefined>(undefined);

  // Lazy, like the Solid accessor: only computed once the form opens.
  const defaultLabel = () => suggestNextProviderKeyLabel(props.existingLabels.filter(Boolean));
  const selectedEndpointRegionOption = props.endpointRegions?.find(
    (region) => region.value === endpointRegion,
  );
  const customEndpointPayload = !selectedEndpointRegionOption?.baseUrlPlaceholder
    ? endpointRegion
    : customEndpointUrl.trim() || undefined;

  // Sync the label suggestion and region when opened (also from outside) and
  // focus the key field. Runs on open changes only, so typing never steals focus.
  useEffect(() => {
    const wasOpen = prevOpen.current;
    prevOpen.current = isOpen;
    if (isOpen && !label.trim()) {
      setLabel(defaultLabel());
    }
    const defaultEndpointRegion = props.endpointRegions?.[0]?.value;
    if (isOpen && defaultEndpointRegion && !endpointRegion) {
      setEndpointRegion(props.initialEndpointRegion ?? defaultEndpointRegion);
    }
    if (isOpen && !wasOpen) {
      requestAnimationFrame(() => apiKeyInputRef.current?.focus());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const submit = async () => {
    if (selectedEndpointRegionOption?.baseUrlPlaceholder && !customEndpointUrl.trim()) {
      toast.error(t('providerSetup.shared.baseUrlRequired'));
      return;
    }
    const labelToUse = (label.trim() || defaultLabel()).slice(0, MAX_LABEL_LENGTH);
    const ok = await props.onAdd(labelToUse, apiKey.trim(), customEndpointPayload);
    if (ok) {
      setIsOpen(false);
      setLabel('');
      setApiKey('');
      setCustomEndpointUrl('');
    }
  };

  if (!isOpen) {
    if (props.open !== undefined) return null;
    return (
      <button
        type="button"
        className="link-action mt-3 inline-flex items-center gap-1 text-sm text-muted"
        onClick={() => {
          setLabel(defaultLabel());
          setIsOpen(true);
        }}
      >
        <ListPlus size={14} aria-hidden="true" />{' '}
        {props.isSubscription
          ? t('providerSetup.shared.addConnection')
          : t('providerSetup.shared.addAnotherKey')}
      </button>
    );
  }

  const baseUrlPlaceholder = selectedEndpointRegionOption?.baseUrlPlaceholder;
  return (
    <div className="well mt-3 flex flex-col">
      <label className="label" htmlFor="add-key-label">
        {t('providerSetup.keyForm.name')}
      </label>
      <input
        id="add-key-label"
        className="field"
        type="text"
        maxLength={MAX_LABEL_LENGTH}
        aria-label={t('providerSetup.keyForm.keyName')}
        value={label}
        placeholder={defaultLabel()}
        onChange={(e) => setLabel(e.currentTarget.value)}
      />
      {props.endpointRegions?.length ? (
        <>
          <label className="label mt-2" htmlFor="add-key-endpoint">
            {t('providerSetup.shared.region')}
          </label>
          <select
            id="add-key-endpoint"
            className="field"
            value={endpointRegion}
            disabled={props.busy}
            onChange={(e) => setEndpointRegion(e.currentTarget.value)}
          >
            {props.endpointRegions.map((region) => (
              <option key={region.value} value={region.value}>
                {region.label}
              </option>
            ))}
          </select>
          {baseUrlPlaceholder ? (
            <>
              <label className="label mt-2" htmlFor="add-key-base-url">
                {t('providerSetup.shared.baseUrl')}
              </label>
              <input
                id="add-key-base-url"
                className="field"
                type="url"
                autoComplete="off"
                placeholder={baseUrlPlaceholder}
                value={customEndpointUrl}
                disabled={props.busy}
                onChange={(e) => setCustomEndpointUrl(e.currentTarget.value)}
              />
            </>
          ) : null}
        </>
      ) : null}
      <label className="label mt-2" htmlFor="add-key-value">
        {t('providerSetup.keyForm.credential', {
          owner: props.credentialOwnerName,
          noun: props.credentialNoun,
        })}
      </label>
      <input
        ref={apiKeyInputRef}
        id="add-key-value"
        className="field provider-detail__input--masked font-mono"
        type="text"
        autoComplete="off"
        aria-label={t('providerSetup.keyForm.newCredential', {
          owner: props.credentialOwnerName,
          noun: props.credentialNoun,
        })}
        placeholder={props.placeholder}
        value={apiKey}
        onChange={(e) => setApiKey(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
      />
      <KeyHelpLink
        url={props.whereToGetUrl}
        owner={props.credentialOwnerName}
        noun={props.credentialNoun}
      />
      <div className="mt-3 flex justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)} disabled={props.busy}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" busy={props.busy} disabled={!apiKey.trim()} onClick={() => void submit()}>
          {t('providerSetup.keyForm.addKey')}
        </Button>
      </div>
    </div>
  );
}

interface KeyChainViewProps {
  provDef: ProviderDef;
  provId: string;
  agentName: string;
  authType: AuthType;
  activeKeys: RoutingProvider[];
  busy: boolean;
  setBusy: SetValue<boolean>;
  placeholder: string;
  credentialNoun: string;
  credentialOwnerName: string;
  whereToGetUrl?: string;
  addKeyOpen?: boolean;
  setAddKeyOpen?: SetValue<boolean>;
  endpointRegions: SubscriptionEndpointRegion[];
  endpointRegionLabel: (value: string | null | undefined) => string | undefined;
  onUpdate: () => void;
  onDelete: (label: string) => void;
}

function KeyChainView(props: KeyChainViewProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const startRename = (k: RoutingProvider) => {
    setRenamingId(k.id);
    setRenameValue(k.label);
  };

  const commitRename = async (k: RoutingProvider) => {
    const newLabel = renameValue.trim();
    if (!newLabel || newLabel === k.label) {
      setRenamingId(null);
      return;
    }
    props.setBusy(true);
    try {
      await renameProviderKey(props.agentName, props.provId, k.label, newLabel, props.authType);
      toast.success(t('providerSetup.shared.renamedTo', { label: newLabel }));
      setRenamingId(null);
      props.onUpdate();
    } catch {
      // toast handled upstream
    } finally {
      props.setBusy(false);
    }
  };

  // Order is the default key first, then the order a custom provider's key
  // pool falls over in. Swaps one key with its neighbour.
  const moveKey = async (index: number, delta: -1 | 1) => {
    const labels = props.activeKeys.map((k) => k.label);
    const target = index + delta;
    if (target < 0 || target >= labels.length) return;
    labels.splice(target, 0, ...labels.splice(index, 1));
    props.setBusy(true);
    try {
      await reorderProviderKeys(props.agentName, props.provId, labels, props.authType);
      props.onUpdate();
    } catch {
      // toast handled upstream
    } finally {
      props.setBusy(false);
    }
  };

  // Subscription chains paste setup tokens, which validate differently from
  // api keys. Pick the right validator based on the chain's auth_type.
  const addKey = async (label: string, apiKey: string, region?: string) => {
    const result =
      props.authType === 'subscription'
        ? validateSubscriptionKey(props.provDef, apiKey)
        : validateApiKey(props.provDef, apiKey);
    if (!result.valid) {
      toast.error(result.error!);
      return false;
    }
    props.setBusy(true);
    try {
      await connectProvider(props.agentName, {
        provider: props.provId,
        apiKey: apiKey.replace(/\s/g, ''),
        authType: props.authType,
        label,
        ...(region && { region }),
      });
      toast.success(t('providerSetup.keyForm.keyAdded', { name: props.provDef.name, label }));
      props.onUpdate();
      return true;
    } catch {
      return false;
    } finally {
      props.setBusy(false);
    }
  };

  const last = props.activeKeys.length - 1;
  return (
    <div className="mb-4">
      <label className="label provider-detail__label">{t('providerSetup.keyForm.apiKeys')}</label>
      <ul
        role="list"
        aria-label={t('providerSetup.keyForm.apiKeysFor', { name: props.provDef.name })}
        className="m-0 flex list-none flex-col gap-2 p-0"
      >
        {props.activeKeys.map((k, i) => (
          <li
            key={k.id}
            className="flex items-center gap-2 rounded-control border border-line bg-sunken px-2.5 py-2"
          >
            {renamingId === k.id ? (
              <>
                <input
                  className="field min-w-0 flex-1"
                  type="text"
                  maxLength={MAX_LABEL_LENGTH}
                  aria-label={t('providerSetup.shared.renameNamed', { label: k.label })}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitRename(k);
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                />
                <Button size="sm" disabled={props.busy} onClick={() => void commitRename(k)}>
                  {t('common.save')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={props.busy}
                  onClick={() => setRenamingId(null)}
                >
                  {t('common.cancel')}
                </Button>
              </>
            ) : (
              <>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{k.label}</div>
                  <div className="truncate font-mono text-xs text-muted">
                    {[
                      k.key_prefix ? `${k.key_prefix}${'•'.repeat(12)}` : '••••••••••••',
                      props.endpointRegionLabel(k.region),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <button
                  type="button"
                  className={cx('icon-btn', 'shrink-0')}
                  disabled={props.busy || i === 0}
                  onClick={() => void moveKey(i, -1)}
                  aria-label={t('providerSetup.keyForm.moveUp', { label: k.label })}
                  title={t('providerSetup.keyForm.moveUpTitle')}
                >
                  <ArrowUp size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-btn shrink-0"
                  disabled={props.busy || i === last}
                  onClick={() => void moveKey(i, 1)}
                  aria-label={t('providerSetup.keyForm.moveDown', { label: k.label })}
                  title={t('providerSetup.keyForm.moveDownTitle')}
                >
                  <ArrowDown size={14} aria-hidden="true" />
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  disabled={props.busy}
                  onClick={() => startRename(k)}
                >
                  {t('providerSetup.shared.rename')}
                </Button>
                <button
                  type="button"
                  className="icon-btn provider-detail__disconnect-icon shrink-0 text-danger"
                  disabled={props.busy}
                  onClick={() => props.onDelete(k.label)}
                  aria-label={t('providerSetup.keyForm.deleteKey', { label: k.label })}
                  title={t('providerSetup.keyForm.deleteKeyTitle')}
                >
                  <TrashIcon />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {props.activeKeys.length < MAX_KEYS_PER_PROVIDER ? (
        <AddAnotherKeyAction
          onAdd={addKey}
          busy={props.busy}
          setBusy={props.setBusy}
          provDef={props.provDef}
          placeholder={props.placeholder}
          whereToGetUrl={props.whereToGetUrl}
          credentialNoun={props.credentialNoun}
          credentialOwnerName={props.credentialOwnerName}
          existingLabels={props.activeKeys.map((k) => k.label ?? '')}
          open={props.addKeyOpen}
          setOpen={props.setAddKeyOpen}
          isSubscription={props.authType === 'subscription'}
          endpointRegions={props.endpointRegions}
          initialEndpointRegion={props.activeKeys[0]?.region ?? props.endpointRegions[0]?.value}
        />
      ) : null}
    </div>
  );
}

export default ProviderKeyForm;
