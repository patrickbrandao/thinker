import { useEffect, useRef, useState } from 'react';
import type { ProviderDef } from '../services/providers.js';
import {
  startAnthropicOAuth,
  submitAnthropicOAuth,
  revokeAnthropicOAuth,
  getAnthropicOAuthPending,
  type AuthType,
  type RoutingProvider,
} from '../services/api.js';
import { toast } from '../services/toast-store.js';
import { t } from '../i18n/index.js';
import { Button } from './ui.js';
import { SubscriptionAccountList, renameSubscriptionKey } from './OAuthDetailView.js';

interface Props {
  provDef: ProviderDef;
  provId: string;
  agentName: string;
  connected: boolean;
  selectedAuthType: AuthType;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onBack: () => void;
  onUpdate: () => void;
  onClose: () => void;
  addKeyOpen?: boolean;
  setAddKeyOpen?: (open: boolean) => void;
  activeKeys?: RoutingProvider[];
}

/**
 * Anthropic subscription connect view. Sign in with Claude opens an OAuth
 * popup; the user pastes the resulting `<code>#<state>` payload back into
 * the input. Tokens are stored as refreshable JSON blobs and rotated by
 * the proxy automatically on every request.
 */
export default function AnthropicOAuthDetailView(props: Props) {
  const [state, setState] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const latest = useRef(props);
  latest.current = props;

  const activeKeys = props.activeKeys ?? [];
  const isMultiKey = activeKeys.length > 1;
  const showConnectFlow = !props.connected || addingAccount;
  const via = props.provDef.subscriptionLabel ?? t('providerSetup.shared.subscriptionLower');

  const handleSignIn = async () => {
    setError(null);
    // Open synchronously while the click still has user activation. Browsers
    // can block a window opened after the OAuth start request completes.
    const popup = window.open('about:blank', '_blank');
    if (!popup) {
      toast.error(t('providerSetup.shared.popupBlocked'));
      if (latest.current.connected) setAddingAccount(false);
      return;
    }
    // The blank page is same-origin, so remove its access to the dashboard
    // before navigating it to Anthropic.
    popup.opener = null;

    latest.current.setBusy(true);
    try {
      const { url, state: authState } = await startAnthropicOAuth(latest.current.agentName);
      setState(authState);
      if (!popup.closed) popup.location.replace(url);
    } catch {
      popup.close();
      if (latest.current.connected) setAddingAccount(false);
      // error toast from fetchMutate
    } finally {
      latest.current.setBusy(false);
    }
  };

  // When "Add another key" is clicked in the header, launch a new OAuth popup.
  useEffect(() => {
    if (props.addKeyOpen && props.connected && !props.busy) {
      setAddingAccount(true);
      props.setAddKeyOpen?.(false);
      void handleSignIn();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.addKeyOpen, props.connected, props.busy]);

  // Restore any pending OAuth flow so the paste field still works after the
  // modal was closed mid-dance.
  useEffect(() => {
    if (props.connected) return;
    let cancelled = false;
    getAnthropicOAuthPending(props.agentName)
      .then(({ state: pending }) => {
        if (!cancelled && pending) setState(pending);
      })
      .catch(() => {
        // Missing pending state just means the user hasn't started a flow yet.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async () => {
    const raw = input.trim().replace(/\s/g, '');
    if (!raw) return;

    if (!raw.includes('#')) {
      setError(t('providerSetup.anthropic.invalidCode'));
      return;
    }
    const pastedState = raw.slice(raw.indexOf('#') + 1);
    if (!pastedState) {
      setError(t('providerSetup.anthropic.invalidCode'));
      return;
    }

    props.setBusy(true);
    setError(null);
    try {
      const authState = state ?? pastedState;
      await submitAnthropicOAuth(props.agentName, raw, authState);
      toast.success(t('providerSetup.shared.subscriptionConnected', { name: props.provDef.name }));
      setAddingAccount(false);
      setInput('');
      setState(null);
      latest.current.onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('providerSetup.anthropic.exchangeFailed'));
    } finally {
      latest.current.setBusy(false);
    }
  };

  const cancelAddAccount = () => {
    setAddingAccount(false);
    setInput('');
    setError(null);
    setState(null);
  };

  const revoke = async (label?: string) => {
    props.setBusy(true);
    try {
      const result = await (label
        ? revokeAnthropicOAuth(props.agentName, label)
        : revokeAnthropicOAuth(props.agentName));
      if (result?.notifications?.length) {
        for (const msg of result.notifications) toast.error(msg);
      }
      if (!label) latest.current.onBack();
      latest.current.onUpdate();
    } catch {
      // error toast from fetchMutate
    } finally {
      latest.current.setBusy(false);
    }
  };

  if (showConnectFlow) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-dim">{t('providerSetup.anthropic.intro')}</p>
          <Button block busy={props.busy} onClick={() => void handleSignIn()}>
            {t('providerSetup.anthropic.signIn')}
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 text-xs text-faint">
            <span className="h-px flex-1 bg-line" />
            <span>{t('providerSetup.anthropic.pasteDivider')}</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <p className="text-xs text-muted">{t('providerSetup.anthropic.pasteHint')}</p>
          <input
            className="field font-mono"
            aria-invalid={error ? true : undefined}
            type="text"
            autoComplete="off"
            placeholder={t('providerSetup.anthropic.codePlaceholder')}
            aria-label={t('providerSetup.anthropic.codeAria')}
            value={input}
            onChange={(e) => {
              setInput(e.currentTarget.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSubmit();
            }}
          />
          {error ? <div className="form-error">{error}</div> : null}
          <Button
            block
            busy={props.busy}
            disabled={!input.trim()}
            onClick={() => void handleSubmit()}
          >
            {t('providerSetup.shared.connect')}
          </Button>
        </div>
        {addingAccount ? (
          <Button variant="ghost" block disabled={props.busy} onClick={cancelAddAccount}>
            {t('common.cancel')}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {isMultiKey ? (
        <SubscriptionAccountList
          keys={activeKeys}
          ariaLabel={t('providerSetup.shared.oauthAccountsFor', { name: props.provDef.name })}
          via={via}
          busy={props.busy}
          onDelete={(label) => void revoke(label)}
          onRename={(key, newLabel) =>
            renameSubscriptionKey({
              agentName: props.agentName,
              provId: props.provId,
              authType: props.selectedAuthType,
              key,
              newLabel,
              setBusy: props.setBusy,
              onUpdate: props.onUpdate,
            })
          }
        />
      ) : (
        <p className="text-sm text-dim">{t('providerSetup.shared.connectedVia', { via })}</p>
      )}
      <Button variant="ghost" block busy={props.busy} onClick={() => void revoke()}>
        {isMultiKey
          ? t('providerSetup.shared.disconnectAll')
          : t('providerSetup.shared.disconnect')}
      </Button>
    </div>
  );
}
