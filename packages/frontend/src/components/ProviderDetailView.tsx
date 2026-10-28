import { useEffect, useState } from 'react';
import { ChevronLeft, ExternalLink, ListPlus, RefreshCw } from 'lucide-react';
import { PROVIDERS } from '../services/providers.js';
import { providerIcon } from './ProviderIcon.js';
import {
  connectProvider,
  disconnectProvider,
  refreshProviderModels,
  type RoutingProvider,
  type AuthType,
} from '../services/api.js';
import { toast } from '../services/toast-store.js';
import { t } from '../i18n/index.js';
import { formatTimeAgo } from '../services/formatters.js';
import CopyButton from './CopyButton.js';
import ProviderKeyForm, { MAX_KEYS_PER_PROVIDER } from './ProviderKeyForm.js';
import OAuthDetailView from './OAuthDetailView.js';
import AnthropicOAuthDetailView from './AnthropicOAuthDetailView.js';
import DeviceCodeDetailView from './DeviceCodeDetailView.js';
import { getRoutingProviderApiKeyUrl } from '../services/provider-api-key-urls.js';
import { Badge, Button, cx } from './ui.js';

type SetValue<T> = (value: T) => void;

export interface ProviderDetailViewProps {
  provId: string;
  agentName: string;
  providers: RoutingProvider[];
  selectedAuthType: AuthType;
  busy: boolean;
  setBusy: SetValue<boolean>;
  keyInput: string;
  setKeyInput: SetValue<string>;
  editing: boolean;
  setEditing: SetValue<boolean>;
  validationError: string | null;
  setValidationError: SetValue<string | null>;
  onBack: () => void;
  onUpdate: () => void | Promise<void>;
  onPollProviders?: () => void | Promise<void>;
  onClose: () => void;
  initialAddKey?: boolean;
}

const Spinner = () => <span className="spinner" aria-hidden="true" />;

