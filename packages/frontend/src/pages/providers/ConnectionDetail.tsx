import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  getConnectionDetail,
  getProviderAnalytics,
  getPerAgentTimeseries,
  getPerAgentMessageTimeseries,
  getPerAgentCostTimeseries,
  getConnectionAttemptStatusTimeseries,
  getConnectionAttemptsByAgentTimeseries,
  getConnectionAttemptHttpStatusTimeseries,
  getConnectionAttemptBreakdown,
  attemptSuccessRate,
} from '../../services/api/analytics.js';
import { platformIcon } from 'thinker-shared';
import { PROVIDERS } from '../../services/providers.js';
import { providerIcon } from '../../components/ProviderIcon.jsx';
import FilterSelect from '../../components/FilterSelect.jsx';
import {
  formatNumber,
  formatCost,
  formatTimeAgo,
  customProviderColor,
} from '../../services/formatters.js';
import { getAgents, getCustomProviders as fetchCustomProviders } from '../../services/api.js';
import {
  renameConnection,
  disconnectConnection,
  refreshConnectionModels,
  setConnectionStreamWarmup,
} from '../../services/api/routing.js';
import UnifiedChartCard, { type ChartTab } from '../../components/UnifiedChartCard.jsx';
import InfoTooltip from '../../components/InfoTooltip.jsx';
import { AGENT_COLORS } from '../../components/MultiAgentTokenChart.jsx';
import Select from '../../components/Select.jsx';
import { setConnectionBreadcrumb } from '../../services/connection-breadcrumb-store.js';
import { toast } from '../../services/toast-store.js';
import { t, tMaybe } from '../../i18n/index.js';
import {
  MAX_STREAM_WARMUP_SECONDS,
  MIN_STREAM_WARMUP_SECONDS,
  parseWarmupSeconds,
  warmupMsToSecondsInput,
  streamWarmupError,
} from '../../services/stream-warmup.js';
import { roleCan } from '../../services/session-store.js';
import { getModelDisplayName } from '../../services/model-display.js';
import CustomProviderForm from '../../components/CustomProviderForm.jsx';
import LocalServerForm from '../../components/LocalServerForm.jsx';
import { useResource } from '../../lib/use-resource.js';
import {
  Badge,
  Button,
  ButtonLink,
  EmptyState,
  Modal,
  Panel,
  Skel,
  cx,
} from '../../components/ui.js';
import { ThemedIcon } from '../../components/setup-ui.js';

const AUTH_TYPE_KIND: Record<string, string> = {
  subscription: 'subscriptions',
  api_key: 'byok',
  local: 'local',
};

const BACK_LINKS: Record<string, string> = {
  subscription: '/providers/subscriptions',
  api_key: '/providers/usage-based',
  local: '/providers/local',
};

interface AgentRow {
  agent_name: string;
  agent_platform: string | null;
  tokens_30d: number;
  cost_30d: number;
  messages_30d: number;
  attempts_30d?: number;
  succeeded_30d?: number;
  pct_of_total: number;
  last_used: string | null;
}

interface ModelRow {
  model: string;
  tokens: number;
  cost: number;
  messages: number;
  pct_of_total: number;
}

interface ConnectionInfo {
  id: string;
  provider: string;
  auth_type: string;
  label: string;
  cached_model_count: number;
  key_prefix: string | null;
  connected_at: string;
  is_active: boolean;
  stream_warmup_ms?: number | null;
  last_used_at: string | null;
}

interface DetailResponse {
  connection: ConnectionInfo | null;
  agents: AgentRow[];
  model_usage: ModelRow[];
  recent_messages: any[];
}

interface AnalyticsResponse {
  summary: {
    messages: { value: number; trend_pct: number };
    tokens: { value: number; trend_pct: number };
  };
  token_usage: Array<{ hour?: string; date?: string; input_tokens: number; output_tokens: number }>;
  message_usage: Array<{ hour?: string; date?: string; count: number }>;
  attempts: { total: number; successful: number; success_rate: number };
}

type GroupBy = 'status' | 'http' | 'harness';
type Series = { agents: string[]; timeseries: Array<Record<string, number | string>> };

const CD_RANGES = ['24h', '7d', '30d', '90d', '365d'] as const;
const cdRangeOptions = () =>
  CD_RANGES.map((value) => ({ label: t(`providers.detail.range.${value}`), value }));

const readStorage = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeStorage = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
};

const backLinkFor = (authType: string | undefined) =>
  BACK_LINKS[authType ?? 'subscription'] ?? '/providers/subscriptions';
