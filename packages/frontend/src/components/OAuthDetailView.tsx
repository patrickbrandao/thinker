import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { ProviderDef } from '../services/providers.js';
import {
  getPopupOauthApi,
  renameProviderKey,
  type AuthType,
  type RoutingProvider,
} from '../services/api.js';
import { toast } from '../services/toast-store.js';
import { t } from '../i18n/index.js';
import { monitorOAuthPopup } from '../services/oauth-popup.js';
import { Button, IconButton } from './ui.js';

const MAX_LABEL_LENGTH = 50;

function parseOAuthCallbackInput(raw: string, fallbackState: string | null) {
  let code: string | null = null;
  let state: string | null = fallbackState;
  const parts = raw.split(/\s+/).filter(Boolean);

  for (const part of parts) {
    try {
      const url = new URL(part);
      code = code ?? url.searchParams.get('code');
      state = state ?? url.searchParams.get('state');
    } catch {
      if (!code && /^[A-Za-z0-9._~-]{20,}$/.test(part)) {
        code = part;
      }
    }
  }

  return { code, state };
}

/**
 * Connected subscription accounts with inline rename and per-account delete.
 * Shared by the OAuth, Anthropic and device-code views. `onRename` resolves
 * true when the rename landed, which closes the inline editor.
 */
