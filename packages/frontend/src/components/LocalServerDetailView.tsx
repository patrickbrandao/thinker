import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, Container, Copy, RefreshCw, Server } from 'lucide-react';
import { LOCAL_SERVER_HINTS, type LocalServerHint } from 'thinker-shared';
import type { ProviderDef } from '../services/providers.js';
import {
  createCustomProvider,
  deleteCustomProvider,
  probeCustomProvider,
  updateCustomProvider,
  type CustomProviderData,
} from '../services/api.js';
import { toast } from '../services/toast-store.js';
import { t } from '../i18n/index.js';
import { checkLocalLlmHost } from '../services/setup-status.js';
import { useResource } from '../lib/use-resource.js';
import { providerIcon } from './ProviderIcon.js';
import { Button, IconButton, cx } from './ui.js';

interface Props {
  agentName: string;
  provider: ProviderDef;
  /** When set, the view opens in edit mode for an existing custom provider. */
  editData?: CustomProviderData;
  onConnected: () => void;
  onBack: () => void;
  /**
   * Optional: open the generic custom-provider form as an escape hatch.
   * Surfaced under the setup command when the provider hint supplies a
   * `notReachableHint` (llama.cpp pre-b3800 builds don't expose
   * `/v1/models`, so the probe can 404 even when the server is up).
   */
  onOpenCustomForm?: () => void;
}

interface ProbeState {
  models: string[];
  baseUrl: string;
}

const DOCKER_HOST = 'host.docker.internal';

/** Copies `text` and flips to a check for 2s; a failure toasts instead. */
function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('providerSetup.local.copyFailed'));
    }
  };
  return { copied, copy };
}

/** A command in a code block with a copy button pinned to its right edge. */
function CommandBlock({ command, ariaLabel }: { command: string; ariaLabel?: boolean }) {
  const { copied, copy } = useCopy();
  return (
    <div className="relative">
      <pre className="code whitespace-pre-wrap break-all pr-10 font-mono">{command}</pre>
      <button
        type="button"
        className={cx('icon-btn absolute right-1.5 top-1/2 -translate-y-1/2', copied && 'text-ok')}
        title={copied ? t('providerSetup.local.copiedBang') : t('common.copy')}
        aria-label={
          ariaLabel
            ? copied
              ? t('common.copied')
              : t('providerSetup.local.copyCommand')
            : undefined
        }
        onClick={() => void copy(command)}
      >
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
    </div>
  );
}

