import { useEffect, useRef, useState } from 'react';
import { normalizeProviderName } from 'thinker-shared';
import { PROVIDERS, type ProviderDef } from '../services/providers.js';
import { type AuthType, type CustomProviderData, type RoutingProvider } from '../services/api.js';
import type { CustomProviderPrefill, ProviderDeepLink } from '../services/routing-params.js';
import CustomProviderForm from './CustomProviderForm.js';
import CopilotDeviceLogin from './CopilotDeviceLogin.js';
import LocalServerDetailView from './LocalServerDetailView.js';
import ProviderDetailView from './ProviderDetailView.js';

export interface ProviderSelectContentProps {
  agentName: string;
  providers: RoutingProvider[];
  customProviders?: CustomProviderData[];
  customProviderPrefill?: CustomProviderPrefill | null;
  providerDeepLink?: ProviderDeepLink | null;
  initialTab?: 'subscription' | 'api_key' | 'local';
  onUpdate: () => void | Promise<void>;
  onPollProviders?: () => void | Promise<void>;
  onClose?: () => void;
  /** Kept for callers; the list header was removed with the tab view. */
  showHeader?: boolean;
  /** Kept for callers; the list footer was removed with the tab view. */
  showFooter?: boolean;
}

const noop = () => {};

/**
 * `provider-modal__view` wraps each detail view; it is a stable hook for
 * tests and for the page that hosts the connect flow.
 */
const VIEW_CLASS = 'provider-modal__view provider-modal__view--from-right';

/**
 * The connect flow for one provider: an API key / token / OAuth detail view,
 * the Copilot device login, a local-server editor or the custom-provider
 * form. It opens from a `providerDeepLink` (or a custom-provider prefill);
 * there is no provider list to return to, so Back closes the host.
 */
