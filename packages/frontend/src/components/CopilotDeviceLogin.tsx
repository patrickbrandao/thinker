import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, Copy, Trash2 } from 'lucide-react';
import { MAX_KEYS_PER_PROVIDER } from 'thinker-shared';
import { providerIcon } from './ProviderIcon.js';
import {
  copilotDeviceCode,
  copilotPollToken,
  disconnectProvider,
  type CopilotPollStatus,
  type RoutingProvider,
} from '../services/api.js';
import { toast } from '../services/toast-store.js';
import { t } from '../i18n/index.js';
import { Button, IconButton } from './ui.js';

type Phase = 'idle' | 'loading' | 'awaiting' | 'success' | 'error';

interface Props {
  agentName: string;
  connected: boolean;
  activeKeys?: RoutingProvider[];
  onBack: () => void;
  onConnected: () => void;
  onUpdated?: () => void;
  onDisconnected: () => void;
}

const SLOW_DOWN_INCREASE = 5;
const MAX_POLL_ERRORS = 5;

export default function CopilotDeviceLogin(props: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [userCode, setUserCode] = useState('');
  const [verificationUri, setVerificationUri] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const pollTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copiedTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelled = useRef(false);
  const latest = useRef(props);
  latest.current = props;

  const activeKeys = (props.activeKeys ?? []).slice().sort((a, b) => a.priority - b.priority);
  const isMultiKey = activeKeys.length > 1;
  const canAddAnother = activeKeys.length < MAX_KEYS_PER_PROVIDER;
  const idleOrError = phase === 'idle' || phase === 'error';
  const showConnectedState = props.connected && idleOrError;

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      if (pollTimeout.current) clearTimeout(pollTimeout.current);
      clearTimeout(copiedTimeout.current);
    };
  }, []);

  /** Returns next delay (seconds), or 0 to stop. */
  const handlePollResult = (status: CopilotPollStatus, currentDelay: number): number => {
    if (status === 'complete') {
      setPhase('success');
      toast.success(t('providerSetup.copilot.connected'));
      latest.current.onConnected();
      return 0;
    }
    if (status === 'expired') {
      setError(t('providerSetup.copilot.expired'));
      setPhase('error');
      return 0;
    }
    if (status === 'denied') {
      setError(t('providerSetup.copilot.denied'));
      setPhase('error');
      return 0;
    }
    if (status === 'slow_down') {
      return currentDelay + SLOW_DOWN_INCREASE;
    }
    return currentDelay;
  };

  const schedulePoll = (code: string, delaySec: number, errorCount = 0) => {
    if (cancelled.current) return;
    pollTimeout.current = setTimeout(async () => {
      if (cancelled.current) return;
      try {
        const result = await copilotPollToken(latest.current.agentName, code);
        if (cancelled.current) return;
        const next = handlePollResult(result.status, delaySec);
        if (next > 0) schedulePoll(code, next, 0);
      } catch {
        if (cancelled.current) return;
        const nextErrors = errorCount + 1;
        if (nextErrors >= MAX_POLL_ERRORS) {
          setError(t('providerSetup.copilot.connectionLost'));
          setPhase('error');
        } else {
          schedulePoll(code, delaySec, nextErrors);
        }
      }
    }, delaySec * 1000);
  };

  const startLogin = async () => {
    setPhase('loading');
    setError('');
    cancelled.current = false;
    try {
      const result = await copilotDeviceCode(props.agentName);
      setUserCode(result.user_code);
      setVerificationUri(result.verification_uri);
      setPhase('awaiting');
      schedulePoll(result.device_code, Math.max(result.interval, 5));
    } catch {
      setError(t('providerSetup.copilot.failedStart'));
      setPhase('error');
    }
  };

  const copyCode = () => {
    navigator.clipboard
      .writeText(userCode)
      .then(() => {
        setCopied(true);
        clearTimeout(copiedTimeout.current);
        copiedTimeout.current = setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        /* fallback: the code stays selectable */
      });
  };

  const disconnect = async (label?: string) => {
    setBusy(true);
    try {
      const result = await (label
        ? disconnectProvider(props.agentName, 'copilot', 'subscription', label)
        : disconnectProvider(props.agentName, 'copilot', 'subscription'));
      if (result?.notifications?.length) {
        for (const msg of result.notifications) toast.error(msg);
      }
      if (label) latest.current.onUpdated?.();
      else latest.current.onDisconnected();
    } catch {
      /* error toast from fetchMutate */
    } finally {
      setBusy(false);
    }
  };

  const errorBox = error ? <div className="form-error">{error}</div> : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <IconButton label={t('providerSetup.shared.backToProviders')} onClick={props.onBack}>
          <ChevronLeft size={16} aria-hidden="true" />
        </IconButton>
        <h2 className="text-base font-semibold text-ink">
          {t('providerSetup.shared.connectProvider')}
        </h2>
      </div>

      <div className="flex items-center gap-3">
        <span className="inline-flex size-8 items-center justify-center">
          {providerIcon('copilot', 28)}
        </span>
        <div className="text-sm font-semibold text-ink">GitHub Copilot</div>
      </div>

      {/* Connected state */}
      {showConnectedState ? (
        <>
          {isMultiKey ? (
            <div>
              <span className="label">{t('providerSetup.shared.accounts')}</span>
              <ul
                role="list"
                aria-label={t('providerSetup.shared.accountsFor', { name: 'GitHub Copilot' })}
                className="flex flex-col gap-2"
              >
                {activeKeys.map((k) => (
                  <li
                    key={k.id}
                    className="flex items-center gap-2 rounded-control border border-line bg-sunken px-2.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{k.label}</div>
                      <div className="text-xs text-muted">
                        {t('providerSetup.copilot.viaSubscription')}
                      </div>
                    </div>
                    <IconButton
                      label={t('providerSetup.shared.deleteAccountNamed', { label: k.label })}
                      title={t('providerSetup.shared.deleteAccount')}
                      className="shrink-0 hover:text-danger"
                      disabled={busy}
                      onClick={() => void disconnect(k.label)}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-ok">{t('providerSetup.copilot.viaDeviceLogin')}</p>
          )}
          {errorBox}
          {canAddAnother ? (
            <Button block busy={busy} onClick={() => void startLogin()}>
              {t('providerSetup.shared.addAnotherKey')}
            </Button>
          ) : null}
          <Button variant="ghost" block busy={busy} onClick={() => void disconnect()}>
            {t('providerSetup.shared.disconnect')}
          </Button>
        </>
      ) : null}

      {/* Idle / Error — show start button */}
      {!props.connected && idleOrError ? (
        <>
          <p className="text-sm text-dim">{t('providerSetup.copilot.requires')}</p>
          {errorBox}
          <Button block onClick={() => void startLogin()}>
            {t('providerSetup.copilot.signIn')}
          </Button>
        </>
      ) : null}

      {/* Loading — fetching device code */}
      {phase === 'loading' ? (
        <div className="flex justify-center py-6">
          <span className="spinner" aria-hidden="true" />
        </div>
      ) : null}

      {/* Awaiting — show code + URL */}
      {phase === 'awaiting' ? (
        <div className="well flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-dim">{t('providerSetup.copilot.copyCode')}</p>
          <div className="flex items-center gap-2">
            <div
              className="select-all font-mono text-2xl font-semibold tracking-widest text-ink"
              aria-label={t('providerSetup.copilot.deviceCode')}
            >
              {userCode}
            </div>
            <IconButton
              label={copied ? t('common.copied') : t('providerSetup.copilot.copyDeviceCode')}
              title={copied ? t('common.copied') : t('common.copy')}
              className={copied ? 'text-ok' : undefined}
              onClick={copyCode}
            >
              {copied ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                <Copy size={16} aria-hidden="true" />
              )}
            </IconButton>
          </div>
          <a className="btn" href={verificationUri} target="_blank" rel="noopener noreferrer">
            {t('providerSetup.copilot.openGithub')}
          </a>
          <p className="flex items-center gap-2 text-sm text-muted">
            <span className="spinner" aria-hidden="true" />
            {t('providerSetup.copilot.waiting')}
          </p>
        </div>
      ) : null}

      {/* Success */}
      {phase === 'success' ? (
        <p className="text-sm text-ok">{t('providerSetup.copilot.success')}</p>
      ) : null}
    </div>
  );
}