export default function LocalServerDetailView(props: Props) {
  const isEdit = !!props.editData;
  const hint: LocalServerHint | undefined = LOCAL_SERVER_HINTS[props.provider.id];

  const host = useResource(() => checkLocalLlmHost(), []);
  // `defaultLocalPort` is the gate that routes the tile click here in
  // the first place (see ProviderApiKeyTab), so it's always defined.
  const resolvedBaseUrl = props.editData
    ? props.editData.base_url
    : `http://${host.data ?? 'localhost'}:${props.provider.defaultLocalPort!}/v1`;

  // In edit mode, pre-select only the models that are already connected.
  const [selected, setSelected] = useState<Set<string>>(() =>
    props.editData ? new Set(props.editData.models.map((m) => m.model_name)) : new Set<string>(),
  );
  const [connecting, setConnecting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // First probe seeds "all selected" (connect mode) or keeps the edit
  // selection (edit mode); subsequent probes intersect-preserve.
  const hasSeeded = useRef(isEdit);

  const probe = useResource<ProbeState>(async () => {
    const url = resolvedBaseUrl;
    const wasConnected = hasSeeded.current;
    try {
      const { models } = await probeCustomProvider(props.agentName, url);
      const names = models.map((m) => m.model_name);
      if (!hasSeeded.current) {
        hasSeeded.current = true;
        setSelected(new Set(names));
      } else {
        const available = new Set(names);
        setSelected((prev) => new Set([...prev].filter((n) => available.has(n))));
      }
      return { models: names, baseUrl: url };
    } catch (err) {
      if (wasConnected) {
        toast.error(t('providerSetup.local.noLongerReachable', { name: props.provider.name }));
      }
      throw err;
    }
  }, [refreshKey, resolvedBaseUrl]);

  const retry = () => setRefreshKey((k) => k + 1);

  const toggleModel = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleConnect = async () => {
    const state = probe.data;
    if (!state || state.models.length === 0) return;
    const picked = Array.from(selected);
    const models = picked.map((name) => ({
      model_name: name,
      input_price_per_million_tokens: 0,
      output_price_per_million_tokens: 0,
    }));
    setConnecting(true);
    try {
      if (props.editData) {
        await updateCustomProvider(props.agentName, props.editData.id, { models });
        toast.success(t('providerSetup.local.updated', props.provider.name, picked.length));
      } else {
        await createCustomProvider(props.agentName, {
          name: props.provider.name,
          base_url: state.baseUrl,
          models,
        });
        toast.success(t('providerSetup.local.connectedModels', props.provider.name, picked.length));
      }
      props.onConnected();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t('providerSetup.local.failedConnect', { name: props.provider.name }),
      );
    } finally {
      setConnecting(false);
    }
  };

  const handleDelete = async () => {
    if (!props.editData) return;
    setDeleting(true);
    try {
      await deleteCustomProvider(props.agentName, props.editData.id);
      toast.success(t('providerSetup.local.disconnected', { name: props.provider.name }));
      props.onConnected();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t('providerSetup.local.failedDisconnect', { name: props.provider.name }),
      );
    } finally {
      setDeleting(false);
    }
  };

  const data = probe.data;
  const failed = !!probe.error;
  let body;
  if (probe.loading && !data) {
    body = (
      <div className="flex items-center gap-2 py-3 text-sm text-muted">
        <span className="spinner" aria-hidden="true" />
        <span>
          {t('providerSetup.local.checking', {
            url: resolvedBaseUrl || t('providerSetup.local.theServer'),
          })}
        </span>
      </div>
    );
  } else if (!failed && data && data.models.length > 0) {
    body = (
      <>
        <SuccessState
          models={data.models}
          baseUrl={data.baseUrl}
          selected={selected}
          onToggle={toggleModel}
          refreshing={probe.loading}
          onRefresh={retry}
        />
        <div className="flex items-center justify-end gap-3">
          {isEdit ? (
            <Button
              size="sm"
              variant="ghost"
              className="mr-auto"
              busy={deleting}
              onClick={() => void handleDelete()}
            >
              {t('providerSetup.local.deleteProvider')}
            </Button>
          ) : null}
          <Button
            size="sm"
            busy={connecting}
            disabled={selected.size === 0 || probe.loading}
            onClick={() => void handleConnect()}
          >
            {isEdit
              ? t('common.saveChanges')
              : t('providerSetup.local.connectModels', selected.size)}
          </Button>
        </div>
      </>
    );
  } else if (!failed && data) {
    body = (
      <EmptyModelsState providerName={props.provider.name} baseUrl={data.baseUrl} onRetry={retry} />
    );
  } else {
    body = (
      <FailureState
        providerName={props.provider.name}
        hint={hint}
        error={probe.error}
        isDocker={host.data === DOCKER_HOST}
        onRetry={retry}
        onOpenCustomForm={props.onOpenCustomForm}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <IconButton label={t('providerSetup.shared.backToProviders')} onClick={props.onBack}>
          <ChevronLeft size={16} aria-hidden="true" />
        </IconButton>
        <h2 className="text-base font-semibold text-ink">
          {isEdit
            ? t('providerSetup.local.editProvider')
            : t('providerSetup.shared.connectProvider')}
        </h2>
      </div>

      <div className="flex items-center gap-3">
        <span className="inline-flex size-8 items-center justify-center">
          {providerIcon(props.provider.id, 28) ?? (
            <span
              className="provider-card__logo-letter inline-flex size-8 items-center justify-center rounded-control text-xs font-semibold text-white"
              // The provider's brand color is data, not a theme token.
              style={{ background: props.provider.color }}
            >
              {props.provider.initial}
            </span>
          )}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink">{props.provider.name}</div>
          <div className="text-xs text-muted">{props.provider.subtitle}</div>
        </div>
      </div>

      {body}
    </div>
  );
}