export default function ProviderSelectContent(props: ProviderSelectContentProps) {
  const closeHandler = props.onClose ?? noop;

  // Deep-link derived initial state is captured once, like the Solid version.
  const deepLink = useRef(props.providerDeepLink).current;
  const deepLinkProv = deepLink ? PROVIDERS.find((p) => p.id === deepLink.providerId) : null;
  // A `custom:<id>` deep link can't resolve to a standard PROVIDERS entry; it
  // targets a custom provider whose editor we open directly (see the effect below).
  const deepLinkCustomId = deepLink?.providerId.startsWith('custom:')
    ? deepLink.providerId.slice('custom:'.length)
    : null;

  const [selectedProvider, setSelectedProvider] = useState<string | null>(
    deepLinkProv ? deepLinkProv.id : null,
  );
  const [selectedAuthType] = useState<AuthType>(
    deepLink?.authType ?? (deepLinkProv?.subscriptionOnly ? 'subscription' : 'api_key'),
  );
  const [showCustomForm, setShowCustomForm] = useState(!!props.customProviderPrefill);
  const [tilePrefill, setTilePrefill] = useState<CustomProviderPrefill | null>(null);
  const [editingCustomProvider, setEditingCustomProvider] = useState<CustomProviderData | null>(
    null,
  );
  const [localServerProvider, setLocalServerProvider] = useState<ProviderDef | null>(null);
  const [localServerEditData, setLocalServerEditData] = useState<CustomProviderData | undefined>(
    undefined,
  );
  const [busy, setBusy] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [editing, setEditing] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const getActiveProviderKeys = (provId: string, authType: AuthType) =>
    props.providers
      .filter(
        (p) => p.provider === provId && p.auth_type === authType && p.is_active && p.has_api_key,
      )
      .slice()
      .sort((a, b) => a.priority - b.priority);

  const isSubscriptionWithToken = (provId: string): boolean => {
    const p = props.providers.find((r) => r.provider === provId && r.auth_type === 'subscription');
    return !!p && p.is_active && p.has_api_key;
  };

  const resetToList = () => {
    setSelectedProvider(null);
    setShowCustomForm(false);
    setTilePrefill(null);
    setEditingCustomProvider(null);
    setLocalServerProvider(null);
    setLocalServerEditData(undefined);
    setKeyInput('');
    setEditing(false);
    setValidationError(null);
  };

  const goBack = () => {
    // When opened via deep-link (from a provider list page), there is no
    // "list view" to go back to. Close the modal instead.
    if (deepLink) {
      closeHandler();
      return;
    }
    resetToList();
  };

  // Finishing a flow (create / delete / connect) always returns to the list state.
  const completeToList = () => {
    resetToList();
  };

  const openCustomForm = (prefill?: CustomProviderPrefill) => {
    setTilePrefill(prefill ?? null);
    setShowCustomForm(true);
  };

  const openEditCustom = (cp: CustomProviderData) => {
    const normalized = normalizeProviderName(cp.name);
    const localProv = PROVIDERS.find(
      (p) => p.defaultLocalPort && normalizeProviderName(p.name) === normalized,
    );
    if (localProv) {
      setLocalServerProvider(localProv);
      setLocalServerEditData(cp);
      return;
    }
    setEditingCustomProvider(cp);
  };

  // Custom-provider deep link: open the custom editor for the matching id
  // instead of leaving the modal on the provider list (which can't resolve a
  // `custom:` id). The effect covers custom providers that load asynchronously
  // after the modal opens; the guard fires it at most once.
  const customDeepLinkOpened = useRef(false);
  useEffect(() => {
    if (!deepLinkCustomId || customDeepLinkOpened.current) return;
    const cp = (props.customProviders ?? []).find((c) => c.id === deepLinkCustomId);
    if (cp) {
      customDeepLinkOpened.current = true;
      openEditCustom(cp);
    }
    // openEditCustom only calls state setters.
  }, [deepLinkCustomId, props.customProviders]);

  const selectedDef = selectedProvider
    ? PROVIDERS.find((p) => p.id === selectedProvider)
    : undefined;
  const noFormOpen = !showCustomForm && !editingCustomProvider;

  return (
    <>
      {/* -- Local Server Detail View (LM Studio) -- */}
      {localServerProvider && noFormOpen ? (
        <div className={VIEW_CLASS}>
          <LocalServerDetailView
            agentName={props.agentName}
            provider={localServerProvider}
            editData={localServerEditData}
            onConnected={() => {
              completeToList();
              props.onUpdate();
            }}
            onBack={goBack}
            onOpenCustomForm={() => {
              setLocalServerProvider(null);
              openCustomForm();
            }}
          />
        </div>
      ) : null}

      {/* -- Custom Provider Form View (create or edit) -- */}
      {(showCustomForm || editingCustomProvider) && !localServerProvider ? (
        <div className={VIEW_CLASS}>
          <CustomProviderForm
            agentName={props.agentName}
            initialData={editingCustomProvider ?? undefined}
            prefill={
              !editingCustomProvider
                ? (tilePrefill ?? props.customProviderPrefill ?? undefined)
                : undefined
            }
            onCreated={() => {
              completeToList();
              props.onUpdate();
            }}
            onBack={goBack}
            onDeleted={() => {
              completeToList();
              props.onUpdate();
            }}
          />
        </div>
      ) : null}

      {/* -- Device Login Detail View (Copilot) -- */}
      {selectedProvider !== null && noFormOpen && selectedDef?.deviceLogin ? (
        <div className={VIEW_CLASS}>
          <CopilotDeviceLogin
            agentName={props.agentName}
            connected={isSubscriptionWithToken(selectedProvider)}
            activeKeys={getActiveProviderKeys(selectedProvider, 'subscription')}
            onBack={goBack}
            onConnected={async () => {
              await props.onUpdate();
              goBack();
            }}
            onUpdated={props.onUpdate}
            onDisconnected={() => {
              goBack();
              props.onUpdate();
            }}
          />
        </div>
      ) : null}

      {/* -- Detail View (API Key / Token) -- */}
      {selectedProvider !== null && noFormOpen && !selectedDef?.deviceLogin ? (
        <div className={VIEW_CLASS}>
          <ProviderDetailView
            provId={selectedProvider}
            agentName={props.agentName}
            providers={props.providers}
            selectedAuthType={selectedAuthType}
            busy={busy}
            setBusy={setBusy}
            keyInput={keyInput}
            setKeyInput={setKeyInput}
            editing={editing}
            setEditing={setEditing}
            validationError={validationError}
            setValidationError={setValidationError}
            onBack={goBack}
            onUpdate={props.onUpdate}
            onPollProviders={props.onPollProviders}
            onClose={closeHandler}
          />
        </div>
      ) : null}
    </>
  );
}
