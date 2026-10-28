import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import UnifiedChartCard, { type ChartTab } from '../components/UnifiedChartCard.js';
import ReliabilityKpiCards from '../components/ReliabilityKpiCards.js';
import FilterSelect from '../components/FilterSelect.js';
import { AGENT_COLORS } from '../components/MultiAgentTokenChart.js';
import CostByModelTable from '../components/CostByModelTable.js';
import ErrorState from '../components/ErrorState.js';
import MessageTable from '../components/MessageTable.js';
import OverviewSkeleton from '../components/OverviewSkeleton.js';
import Select from '../components/Select.js';
import SetupModal from '../components/SetupModal.js';
import { Button, EmptyState, Panel } from '../components/ui.js';
import { type MessageRow } from '../components/message-table-types.js';
import { agentDisplayName } from '../services/agent-display-name.js';
import { agentPlatform, agentCategory } from '../services/agent-platform-store.js';
import { PROVIDERS } from '../services/providers.js';
import { getOverview, getOverviewDetails } from '../services/api.js';
import {
  getReliabilityStats,
  getRequestStatusTimeseries,
  getPerModelReliability,
  getPerProviderTimeseries,
  getPerProviderMessageTimeseries,
  getPerProviderCostTimeseries,
} from '../services/api/analytics.js';
import { preloadModelDisplayNames } from '../services/model-display.js';
import { isRecentlyCreated, isSetupPending, clearSetupPending } from '../services/recent-agents.js';
import { analyticsPing } from '../services/sse.js';
import {
  RANGE_STORAGE_KEY,
  VALID_RANGES,
  useOverviewColumns,
  rangeOptions,
  useOverviewRange,
} from '../services/use-overview-range.js';
import { useSignal } from '../lib/signal.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';

interface OverviewData {
  summary: {
    tokens_today: {
      value: number;
      trend_pct: number;
      sub_values?: { input: number; output: number };
    };
    cost_today: { value: number; trend_pct: number };
    messages: { value: number; trend_pct: number };
    services_hit: { total: number; healthy: number; issues: number };
  };
  request_reliability: {
    total: number;
    successful: number;
    success_rate: number;
    attempt_success_rate: number;
    thinker_lift_pct: number;
    recovered: number;
  } | null;
  token_usage: Array<{
    hour?: string;
    date?: string;
    input_tokens: number;
    output_tokens: number;
  }>;
  cost_usage: Array<{ hour?: string; date?: string; cost: number }>;
  message_usage: Array<{ hour?: string; date?: string; count: number }>;
  cost_by_model: Array<{
    model: string;
    display_name?: string;
    tokens: number;
    share_pct: number;
    estimated_cost: number;
    auth_type: string | null;
    provider?: string | null;
  }>;
  recent_activity: MessageRow[];
  active_skills: Array<{
    name: string;
    agent_name: string | null;
    run_count: number;
    last_active_at: string;
    status: string;
  }>;
  has_data?: boolean;
  has_providers?: boolean;
}

type OverviewDetails = Pick<
  OverviewData,
  'cost_by_model' | 'recent_activity' | 'request_reliability' | 'active_skills'
>;

type KeyedTimeseries = {
  agents: string[];
  timeseries: Array<Record<string, number | string>>;
};

/** A fetched value tagged with the scope (range + harness visit) it belongs to. */
type Scoped<T> = { scope: object; data: T };

const SMART_RANGES = ['30d', '7d', '24h'];

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the flag lasts for this page only.
  }
}

function loadSavedProviders(key: string): Set<string> {
  try {
    const saved = sessionStorage.getItem(key);
    if (saved) return new Set(JSON.parse(saved) as string[]);
  } catch {
    /* ignore */
  }
  return new Set();
}

function filterTs(raw: KeyedTimeseries | undefined, sel: Set<string>): KeyedTimeseries | undefined {
  if (!raw) return undefined;
  if (sel.size === 0) return raw;
  return {
    agents: raw.agents.filter((a) => sel.has(a)),
    timeseries: raw.timeseries.map((row) => {
      const out: Record<string, number | string> = {};
      for (const [k, v] of Object.entries(row)) {
        if (k === 'hour' || k === 'date' || sel.has(k)) out[k] = v;
      }
      return out;
    }),
  };
}

const providerDisplayName = (provId: string): string =>
  PROVIDERS.find((p) => p.id === provId)?.name ?? provId;

