import { useEffect, useRef, useState } from 'react';
import type { ProviderDef } from '../services/providers.js';
import {
  connectProvider,
  getDeviceCodeApi,
  type AuthType,
  type MinimaxOAuthRegion,
  type RoutingProvider,
} from '../services/api.js';
import { suggestNextProviderKeyLabel } from '../services/provider-key-labels.js';
import { validateSubscriptionKey } from '../services/provider-utils.js';
import { toast } from '../services/toast-store.js';
import { t } from '../i18n/index.js';
import Select from './Select.js';
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

const KIRO_DEFAULT_REGION = 'us-east-1';
const KIRO_REGION_OPTIONS = [
  'us-east-2',
  'us-east-1',
  'us-west-1',
  'us-west-2',
  'af-south-1',
  'ap-east-1',
  'ap-south-2',
  'ap-southeast-3',
  'ap-southeast-5',
  'ap-southeast-4',
  'ap-south-1',
  'ap-southeast-6',
  'ap-northeast-3',
  'ap-northeast-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-east-2',
  'ap-southeast-7',
  'ap-northeast-1',
  'ca-central-1',
  'ca-west-1',
  'eu-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-south-1',
  'eu-west-3',
  'eu-south-2',
  'eu-north-1',
  'eu-central-2',
  'il-central-1',
  'mx-central-1',
  'me-south-1',
  'me-central-1',
  'sa-east-1',
  'us-gov-east-1',
  'us-gov-west-1',
].map((region) => ({ value: region, label: region }));

interface DeviceCodeFlow {
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  pollIntervalMs: number;
}

const DEFAULT_POLL_INTERVAL_MS = 2000;