export default function ProviderDetailView(props: ProviderDetailViewProps) {
  const provDef = PROVIDERS.find((p) => p.id === props.provId)!;
  const authType = props.selectedAuthType;
  const busy = props.busy;

  const getProviderByAuth = (at: AuthType) =>
    props.providers.find((p) => p.provider === props.provId && p.auth_type === at);

  const apiKeyRow = getProviderByAuth('api_key');
  const subRow = getProviderByAuth('subscription');
  const isConnectedApiKey = !!apiKeyRow && apiKeyRow.is_active && apiKeyRow.has_api_key;
  const isSubscriptionConnected = !!subRow && subRow.is_active;
  const isSubscriptionWithToken = !!subRow && subRow.is_active && subRow.has_api_key;
  const isNoKeyConnected = !!apiKeyRow && apiKeyRow.is_active && !!provDef.noKeyRequired;

  const getKeyPrefixDisplay = (at: AuthType): string => {
    const p = getProviderByAuth(at);
    if (p?.key_prefix) return `${p.key_prefix}${'•'.repeat(8)}`;
    return '••••••••••••';
  };

  const isSubMode = authType === 'subscription';
  const subscriptionAuthMode =
    provDef.subscriptionAuthMode ?? (provDef.subscriptionKeyPlaceholder ? 'token' : undefined);
  const isPopupOAuthFlow = isSubMode && subscriptionAuthMode === 'popup_oauth';
  const isPopupPasteFlow = isSubMode && subscriptionAuthMode === 'popup_paste';
  const isDeviceCodeFlow = isSubMode && subscriptionAuthMode === 'device_code';
  const isCommandOnly =
    isSubMode &&
    !!provDef.subscriptionCommand &&
    !provDef.subscriptionKeyPlaceholder &&
    !subscriptionAuthMode;
  const connected = isSubMode
    ? isCommandOnly
      ? isSubscriptionConnected
      : subscriptionAuthMode === 'token'
        ? isSubscriptionWithToken
        : isSubscriptionConnected
    : isConnectedApiKey || isNoKeyConnected;
  const isOllama = !!provDef.noKeyRequired;

  const [addKeyOpen, setAddKeyOpen] = useState(false);

  useEffect(() => {
    if (props.initialAddKey) setAddKeyOpen(true);
  }, [props.initialAddKey]);

  const supportsMultiKey = authType !== 'local';

  const activeKeys = props.providers.filter(
    (p) => p.provider === props.provId && p.auth_type === authType && p.is_active && p.has_api_key,
  );

  // Closed providers keep existing connections manageable but take no new ones.
  const subscriptionClosed = isSubMode && !!provDef.subscriptionClosedNote;
  const showConnectFlow = !subscriptionClosed || connected;

  const showAddKeyButton =
    connected &&
    !subscriptionClosed &&
    supportsMultiKey &&
    activeKeys.length < MAX_KEYS_PER_PROVIDER &&
    !addKeyOpen;

  const handleOllamaConnect = async () => {
    props.setBusy(true);
    try {
      await connectProvider(props.agentName, {
        provider: props.provId,
        authType: authType,
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

  const [refreshing, setRefreshing] = useState(false);
  const [refreshedModelCount, setRefreshedModelCount] = useState<number | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const activeProviderRow = getProviderByAuth(authType);
  const modelCount = refreshedModelCount ?? activeProviderRow?.cached_model_count ?? 0;
  const lastFetchedAgo = formatTimeAgo(refreshedAt ?? activeProviderRow?.models_fetched_at ?? null);

  const handleRefreshModels = async () => {
    setRefreshing(true);
    let refreshed = false;
    try {
      const result = await refreshProviderModels(props.agentName, props.provId, authType);
      if (result.ok) {
        refreshed = true;
        setRefreshedModelCount(result.model_count);
        setRefreshedAt(result.last_fetched_at);
        toast.success(t('providerSetup.detail.refreshed', provDef.name, result.model_count));
      } else {
        toast.error(
          result.error ?? t('providerSetup.detail.couldNotRefresh', { name: provDef.name }),
        );
      }
      await props.onUpdate();
      if (refreshed) {
        setRefreshedModelCount(null);
        setRefreshedAt(null);
      }
    } catch {
      // network/server error toast already raised by fetchMutate
    } finally {
      setRefreshing(false);
    }
  };

  const handleDisconnect = async () => {
    props.setBusy(true);
    try {
      const result = await disconnectProvider(props.agentName, props.provId, authType);
      if (result?.notifications?.length) {
        for (const msg of result.notifications) {
          toast.error(msg);
        }
      }
      props.onBack();
      props.onUpdate();
    } catch {
      // error toast from fetchMutate
    } finally {
      props.setBusy(false);
    }
  };

  const disconnectButton = (
    <Button
      variant="ghost"
      block
      className="provider-detail__disconnect mt-4"
      disabled={busy}
      onClick={handleDisconnect}
    >
      {busy ? <Spinner /> : t('providerSetup.shared.disconnect')}
    </Button>
  );

  // Flow views share the same connection state; built once, passed to each.
  const flowProps = {
    provDef,
    provId: props.provId,
    agentName: props.agentName,
    connected,
    selectedAuthType: props.selectedAuthType,
    busy: props.busy,
    setBusy: props.setBusy,
    onBack: props.onBack,
    onUpdate: props.onUpdate,
    onClose: props.onClose,
    addKeyOpen,
    setAddKeyOpen,
    activeKeys,
  };

  const apiKeyUrl = getRoutingProviderApiKeyUrl(props.provId);

  return (
    <div className="provider-detail flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="modal-back-btn icon-btn"
          onClick={props.onBack}
          aria-label={t('providerSetup.shared.backToProviders')}
          title={t('providerSetup.shared.backToProviders')}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <h2 className="text-[15px] font-semibold text-ink">
          {t('providerSetup.shared.connectProvider')}
        </h2>
      </div>

      {/* Provider row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center">
            {providerIcon(props.provId, 28) ?? (
              <span
                className="flex h-8 w-8 items-center justify-center rounded-control bg-s3 text-[13px] font-semibold text-ink"
                aria-hidden="true"
              >
                {provDef.initial}
              </span>
            )}
          </span>
          <div className="flex items-center gap-2 truncate text-base font-semibold text-ink">
            {provDef.name}
            {provDef.beta ? <Badge tone="accent">{t('providerSetup.shared.beta')}</Badge> : null}
          </div>
        </div>
        {showAddKeyButton ? (
          <Button size="sm" onClick={() => setAddKeyOpen(true)}>
            <ListPlus size={14} aria-hidden="true" />
            {isSubMode
              ? t('providerSetup.shared.addConnection')
              : t('providerSetup.shared.addAnotherKey')}
          </Button>
        ) : null}
      </div>

      {subscriptionClosed ? (
        <p className="notice is-warn text-sm" role="note">
          {provDef.subscriptionClosedNote}
        </p>
      ) : null}

      {isSubMode && provDef.subscriptionRequirementNote ? (
        <p className="m-0 text-sm text-muted">{provDef.subscriptionRequirementNote}</p>
      ) : null}

      {connected ? (
        <div className="provider-detail__models-bar flex flex-wrap items-center justify-between gap-2 rounded-control border border-line bg-sunken px-3 py-2 text-xs text-muted">
          <span>
            {t('providerSetup.detail.models', modelCount)}
            {lastFetchedAgo
              ? t('providerSetup.detail.lastRefreshed', { ago: lastFetchedAgo })
              : null}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="provider-detail__refresh-btn"
            disabled={refreshing || busy}
            onClick={handleRefreshModels}
            aria-label={t('providerSetup.detail.refreshModelsFrom', { name: provDef.name })}
            title={t('providerSetup.detail.refreshModelsFrom', { name: provDef.name })}
          >
            <RefreshCw size={14} aria-hidden="true" className={cx(refreshing && 'animate-spin')} />
            {refreshing
              ? t('providerSetup.detail.refreshing')
              : t('providerSetup.detail.refreshModels')}
          </Button>
        </div>
      ) : null}

      {/* Subscription sign-in URL instruction (token mode with external sign-in) */}
      {showConnectFlow && isSubMode && provDef.subscriptionSignInUrl ? (
        <>
          <p className="hint m-0">
            {provDef.subscriptionSignInHint ??
              t('providerSetup.detail.signInHint', { name: provDef.name })}
          </p>
          <a
            className="btn btn-sm provider-detail__signin-btn self-start"
            href={provDef.subscriptionSignInUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('providerSetup.detail.opensNewTab', {
              label: provDef.subscriptionSignInLabel ?? t('providerSetup.detail.signIn'),
            })}
          >
            <ExternalLink size={14} aria-hidden="true" />
            {provDef.subscriptionSignInLabel ?? t('providerSetup.detail.signIn')}
          </a>
        </>
      ) : null}

      {/* Subscription terminal instruction */}
      {showConnectFlow && isSubMode && provDef.subscriptionCommand ? (
        <>
          <p className="hint m-0">
            {isCommandOnly
              ? t('providerSetup.detail.runCommandLogin')
              : t('providerSetup.detail.runCommandPaste')}
          </p>
          <div
            className="code-block relative"
            aria-label={t('providerSetup.detail.terminal')}
            role="group"
          >
            <CopyButton text={provDef.subscriptionCommand} className="absolute right-1 top-1" />
            <pre className="code whitespace-pre-wrap break-all pr-10">
              <span className="select-none text-faint">$ </span>
              <span>{provDef.subscriptionCommand}</span>
            </pre>
          </div>
        </>
      ) : null}

      {/* Command-only subscription */}
      {showConnectFlow && isCommandOnly ? (
        <>
          <p className="hint m-0">{t('providerSetup.detail.browserWillOpen')}</p>
          {connected ? (
            disconnectButton
          ) : (
            <Button block className="mt-4" onClick={props.onBack}>
              {t('common.done')}
            </Button>
          )}
        </>
      ) : null}

      {/* OAuth subscription */}
      {showConnectFlow && isPopupOAuthFlow ? (
        <OAuthDetailView {...flowProps} onPollProviders={props.onPollProviders} />
      ) : null}

      {/* Paste-code OAuth subscription (Anthropic) */}
      {showConnectFlow && isPopupPasteFlow ? <AnthropicOAuthDetailView {...flowProps} /> : null}

      {/* Device-code subscription */}
      {showConnectFlow && isDeviceCodeFlow ? <DeviceCodeDetailView {...flowProps} /> : null}

      {/* Ollama (no key) */}
      {isOllama ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-dim">{t('providerSetup.detail.noKeyLocal')}</span>
            {apiKeyUrl ? (
              <a
                href={apiKeyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="link-action text-sm"
              >
                {t('providerSetup.shared.getProduct', { name: provDef.name })}
              </a>
            ) : null}
          </div>
          {connected ? (
            disconnectButton
          ) : (
            <Button block className="mt-4" disabled={busy} onClick={handleOllamaConnect}>
              {busy ? <Spinner /> : t('providerSetup.shared.connect')}
            </Button>
          )}
        </>
      ) : null}

      {/* API key / subscription token form (non-Ollama, non-command-only, non-OAuth) */}
      {showConnectFlow &&
      !isOllama &&
      !isCommandOnly &&
      !isPopupOAuthFlow &&
      !isPopupPasteFlow &&
      !isDeviceCodeFlow ? (
        <ProviderKeyForm
          provDef={provDef}
          provId={props.provId}
          agentName={props.agentName}
          isSubMode={isSubMode}
          connected={connected}
          selectedAuthType={props.selectedAuthType}
          busy={props.busy}
          setBusy={props.setBusy}
          keyInput={props.keyInput}
          setKeyInput={props.setKeyInput}
          editing={props.editing}
          setEditing={props.setEditing}
          validationError={props.validationError}
          setValidationError={props.setValidationError}
          getKeyPrefixDisplay={getKeyPrefixDisplay}
          providers={props.providers}
          addKeyOpen={addKeyOpen}
          setAddKeyOpen={setAddKeyOpen}
          onBack={props.onBack}
          onUpdate={props.onUpdate}
        />
      ) : null}
    </div>
  );
}