/** The Overview tab of a harness: reliability KPIs, the chart card, recent requests, model usage. */
export default function Overview() {
  const params = useParams<{ agentName: string }>();
  const agentName = safeDecode(params.agentName ?? '');
  const location = useLocation();
  const navigate = useNavigate();
  const ping = useSignal(analyticsPing);
  const { columns } = useOverviewColumns();

  useEffect(() => {
    preloadModelDisplayNames();
  }, []);

  // Only treat the stored value as a user selection when it is actually valid.
  // An invalid stored range falls through to the smart-range cascade.
  const [userSelectedRange, setUserSelectedRange] = useState(() =>
    VALID_RANGES.has(readStorage(RANGE_STORAGE_KEY) ?? ''),
  );
  const { range, setRange, handleRangeChange } = useOverviewRange({
    markUserSelected: () => setUserSelectedRange(true),
  });

  const [activeView, setActiveViewRaw] = useState<ChartTab>('requests');
  const [tokenChartRequested, setTokenChartRequested] = useState(false);
  const [costChartRequested, setCostChartRequested] = useState(false);
  const setActiveView = (view: ChartTab) => {
    if (view === 'tokens') setTokenChartRequested(true);
    if (view === 'cost') setCostChartRequested(true);
    setActiveViewRaw(view);
  };

  // Open gate keys off a persistent "setup pending" flag (localStorage) so the
  // modal reliably reopens after a page refresh until the user dismisses or
  // completes it; `isRecentlyCreated` is an in-session OR that need not survive
  // reloads. The completed/dismissed flags are the backstop against re-opening.
  const [setupOpen, setSetupOpen] = useState(
    () =>
      (isSetupPending(agentName) || isRecentlyCreated(agentName)) &&
      !readStorage(`setup_completed_${agentName}`) &&
      !readStorage(`setup_dismissed_${agentName}`),
  );
  const [setupCompleted, setSetupCompleted] = useState(
    () => !!readStorage(`setup_completed_${agentName}`),
  );

  // One token per range/agent visit: its identity changes on every transition
  // (A → B → A included) but stays stable across same-scope SSE refreshes, so
  // a result from an earlier visit never passes for the current one.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scope = useMemo(() => ({}), [range, agentName]);

  // ── Critical overview ────────────────────────────────────────────────
  // Refetches on range, agent and every SSE ping. The skeleton shows only
  // while the visible data belongs to another range/agent — a background ping
  // refetch updates in place instead.
  const overviewRes = useResource(
    async (): Promise<Scoped<OverviewData>> => ({
      scope,
      data: (await getOverview(range, agentName, true)) as OverviewData,
    }),
    [range, agentName, ping],
  );
  const overviewMatches = overviewRes.data?.scope === scope;
  const data = overviewMatches ? overviewRes.data!.data : undefined;

  // Secondary details load once the critical overview for this scope is in.
  const detailsRes = useResource(
    async (): Promise<Scoped<OverviewDetails>> => ({
      scope,
      data: (await getOverviewDetails(range, agentName)) as OverviewDetails,
    }),
    [scope, overviewMatches],
    { enabled: overviewMatches },
  );
  const overviewDetails = detailsRes.data?.scope === scope ? detailsRes.data.data : undefined;

  const showDashboard = !!data && (data.has_data !== false || data.has_providers === true);
  const showEmptyState = !!data && data.has_data === false && !data.has_providers;

  useEffect(() => {
    if (showEmptyState && !setupCompleted && !readStorage(`setup_dismissed_${agentName}`)) {
      setSetupOpen(true);
    }
  }, [showEmptyState, setupCompleted, agentName]);

  // Step the chart range down to the next bucket while it has no data, but only
  // once a fetch for the current range resolved. Both `data` and `range` are
  // tracked so the cascade keeps re-firing as it steps 30d → 7d → 24h.
  useEffect(() => {
    if (userSelectedRange) return;
    if (!data || (data.has_data === false && !data.has_providers)) return;
    const hasData =
      (data.token_usage?.length ?? 0) > 0 ||
      (data.cost_usage?.length ?? 0) > 0 ||
      (data.message_usage?.length ?? 0) > 0;
    if (hasData) return;
    const currentIdx = SMART_RANGES.indexOf(range);
    if (currentIdx < 0 || currentIdx >= SMART_RANGES.length - 1) return;
    setRange(SMART_RANGES[currentIdx + 1]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, range]);

  // ── Provider breakdown (per-agent, grouped by provider) ─────────────
  const providerFilterKey = `agent-overview-providers:${agentName}`;
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(() =>
    loadSavedProviders(providerFilterKey),
  );
  useEffect(() => {
    setSelectedProviders(loadSavedProviders(providerFilterKey));
  }, [providerFilterKey]);

  const providerTokenTs = useResource(
    () => getPerProviderTimeseries(agentName, range) as Promise<KeyedTimeseries>,
    [agentName, range, ping],
    { enabled: tokenChartRequested },
  );
  const providerMessageTs = useResource(
    () => getPerProviderMessageTimeseries(agentName, range) as Promise<KeyedTimeseries>,
    [agentName, range, ping],
  );
  const providerCostTs = useResource(
    () => getPerProviderCostTimeseries(agentName, range) as Promise<KeyedTimeseries>,
    [agentName, range, ping],
    { enabled: costChartRequested },
  );

  // ── Reliability ──────────────────────────────────────────────────────
  const reliabilityRes = useResource(
    async () => ({ scope, data: await getReliabilityStats(range, agentName) }),
    [range, agentName, ping],
  );
  const reliabilityStats =
    reliabilityRes.data?.scope === scope ? reliabilityRes.data.data : undefined;
  // Request-status timeseries: the Requests chart's ONLY view on this page (an
  // agent is the harness, and a request may touch several providers, so no
  // other grouping is meaningful) + the Recovered requests tab subset.
  const statusTs = useResource(
    () => getRequestStatusTimeseries(range, agentName),
    [range, agentName, ping],
  );
  const modelReliability = useResource(
    () => getPerModelReliability(range, agentName),
    [range, agentName, ping],
  );

  const recoveredTs = useMemo(() => {
    const ts = statusTs.data;
    if (!ts) return undefined;
    const picked = ts.keys.map((k, i) => ({ k, i })).filter(({ k }) => k === 'fallback');
    return {
      ...ts,
      keys: picked.map(({ k }) => k),
      buckets: ts.buckets.map((b) => ({
        bucket: b.bucket,
        counts: picked.map(({ i }) => b.counts[i] ?? 0),
      })),
    };
  }, [statusTs.data]);

  const allProviders = useMemo(() => {
    const set = new Set<string>([
      ...(providerTokenTs.data?.agents ?? []),
      ...(providerMessageTs.data?.agents ?? []),
      ...(providerCostTs.data?.agents ?? []),
    ]);
    return [...set].sort();
  }, [providerTokenTs.data, providerMessageTs.data, providerCostTs.data]);

  const providerColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    allProviders.forEach((p, i) => {
      map[p] = AGENT_COLORS[i % AGENT_COLORS.length]!;
    });
    return map;
  }, [allProviders]);

  const effectiveSelected = useMemo(
    () =>
      selectedProviders.size === 0 && allProviders.length > 0
        ? new Set(allProviders)
        : selectedProviders,
    [selectedProviders, allProviders],
  );
  const persistProviders = (next: Set<string>) => {
    setSelectedProviders(next);
    try {
      sessionStorage.setItem(providerFilterKey, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  };
  const toggleProvider = (provider: string) => {
    const next = new Set(effectiveSelected);
    if (next.has(provider)) next.delete(provider);
    else next.add(provider);
    persistProviders(next);
  };
  const setAllProviders = (on: boolean) =>
    persistProviders(on ? new Set(allProviders) : new Set<string>());

  // Memoized so the charts see a new array only when the series really change.
  const filteredTokenTs = useMemo(
    () => filterTs(providerTokenTs.data, effectiveSelected),
    [providerTokenTs.data, effectiveSelected],
  );
  const filteredCostTs = useMemo(
    () => filterTs(providerCostTs.data, effectiveSelected),
    [providerCostTs.data, effectiveSelected],
  );

  const recoveredTrendPct = (() => {
    const s = reliabilityStats;
    if (!s) return 0;
    const cur = s.fallback_saves?.value ?? 0;
    const prev = s.fallback_saves?.previous ?? 0;
    if (prev === 0) return 0;
    return Math.max(-999, Math.min(999, Math.round(((cur - prev) / prev) * 100)));
  })();

  const encodedAgent = encodeURIComponent(agentName);
  const goToRouting = () =>
    navigate(`/harnesses/${encodedAgent}/routing`, { state: { openProviders: true } });
  const name = agentDisplayName() ?? agentName;
  const newApiKey = (location.state as { newApiKey?: string } | null)?.newApiKey ?? null;

  const content = () => {
    if (overviewRes.error && !overviewRes.loading) {
      return <ErrorState error={overviewRes.error} onRetry={() => void overviewRes.reload()} />;
    }
    if (!data) return <OverviewSkeleton />;
    if (showEmptyState) {
      return (
        <Panel>
          <EmptyState
            title={t('overview.empty.noActivity')}
            description={
              setupCompleted ? t('overview.empty.agentConnect') : t('overview.empty.agentSetup')
            }
            action={
              <>
                {setupCompleted ? (
                  <Button size="sm" className="mt-2" onClick={goToRouting}>
                    {t('overview.empty.connectProvider')}
                  </Button>
                ) : (
                  <Button size="sm" className="mt-2" onClick={() => setSetupOpen(true)}>
                    {t('overview.empty.setupHarness')}
                  </Button>
                )}
                <img
                  src="/example-overview.svg"
                  alt={t('overview.empty.exampleAlt')}
                  className="mt-4 w-full max-w-2xl opacity-60"
                  loading="lazy"
                />
              </>
            }
          />
        </Panel>
      );
    }
    if (!showDashboard) return null;

    const recent =
      overviewDetails?.recent_activity?.slice(0, 5) ?? data.recent_activity?.slice(0, 5) ?? [];
    return (
      <>
        {data.has_data === false ? (
          <div className="waiting-banner notice is-info">
            <p>{t('overview.empty.waiting')}</p>
          </div>
        ) : null}

        <ReliabilityKpiCards stats={reliabilityStats} agentName={agentName} range={range} />

        <UnifiedChartCard
          activeTab={activeView}
          onTabChange={setActiveView}
          requestsValue={data.summary?.messages?.value ?? 0}
          requestsTrendPct={data.summary?.messages?.trend_pct ?? 0}
          recoveredValue={reliabilityStats?.fallback_saves?.value ?? 0}
          recoveredTrendPct={recoveredTrendPct}
          recoveredTimeseries={recoveredTs}
          costValue={data.summary?.cost_today?.value ?? 0}
          costTrendPct={data.summary?.cost_today?.trend_pct ?? 0}
          costInfoTooltip={t('overview.costInfo')}
          tokensValue={data.summary?.tokens_today?.value ?? 0}
          tokensTrendPct={data.summary?.tokens_today?.trend_pct ?? 0}
          range={range}
          requestStatusTimeseries={statusTs.data}
          agentTimeseries={filteredTokenTs}
          agentCostTimeseries={filteredCostTs}
          colorMap={providerColorMap}
          seriesFilters={
            activeView !== 'requests' && allProviders.length > 1 ? (
              <FilterSelect
                noun={t('overview.nounProviders')}
                items={allProviders}
                selected={effectiveSelected}
                colorMap={providerColorMap}
                displayName={providerDisplayName}
                onToggle={toggleProvider}
                onSelectAll={() => setAllProviders(true)}
                onUnselectAll={() => setAllProviders(false)}
              />
            ) : undefined
          }
        />

        {/* "Error classes by frequency" stays unmounted until the backend has
            real error_class data (preservation spec). */}

        <Panel
          title={t('overview.recentRequests')}
          actions={
            <Link
              to={`/harnesses/${encodedAgent}/messages`}
              className="view-more-link link-action text-sm"
            >
              {t('overview.viewMore')}
            </Link>
          }
          bodyClassName="p-0"
        >
          <MessageTable
            items={recent}
            columns={columns}
            agentName={agentName}
            customProviderName={() => undefined}
            // No inline accordion here: a click lands on the Requests page
            // with the request opened in the side panel. (`expandable` keeps
            // the rows clickable; `onRowSelect` switches them to drawer mode.)
            expandable
            onRowSelect={(id: string) =>
              navigate(`/harnesses/${encodedAgent}/messages?request=${id}`)
            }
          />
        </Panel>

        <CostByModelTable
          rows={overviewDetails?.cost_by_model ?? data.cost_by_model ?? []}
          reliability={modelReliability.data}
        />
      </>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <title>{t('overview.agentPageTitle', { name })}</title>
      <meta name="description" content={t('overview.agentMetaDescription', { name })} />

      {showDashboard || (showEmptyState && !setupCompleted) ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {showDashboard ? (
            <div className="w-44">
              <Select value={range} onChange={handleRangeChange} options={rangeOptions()} />
            </div>
          ) : null}
          {showEmptyState && !setupCompleted ? (
            <Button size="sm" onClick={() => setSetupOpen(true)}>
              {t('overview.empty.setupHarness')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {content()}

      <SetupModal
        open={setupOpen}
        agentName={agentName}
        apiKey={newApiKey}
        agentPlatform={agentPlatform()}
        agentCategory={agentCategory()}
        onClose={() => {
          writeStorage(`setup_dismissed_${agentName}`, '1');
          clearSetupPending(agentName);
          setSetupOpen(false);
        }}
        onDone={() => {
          writeStorage(`setup_completed_${agentName}`, '1');
          clearSetupPending(agentName);
          setSetupCompleted(true);
        }}
        onGoToRouting={goToRouting}
      />
    </div>
  );
}