const backLabelFor = (authType: string | undefined) => {
  const kind = AUTH_TYPE_KIND[authType ?? 'subscription'];
  return (kind && tMaybe(`providers.kind.${kind}`)) ?? t('providers.kind.providers');
};

const formatRate = (rate: number | null) => (rate == null ? '—' : `${(rate * 100).toFixed(1)}%`);

/** Thin share bar + percentage used by the models and harnesses tables. */
function ShareBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-15 overflow-hidden rounded-full bg-s3">
        <div className="h-full rounded-full bg-ok" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted">{pct}%</span>
    </div>
  );
}

function StatTile({
  label,
  value,
  extra,
  title,
  onClick,
}: {
  label: ReactNode;
  value: ReactNode;
  extra?: ReactNode;
  title?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="stat-label flex items-center gap-1">{label}</span>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="stat-value">{value}</span>
        {extra}
      </div>
    </>
  );
  return onClick ? (
    <button
      type="button"
      className="stat-tile cursor-pointer text-left hover:border-line-strong"
      title={title}
      onClick={onClick}
    >
      {body}
    </button>
  ) : (
    <div className="stat-tile">{body}</div>
  );
}

const ConnectionDetail = () => {
  const { connectionId = '' } = useParams<{ connectionId: string }>();
  const navigate = useNavigate();
  const detail = useResource(
    () => getConnectionDetail(connectionId) as Promise<DetailResponse>,
    [connectionId],
  );

  const conn = detail.error ? null : (detail.data?.connection ?? null);
  const provDef = PROVIDERS.find((p) => p.id === conn?.provider);
  const isCustomProvider = conn?.provider?.startsWith('custom:') ?? false;
  const authType = conn?.auth_type;
  const provider = conn?.provider;
  const label = conn?.label;

  // Only the custom-provider edit form still goes through agent-scoped routes.
  const agents = useResource(async () => {
    try {
      const res = await getAgents();
      return ((res as any)?.agents ?? res ?? []) as Array<{ agent_name: string }>;
    } catch {
      return [] as Array<{ agent_name: string }>;
    }
  }, []);
  const firstAgentName = (agents.data ?? [])[0]?.agent_name ?? '';

  // Fetch custom provider name for custom: providers
  const customProvider = useResource(
    async () => {
      try {
        const list = await fetchCustomProviders(firstAgentName);
        const providerId = (provider ?? '').replace('custom:', '');
        return (list as any[])?.find((cp: any) => cp.id === providerId) ?? null;
      } catch {
        return null;
      }
    },
    [provider, firstAgentName],
    { enabled: isCustomProvider && !!firstAgentName },
  );
  const customProviderData = isCustomProvider ? (customProvider.data ?? null) : null;

  const providerDisplayName = provDef
    ? provDef.name
    : customProviderData
      ? (customProviderData.name as string)
      : (provider ?? '');

  const backLink = backLinkFor(authType);
  const backLabel = backLabelFor(authType);

  // Set breadcrumb for the topbar; cleared when the page unmounts.
  useEffect(() => {
    if (conn) {
      setConnectionBreadcrumb(
        providerDisplayName,
        backLinkFor(conn.auth_type),
        () => backLabelFor(conn.auth_type),
        conn.provider,
        conn.label,
      );
    }
  }, [conn?.provider, conn?.label, conn?.auth_type, providerDisplayName]);
  useEffect(() => () => setConnectionBreadcrumb(null), []);

  // Chart state (persisted in sessionStorage)
  const [chartRange, setChartRangeRaw] = useState<string>(() => {
    const v = readStorage(`chart-range:${connectionId}`);
    // Restore any persisted range, including longer windows, so saved
    // selections survive reload instead of silently resetting to the 7d default.
    return v && (CD_RANGES as readonly string[]).includes(v) ? v : '7d';
  });
  const setChartRange = (v: string) => {
    setChartRangeRaw(v);
    writeStorage(`chart-range:${connectionId}`, v);
  };
  const [chartView, setChartViewRaw] = useState<ChartTab>(() => {
    const v = readStorage(`chart-view:${connectionId}`);
    return v === 'tokens' || v === 'cost' || v === 'requests' ? v : 'tokens';
  });
  const setChartView = (v: ChartTab) => {
    setChartViewRaw(v);
    writeStorage(`chart-view:${connectionId}`, v);
  };

  // Attempts tab view: By HTTP status (default), attempt status or harness.
  // Persisted per connection like the range and the active tab.
  const [groupBy, setGroupByRaw] = useState<GroupBy>(() => {
    const v = readStorage(`chart-group:${connectionId}`);
    return v === 'harness' || v === 'status' ? v : 'http';
  });
  const setGroupBy = (v: GroupBy) => {
    setGroupByRaw(v);
    writeStorage(`chart-group:${connectionId}`, v);
  };

  // Every chart/summary query is scoped to this exact connection
  // (provider+auth_type+label, plus the tenant_providers id), so two
  // connections that share provider+auth_type don't show each other's usage.
  const scope = [chartRange, authType, provider, label, connectionId];
  const enabled = { enabled: !!conn };
  const a = authType ?? '';
  const p = provider ?? '';

  const analytics = useResource(
    () =>
      getProviderAnalytics(
        a,
        chartRange,
        undefined,
        p,
        label,
        connectionId,
      ) as Promise<AnalyticsResponse>,
    scope,
    enabled,
  );
  const agentTimeseries = useResource(
    () => getPerAgentTimeseries(a, p, chartRange, label, connectionId),
    scope,
    enabled,
  );
  const agentMessageTimeseries = useResource(
    () => getPerAgentMessageTimeseries(a, p, chartRange, label, connectionId),
    scope,
    enabled,
  );
  // Attempt world: every provider call on this connection, by its own
  // outcome. The harness view shares the same universe so both stack to the
  // same totals.
  const attemptStatusTs = useResource(
    () => getConnectionAttemptStatusTimeseries(a, p, chartRange, label, connectionId),
    scope,
    enabled,
  );
  const attemptsByAgentTs = useResource(
    () => getConnectionAttemptsByAgentTimeseries(a, p, chartRange, label, connectionId),
    scope,
    enabled,
  );
  const httpStatusTs = useResource(
    () => getConnectionAttemptHttpStatusTimeseries(a, p, chartRange, label, connectionId),
    scope,
    enabled,
  );
  const breakdown = useResource(
    () => getConnectionAttemptBreakdown(a, p, chartRange, label, connectionId),
    scope,
    enabled,
  );

  const isByok = authType === 'api_key';
  const agentCostTimeseries = useResource(
    () => getPerAgentCostTimeseries(a, p, chartRange, label, connectionId),
    scope,
    { enabled: !!conn && isByok },
  );

  const attemptTotals = (() => {
    const ts = attemptStatusTs.data;
    if (!ts) return { attempts: 0, succeeded: 0 };
    const successIdx = ts.keys.indexOf('success');
    let attempts = 0;
    let succeeded = 0;
    for (const b of ts.buckets) {
      for (let i = 0; i < b.counts.length; i++) {
        attempts += b.counts[i] ?? 0;
        if (i === successIdx) succeeded += b.counts[i] ?? 0;
      }
    }
    return { attempts, succeeded };
  })();

  // Harness tag selection for chart filtering (persisted in sessionStorage).
  // `null` means "no persisted preference" (→ default to all selected); a Set
  // — even an empty one — means an explicit user choice, so a genuine
  // "Unselect all" survives and isn't coerced back to "all selected".
  const storageKey = `agent-filter:${connectionId}`;
  const [selectedAgents, setSelectedAgents] = useState<Set<string> | null>(() => {
    try {
      const saved = readStorage(storageKey);
      if (saved !== null) return new Set(JSON.parse(saved) as string[]);
    } catch {
      /* ignore */
    }
    return null;
  });
  const persistSelection = (next: Set<string>) => {
    setSelectedAgents(next);
    writeStorage(storageKey, JSON.stringify([...next]));
  };

  // Merge agent lists from every per-harness series.
  const allAgents = [
    ...new Set([
      ...(agentTimeseries.data?.agents ?? []),
      ...(agentMessageTimeseries.data?.agents ?? []),
      ...(agentCostTimeseries.data?.agents ?? []),
      ...(attemptsByAgentTs.data?.agents ?? []),
    ]),
  ].sort();

  const agentColorMap: Record<string, string> = {};
  allAgents.forEach((agent, i) => {
    agentColorMap[agent] = AGENT_COLORS[i % AGENT_COLORS.length]!;
  });

  // No persisted preference (null) → default to all selected. An explicit
  // (possibly empty) Set is honored as-is so "Unselect all" sticks.
  const effectiveSelected = selectedAgents ?? new Set(allAgents);

  const toggleAgent = (agent: string) => {
    const next = new Set(effectiveSelected);
    if (next.has(agent)) next.delete(agent);
    else next.add(agent);
    persistSelection(next);
  };

  // Filter a series bundle down to the selected agents. An explicit empty
  // selection (genuine "Unselect all") yields empty agents/series, so the chart
  // renders its empty state instead of silently showing everything.
  const filterSeries = (raw: Series | null | undefined): Series | undefined => {
    if (!raw) return undefined;
    const agentsKept = raw.agents.filter((x) => effectiveSelected.has(x));
    const timeseries = raw.timeseries.map((row) => {
      const filtered: Record<string, number | string> = {};
      for (const [k, v] of Object.entries(row)) {
        if (k === 'hour' || k === 'date' || effectiveSelected.has(k)) filtered[k] = v;
      }
      return filtered;
    });
    return { agents: agentsKept, timeseries };
  };

  const harnessFilter = (
    <FilterSelect
      noun={t('providers.detail.harnessesNoun')}
      items={allAgents}
      selected={effectiveSelected}
      colorMap={agentColorMap}
      onToggle={toggleAgent}
      onSelectAll={() => persistSelection(new Set(allAgents))}
      onUnselectAll={() => persistSelection(new Set<string>())}
    />
  );

  // Manage modal state
  const [showManageModal, setShowManageModal] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [warmupValue, setWarmupValue] = useState('');
  const [savingWarmup, setSavingWarmup] = useState(false);
  const [warmupError, setWarmupError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deletingConnection, setDeletingConnection] = useState(false);

  const openManageModal = () => {
    if (conn) setRenameValue(conn.label);
    setRenameError('');
    setWarmupValue(warmupMsToSecondsInput(conn?.stream_warmup_ms));
    setWarmupError('');
    setShowDeleteConfirm(false);
    setDeleteConfirmName('');
    setShowManageModal(true);
  };

  const closeManageModal = () => {
    setShowManageModal(false);
    setShowDeleteConfirm(false);
    setDeleteConfirmName('');
  };

  const deleteConfirmMatches = !!conn && deleteConfirmName === conn.label;

  const handleRename = async () => {
    if (!conn) return;
    const newLabel = renameValue.trim();
    if (!newLabel) {
      setRenameError(t('providers.nameEmpty'));
      return;
    }
    if (newLabel === conn.label) {
      closeManageModal();
      return;
    }
    setRenaming(true);
    setRenameError('');
    try {
      await renameConnection(conn.provider, conn.label, newLabel, conn.auth_type as any);
      toast.success(t('providers.connectionRenamed'));
      closeManageModal();
      void detail.reload();
    } catch (e: any) {
      setRenameError(e?.message ?? t('providers.renameFailed'));
    } finally {
      setRenaming(false);
    }
  };

  const warmupUnchanged = parseWarmupSeconds(warmupValue) === (conn?.stream_warmup_ms ?? null);

  const handleSaveWarmup = async () => {
    if (!conn) return;
    const ms = parseWarmupSeconds(warmupValue);
    if (ms === undefined) {
      setWarmupError(streamWarmupError());
      return;
    }
    setSavingWarmup(true);
    setWarmupError('');
    try {
      await setConnectionStreamWarmup(conn.id, ms);
      toast.success(t('providers.detail.warmupSaved'));
      void detail.reload();
    } catch (e: any) {
      setWarmupError(e?.message ?? t('providers.detail.saveFailed'));
    } finally {
      setSavingWarmup(false);
    }
  };

  const handleDisconnect = async () => {
    if (!conn) return;
    if (!conn.is_active && !deleteConfirmMatches) return;
    setDeletingConnection(true);
    try {
      await disconnectConnection(conn.provider, conn.auth_type as any, conn.label);
      toast.success(t('providers.detail.connectionRemoved'));
      navigate(backLink);
    } catch (e: any) {
      toast.error(e?.message ?? t('providers.detail.disconnectFailed'));
    } finally {
      setDeletingConnection(false);
    }
  };

  const handleRefreshModels = async () => {
    setRefreshingModels(true);
    try {
      await refreshConnectionModels();
      toast.success(t('providers.detail.modelsRefreshed'));
      void detail.reload();
    } catch {
      toast.error(t('providers.detail.refreshFailed'));
    } finally {
      setRefreshingModels(false);
    }
  };

  // Deep links into the Requests log, scoped to THIS connection and the
  // card's current window, so the list matches what the card counted.
  const requestsLink = (extra: string) =>
    `/messages?connections=${encodeURIComponent(connectionId)}&range=${chartRange}${extra}`;
  const viewMore = <span className="link-action text-xs">{t('providers.detail.viewMore')}</span>;

  // A rejected fetch surfaces a retryable error state; a resolved-but-null
  // connection (unknown id / deleted) renders not-found. Neither may leave the
  // loading skeleton spinning forever.
  const hasError = !detail.loading && !!detail.error;
  const notFound = !hasError && !detail.loading && detail.data !== undefined && conn === null;

  if (hasError) {
    return (
      <div className="page">
        <title>{t('providers.detail.loadErrorTitle')}</title>
        <EmptyState
          title={t('providers.detail.loadErrorHeading')}
          description={t('providers.detail.loadErrorBody')}
          action={
            <Button variant="ghost" size="sm" onClick={() => void detail.reload()}>
              {t('common.retry')}
            </Button>
          }
        />
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="page">
        <title>{t('providers.detail.notFoundTitle')}</title>
        <EmptyState
          title={t('providers.detail.notFoundHeading')}
          description={t('providers.detail.notFoundBody')}
          action={
            <ButtonLink to="/" variant="ghost" size="sm">
              {t('providers.detail.backToOverview')}
            </ButtonLink>
          }
        />
      </div>
    );
  }
  if (!detail.data || !conn) {
    return (
      <div className="page">
        <Skel width="100%" height={300} />
      </div>
    );
  }

  const c = conn;
  const data = detail.data;
  const b = breakdown.data;
  const icon32 = providerIcon(c.provider, 32);
  const totalCost = (() => {
    const ts = agentCostTimeseries.data;
    if (!ts) return undefined;
    let sum = 0;
    for (const row of ts.timeseries) {
      for (const x of ts.agents) sum += Number(row[x] ?? 0);
    }
    return sum;
  })();

  const emptyRow = (text: string) => (
    <p className="px-4 py-6 text-center text-sm text-muted">{text}</p>
  );
  const metaItem = (k: string, v: ReactNode) => (
    <span>
      <span className="font-semibold text-ink">{k}</span> <span className="text-muted">{v}</span>
    </span>
  );

  return (
    <div className="page">
      <title>
        {t('providers.detail.pageTitle', { provider: providerDisplayName, label: c.label })}
      </title>

      <div className="mb-4">
        <Link to={backLink} className="text-sm text-muted no-underline hover:text-ink">
          ← {backLabel}
        </Link>
      </div>

      <div className="page-head">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex size-8 shrink-0 items-center">
              {icon32 ?? (
                <span
                  className="inline-flex size-8 items-center justify-center rounded-control text-base font-bold text-on-accent"
                  style={{ background: customProviderColor(providerDisplayName) }}
                >
                  {providerDisplayName.charAt(0).toUpperCase()}
                </span>
              )}
            </span>
            <h1 className="flex flex-wrap items-baseline gap-2">
              {providerDisplayName}
              <span className="text-sm font-normal text-muted">{c.label}</span>
            </h1>
            <div className="flex items-center gap-2">
              {isCustomProvider ? <Badge tone="outline">{t('providers.custom')}</Badge> : null}
              {c.is_active ? (
                <Badge tone="ok">{t('providers.active')}</Badge>
              ) : (
                <Badge>{t('providers.inactive')}</Badge>
              )}
            </div>
          </div>
          <div className="sub flex flex-wrap gap-x-4 gap-y-1">
            {metaItem(t('providers.detail.connectionName'), c.label)}
            {metaItem(t('providers.detail.models'), c.cached_model_count)}
            {metaItem(
              t('providers.detail.firstConnection'),
              c.connected_at ? formatTimeAgo(c.connected_at) : '—',
            )}
            {metaItem(
              t('providers.detail.lastUsed'),
              c.last_used_at ? formatTimeAgo(c.last_used_at) : '—',
            )}
          </div>
        </div>
        <div className="page-actions">
          {allAgents.length > 1 ? harnessFilter : null}
          <Select value={chartRange} onChange={setChartRange} options={cdRangeOptions()} />
          {roleCan.manageProviders() ? (
            <Button variant="ghost" size="sm" onClick={openManageModal}>
              {t('providers.detail.manage')}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Attempt world cards: the connection's own numbers on the filtered period. */}
      <div className="stat-tiles mb-4">
        <StatTile
          label={
            <>
              {t('providers.successRate')}
              <InfoTooltip text={t('ui.analytics.connectionSuccessRate')} />
            </>
          }
          value={formatRate(
            b ? attemptSuccessRate({ attempts: b.attempts, succeeded: b.succeeded }) : null,
          )}
        />
        <StatTile
          label={t('providers.detail.succeededAttempts')}
          title={t('providers.detail.succeededTitle')}
          onClick={() => navigate(requestsLink('&attempts=has_succeeded'))}
          value={formatNumber(b?.succeeded ?? 0)}
          extra={viewMore}
        />
        <StatTile
          label={t('providers.detail.failedAttempts')}
          title={t('providers.detail.failedTitle')}
          onClick={() => navigate(requestsLink('&attempts=has_failed'))}
          value={formatNumber(b?.failed ?? 0)}
          extra={viewMore}
        />
        <StatTile
          label={t('providers.detail.fallbackRetries')}
          title={t('providers.detail.fallbackTitle')}
          onClick={() => navigate(requestsLink('&trigger=fallback'))}
          value={formatNumber(b?.fallback_retries ?? 0)}
          extra={
            <>
              {(b?.fallback_retries ?? 0) > 0 ? (
                <span className="text-xs text-muted">
                  {t('providers.detail.succeeded', {
                    count: formatNumber(b?.fallback_retries_succeeded ?? 0),
                  })}
                </span>
              ) : null}
              {viewMore}
            </>
          }
        />
      </div>

      {analytics.data ? (
        <div className="mb-4">
          <UnifiedChartCard
            activeTab={chartView}
            onTabChange={setChartView}
            requestsLabel={t('providers.detail.attempts')}
            requestsInfoTooltip={t('ui.analytics.totalAttempts')}
            requestsValue={attemptTotals.attempts}
            requestsTrendPct={0}
            tokensValue={analytics.data.summary.tokens.value}
            tokensTrendPct={analytics.data.summary.tokens.trend_pct}
            costValue={isByok ? (totalCost ?? 0) : undefined}
            range={chartRange}
            agentTimeseries={filterSeries(agentTimeseries.data)}
            agentRequestTimeseries={
              groupBy === 'harness' ? filterSeries(attemptsByAgentTs.data) : undefined
            }
            requestStatusTimeseries={
              groupBy === 'status'
                ? (attemptStatusTs.data ?? undefined)
                : groupBy === 'http'
                  ? (httpStatusTs.data ?? undefined)
                  : undefined
            }
            requestStatusSeriesMode={groupBy === 'http' ? 'http_status' : 'disposition'}
            agentCostTimeseries={isByok ? filterSeries(agentCostTimeseries.data) : undefined}
            colorMap={agentColorMap}
            seriesFilters={
              <>
                {/* Status/harness grouping only applies to the Attempts tab;
                    Tokens and Cost stay per-harness. */}
                {chartView === 'requests' ? (
                  <div className="segmented">
                    {(
                      [
                        ['http', t('providers.detail.byHttpStatus')],
                        ['status', t('providers.detail.byAttemptStatus')],
                        ['harness', t('providers.detail.byHarness')],
                      ] as const
                    ).map(([key, text]) => (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={groupBy === key}
                        onClick={() => setGroupBy(key)}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                ) : null}
                {(chartView !== 'requests' || groupBy === 'harness') && allAgents.length > 1
                  ? harnessFilter
                  : null}
              </>
            }
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        <Panel title={t('providers.detail.recentRequests')} bodyClassName="p-0">
          {data.recent_messages.length > 0 ? (
            <div className="table-wrap max-h-96 rounded-none border-0">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('providers.detail.colDate')}</th>
                    <th>{t('providers.detail.colRequestId')}</th>
                    <th>{t('providers.detail.colModel')}</th>
                    <th className="num">{t('providers.detail.colTokens')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_messages.map((msg: any, i: number) => (
                    <tr key={msg.id ?? i}>
                      <td className="whitespace-nowrap">
                        {msg.timestamp ? formatTimeAgo(msg.timestamp) : '—'}
                      </td>
                      <td className="font-mono text-xs text-muted">
                        {msg.id ? msg.id.slice(0, 8) : '—'}
                      </td>
                      <td className="max-w-45 truncate">
                        {msg.model ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="inline-flex size-3.5 shrink-0">
                              {providerIcon(msg.provider ?? c.provider, 14)}
                            </span>
                            {getModelDisplayName(msg.model)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="num">
                        {formatNumber((msg.input_tokens ?? 0) + (msg.output_tokens ?? 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            emptyRow(t('providers.detail.noRequests'))
          )}
        </Panel>

        <Panel title={t('providers.detail.modelsTitle')} bodyClassName="p-0">
          {data.model_usage.length > 0 ? (
            <div className="table-wrap max-h-96 rounded-none border-0">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('providers.detail.colModel')}</th>
                    <th className="num">{t('providers.detail.colTokens')}</th>
                    <th>{t('providers.detail.colPctTotal')}</th>
                    {isByok ? <th className="num">{t('providers.detail.colCost')}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {data.model_usage.map((m) => (
                    <tr key={m.model}>
                      <td className="row-title max-w-50 truncate">{m.model}</td>
                      <td className="num">{formatNumber(m.tokens)}</td>
                      <td>
                        <ShareBar pct={m.pct_of_total} />
                      </td>
                      {isByok ? (
                        <td className="num font-semibold text-ink">
                          {formatCost(m.cost) ?? '$0.00'}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            emptyRow(t('providers.detail.noModelUsage'))
          )}
        </Panel>

        <Panel title={t('providers.detail.harnessesTitle')} bodyClassName="p-0">
          {data.agents.length > 0 ? (
            <div className="table-wrap max-h-96 rounded-none border-0">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('providers.detail.colHarness')}</th>
                    <th className="num">{t('providers.detail.colTokens30d')}</th>
                    <th>{t('providers.detail.colPctTotal')}</th>
                    {isByok ? <th className="num">{t('providers.detail.colCost30d')}</th> : null}
                    <th className="num">
                      <span className="inline-flex items-center gap-1">
                        {t('providers.totalAttempts')}
                        <InfoTooltip text={t('ui.analytics.totalAttempts')} />
                      </span>
                    </th>
                    <th className="num">
                      <span className="inline-flex items-center gap-1">
                        {t('providers.successRate')}
                        <InfoTooltip text={t('ui.analytics.connectionHarnessSuccessRate')} />
                      </span>
                    </th>
                    <th>{t('providers.lastUsed')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((agent) => {
                    const platform = platformIcon(agent.agent_platform, null);
                    return (
                      <tr key={agent.agent_name}>
                        <td>
                          <Link
                            to={`/harnesses/${encodeURIComponent(agent.agent_name)}`}
                            className="row-title flex items-center gap-2 no-underline"
                          >
                            {platform ? (
                              <ThemedIcon
                                src={platform}
                                size={16}
                                className="platform-icon rounded-sm"
                              />
                            ) : null}
                            {agent.agent_name}
                          </Link>
                        </td>
                        <td className="num">{formatNumber(agent.tokens_30d)}</td>
                        <td>
                          <ShareBar pct={agent.pct_of_total} />
                        </td>
                        {isByok ? (
                          <td className="num">{formatCost(agent.cost_30d) ?? '$0.00'}</td>
                        ) : null}
                        <td className="num">{formatNumber(agent.attempts_30d ?? 0)}</td>
                        <td className="num">
                          {formatRate(
                            attemptSuccessRate({
                              attempts: agent.attempts_30d ?? 0,
                              succeeded: agent.succeeded_30d,
                            }),
                          )}
                        </td>
                        <td className="text-muted">
                          {agent.last_used ? formatTimeAgo(agent.last_used) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            emptyRow(t('providers.detail.noHarnesses'))
          )}
        </Panel>
      </div>

      {/* Custom provider edit modal */}
      <Modal
        open={showManageModal && isCustomProvider && !!customProviderData}
        onClose={closeManageModal}
        label={t('providers.detail.editCustomProvider')}
        wide
      >
        {customProviderData?.local_type ? (
          <LocalServerForm
            agentName={firstAgentName}
            type={customProviderData.local_type}
            editData={customProviderData}
            onSaved={() => {
              closeManageModal();
              void detail.reload();
            }}
            onCancel={closeManageModal}
            onDeleted={() => {
              closeManageModal();
              navigate(backLink);
            }}
          />
        ) : (
          <CustomProviderForm
            agentName={firstAgentName}
            initialData={customProviderData!}
            onCreated={() => {
              closeManageModal();
              void detail.reload();
            }}
            onBack={closeManageModal}
            onDeleted={() => {
              closeManageModal();
              navigate(backLink);
            }}
          />
        )}
      </Modal>

      {/* Manage connection modal */}
      <Modal
        open={showManageModal && !(isCustomProvider && customProviderData)}
        onClose={closeManageModal}
        label={providerDisplayName}
        title={
          <span className="flex items-center gap-2.5">
            <span className="flex size-7 items-center">
              {provDef ? (
                providerIcon(provDef.id, 28)
              ) : (
                <span className="flex size-7 items-center justify-center rounded-full bg-s3 text-sm font-semibold text-muted">
                  {providerDisplayName.charAt(0)}
                </span>
              )}
            </span>
            {providerDisplayName}
          </span>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <label className="label" htmlFor="connection-rename">
              {t('providers.detail.connectionNameLabel')}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="connection-rename"
                type="text"
                className="field flex-1"
                aria-invalid={renameError ? true : undefined}
                value={renameValue}
                onChange={(e) => {
                  setRenameValue(e.currentTarget.value);
                  setRenameError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleRename();
                }}
              />
              <Button
                size="sm"
                disabled={renaming || renameValue.trim() === c.label}
                onClick={() => void handleRename()}
              >
                {renaming ? t('providers.detail.saving') : t('providers.detail.save')}
              </Button>
            </div>
            {renameError ? <p className="form-error mt-1">{renameError}</p> : null}
          </div>

          {/* Stream warm-up override (#244) */}
          <div>
            <label className="label" htmlFor="connection-stream-warmup">
              {t('providers.detail.streamWarmup')}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="connection-stream-warmup"
                type="number"
                min={MIN_STREAM_WARMUP_SECONDS}
                max={MAX_STREAM_WARMUP_SECONDS}
                step="1"
                placeholder={t('providers.detail.inherit')}
                className="field flex-1"
                aria-invalid={warmupError ? true : undefined}
                value={warmupValue}
                onChange={(e) => {
                  setWarmupValue(e.currentTarget.value);
                  setWarmupError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSaveWarmup();
                }}
              />
              <Button
                size="sm"
                disabled={savingWarmup || warmupUnchanged}
                onClick={() => void handleSaveWarmup()}
              >
                {savingWarmup ? t('providers.detail.applying') : t('providers.detail.apply')}
              </Button>
            </div>
            <p className="hint">{t('providers.detail.warmupHint')}</p>
            {warmupError ? <p className="form-error mt-1">{warmupError}</p> : null}
          </div>

          {c.is_active ? (
            <>
              <div className="flex items-center justify-between border-t border-line pt-3">
                <span className="text-sm text-muted">
                  {t('providers.detail.modelCount', c.cached_model_count ?? 0)}
                </span>
                {/* Custom provider models are entered by hand; discovery skips them. */}
                {!isCustomProvider ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={refreshingModels}
                    onClick={() => void handleRefreshModels()}
                  >
                    {refreshingModels
                      ? t('providers.detail.refreshing')
                      : t('providers.detail.refreshModels')}
                  </Button>
                ) : null}
              </div>
              <div className="border-t border-line pt-3 text-sm text-muted">
                {t('providers.detail.connectedVia')}{' '}
                {c.auth_type === 'subscription'
                  ? t('providers.detail.viaSubscription')
                  : c.auth_type === 'api_key'
                    ? t('providers.detail.viaApiKey')
                    : t('providers.detail.viaLocal')}
              </div>
              <div className="flex items-center justify-between border-t border-line pt-4">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => void handleDisconnect()}
                  disabled={deletingConnection}
                >
                  {deletingConnection
                    ? t('providers.detail.disconnecting')
                    : t('providers.detail.disconnect')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={closeManageModal}
                  disabled={deletingConnection}
                >
                  {t('providers.detail.done')}
                </Button>
              </div>
            </>
          ) : showDeleteConfirm ? (
            <div
              className="flex flex-col gap-3 border-t border-line pt-3"
              role="alertdialog"
              aria-labelledby="delete-connection-confirm-title"
              aria-describedby="delete-connection-confirm-copy"
            >
              <div className="rounded-control bg-danger-tint p-3">
                <h3 id="delete-connection-confirm-title" className="text-sm text-danger">
                  {t('providers.detail.deleteHistoryTitle')}
                </h3>
                <p id="delete-connection-confirm-copy" className="mt-1 text-sm text-dim">
                  {t('providers.detail.deleteHistoryBody')}
                </p>
              </div>
              <div>
                <label htmlFor="delete-connection-confirm-input" className="label">
                  {t('providers.detail.typeNameToConfirm')}
                </label>
                <input
                  id="delete-connection-confirm-input"
                  className="field"
                  type="text"
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && deleteConfirmMatches) void handleDisconnect();
                  }}
                  placeholder={c.label}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteConfirmName('');
                  }}
                  disabled={deletingConnection}
                >
                  {t('providers.detail.cancel')}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => void handleDisconnect()}
                  disabled={!deleteConfirmMatches || deletingConnection}
                >
                  {deletingConnection
                    ? t('providers.detail.deleting')
                    : t('providers.detail.deleteConnection')}
                </Button>
              </div>
            </div>
          ) : (
            <div className={cx('flex items-center justify-between border-t border-line pt-3')}>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setDeleteConfirmName('');
                  setShowDeleteConfirm(true);
                }}
              >
                {t('providers.detail.delete')}
              </Button>
              <Button variant="ghost" size="sm" onClick={closeManageModal}>
                {t('providers.detail.close')}
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default ConnectionDetail;