export function SubscriptionAccountList({
  keys,
  ariaLabel,
  via,
  busy,
  onRename,
  onDelete,
}: {
  keys: RoutingProvider[];
  ariaLabel: string;
  via: string;
  busy: boolean;
  onRename: (key: RoutingProvider, newLabel: string) => Promise<boolean>;
  onDelete: (label: string) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const commitRename = async (k: RoutingProvider) => {
    const newLabel = renameValue.trim();
    if (!newLabel || newLabel === k.label) {
      setRenamingId(null);
      return;
    }
    if (await onRename(k, newLabel)) setRenamingId(null);
  };

  return (
    <div>
      <span className="label">{t('providerSetup.shared.accounts')}</span>
      <ul role="list" aria-label={ariaLabel} className="flex flex-col gap-2">
        {keys.map((k) => (
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
                  autoFocus
                  onChange={(e) => setRenameValue(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitRename(k);
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                />
                <Button size="sm" disabled={busy} onClick={() => void commitRename(k)}>
                  {t('common.save')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setRenamingId(null)}
                >
                  {t('common.cancel')}
                </Button>
              </>
            ) : (
              <>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{k.label}</div>
                  <div className="text-xs text-muted">
                    {t('providerSetup.shared.connectedVia', { via })}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0"
                  disabled={busy}
                  onClick={() => {
                    setRenamingId(k.id);
                    setRenameValue(k.label);
                  }}
                >
                  {t('providerSetup.shared.rename')}
                </Button>
                <IconButton
                  label={t('providerSetup.shared.deleteAccountNamed', { label: k.label })}
                  title={t('providerSetup.shared.deleteAccount')}
                  className="shrink-0 hover:text-danger"
                  disabled={busy}
                  onClick={() => onDelete(k.label)}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </IconButton>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Renames a subscription key; resolves true on success (errors toast upstream). */
export async function renameSubscriptionKey(opts: {
  agentName: string;
  provId: string;
  authType: AuthType;
  key: RoutingProvider;
  newLabel: string;
  setBusy: (busy: boolean) => void;
  onUpdate: () => void;
}): Promise<boolean> {
  opts.setBusy(true);
  try {
    await renameProviderKey(
      opts.agentName,
      opts.provId,
      opts.key.label,
      opts.newLabel,
      opts.authType,
    );
    toast.success(t('providerSetup.shared.renamedTo', { label: opts.newLabel }));
    opts.onUpdate();
    return true;
  } catch {
    // toast handled upstream
    return false;
  } finally {
    opts.setBusy(false);
  }
}

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
  onPollProviders?: () => void | Promise<void>;
  onClose: () => void;
  addKeyOpen?: boolean;
  setAddKeyOpen?: (open: boolean) => void;
  activeKeys?: RoutingProvider[];
}

export default function OAuthDetailView(props: Props) {
  const [pasteFlowActive, setPasteFlowActive] = useState(false);
  const [flowKeyCount, setFlowKeyCount] = useState<number | null>(null);
  const [pasteUrl, setPasteUrl] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [oauthState, setOauthState] = useState<string | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const successHandled = useRef(false);
  const latest = useRef(props);
  latest.current = props;

  // Dispose the OAuth popup monitor if the view unmounts mid-flow, otherwise its
  // 300ms URL poll keeps running after the component is gone.
  const disposeOAuthMonitor = useRef<(() => void) | null>(null);
  useEffect(() => () => disposeOAuthMonitor.current?.(), []);

  const activeKeys = props.activeKeys ?? [];
  const activeKeyCount = activeKeys.length;
  const isMultiKey = activeKeyCount > 1;
  const isXaiProvider = props.provId === 'xai';
  const isOpenAiProvider = props.provId === 'openai';
  const callbackPlaceholder = isXaiProvider
    ? t('providerSetup.oauth.callbackPlaceholderXai')
    : 'http://localhost:1455/auth/callback?code=...';
  const showConnectFlow = !props.connected || addingAccount || pasteFlowActive;
  const via = props.provDef.subscriptionLabel ?? t('providerSetup.shared.subscriptionLower');
  const flowHasConnected =
    flowKeyCount === null
      ? false
      : flowKeyCount > 0
        ? activeKeyCount > flowKeyCount
        : props.connected;

  // Reads only refs and stable setters, so the popup monitor can hold it.
  const finishOAuthSuccess = () => {
    if (successHandled.current) return;
    successHandled.current = true;
    setPasteFlowActive(false);
    setFlowKeyCount(null);
    setPasteUrl('');
    setPasteError(null);
    setOauthState(null);
    setAddingAccount(false);
    toast.success(
      t('providerSetup.shared.subscriptionConnected', { name: latest.current.provDef.name }),
    );
    latest.current.onUpdate();
  };

  const oauthApi = () => getPopupOauthApi(latest.current.provId);

  const handleOAuthLogin = async () => {
    const p = latest.current;
    p.setBusy(true);
    setPasteUrl('');
    setPasteError(null);
    try {
      const { url } = await oauthApi().getUrl(p.agentName);
      try {
        setOauthState(new URL(url).searchParams.get('state'));
      } catch {
        setOauthState(null);
      }
      const popup = window.open(url, 'thinker-oauth', 'width=500,height=700');
      if (!popup) {
        toast.error(t('providerSetup.shared.popupBlocked'));
        if (latest.current.connected) setAddingAccount(false);
        setOauthState(null);
        latest.current.setBusy(false);
        return;
      }

      setPasteFlowActive(true);
      setFlowKeyCount((latest.current.activeKeys ?? []).length);
      successHandled.current = false;
      latest.current.setBusy(false);

      // Dispose any in-flight monitor from a previous start before replacing it,
      // so repeated logins don't orphan the earlier poll/listener handle.
      disposeOAuthMonitor.current?.();
      disposeOAuthMonitor.current = monitorOAuthPopup(
        popup,
        {
          onSuccess: finishOAuthSuccess,
          onFailure: () => {
            // Popup closed without auto-redirect — user needs to paste the URL
          },
        },
        `/oauth/${p.provId}/done`,
      );
    } catch {
      if (latest.current.connected) setAddingAccount(false);
      latest.current.setBusy(false);
    }
  };

  // When "Add another key" is clicked in the header, launch a new OAuth popup.
  useEffect(() => {
    if (props.addKeyOpen && props.connected && !props.busy) {
      setAddingAccount(true);
      props.setAddKeyOpen?.(false);
      void handleOAuthLogin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.addKeyOpen, props.connected, props.busy]);

  useEffect(() => {
    if (!pasteFlowActive) return;
    const interval = window.setInterval(() => {
      const poll = latest.current.onPollProviders ?? latest.current.onUpdate;
      void poll();
    }, 2000);
    return () => window.clearInterval(interval);
  }, [pasteFlowActive]);

  useEffect(() => {
    if (pasteFlowActive && flowHasConnected) finishOAuthSuccess();
  }, [pasteFlowActive, flowHasConnected]);

  const handlePasteSubmit = async () => {
    const raw = pasteUrl.trim();
    if (!raw) return;

    try {
      const { code, state } = parseOAuthCallbackInput(raw, oauthState);
      if (!code || !state) {
        setPasteError(
          props.provId === 'xai'
            ? t('providerSetup.oauth.missingCodeXai')
            : t('providerSetup.oauth.missingCode'),
        );
        return;
      }

      props.setBusy(true);
      setPasteError(null);
      await oauthApi().submitCallback(code, state);
      finishOAuthSuccess();
    } catch (err) {
      // The server's message says what went wrong. Network failures (fetch
      // rejects with a TypeError) and empty messages get the generic hint.
      setPasteError(
        err instanceof Error && !(err instanceof TypeError) && err.message
          ? err.message
          : t('providerSetup.oauth.exchangeFailed'),
      );
    } finally {
      latest.current.setBusy(false);
    }
  };

  const cancelAddAccount = () => {
    setAddingAccount(false);
    setPasteFlowActive(false);
    setFlowKeyCount(null);
    successHandled.current = false;
    setPasteUrl('');
    setPasteError(null);
    setOauthState(null);
  };

  const revoke = async (label?: string) => {
    props.setBusy(true);
    try {
      const api = oauthApi();
      const result = await (label
        ? api.revoke(props.agentName, label)
        : api.revoke(props.agentName));
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
      <div className="flex flex-col gap-3">
        {pasteFlowActive ? (
          <>
            {isXaiProvider ? (
              <p className="text-sm text-dim">{t('providerSetup.oauth.xaiWindowOpened')}</p>
            ) : (
              <>
                <p className="text-sm text-dim">{t('providerSetup.oauth.windowOpened')}</p>
                {isOpenAiProvider ? (
                  <p className="text-sm text-dim">
                    {t('providerSetup.oauth.copyUrlBefore')}{' '}
                    <span className="font-medium text-ink">
                      {t('providerSetup.oauth.copyUrlEmphasis')}
                    </span>{' '}
                    {t('providerSetup.oauth.copyUrlAfter')}
                  </p>
                ) : null}
              </>
            )}
            <div className="flex flex-col gap-2">
              <input
                type="text"
                className="field"
                aria-invalid={pasteError ? true : undefined}
                autoComplete="off"
                placeholder={callbackPlaceholder}
                value={pasteUrl}
                onChange={(e) => {
                  setPasteUrl(e.currentTarget.value);
                  setPasteError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handlePasteSubmit();
                }}
              />
              {pasteError ? <div className="form-error">{pasteError}</div> : null}
              <Button
                size="sm"
                className="self-start"
                busy={props.busy}
                disabled={!pasteUrl.trim()}
                onClick={() => void handlePasteSubmit()}
              >
                {t('providerSetup.shared.connect')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-dim">
              {t('providerSetup.oauth.loginToConnect', { name: props.provDef.name })}
            </p>
            <Button block busy={props.busy} onClick={() => void handleOAuthLogin()}>
              {t('providerSetup.oauth.loginWith', { name: props.provDef.name })}
            </Button>
          </>
        )}
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
      <div className="flex items-center gap-2">
        <Button variant="ghost" busy={props.busy} onClick={() => void revoke()}>
          {isMultiKey
            ? t('providerSetup.shared.disconnectAll')
            : t('providerSetup.shared.disconnect')}
        </Button>
        <div className="flex-1" />
        <Button size="sm" onClick={() => props.onClose()}>
          {t('common.done')}
        </Button>
      </div>
    </div>
  );
}
