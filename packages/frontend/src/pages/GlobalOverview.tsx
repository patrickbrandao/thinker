import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { BarChart3 } from 'lucide-react';
import { platformIcon } from 'thinker-shared';
import AddAgentModal from '../components/AddAgentModal.js';
import {
  getAgents,
  getGlobalProviders,
  getGlobalProviderUsage,
  getRecentRequests,
  mergeUsage,
} from '../services/api.js';
import { customProviderColor, formatNumber, formatCost } from '../services/formatters.js';
import { customProviderLogo, providerIcon } from '../components/ProviderIcon.js';
import { stripCustomPrefix } from '../services/routing-utils.js';
import {
  getOverview,
  getModelUsage,
  getOverviewAgentUsage,
  getOverviewProviderUsage,
  getReliabilityStats,
  getRequestStatusTimeseries,
  getPerProviderReliability,
  getPerAgentReliability,
  getPerModelReliability,
  recoveredCount,
  successRate,
  attemptSuccessRate,
} from '../services/api/analytics.js';
import { preloadModelDisplayNames } from '../services/model-display.js';
import { PROVIDERS } from '../services/providers.js';
import { AGENT_COLORS } from '../components/MultiAgentTokenChart.js';
import InfoTooltip from '../components/InfoTooltip.js';
import UnifiedChartCard, { type ChartTab } from '../components/UnifiedChartCard.js';
import ReliabilityKpiCards from '../components/ReliabilityKpiCards.js';
import Sparkline from '../components/Sparkline.js';
import FilterSelect from '../components/FilterSelect.js';
import Select from '../components/Select.js';
import { authLabel, authBadgeFor } from '../components/AuthBadge.js';
import GlobalOverviewSkeleton from '../components/GlobalOverviewSkeleton.js';
import MessageTable from '../components/MessageTable.js';
import { Badge, Button, ButtonLink, EmptyState, Panel, Skel } from '../components/ui.js';
import {
  COMPACT_COLUMNS,
  type MessageColumnKey,
  type MessageRow,
} from '../components/message-table-types.js';
import { agentPing, analyticsPing, messagePing, routingPing } from '../services/sse.js';
import { formatRate } from '../services/overview-format.js';
import { rangeOptions } from '../services/use-overview-range.js';
import { useSignal } from '../lib/signal.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';

interface ProviderGroup {
  provider: string;
  auth_type: string;
  /** Backend-resolved name for `custom:<uuid>` groups; null for built-ins. */
  display_name?: string | null;
  connection_count: number;
  connections: Array<{ id: string; label: string; is_active: boolean }>;
  total_models: number;
  consumption_tokens: number;
  consumption_messages: number;
  consumption_cost: number;
  last_used_at: string | null;
  sparkline_7d: number[];
}

interface CostByModelRow {
  model: string;
  display_name: string;
  tokens: number;
  share_pct: number;
  estimated_cost: number;
  auth_type: string | null;
  provider: string | null;
  custom_provider_name?: string | null;
}

interface OverviewResponse {
  summary: {
    tokens_today: { value: number; trend_pct: number };
    cost_today: { value: number; trend_pct: number };
    messages: { value: number; trend_pct: number };
  };
  request_reliability: {
    total: number;
    successful: number;
    success_rate: number;
    attempt_success_rate: number;
    thinker_lift_pct: number;
    recovered: number;
  } | null;
  token_usage: Array<{ hour?: string; date?: string; input_tokens: number; output_tokens: number }>;
  message_usage: Array<{ hour?: string; date?: string; count: number }>;
  has_data: boolean;
  has_providers: boolean;
}

interface AgentRow {
  agent_name: string;
  display_name: string;
  agent_category: string | null;
  agent_platform: string | null;
  message_count: number;
  total_tokens: number;
  sparkline: number[];
}

type TSResult = { agents: string[]; timeseries: Array<Record<string, number | string>> };
type UsageTSResult = { tokenUsage: TSResult; messageUsage: TSResult; costUsage: TSResult };

const RANGE_STORAGE_KEY = 'thinker_global_range';
const GROUP_STORAGE_KEY = 'thinker_global_group';
const ONBOARDING_DISMISSED_KEY = 'overview_onboarding_dismissed';

