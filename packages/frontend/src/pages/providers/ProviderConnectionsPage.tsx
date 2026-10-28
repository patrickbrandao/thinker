import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ChevronDown, LayoutGrid, List, Pencil, Shapes } from 'lucide-react';
import {
  getAgents,
  getCustomProviders,
  getProviders as getAgentProviders,
} from '../../services/api.js';
import {
  getProviders as getGlobalProviders,
  getProviderUsage,
  mergeUsage,
  connectionUsage,
  type TenantProviderSummary,
} from '../../services/api/providers.js';
import { analyticsPing, routingPing } from '../../services/sse.js';
import { toggleScrollFade } from '../../services/scroll-fade.js';
import { renameProviderKey } from '../../services/api/routing.js';
import { getPlaygroundAgent } from '../../services/api/playground.js';
import type { AuthType, CustomProviderData, RoutingProvider } from '../../services/api.js';
import type { CustomProviderPrefill, ProviderDeepLink } from '../../services/routing-params.js';
import { PROVIDERS, subscriptionCatalog, type ProviderDef } from '../../services/providers.js';
import { formatCost, formatNumber, formatTimeAgo } from '../../services/formatters.js';
import InfoTooltip from '../../components/InfoTooltip.jsx';
import { providerIcon } from '../../components/ProviderIcon.jsx';
import { toast } from '../../services/toast-store.js';
import { t } from '../../i18n/index.js';
import { me, roleCan } from '../../services/session-store.js';
import ProviderSelectModal from '../../components/ProviderSelectModal.jsx';
import CustomProviderForm from '../../components/CustomProviderForm.jsx';
import Sparkline from '../../components/Sparkline.jsx';
import { attemptSuccessRate } from '../../services/api/analytics.js';
import { Badge, Button, Modal, Skel, cx } from '../../components/ui.js';
import { useResource } from '../../lib/use-resource.js';
import { useSignal } from '../../lib/signal.js';

type ProviderPageKind = 'subscriptions' | 'byok' | 'local';
type ViewMode = 'list' | 'grid';

interface ProviderConnectionsPageProps {
  kind: ProviderPageKind;
}

interface AgentRow {
  agent_name: string;
}

interface PageCopy {
  title: string;
  heading: string;
  subtitle: string;
  addLabel: string;
  customAddLabel?: string;
  connectedHeading: string;
  supportedHeading: string;
  authType: AuthType;
  /** Cost metric (stat card + per-row column) — BYOK only. Subscriptions and
   *  local providers have no real cost figure to show. */
  metricLabel?: string;
  metricTooltip?: string;
  rowMetricHeading?: string;
  activeLabel: (count: number) => string;
}

/** Page copy, read at render time so it follows the active language. */
const pageCopy = (kind: ProviderPageKind): PageCopy => {
  if (kind === 'subscriptions')
    return {
      title: t('providers.page.subscriptions.title'),
      heading: t('providers.kind.subscriptions'),
      subtitle: t('providers.page.subscriptions.subtitle'),
      addLabel: t('providers.connect'),
      connectedHeading: t('providers.page.subscriptions.connectedHeading'),
      supportedHeading: t('providers.page.subscriptions.supportedHeading'),
      authType: 'subscription',
      activeLabel: (n) => t('providers.page.activeConnections', n),
    };
  if (kind === 'byok')
    return {
      title: t('providers.page.byok.title'),
      heading: t('providers.kind.byok'),
      subtitle: t('providers.page.byok.subtitle'),
      addLabel: t('providers.connect'),
      customAddLabel: t('providers.page.addCustomProvider'),
      connectedHeading: t('providers.page.byok.connectedHeading'),
      supportedHeading: t('providers.page.byok.supportedHeading'),
      authType: 'api_key',
      metricLabel: t('providers.page.totalApiCost30d'),
      metricTooltip: t('providers.page.totalApiCostTooltip'),
      rowMetricHeading: t('providers.page.cost30d'),
      activeLabel: (n) => t('providers.page.activeKeys', n),
    };
  return {
    title: t('providers.page.local.title'),
    heading: t('providers.kind.local'),
    subtitle: t('providers.page.local.subtitle'),
    addLabel: t('providers.connect'),
    connectedHeading: t('providers.page.local.connectedHeading'),
    supportedHeading: t('providers.page.local.supportedHeading'),
    authType: 'local',
    activeLabel: (n) => t('providers.page.activeConnections', n),
  };
};