export default function DeviceCodeDetailView(props: Props) {
  const [flow, setFlowState] = useState<DeviceCodeFlow | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<MinimaxOAuthRegion>('global');
  const [kiroStartUrl, setKiroStartUrl] = useState('');
  const [kiroRegion, setKiroRegion] = useState(KIRO_DEFAULT_REGION);
  const [kiroConfigError, setKiroConfigError] = useState<string | null>(null);
  const [altToken, setAltToken] = useState('');
  const [altError, setAltError] = useState<string | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const latest = useRef(props);
  latest.current = props;
  // The poll loop spans renders, so it reads the flow and its bookkeeping
  // from refs instead of render-time state.
  const flowRef = useRef<DeviceCodeFlow | null>(null);
  const pollTimer = useRef<number | undefined>(undefined);
  const isDisposed = useRef(false);
  const activeFlowGeneration = useRef(0);

  const setFlow = (next: DeviceCodeFlow | null) => {
    flowRef.current = next;
    setFlowState(next);
  };

  const api = () => getDeviceCodeApi(latest.current.provId);
  const isKiro = props.provId === 'kiro';
  const hasRegion = api().hasRegion;
  const activeKeys = props.activeKeys ?? [];
  const isMultiKey = activeKeys.length > 1;
  const showConnectFlow = !props.connected || addingAccount;
  const via = props.provDef.subscriptionLabel ?? t('providerSetup.shared.subscriptionLower');
  const alt = props.provDef.subscriptionTokenAlternative;
  const kiroErrorId = kiroConfigError ? 'kiro-identity-error' : undefined;

  const handleAltConnect = async () => {
    const trimmed = altToken.replace(/\s/g, '');
    const result = validateSubscriptionKey(props.provDef, trimmed);
    if (!result.valid) {
      setAltError(result.error!);
      return;
    }
    props.setBusy(true);
    try {
      const label = addingAccount
        ? suggestNextProviderKeyLabel(activeKeys.map((k) => k.label))
        : undefined;
      await connectProvider(props.agentName, {
        provider: props.provId,
        apiKey: trimmed,
        authType: 'subscription',
        // Region is OAuth-flow state, but a pasted Coding Plan token still
        // needs to route to the right MiniMax host (api.minimax.io vs
        // api.minimaxi.com). Stick the picker's current value on the row so
        // the proxy fallback honors CN tokens.
        region: selectedRegion,
        ...(label && { label }),
      });
      toast.success(t('providerSetup.shared.subscriptionConnected', { name: props.provDef.name }));
      setAddingAccount(false);
      setAltToken('');
      latest.current.onUpdate();
    } catch {
      // error toast from fetchMutate
    } finally {
      latest.current.setBusy(false);
    }
  };

  const buildStartOptions = () => {
    if (hasRegion) {
      return { region: selectedRegion };
    }
    if (!isKiro) {
      return undefined;
    }

    const startUrl = kiroStartUrl.trim();
    const region = kiroRegion.trim().toLowerCase();
    if (!/^[a-z]{2}(?:-[a-z0-9]+)+-\d$/.test(region)) {
      setKiroConfigError(t('providerSetup.device.invalidRegion'));
      return null;
    }
    if (startUrl) {
      try {
        const parsed = new URL(startUrl);
        if (parsed.protocol !== 'https:') {
          setKiroConfigError(t('providerSetup.device.startUrlHttps'));
          return null;
        }
      } catch {
        setKiroConfigError(t('providerSetup.device.invalidStartUrl'));
        return null;
      }
    }
    setKiroConfigError(null);
    return startUrl ? { startUrl, region } : { region };
  };

  const connectHint = hasRegion
    ? t('providerSetup.device.hintMinimax')
    : isKiro
      ? t('providerSetup.device.hintKiro')
      : t('providerSetup.device.hintDefault');

  const clearPollTimer = () => {
    if (pollTimer.current !== undefined) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = undefined;
    }
  };

  const isStale = (flowGeneration: number) =>
    isDisposed.current || flowGeneration !== activeFlowGeneration.current;

  const schedulePoll = (delayMs: number, flowGeneration = activeFlowGeneration.current) => {
    clearPollTimer();
    if (isStale(flowGeneration)) return;
    pollTimer.current = window.setTimeout(() => {
      if (isStale(flowGeneration)) return;
      void runPoll(flowGeneration);
    }, delayMs);
  };

  const runPoll = async (flowGeneration = activeFlowGeneration.current) => {
    if (isStale(flowGeneration)) return;
    const current = flowRef.current;
    if (!current) return;

    if (Date.now() >= current.expiresAt) {
      clearPollTimer();
      setStatusMessage(null);
      setFlow(null);
      toast.error(t('providerSetup.device.expired'));
      return;
    }

    try {
      const result = await api().poll(current.flowId);
      if (isStale(flowGeneration)) return;
      const latestFlow = flowRef.current;
      if (!latestFlow || latestFlow.flowId !== current.flowId) {
        return;
      }

      if (result.status === 'success') {
        clearPollTimer();
        toast.success(
          t('providerSetup.shared.subscriptionConnected', { name: latest.current.provDef.name }),
        );
        setAddingAccount(false);
        setFlow(null);
        latest.current.onUpdate();
        return;
      }

      if (result.status === 'error') {
        clearPollTimer();
        setStatusMessage(null);
        setFlow(null);
        toast.error(
          result.message ??
            t('providerSetup.device.loginFailed', { name: latest.current.provDef.name }),
        );
        return;
      }

      setStatusMessage(result.message ?? t('providerSetup.device.waitingApproval'));
      schedulePoll(
        result.pollIntervalMs ?? latestFlow.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
        flowGeneration,
      );
    } catch {
      if (isStale(flowGeneration)) return;
      clearPollTimer();
      setStatusMessage(null);
      setFlow(null);
      toast.error(t('providerSetup.device.checkFailed'));
    }
  };

  const handleStart = async () => {
    const startOptions = buildStartOptions();
    if (startOptions === null) return;
    // Open the popup synchronously inside the click handler to keep the
    // user-gesture flag alive; without this, browsers block the post-await
    // window.open as a "programmatic popup". noopener can't be used here
    // because Chrome returns null with it set, and we need the popup ref
    // to redirect it later — we null `popup.opener` ourselves instead.
    const popup = window.open('about:blank', '_blank');
    if (!popup) {
      toast.error(t('providerSetup.shared.popupBlocked'));
      return;
    }
    // Defang the opener-attack vector that noopener would normally prevent;
    // the popup is about:blank (same-origin) so this assignment can't throw.
    popup.opener = null;

    latest.current.setBusy(true);
    const flowGeneration = ++activeFlowGeneration.current;
    clearPollTimer();
    setStatusMessage(null);
    try {
      const nextFlow = await api().start(latest.current.agentName, startOptions);
      if (isStale(flowGeneration)) {
        popup.close();
        return;
      }
      popup.location.replace(nextFlow.verificationUri);
      setFlow(nextFlow);
      schedulePoll(nextFlow.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, flowGeneration);
    } catch {
      popup.close();
      if (isStale(flowGeneration)) return;
      setFlow(null);
    } finally {
      if (!isStale(flowGeneration)) latest.current.setBusy(false);
    }
  };

  // When "Add another key" is clicked in the header, launch a new device code flow.
  useEffect(() => {
    if (props.addKeyOpen && props.connected && !props.busy) {
      setAddingAccount(true);
      props.setAddKeyOpen?.(false);
      void handleStart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.addKeyOpen, props.connected, props.busy]);

  useEffect(() => {
    isDisposed.current = false;
    return () => {
      isDisposed.current = true;
      activeFlowGeneration.current += 1;
      clearPollTimer();
    };
  }, []);

  const cancelAddAccount = () => {
    setAddingAccount(false);
    setFlow(null);
    setStatusMessage(null);
    setAltToken('');
    setAltError(null);
    clearPollTimer();
  };

  const revoke = async (label?: string) => {
    props.setBusy(true);
    try {
      const deviceApi = api();
      const result = await (label
        ? deviceApi.revoke(props.agentName, label)
        : deviceApi.revoke(props.agentName));
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
        {flow ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-dim">
              {t('providerSetup.device.tabOpened', { name: props.provDef.name })}
            </p>
            {statusMessage ? <p className="text-sm text-muted">{statusMessage}</p> : null}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              <p className="text-sm text-dim">{connectHint}</p>
              {hasRegion ? (
                <div>
                  <label className="label" htmlFor="minimax-region">
                    {t('providerSetup.shared.region')}
                  </label>
                  <select
                    id="minimax-region"
                    className="field"
                    value={selectedRegion}
                    disabled={props.busy}
                    onChange={(e) => setSelectedRegion(e.currentTarget.value as MinimaxOAuthRegion)}
                  >
                    <option value="global">{t('providerSetup.device.regionGlobal')}</option>
                    <option value="cn">{t('providerSetup.device.regionCn')}</option>
                  </select>
                </div>
              ) : null}
              {isKiro ? (
                <>
                  <div>
                    <span className="label">{t('providerSetup.shared.region')}</span>
                    <Select
                      label={t('providerSetup.shared.region')}
                      options={KIRO_REGION_OPTIONS}
                      value={kiroRegion}
                      disabled={props.busy}
                      portal
                      maxDropdownHeight={240}
                      ariaDescribedBy={kiroErrorId}
                      onChange={(value) => {
                        setKiroRegion(value);
                        setKiroConfigError(null);
                      }}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="kiro-start-url">
                      {t('providerSetup.device.startUrl')}{' '}
                      <span className="text-faint">{t('providerSetup.device.optional')}</span>
                    </label>
                    <input
                      id="kiro-start-url"
                      className="field"
                      aria-invalid={kiroConfigError ? true : undefined}
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      // i18n-ignore: example URL
                      placeholder="https://your-domain.awsapps.com/start"
                      value={kiroStartUrl}
                      disabled={props.busy}
                      aria-describedby={kiroErrorId}
                      onChange={(e) => {
                        setKiroStartUrl(e.currentTarget.value);
                        setKiroConfigError(null);
                      }}
                    />
                  </div>
                  {kiroConfigError ? (
                    <div id="kiro-identity-error" className="form-error">
                      {kiroConfigError}
                    </div>
                  ) : null}
                </>
              ) : null}
              <Button block busy={props.busy} onClick={() => void handleStart()}>
                {t('providerSetup.device.connectWith', { name: props.provDef.name })}
              </Button>
            </div>
            {alt ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3 text-xs text-faint">
                  <span className="h-px flex-1 bg-line" />
                  <span>{alt.dividerLabel}</span>
                  <span className="h-px flex-1 bg-line" />
                </div>
                <input
                  id="minimax-alt-token"
                  className="field font-mono"
                  aria-invalid={altError ? true : undefined}
                  type="text"
                  autoComplete="off"
                  placeholder={alt.placeholder}
                  aria-label={t('providerSetup.device.codingPlanToken', {
                    name: props.provDef.name,
                  })}
                  value={altToken}
                  disabled={props.busy}
                  onChange={(e) => {
                    setAltToken(e.currentTarget.value);
                    setAltError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleAltConnect();
                  }}
                />
                {altError ? <div className="form-error">{altError}</div> : null}
                <Button
                  variant="ghost"
                  block
                  busy={props.busy}
                  disabled={!altToken.trim()}
                  onClick={() => void handleAltConnect()}
                >
                  {t('providerSetup.device.connectWithToken')}
                </Button>
              </div>
            ) : null}
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
          ariaLabel={t('providerSetup.shared.accountsFor', { name: props.provDef.name })}
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