/* ── Probe success ────────────────────────────────── */

function SuccessState(p: {
  models: string[];
  baseUrl: string;
  selected: Set<string>;
  onToggle: (name: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div>
      {/* Header row: model count + refresh */}
      <div className="mb-2 flex items-center">
        <span className="text-sm font-semibold text-ink">
          {t('providerSetup.local.modelsAvailable', p.models.length, p.baseUrl)}
        </span>
        <IconButton
          label={t('providerSetup.local.refreshList')}
          title={t('providerSetup.local.refresh')}
          className="ml-auto shrink-0"
          onClick={p.onRefresh}
          disabled={p.refreshing}
        >
          {p.refreshing ? (
            <span className="spinner" aria-hidden="true" />
          ) : (
            <RefreshCw size={14} aria-hidden="true" />
          )}
        </IconButton>
      </div>

      {/* Model list with toggle switches */}
      <div
        className={cx(
          'flex max-h-60 flex-col overflow-y-auto border-t border-line transition-opacity',
          p.refreshing && 'pointer-events-none opacity-60',
        )}
      >
        {p.models.map((name) => {
          const on = p.selected.has(name);
          return (
            <button
              key={name}
              type="button"
              role="switch"
              aria-checked={on}
              className="provider-toggle flex w-full items-center justify-between gap-3 border-b border-line bg-transparent py-2.5 text-left"
              onClick={() => p.onToggle(name)}
            >
              <span className="truncate text-sm text-ink">{name}</span>
              <span
                aria-hidden="true"
                aria-checked={on}
                className={cx(
                  'switch provider-toggle__switch shrink-0',
                  on && 'provider-toggle__switch--on',
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Server reachable but no models loaded ────────── */

function EmptyModelsState(p: { providerName: string; baseUrl: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="notice">
        <Server aria-hidden="true" />
        <span>
          {t('providerSetup.local.noModelsLoaded', { url: p.baseUrl, name: p.providerName })}
        </span>
      </div>

      <video
        src="/icons/lmstudio-load-models.mp4"
        preload="none"
        autoPlay
        loop
        muted
        playsInline
        disablePictureInPicture
        className="pointer-events-none w-full rounded-control border border-line"
      />

      <div className="flex justify-end">
        <Button size="sm" onClick={p.onRetry}>
          {t('common.retry')}
        </Button>
      </div>
    </div>
  );
}

/* ── Probe failure ────────────────────────────────── */

function FailureState(p: {
  providerName: string;
  hint?: LocalServerHint;
  error: unknown;
  isDocker: boolean;
  onRetry: () => void;
  onOpenCustomForm?: () => void;
}) {
  const errorMsg =
    p.error instanceof Error ? p.error.message : t('providerSetup.local.couldNotReach');
  const isDocker = !!p.hint?.dockerBindNote && p.isDocker;
  const notReachable = p.hint?.notReachableHint;

  return (
    <div className="flex flex-col gap-4">
      {/* Docker caveat first — it's a prerequisite for the server to be reachable */}
      {p.hint && isDocker ? <DockerCaveat hint={p.hint} errorMsg={errorMsg} /> : null}

      {/* Error card — only shown outside Docker (DockerCaveat renders it inline when in Docker) */}
      {!isDocker ? (
        <div className="notice whitespace-pre-line">
          <Server aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      ) : null}

      {p.hint ? (
        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold text-ink">
            {isDocker
              ? t('providerSetup.local.startServerStep')
              : t('providerSetup.local.startServer')}
          </div>
          <CommandBlock command={p.hint.setupCommand} />
          {p.hint.setupNote ? (
            <div className="text-xs leading-relaxed text-muted">{p.hint.setupNote}</div>
          ) : null}
          {/* GUI-launch fallback + setup video are LM-Studio specific; gate
              them on `persistsBindAcrossLaunches`, which today identifies
              GUI-wrapped local providers (CLI-only providers like llama.cpp
              don't have a "Developer → Start Server" menu to point at). */}
          {p.hint.persistsBindAcrossLaunches ? (
            <>
              <div className="mt-1 text-xs text-muted">
                {t('providerSetup.local.openDeveloper', { name: p.providerName })}
              </div>
              <video
                src="/icons/lmstudio-start-server.mp4"
                preload="none"
                autoPlay
                loop
                muted
                playsInline
                disablePictureInPicture
                className="pointer-events-none w-full rounded-control border border-line"
              />
            </>
          ) : null}
          {notReachable ? (
            <div className="mt-1 text-xs leading-relaxed text-muted">
              {notReachable.before}
              {p.onOpenCustomForm ? (
                <button
                  type="button"
                  className="link-action underline"
                  onClick={p.onOpenCustomForm}
                >
                  {notReachable.linkLabel}
                </button>
              ) : (
                // i18n-ignore: HTML quote entities
                <span>&ldquo;{notReachable.linkLabel}&rdquo;</span>
              )}
              {notReachable.after}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        {p.hint?.installUrl ? (
          <a
            href={p.hint.installUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm"
          >
            {t('providerSetup.shared.getProduct', { name: p.providerName })}
          </a>
        ) : null}
        <Button size="sm" className="ml-auto" onClick={p.onRetry}>
          {t('common.retry')}
        </Button>
      </div>
    </div>
  );
}

/* ── Docker caveat with GUI/CLI tabs ──────────────── */

function DockerCaveat(p: { hint: LocalServerHint; errorMsg: string }) {
  const [activeTab, setActiveTab] = useState<'gui' | 'cli'>('gui');
  const bindCommand = p.hint.dockerBindCommand ?? p.hint.setupCommand;
  const guiFix = p.hint.dockerGuiFix;

  return (
    <div className="provider-detail__caveat flex flex-col gap-3 text-sm text-dim">
      {/* Alert cards: overview of both problems */}
      <div className="notice is-info">
        <Container aria-hidden="true" />
        <span>{p.hint.dockerBindNote}</span>
      </div>
      <div className="notice whitespace-pre-line">
        <Server aria-hidden="true" />
        <span>{p.errorMsg}</span>
      </div>

      {/* Step 1: Running Thinker in Docker */}
      <div className="text-sm font-semibold text-ink">{t('providerSetup.local.dockerStep')}</div>

      {/* Tabs: GUI / CLI */}
      {guiFix ? (
        <>
          <div className="segmented w-full">
            {(['gui', 'cli'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className="flex-1"
                aria-pressed={activeTab === tab}
                onClick={() => setActiveTab(tab)}
              >
                {/* i18n-ignore: interface names */}
                {tab === 'gui' ? 'GUI' : 'CLI'}
              </button>
            ))}
          </div>
          {activeTab === 'gui' ? <div className="text-sm text-ink">{guiFix}</div> : null}
        </>
      ) : null}

      {/* CLI tab content (also shown when no GUI fix available) */}
      {activeTab === 'cli' || !guiFix ? <CommandBlock command={bindCommand} ariaLabel /> : null}

      {p.hint.persistsBindAcrossLaunches ? (
        <div className="text-xs">{t('providerSetup.local.onlyOnce')}</div>
      ) : null}
    </div>
  );
}