const CONNECTIONS_COLLAPSE_THRESHOLD = 6;

const providerListForKind = (
  kind: ProviderPageKind,
  hasConnection: (providerId: string) => boolean,
): ProviderDef[] => {
  if (kind === 'subscriptions') return subscriptionCatalog(PROVIDERS, hasConnection);
  if (kind === 'local') return PROVIDERS.filter((provider) => provider.localOnly);
  return PROVIDERS.filter((provider) => !provider.subscriptionOnly && !provider.localOnly);
};

const standardProviderName = (providerId: string): string | null =>
  PROVIDERS.find((provider) => provider.id === providerId)?.name ?? null;

const customProviderName = (
  providerId: string,
  customProviders: readonly CustomProviderData[],
): string | null => {
  if (!providerId.startsWith('custom:')) return null;
  const id = providerId.slice('custom:'.length);
  return customProviders.find((provider) => provider.id === id)?.name ?? null;
};

const providerDisplayName = (
  providerId: string,
  customProviders: readonly CustomProviderData[],
): string =>
  customProviderName(providerId, customProviders) ?? standardProviderName(providerId) ?? providerId;

const formatRate = (rate: number | null) => (rate == null ? '—' : `${(rate * 100).toFixed(1)}%`);

/** Shimmer placeholder shown in usage cells while the usage fetch is in flight. */
const UsageShimmer = ({ width }: { width?: number }) => <Skel width={width ?? 56} height={12} />;

const StatusBadge = ({ active }: { active: boolean }) =>
  active ? (
    <Badge tone="ok">{t('providers.active')}</Badge>
  ) : (
    <Badge>{t('providers.inactive')}</Badge>
  );

function ProviderMark({
  providerId,
  name,
  size = 20,
}: {
  providerId: string;
  name: string;
  size?: number;
}) {
  const icon = providerIcon(providerId, size);
  if (icon)
    return (
      <span className="flex shrink-0 items-center" style={{ width: size, height: size }}>
        {icon}
      </span>
    );
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-[4px] bg-accent-tint font-semibold text-accent',
        size > 20 ? 'text-xs' : 'text-[11px]',
      )}
      style={{ width: size, height: size }}
    >
      {(name || providerId).charAt(0).toUpperCase()}
    </span>
  );
}

function ActiveLabel({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-ok">
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  );
}