function loadRange(): string {
  try {
    const v = localStorage.getItem(RANGE_STORAGE_KEY);
    if (v === '24h' || v === '7d' || v === '30d' || v === '90d' || v === '365d') return v;
  } catch {
    /* ignore */
  }
  return '7d';
}

function loadGroup(): string {
  try {
    const v = localStorage.getItem(GROUP_STORAGE_KEY);
    if (v === 'status' || v === 'provider' || v === 'agent') return v;
  } catch {
    /* ignore */
  }
  return 'status';
}

function loadSavedAgents(key: string): Set<string> {
  try {
    const saved = sessionStorage.getItem(key);
    if (saved) return new Set(JSON.parse(saved) as string[]);
  } catch {
    /* ignore */
  }
  return new Set();
}

function persist(storage: 'local' | 'session', key: string, value: string): void {
  try {
    (storage === 'local' ? localStorage : sessionStorage).setItem(key, value);
  } catch {
    /* ignore */
  }
}

function filterSeries(raw: TSResult | undefined, sel: Set<string>): TSResult | undefined {
  if (!raw) return undefined;
  if (sel.size === 0) return raw;
  return {
    agents: raw.agents.filter((a) => sel.has(a)),
    timeseries: raw.timeseries.map((row) => {
      const filtered: Record<string, number | string> = {};
      for (const [k, v] of Object.entries(row)) {
        if (k === 'hour' || k === 'date' || sel.has(k)) filtered[k] = v;
      }
      return filtered;
    }),
  };
}

/** Placeholder rows for a panel whose own data is still loading. */
function PanelRowsSkeleton() {
  return (
    <div data-testid="panel-rows-skeleton" className="flex flex-col gap-3 p-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skel width={140} height={12} />
          <Skel width={100} height={12} />
          <Skel width={50} height={12} />
        </div>
      ))}
    </div>
  );
}

/** A count that drills into the Requests log without triggering the row's own link. */
function CountLink({
  to,
  title,
  onGo,
  children,
}: {
  to: string;
  title: string;
  onGo: (to: string) => void;
  children: ReactNode;
}) {
  return (
    <a
      className="link-action"
      href={to}
      title={title}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        e.stopPropagation();
        onGo(to);
      }}
    >
      {children}
    </a>
  );
}

function HeadTip({ label, tip }: { label: string; tip?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      {tip ? <InfoTooltip text={tip} /> : null}
    </span>
  );
}