export default function ProviderConnectionsPage({ kind }: ProviderConnectionsPageProps) {
  useSignal(me);
  const copy = pageCopy(kind);
  const canManage = roleCan.manageProviders();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showModal, setShowModal] = useState(false);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [deepLink, setDeepLink] = useState<ProviderDeepLink | null>(null);
  const [customProviderPrefill, setCustomProviderPrefill] = useState<CustomProviderPrefill | null>(
    null,
  );
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  // Past this many connections the list is capped inside its own card, so the
  // supported-provider catalog below stays reachable without a long scroll.
  const [connectionsExpanded, setConnectionsExpanded] = useState(false);
  const connectionsScroller = useRef<HTMLDivElement>(null);

  // Inline rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);

  const analyticsTick = useSignal(analyticsPing);
  const routingTick = useSignal(routingPing);

  // CONFIG resource — paints the page immediately (cheap endpoint, no
  // agent_messages scan).
  const config = useResource(async () => {
    try {
      return await getGlobalProviders();
    } catch {
      return { providers: [], model_counts: {} };
    }
  }, []);

  // USAGE resource — the expensive 30d aggregation, fetched independently. Its
  // deps include the SSE pings so coalesced message activity (analyticsPing) or
  // a provider connect/disconnect/rename (routingPing) re-runs the usage fetch.
  const usage = useResource(async () => {
    try {
      return (await getProviderUsage()).providers;
    } catch {
      return [];
    }
  }, [analyticsTick, routingTick]);

  // Distinguish "loading" (shimmer the usage cells) from "loaded-zero" (a real
  // 0). Only the FIRST load shimmers; SSE-driven refetches keep the prior
  // numbers on screen so the table doesn't flicker.
  const usageLoading = usage.loading && usage.data === undefined;

  // Coordinate a usage refetch alongside config on connect/disconnect/rename.
  const refetchGlobalProviders = () => Promise.all([config.reload(), usage.reload()]);

  // Merge config + usage by (provider, auth_type). While usage is still loading
  // every row carries zeroed usage; `usageLoading` tells the view to shimmer
  // instead of rendering those zeros.
  const mergedProviders = useMemo(
    () => mergeUsage(config.data?.providers ?? [], usage.data),
    [config.data, usage.data],
  );

  const agents = useResource(async () => {
    try {
      const result = (await getAgents()) as { agents?: AgentRow[] } | AgentRow[];
      return Array.isArray(result) ? result : (result.agents ?? []);
    } catch {
      return [] as AgentRow[];
    }
  }, []);

  // Connections belong to the organization; the agent name only addresses the
  // routing endpoints. With no harness yet, the reserved Playground agent
  // stands in, so providers can be connected before the first harness.
  const noHarness = agents.data !== undefined && agents.data.length === 0;
  const playgroundAgent = useResource(
    async () => {
      try {
        return (await getPlaygroundAgent()).name;
      } catch {
        return '';
      }
    },
    [],
    { enabled: noHarness },
  );
  const firstAgentName = agents.data?.[0]?.agent_name ?? playgroundAgent.data ?? '';

  const modalProviders = useResource(async (): Promise<RoutingProvider[]> => {
    if (!firstAgentName) return [];
    try {
      return await getAgentProviders(firstAgentName);
    } catch {
      return [];
    }
  }, [firstAgentName]);

  const customProviders = useResource(async (): Promise<CustomProviderData[]> => {
    if (!firstAgentName) return [];
    try {
      return await getCustomProviders(firstAgentName);
    } catch {
      return [];
    }
  }, [firstAgentName]);

  const connectedSummaries = mergedProviders.filter(
    (provider) => provider.auth_type === copy.authType,
  );

  const hasUsage = (summary: TenantProviderSummary) =>
    summary.consumption_tokens > 0 || summary.consumption_messages > 0;

  const connectedRows: Array<{
    summary: TenantProviderSummary;
    connection: TenantProviderSummary['connections'][number];
    name: string;
  }> = [];
  for (const summary of connectedSummaries) {
    for (const connection of summary.connections) {
      if (!connection.is_active && kind !== 'subscriptions' && !hasUsage(summary)) continue;
      connectedRows.push({
        summary,
        connection,
        name: providerDisplayName(summary.provider, customProviders.data ?? []),
      });
    }
  }

  const connectionsCollapsible = connectedRows.length > CONNECTIONS_COLLAPSE_THRESHOLD;
  const connectionsCollapsed = connectionsCollapsible && !connectionsExpanded;
  const toggleConnections = () => {
    setConnectionsExpanded((open) => !open);
    // Expanding takes the cap off, which drops the scroll position. The
    // at-bottom flag from before it would otherwise survive into the next
    // collapse and keep the fade hidden at the top of the list.
    const scroller = connectionsScroller.current;
    if (scroller) {
      scroller.scrollTop = 0;
      scroller.parentElement?.classList.remove('scroll-panel--at-bottom');
    }
  };

  const connectedByProvider = new Map<string, TenantProviderSummary>();
  for (const summary of connectedSummaries) connectedByProvider.set(summary.provider, summary);

  const catalogProviders = providerListForKind(
    kind,
    (providerId) =>
      connectedByProvider.get(providerId)?.connections.some((connection) => connection.is_active) ??
      false,
  );

  const activeConnectionCount = (providerId: string) =>
    connectedByProvider.get(providerId)?.connections.filter((connection) => connection.is_active)
      .length ?? 0;

  const totalApiCost = connectedSummaries.reduce(
    (sum, summary) => sum + summary.consumption_cost,
    0,
  );

  // Attempt-world totals for the header cards: summed over THIS page's rows
  // (provider + auth_type grain), so the Subscriptions page never blends an
  // api_key connection's failures into its numbers, and vice versa.
  const totalAttempts = connectedSummaries.reduce((sum, s) => sum + s.attempts_30d, 0);
  const totalAttemptsSucceeded = connectedSummaries.reduce((sum, s) => sum + s.succeeded_30d, 0);

  const connectionDenominator = (summary: TenantProviderSummary) =>
    Math.max(
      summary.connections.filter((connection) => connection.is_active || hasUsage(summary)).length,
      summary.connection_count,
      1,
    );

  // Per-connection usage at the (provider, auth_type, label) grain: two
  // connections of the same provider and type never share numbers. Falls back
  // to the group's even split only while the label rows are missing.
  const usageForConnection = (
    summary: TenantProviderSummary,
    connection: { label?: string | null },
  ) => connectionUsage(usage.data, summary.provider, summary.auth_type, connection.label);

  const perConnectionTokens = (
    summary: TenantProviderSummary,
    connection: { label?: string | null },
  ) =>
    usageForConnection(summary, connection)?.consumption_tokens ??
    Math.round(summary.consumption_tokens / connectionDenominator(summary));

  const perConnectionCost = (
    summary: TenantProviderSummary,
    connection: { label?: string | null },
  ) =>
    usageForConnection(summary, connection)?.consumption_cost ??
    summary.consumption_cost / connectionDenominator(summary);

  const connectionLastUsedAt = (
    summary: TenantProviderSummary,
    connection: { label?: string | null },
  ) =>
    usageForConnection(summary, connection)?.last_used_at ??
    (summary.connections.length === 1 ? summary.last_used_at : null);

  const showMetricCard = !!copy.metricLabel && (connectedRows.length > 0 || totalApiCost > 0);

  const activeLabel = (count: number) => {
    if (kind === 'local') return t('providers.connected');
    return copy.activeLabel(count);
  };

  const startRename = (connectionId: string, currentLabel: string, e: SyntheticEvent) => {
    e.stopPropagation();
    setRenamingId(connectionId);
    setRenameValue(currentLabel);
    setRenameError('');
  };

  const cancelRename = (e?: SyntheticEvent) => {
    e?.stopPropagation();
    setRenamingId(null);
    setRenameError('');
  };

  const submitRename = async (
    provider: string,
    currentLabel: string,
    authType: string,
    e?: SyntheticEvent,
  ) => {
    e?.stopPropagation();
    const newLabel = renameValue.trim();
    if (!newLabel) {
      setRenameError(t('providers.nameEmpty'));
      return;
    }
    if (newLabel === currentLabel) {
      cancelRename();
      return;
    }
    if (!firstAgentName) return;
    setRenameBusy(true);
    setRenameError('');
    try {
      await renameProviderKey(
        firstAgentName,
        provider,
        currentLabel,
        newLabel,
        authType as AuthType,
      );
      toast.success(t('providers.connectionRenamed'));
      setRenamingId(null);
      void refetchGlobalProviders();
    } catch (err: unknown) {
      setRenameError((err as { message?: string })?.message ?? t('providers.renameFailed'));
    } finally {
      setRenameBusy(false);
    }
  };

  const openModal = (providerId?: string) => {
    setCustomProviderPrefill(null);
    // Deep-link with the page's auth type so the connection form opens in the
    // matching mode (e.g. the Subscriptions page opens the OAuth/subscription
    // flow rather than the API-key form for providers that support both).
    setDeepLink(providerId ? { providerId, authType: copy.authType } : null);
    void modalProviders.reload();
    setShowModal(true);
  };

  // Deep-link support: visiting a provider page with ?add=true auto-opens the
  // connect modal so onboarding surfaces can route a user straight into adding
  // a provider. React on every navigation (not just initial mount) and clear the
  // param (replace) so a refresh or back-nav doesn't re-trigger it.
  const addParam = searchParams.get('add');
  useEffect(() => {
    if (addParam !== 'true') return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('add');
        return next;
      },
      { replace: true },
    );
    openModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addParam]);

  const handleCustomModalClose = () => {
    setShowCustomModal(false);
    void refetchGlobalProviders();
    void customProviders.reload();
  };

  const handleModalClose = () => {
    setShowModal(false);
    setDeepLink(null);
    setCustomProviderPrefill(null);
    void refetchGlobalProviders();
  };

  const handleModalUpdate = async () => {
    await Promise.all([
      modalProviders.reload(),
      refetchGlobalProviders(),
      customProviders.reload(),
    ]);
  };

  const goToConnection = (id: string) => navigate(`/providers/connections/${id}`);

  const connectButton = (providerId: string) =>
    canManage ? (
      <Button
        variant="ghost"
        size="sm"
        className="whitespace-nowrap"
        disabled={!firstAgentName}
        onClick={() => openModal(providerId)}
      >
        {copy.addLabel}
      </Button>
    ) : null;

  return (
    <div className="page wide">
      <title>{copy.title}</title>
      {copy.customAddLabel && canManage ? (
        <div className="page-head justify-end">
          <div className="page-actions">
            <Button variant="ghost" size="sm" onClick={() => setShowCustomModal(true)}>
              <Shapes size={14} aria-hidden="true" />
              {copy.customAddLabel}
            </Button>
          </div>
        </div>
      ) : null}

      {connectedRows.length > 0 ? (
        <>
          <div className="stat-tiles mb-6">
            {showMetricCard ? (
              <div className="stat-tile">
                <div className="stat-label">{copy.metricLabel}</div>
                <div className="stat-value">
                  {usageLoading ? (
                    <UsageShimmer width={72} />
                  ) : (
                    (formatCost(totalApiCost) ?? '$0.00')
                  )}
                </div>
              </div>
            ) : null}
            <div className="stat-tile">
              <div className="stat-label inline-flex items-center gap-1">
                {t('providers.totalAttempts30d')}
                <InfoTooltip text={t('ui.analytics.totalAttempts')} />
              </div>
              <div className="stat-value">{formatNumber(totalAttempts)}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label inline-flex items-center gap-1">
                {t('providers.successRate30d')}
                <InfoTooltip text={t('ui.analytics.connectionSuccessRate30d')} />
              </div>
              <div className="stat-value">
                {formatRate(
                  attemptSuccessRate({
                    attempts: totalAttempts,
                    succeeded: totalAttemptsSucceeded,
                  }),
                )}
              </div>
            </div>
          </div>

          <h2 className="mb-3 text-sm font-semibold text-ink">{copy.connectedHeading}</h2>
          <div
            className={cx(
              'connections-panel panel mb-6 overflow-hidden',
              connectionsCollapsed && 'connections-panel--collapsed',
            )}
          >
            <div className="connections-panel__viewport group relative">
              <div
                className={cx(
                  'connections-panel__body overflow-x-auto',
                  connectionsCollapsed &&
                    'max-h-[340px] overflow-y-auto [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-[1] [&_thead_th]:bg-elev',
                )}
                id="connected-connections"
                ref={connectionsScroller}
                onScroll={toggleScrollFade}
              >
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('providers.page.colProvider')}</th>
                      <th>{t('providers.page.colConnection')}</th>
                      <th>{t('providers.page.colStatus')}</th>
                      <th>{t('providers.page.colUsage30d')}</th>
                      {copy.rowMetricHeading ? <th>{copy.rowMetricHeading}</th> : null}
                      <th>
                        <span className="inline-flex items-center gap-1">
                          {t('providers.totalAttempts30d')}
                          <InfoTooltip text={t('ui.analytics.totalAttempts')} />
                        </span>
                      </th>
                      <th>
                        <span className="inline-flex items-center gap-1">
                          {t('providers.successRate30d')}
                          <InfoTooltip text={t('ui.analytics.connectionSuccessRate30d')} />
                        </span>
                      </th>
                      <th>{t('providers.lastUsed')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {connectedRows.map((row) => {
                      const u = usageForConnection(row.summary, row.connection);
                      const spark = u?.sparkline_7d ?? row.summary.sparkline_7d;
                      const lastUsed = connectionLastUsedAt(row.summary, row.connection);
                      const authType = row.summary.auth_type ?? copy.authType;
                      return (
                        <tr
                          key={row.connection.id}
                          className="group/row cursor-pointer"
                          tabIndex={0}
                          onClick={() => goToConnection(row.connection.id)}
                          onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
                            if (event.target !== event.currentTarget) return;
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              goToConnection(row.connection.id);
                            }
                          }}
                        >
                          <td>
                            <span className="flex items-center gap-2.5">
                              <ProviderMark providerId={row.summary.provider} name={row.name} />
                              <span className="row-title">{row.name}</span>
                              {row.summary.provider.startsWith('custom:') ? (
                                <Badge tone="outline">{t('providers.custom')}</Badge>
                              ) : null}
                            </span>
                          </td>
                          <td className="text-muted" onClick={(e) => e.stopPropagation()}>
                            {renamingId === row.connection.id ? (
                              <>
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    className="field h-7 w-32"
                                    aria-invalid={renameError ? true : undefined}
                                    value={renameValue}
                                    autoFocus
                                    onChange={(e) => {
                                      setRenameValue(e.currentTarget.value);
                                      setRenameError('');
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter')
                                        void submitRename(
                                          row.summary.provider,
                                          row.connection.label,
                                          authType,
                                          e,
                                        );
                                      if (e.key === 'Escape') cancelRename(e);
                                    }}
                                  />
                                  <Button
                                    size="sm"
                                    disabled={renameBusy}
                                    onClick={(e) =>
                                      void submitRename(
                                        row.summary.provider,
                                        row.connection.label,
                                        authType,
                                        e,
                                      )
                                    }
                                  >
                                    {t('common.save')}
                                  </Button>
                                  <Button variant="ghost" size="sm" onClick={cancelRename}>
                                    {t('common.cancel')}
                                  </Button>
                                </div>
                                {renameError ? (
                                  <div className="mt-0.5 text-xs text-danger">{renameError}</div>
                                ) : null}
                              </>
                            ) : (
                              <span className="inline-flex cursor-default items-center gap-1.5">
                                {row.connection.label}
                                {canManage ? (
                                  <button
                                    type="button"
                                    className="inline-flex cursor-pointer items-center rounded-control border-0 bg-transparent p-0.5 text-muted opacity-0 transition-opacity group-hover/row:opacity-100 hover:text-ink focus-visible:opacity-100"
                                    onClick={(e) =>
                                      startRename(row.connection.id, row.connection.label, e)
                                    }
                                    aria-label={t('providers.page.renameAria', {
                                      label: row.connection.label,
                                    })}
                                  >
                                    <Pencil size={13} aria-hidden="true" />
                                  </button>
                                ) : null}
                              </span>
                            )}
                          </td>
                          <td>
                            <StatusBadge active={row.connection.is_active} />
                          </td>
                          <td>
                            {usageLoading ? (
                              <UsageShimmer width={96} />
                            ) : (
                              <div className="flex items-center gap-2 whitespace-nowrap">
                                {spark?.length ? (
                                  <span className="shrink-0">
                                    <Sparkline data={spark} width={60} height={20} />
                                  </span>
                                ) : null}
                                <span>
                                  {formatNumber(perConnectionTokens(row.summary, row.connection))}{' '}
                                  {t('providers.page.tokensSuffix')}
                                </span>
                              </div>
                            )}
                          </td>
                          {copy.rowMetricHeading ? (
                            <td className="num">
                              {usageLoading ? (
                                <UsageShimmer />
                              ) : (
                                (formatCost(perConnectionCost(row.summary, row.connection)) ??
                                '$0.00')
                              )}
                            </td>
                          ) : null}
                          {/* Attempt reliability at the row's own grain (provider +
                          auth_type): a subscription row never shows a rate
                          blended with the provider's api_key traffic. */}
                          <td className="num">
                            {usageLoading ? (
                              <UsageShimmer width={48} />
                            ) : (
                              formatNumber(u?.attempts_30d ?? row.summary.attempts_30d)
                            )}
                          </td>
                          <td className="num">
                            {usageLoading ? (
                              <UsageShimmer width={48} />
                            ) : (
                              formatRate(
                                attemptSuccessRate({
                                  attempts: u?.attempts_30d ?? row.summary.attempts_30d,
                                  succeeded: u?.succeeded_30d ?? row.summary.succeeded_30d,
                                }),
                              )
                            )}
                          </td>
                          <td className="whitespace-nowrap text-xs text-muted">
                            {usageLoading ? (
                              <UsageShimmer width={48} />
                            ) : lastUsed ? (
                              formatTimeAgo(lastUsed)
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="row-actions">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="whitespace-nowrap"
                              onClick={(event) => {
                                event.stopPropagation();
                                goToConnection(row.connection.id);
                              }}
                            >
                              {t('providers.page.viewDetails')}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {connectionsCollapsed ? (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-elev to-transparent group-[.scroll-panel--at-bottom]:hidden"
                />
              ) : null}
            </div>
            {connectionsCollapsible ? (
              <button
                type="button"
                className="connections-panel__toggle flex w-full cursor-pointer items-center justify-center gap-1.5 border-0 border-t border-solid border-line bg-transparent px-3 py-2 text-xs font-medium text-muted hover:bg-s2 hover:text-ink"
                aria-expanded={connectionsExpanded}
                aria-controls="connected-connections"
                onClick={toggleConnections}
              >
                {connectionsExpanded
                  ? t('common.showLess')
                  : t('providers.page.showAll', { count: connectedRows.length })}
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  className={cx('transition-transform', connectionsExpanded && 'rotate-180')}
                />
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="m-0 text-sm font-semibold text-ink">{copy.supportedHeading}</h2>
        <div className="segmented" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'grid'}
            aria-label={t('providers.page.gridView')}
            className="inline-flex items-center"
            onClick={() => setViewMode('grid')}
          >
            <LayoutGrid size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'list'}
            aria-label={t('providers.page.listView')}
            className="inline-flex items-center"
            onClick={() => setViewMode('list')}
          >
            <List size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      {viewMode === 'list' ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('providers.page.colProvider')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {catalogProviders.map((provider) => {
                const activeCount = activeConnectionCount(provider.id);
                return (
                  <tr key={provider.id}>
                    <td>
                      <span className="flex items-center gap-2.5">
                        <ProviderMark providerId={provider.id} name={provider.name} />
                        <span className="row-title">{provider.name}</span>
                      </span>
                    </td>
                    <td className="row-actions">
                      <span className="inline-flex items-center justify-end gap-2">
                        {activeCount > 0 ? (
                          <ActiveLabel>{activeLabel(activeCount)}</ActiveLabel>
                        ) : null}
                        {connectButton(provider.id)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card-grid">
          {catalogProviders.map((provider) => {
            const activeCount = activeConnectionCount(provider.id);
            return (
              <div key={provider.id} className="card flex flex-col gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <ProviderMark providerId={provider.id} name={provider.name} size={24} />
                  <span className="truncate text-sm font-semibold text-ink">{provider.name}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  {activeCount > 0 ? (
                    <ActiveLabel>{activeLabel(activeCount)}</ActiveLabel>
                  ) : (
                    <span />
                  )}
                  {connectButton(provider.id)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && firstAgentName ? (
        <ProviderSelectModal
          agentName={firstAgentName}
          providers={modalProviders.data ?? []}
          customProviders={customProviders.data ?? []}
          customProviderPrefill={customProviderPrefill}
          providerDeepLink={deepLink}
          initialTab={copy.authType}
          onUpdate={handleModalUpdate}
          onClose={handleModalClose}
        />
      ) : null}

      <Modal
        open={showCustomModal && !!firstAgentName}
        onClose={handleCustomModalClose}
        label={t('providers.page.addCustomProvider')}
        wide
      >
        <CustomProviderForm
          agentName={firstAgentName}
          onCreated={handleCustomModalClose}
          onBack={handleCustomModalClose}
        />
      </Modal>
    </div>
  );
}