function CustomLetter({ name, size }: { name: string; size: 16 | 20 }) {
  return (
    <span
      className={
        size === 16
          ? 'provider-card__logo-letter inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-on-accent'
          : 'inline-flex size-5 shrink-0 items-center justify-center rounded-control text-[11px] font-semibold text-on-accent'
      }
      // Custom providers get a generated color derived from their name.
      style={{ background: customProviderColor(name) }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/** The workspace dashboard: every harness and provider over one time range. */
export default function GlobalOverview() {
  const navigate = useNavigate();
  const aPing = useSignal(analyticsPing);
  const mPing = useSignal(messagePing);
  const agPing = useSignal(agentPing);
  const rPing = useSignal(routingPing);

  useEffect(() => {
    preloadModelDisplayNames();
  }, []);

  // ── Range and grouping (persisted in localStorage) ───────────────────
  const [chartRange, setChartRangeRaw] = useState(loadRange);
  const setChartRange = (v: string) => {
    setChartRangeRaw(v);
    persist('local', RANGE_STORAGE_KEY, v);
  };
  const [groupBy, setGroupByRaw] = useState(loadGroup);
  const setGroupBy = (v: string) => {
    setGroupByRaw(v);
    persist('local', GROUP_STORAGE_KEY, v);
  };
  const [chartView, setChartView] = useState<ChartTab>('requests');

  // ── Data ─────────────────────────────────────────────────────────────
  const overviewRes = useResource(
    async () => ({
      range: chartRange,
      data: (await getOverview(chartRange, undefined, true)) as OverviewResponse,
    }),
    [chartRange, aPing],
  );
  const overview = overviewRes.data?.data;
  // Skeleton on a range change, not on the frequent background SSE refetches
  // (those update in place): the visible overview belongs to another range.
  const rangeChanging = overviewRes.loading && overviewRes.data?.range !== chartRange;

  // Recent Requests and Model usage load on their own, in parallel with the
  // overview. Recent Requests follows the live message feed (messagePing);
  // Model usage is an aggregate and refreshes at the analytics cadence. Each
  // result keeps the range it was loaded for, so a range change never shows
  // the previous range's rows.
  const recentRes = useResource(
    async () => ({
      range: chartRange,
      data: ((await getRecentRequests(chartRange)) as { items: MessageRow[] }).items,
    }),
    [chartRange, mPing],
  );
  const recentRequests = recentRes.data?.range === chartRange ? recentRes.data.data : undefined;
  const modelUsageRes = useResource(
    async () => ({
      range: chartRange,
      data: ((await getModelUsage(chartRange)) as { cost_by_model: CostByModelRow[] })
        .cost_by_model,
    }),
    [chartRange, aPing],
  );
  const modelUsage = modelUsageRes.data?.range === chartRange ? modelUsageRes.data.data : undefined;

  const agentsRes = useResource(async () => {
    try {
      const data = (await getAgents()) as { agents?: AgentRow[] } | AgentRow[] | null;
      return Array.isArray(data) ? data : (data?.agents ?? []);
    } catch {
      return [] as AgentRow[];
    }
  }, [agPing, aPing]);
  const agents = agentsRes.data;

  // Provider rows/status are routing-domain state: a connect/disconnect/rename
  // emits a `routing` SSE event, so the config list keys on routingPing. A new
  // or removed agent can also change which providers appear.
  const providerConfigRes = useResource(async () => {
    try {
      return (await getGlobalProviders()).providers;
    } catch {
      return [];
    }
  }, [agPing, rPing]);
  // The expensive 30d usage aggregation, fetched independently.
  const providerUsageRes = useResource(async () => {
    try {
      return (await getGlobalProviderUsage()).providers;
    } catch {
      return [];
    }
  }, [aPing, rPing]);

  // One token per range: a reliability result from another range never shows.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reliabilityScope = useMemo(() => ({}), [chartRange]);
  const reliabilityRes = useResource(
    async () => ({ scope: reliabilityScope, data: await getReliabilityStats(chartRange) }),
    [reliabilityScope, aPing],
  );
  const reliabilityStats =
    reliabilityRes.data?.scope === reliabilityScope ? reliabilityRes.data.data : undefined;

  // Request-status timeseries: feeds the "By request status" chart view AND
  // the Recovered requests tab (the fallback series alone).
  const requestStatusRes = useResource(
    () => getRequestStatusTimeseries(chartRange),
    [chartRange, aPing],
  );
  const requestStatusTs = requestStatusRes.data;
  const recoveredTs = useMemo(() => {
    if (!requestStatusTs) return undefined;
    const picked = requestStatusTs.keys
      .map((k, i) => ({ k, i }))
      .filter(({ k }) => k === 'fallback');
    return {
      ...requestStatusTs,
      keys: picked.map(({ k }) => k),
      buckets: requestStatusTs.buckets.map((b) => ({
        bucket: b.bucket,
        counts: picked.map(({ i }) => b.counts[i] ?? 0),
      })),
    };
  }, [requestStatusTs]);

  // Harness table usage follows the page range selector (the workspace agents
  // endpoint is a fixed window).
  const harnessUsageRes = useResource(
    () => getOverviewAgentUsage(chartRange) as Promise<UsageTSResult>,
    [chartRange, aPing],
  );
  const harnessUsageFor = (agentName: string) => {
    const ts = harnessUsageRes.data?.tokenUsage;
    if (!ts || !ts.agents.includes(agentName)) return null;
    const spark: number[] = [];
    let total = 0;
    for (const row of ts.timeseries) {
      const v = Number(row[agentName] ?? 0);
      spark.push(v);
      total += v;
    }
    return { total, spark };
  };

  const agentReliability = useResource(
    () => getPerAgentReliability(chartRange),
    [chartRange, aPing],
  );
  const providerReliability = useResource(
    () => getPerProviderReliability(chartRange),
    [chartRange, aPing],
  );
  const modelReliability = useResource(
    () => getPerModelReliability(chartRange),
    [chartRange, aPing],
  );

  // Merged groups (config + usage by provider+auth_type) drive the table;
  // undefined until the config resolves.
  const providers = useMemo(
    () =>
      providerConfigRes.data === undefined
        ? undefined
        : (mergeUsage(providerConfigRes.data, providerUsageRes.data) as unknown as ProviderGroup[]),
    [providerConfigRes.data, providerUsageRes.data],
  );

  const usageRes = useResource(
    () =>
      (groupBy === 'provider'
        ? getOverviewProviderUsage(chartRange)
        : getOverviewAgentUsage(chartRange)) as Promise<UsageTSResult>,
    [chartRange, groupBy, aPing],
  );

  // Provider-grouped series key custom providers as 'custom:<uuid>'. Remap
  // those keys to the provider's display name so the filter, legend and
  // tooltip read like every other provider.
  const { tokenSeries, messageSeries, costSeries } = useMemo(() => {
    const displaySeriesName = (key: string) => {
      const name = key.startsWith('custom:')
        ? (providers?.find((g) => g.provider === key)?.display_name ?? null)
        : null;
      // 'hour'/'date' are the row's bucket columns — never let a custom
      // provider named like them clobber the axis.
      return name && name !== 'hour' && name !== 'date' ? name : key;
    };
    const remap = (raw: TSResult | undefined): TSResult | undefined => {
      if (!raw || !raw.agents.some((a) => a.startsWith('custom:'))) return raw;
      return {
        agents: raw.agents.map(displaySeriesName),
        timeseries: raw.timeseries.map((row) =>
          Object.fromEntries(Object.entries(row).map(([k, v]) => [displaySeriesName(k), v])),
        ),
      };
    };
    return {
      tokenSeries: remap(usageRes.data?.tokenUsage),
      messageSeries: remap(usageRes.data?.messageUsage),
      costSeries: remap(usageRes.data?.costUsage),
    };
  }, [usageRes.data, providers]);

  // ── Series filter (sessionStorage) ───────────────────────────────────
  // Scoped by grouping: provider and harness groupings list different series,
  // so a shared set would filter out every series when switching modes.
  const storageKey = `global-agent-filter:${groupBy}`;
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(() =>
    loadSavedAgents(storageKey),
  );
  useEffect(() => {
    setSelectedAgents(loadSavedAgents(storageKey));
  }, [storageKey]);

  const allAgents = useMemo(() => {
    const set = new Set([
      ...(tokenSeries?.agents ?? []),
      ...(messageSeries?.agents ?? []),
      ...(costSeries?.agents ?? []),
    ]);
    return [...set].sort();
  }, [tokenSeries, messageSeries, costSeries]);

  const agentColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    allAgents.forEach((a, i) => {
      map[a] = AGENT_COLORS[i % AGENT_COLORS.length]!;
    });
    return map;
  }, [allAgents]);

  // Prune the persisted selection against the series present for the current
  // grouping; when nothing intersects, fall back to "all selected" so the
  // chart never renders blank.
  const effectiveSelected = useMemo(() => {
    if (allAgents.length === 0) return selectedAgents;
    const pruned = new Set(allAgents.filter((a) => selectedAgents.has(a)));
    return pruned.size === 0 ? new Set(allAgents) : pruned;
  }, [allAgents, selectedAgents]);

  const saveSelection = (next: Set<string>) => {
    setSelectedAgents(next);
    persist('session', storageKey, JSON.stringify([...next]));
  };
  const toggleAgent = (agent: string) => {
    const next = new Set(effectiveSelected);
    if (next.has(agent)) next.delete(agent);
    else next.add(agent);
    saveSelection(next);
  };
  const setAllAgents = (on: boolean) => saveSelection(on ? new Set(allAgents) : new Set());

  const filteredTokenTs = useMemo(
    () => filterSeries(tokenSeries, effectiveSelected),
    [tokenSeries, effectiveSelected],
  );
  const filteredMessageTs = useMemo(
    () => filterSeries(messageSeries, effectiveSelected),
    [messageSeries, effectiveSelected],
  );
  const filteredCostTs = useMemo(
    () => filterSeries(costSeries, effectiveSelected),
    [costSeries, effectiveSelected],
  );

  // ── Derived ──────────────────────────────────────────────────────────
  const agentList = agents ?? [];
  const providerList = providers ?? [];
  const sortedAgents = [...agentList].sort((a, b) => (b.total_tokens ?? 0) - (a.total_tokens ?? 0));
  const hasNoAgents = agents !== undefined && agentList.length === 0;
  const hasNoProviders = providers !== undefined && providerList.length === 0;

  // Auto-open the Create Harness modal for first-time users (once per session).
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const dismissAddAgent = () => {
    setAddAgentOpen(false);
    persist('session', ONBOARDING_DISMISSED_KEY, '1');
  };
  useEffect(() => {
    if (!hasNoAgents) return;
    let dismissed: string | null = null;
    try {
      dismissed = sessionStorage.getItem(ONBOARDING_DISMISSED_KEY);
    } catch {
      /* ignore */
    }
    if (!dismissed) setAddAgentOpen(true);
  }, [hasNoAgents]);

  const recentColumns = useMemo((): MessageColumnKey[] => {
    const at = COMPACT_COLUMNS.indexOf('model');
    return [...COMPACT_COLUMNS.slice(0, at), 'agent', ...COMPACT_COLUMNS.slice(at)];
  }, []);

  const showDashboard =
    !hasNoAgents &&
    !hasNoProviders &&
    !rangeChanging &&
    overview !== undefined &&
    agents !== undefined &&
    providers !== undefined;

  const requestsGroup = groupBy === 'agent' ? 'agent' : 'status';
  const usageGroup = groupBy === 'provider' ? 'provider' : 'agent';
  const recoveredTrendPct = (() => {
    const s = reliabilityStats;
    if (!s) return 0;
    const cur = s.fallback_saves?.value ?? 0;
    const prev = s.fallback_saves?.previous ?? 0;
    if (prev === 0) return 0;
    return Math.max(-999, Math.min(999, Math.round(((cur - prev) / prev) * 100)));
  })();

  const segmented = (options: Array<{ key: string; label: string; active: boolean }>) => (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={o.active} onClick={() => setGroupBy(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );

  const dashboard = () => {
    const o = overview!;
    return (
      <>
        <ReliabilityKpiCards stats={reliabilityStats} range={chartRange} />

        <UnifiedChartCard
          activeTab={chartView}
          onTabChange={setChartView}
          requestsValue={o.summary.messages.value}
          requestsTrendPct={o.summary.messages.trend_pct}
          recoveredValue={reliabilityStats?.fallback_saves?.value ?? 0}
          recoveredTrendPct={recoveredTrendPct}
          recoveredTimeseries={recoveredTs}
          costValue={o.summary.cost_today.value}
          costTrendPct={o.summary.cost_today.trend_pct}
          costInfoTooltip={t('overview.costInfo')}
          tokensValue={o.summary.tokens_today.value}
          tokensTrendPct={o.summary.tokens_today.trend_pct}
          range={chartRange}
          // A request can touch several providers, so the Requests tab only
          // groups by status or harness; usage tabs only group by provider or
          // harness. One stored groupBy, coerced per tab.
          requestStatusTimeseries={requestsGroup === 'status' ? requestStatusTs : undefined}
          agentRequestTimeseries={requestsGroup === 'agent' ? filteredMessageTs : undefined}
          agentTimeseries={filteredTokenTs}
          agentCostTimeseries={filteredCostTs}
          colorMap={agentColorMap}
          seriesFilters={
            <>
              {chartView === 'requests'
                ? segmented([
                    {
                      key: 'status',
                      label: t('overview.groupBy.status'),
                      active: requestsGroup === 'status',
                    },
                    {
                      key: 'agent',
                      label: t('overview.groupBy.harness'),
                      active: requestsGroup === 'agent',
                    },
                  ])
                : segmented([
                    {
                      key: 'provider',
                      label: t('overview.groupBy.provider'),
                      active: usageGroup === 'provider',
                    },
                    {
                      key: 'agent',
                      label: t('overview.groupBy.harness'),
                      active: usageGroup === 'agent',
                    },
                  ])}
              {chartView !== 'requests' || requestsGroup === 'agent' ? (
                <div className="min-w-36">
                  <FilterSelect
                    noun={
                      groupBy === 'provider'
                        ? t('overview.nounProviders')
                        : t('overview.nounHarnesses')
                    }
                    items={allAgents}
                    selected={effectiveSelected}
                    colorMap={agentColorMap}
                    onToggle={toggleAgent}
                    onSelectAll={() => setAllAgents(true)}
                    onUnselectAll={() => setAllAgents(false)}
                  />
                </div>
              ) : null}
            </>
          }
        />

        {/* "Error classes by frequency" stays unmounted until the backend has
            real error_class data (see the preservation spec in tests/components). */}

        <Panel
          title={t('overview.recentRequests')}
          actions={
            <Link to="/messages" className="view-more-link link-action text-sm">
              {t('overview.viewMore')}
            </Link>
          }
          bodyClassName="max-h-[420px] overflow-auto p-0"
        >
          {recentRequests ? (
            <MessageTable
              items={recentRequests}
              columns={recentColumns}
              customProviderName={() => undefined}
              expandable
              onRowSelect={(id: string) => navigate(`/messages?request=${id}`)}
            />
          ) : (
            <PanelRowsSkeleton />
          )}
        </Panel>

        <Panel
          title={t('overview.modelUsage.title')}
          bodyClassName="max-h-[420px] overflow-auto p-0"
        >
          <table className="data">
            <thead>
              <tr>
                <th>{t('overview.modelUsage.model')}</th>
                <th className="num">{t('overview.modelUsage.tokens')}</th>
                <th className="num">{t('overview.modelUsage.share')}</th>
                <th className="num">{t('overview.modelUsage.estCost')}</th>
                <th>
                  <HeadTip
                    label={t('overview.totalAttempts')}
                    tip={t('overview.tips.totalAttempts')}
                  />
                </th>
                <th>
                  <HeadTip
                    label={t('overview.successRate')}
                    tip={t('overview.tips.modelSuccessRate')}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {modelUsage === undefined ? (
                <tr>
                  <td colSpan={6} className="p-0">
                    <PanelRowsSkeleton />
                  </td>
                </tr>
              ) : null}
              {(modelUsage ?? []).slice(0, 10).map((row) => {
                const isCustom = row.provider?.startsWith('custom:') === true;
                const customName = row.custom_provider_name ?? undefined;
                const rel = modelReliability.data?.find((r) => r.model === row.model);
                const rate = rel ? attemptSuccessRate(rel) : null;
                return (
                  <tr key={`${row.provider ?? ''}:${row.model}`}>
                    <td>
                      <div className="flex items-center gap-1.5">
                        {isCustom ? (
                          (customProviderLogo(customName ?? '', 16, undefined, row.model) ?? (
                            <span title={customName} className="inline-flex">
                              <CustomLetter
                                name={customName ?? stripCustomPrefix(row.model)}
                                size={16}
                              />
                            </span>
                          ))
                        ) : row.provider ? (
                          <span className="relative flex size-3.5 shrink-0 items-center">
                            {providerIcon(row.provider, 16)}
                            {authBadgeFor(row.auth_type, 12)}
                          </span>
                        ) : null}
                        <span className="row-title">
                          {row.model.startsWith('custom:')
                            ? stripCustomPrefix(row.model)
                            : row.display_name || row.model}
                        </span>
                      </div>
                    </td>
                    <td className="num">{formatNumber(row.tokens)}</td>
                    <td className="num">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-15 overflow-hidden rounded-full bg-s3">
                          <div
                            className="h-full rounded-full bg-ok"
                            style={{ width: `${row.share_pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted">{row.share_pct}%</span>
                      </div>
                    </td>
                    <td className="num">{formatCost(row.estimated_cost) ?? formatCost(0)}</td>
                    <td>{rel ? formatNumber(rel.attempts) : '—'}</td>
                    <td>{rate == null ? '—' : formatRate(rate)}</td>
                  </tr>
                );
              })}
              {modelUsage?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted">
                    {t('overview.modelUsage.empty')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Panel>

        <Panel
          title={t('overview.connections.title')}
          bodyClassName="max-h-[420px] overflow-auto p-0"
        >
          <table className="data">
            <thead>
              <tr>
                <th>{t('overview.connections.provider')}</th>
                <th>{t('overview.connections.name')}</th>
                <th>{t('overview.connections.type')}</th>
                <th>{t('overview.connections.status')}</th>
                <th>
                  <HeadTip
                    label={t('overview.totalAttempts')}
                    tip={t('overview.tips.totalAttempts')}
                  />
                </th>
                <th>
                  <HeadTip
                    label={t('overview.connections.failedAttempts')}
                    tip={t('overview.connections.failedAttemptsTip')}
                  />
                </th>
                <th>
                  <HeadTip
                    label={t('overview.successRate')}
                    tip={t('overview.tips.connectionSuccessRate')}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {providerList
                .flatMap((group) =>
                  (group.connections.length
                    ? group.connections
                    : [{ id: '', label: 'Default', is_active: false }]
                  ).map((connection) => ({ group, connection })),
                )
                .map(({ group, connection }, i) => {
                  const isCustom = group.provider.startsWith('custom:');
                  const customName = isCustom ? (group.display_name ?? null) : null;
                  const prov = PROVIDERS.find((p) => p.id === group.provider);
                  const displayName = prov?.name ?? customName ?? group.provider;
                  const pKey = isCustom ? 'custom' : group.provider;
                  const wantedLabel = (connection.label || 'Default').toLowerCase();
                  const rel = providerReliability.data?.find(
                    (r) =>
                      r.provider === pKey &&
                      r.auth_type === group.auth_type &&
                      (r.key_label ?? 'Default').toLowerCase() === wantedLabel,
                  );
                  const failed = rel && rel.succeeded != null ? rel.attempts - rel.succeeded : null;
                  const rate = rel ? attemptSuccessRate(rel) : null;
                  const failedLink = `/messages?connections=${encodeURIComponent(connection.id)}&range=${chartRange}&attempts=has_failed`;
                  return (
                    <tr
                      key={`${group.provider}:${group.auth_type}:${connection.id || i}`}
                      className={connection.id ? 'cursor-pointer' : undefined}
                      onClick={() => {
                        if (connection.id) navigate(`/providers/connections/${connection.id}`);
                      }}
                    >
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="flex shrink-0 items-center">
                            {providerIcon(group.provider, 20) ??
                              (isCustom ? customProviderLogo(customName ?? '', 20) : null) ??
                              (isCustom ? (
                                <CustomLetter name={customName ?? displayName} size={20} />
                              ) : null)}
                          </span>
                          <span className="row-title">{displayName}</span>
                          {isCustom ? <Badge>{t('overview.connections.custom')}</Badge> : null}
                        </div>
                      </td>
                      <td className="text-muted">
                        {connection.label || t('overview.connections.defaultLabel')}
                      </td>
                      <td>
                        <span className="text-xs font-medium text-muted">
                          {authLabel(group.auth_type)}
                        </span>
                      </td>
                      <td>
                        {connection.is_active ? (
                          <Badge tone="ok">{t('overview.connections.active')}</Badge>
                        ) : (
                          <Badge>{t('overview.connections.inactive')}</Badge>
                        )}
                      </td>
                      <td>{rel ? formatNumber(rel.attempts) : '—'}</td>
                      <td>
                        {failed == null ? (
                          '—'
                        ) : failed === 0 || !connection.id ? (
                          formatNumber(failed)
                        ) : (
                          // The row navigates to the connection; this cell
                          // drills into the Requests log instead.
                          <CountLink
                            to={failedLink}
                            title={t('overview.connections.failedLinkTitle')}
                            onGo={navigate}
                          >
                            {formatNumber(failed)}
                          </CountLink>
                        )}
                      </td>
                      <td>{rate == null ? '—' : formatRate(rate)}</td>
                    </tr>
                  );
                })}
              {providerList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-muted">
                    {t('overview.connections.empty')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Panel>

        <Panel
          title={t('overview.harnesses.title')}
          bodyClassName="max-h-[420px] overflow-auto p-0"
        >
          <table className="data">
            <thead>
              <tr>
                <th>{t('overview.harnesses.harness')}</th>
                <th>{t('overview.harnesses.usage')}</th>
                <th>
                  <HeadTip
                    label={t('overview.harnesses.totalRequests')}
                    tip={t('overview.tips.harnessTotalRequests')}
                  />
                </th>
                <th>{t('overview.harnesses.recoveredRequests')}</th>
                <th>
                  <HeadTip
                    label={t('overview.successRate')}
                    tip={t('overview.tips.harnessSuccessRate')}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedAgents.map((agent) => {
                const icon = platformIcon(agent.agent_platform, agent.agent_category);
                const usage = harnessUsageFor(agent.agent_name);
                const rel = agentReliability.data?.find((r) => r.agent_name === agent.agent_name);
                const rate = rel ? successRate(rel) : null;
                const scope = `/messages?agent=${encodeURIComponent(agent.agent_name)}&range=${chartRange}`;
                return (
                  <tr
                    key={agent.agent_name}
                    className="cursor-pointer"
                    onClick={() => navigate(`/harnesses/${encodeURIComponent(agent.agent_name)}`)}
                  >
                    <td>
                      <div className="flex items-center gap-2">
                        {icon ? (
                          <img src={icon} alt="" width={20} height={20} className="shrink-0" />
                        ) : null}
                        <span className="row-title">{agent.display_name || agent.agent_name}</span>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        {(usage?.spark ?? []).length > 0 ? (
                          <span className="shrink-0 text-accent">
                            <Sparkline data={usage!.spark} width={60} height={24} />
                          </span>
                        ) : null}
                        <span className="tabular-nums">
                          {t('overview.harnesses.tokens', { n: formatNumber(usage?.total ?? 0) })}
                        </span>
                      </div>
                    </td>
                    <td>
                      <CountLink
                        to={scope}
                        title={t('overview.harnesses.requestsLinkTitle')}
                        onGo={navigate}
                      >
                        {formatNumber(rel?.requests ?? 0)}
                      </CountLink>
                    </td>
                    <td>
                      {rel ? (
                        // Recovered = successful requests holding a fallback attempt.
                        <CountLink
                          to={`${scope}&status=ok&trigger=fallback`}
                          title={t('overview.harnesses.recoveredLinkTitle')}
                          onGo={navigate}
                        >
                          {formatNumber(recoveredCount(rel))}
                        </CountLink>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{rate == null ? '—' : formatRate(rate)}</td>
                  </tr>
                );
              })}
              {agentList.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted">
                    {t('overview.harnesses.empty')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Panel>
      </>
    );
  };

  return (
    <div className="page wide">
      <title>{t('overview.pageTitle')}</title>
      <AddAgentModal open={addAgentOpen} onClose={dismissAddAgent} />

      {!hasNoAgents || !hasNoProviders ? (
        <div className="page-head justify-end">
          <div className="page-actions">
            <div className="w-44">
              <Select value={chartRange} onChange={setChartRange} options={rangeOptions()} />
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        {hasNoAgents && hasNoProviders ? (
          <Panel>
            <EmptyState
              icon={<BarChart3 aria-hidden="true" />}
              title={t('overview.empty.noActivity')}
              description={t('overview.empty.setupAndConnect')}
              action={
                <Button size="sm" className="mt-2" onClick={() => setAddAgentOpen(true)}>
                  {t('overview.empty.setupHarness')}
                </Button>
              }
            />
          </Panel>
        ) : null}

        {!hasNoAgents && hasNoProviders ? (
          <Panel>
            <EmptyState
              icon={<BarChart3 aria-hidden="true" />}
              title={t('overview.empty.noProviders')}
              description={t('overview.empty.connectToRoute')}
              action={
                <ButtonLink to="/providers/subscriptions" size="sm" className="mt-2">
                  {t('overview.empty.connectProvider')}
                </ButtonLink>
              }
            />
          </Panel>
        ) : null}

        {showDashboard ? (
          dashboard()
        ) : !hasNoAgents && !hasNoProviders ? (
          <GlobalOverviewSkeleton />
        ) : null}
      </div>
    </div>
  );
}
