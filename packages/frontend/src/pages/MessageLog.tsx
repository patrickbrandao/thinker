import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
} from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Ban, Sprout } from 'lucide-react';
import ErrorState from '../components/ErrorState.js';
import MessageTable from '../components/MessageTable.js';
import RequestDrawer from '../components/RequestDrawer.js';
import Pagination from '../components/Pagination.js';
import Select, { type SelectOption } from '../components/Select.js';
import MultiSelect, { type MultiSelectOption } from '../components/MultiSelect.js';
import { getProviders as getProviderConnections } from '../services/api/providers.js';
import SetupModalImpl from '../components/SetupModal.js';
import { DETAILED_COLUMNS, type MessageRow } from '../components/message-table-types.js';
import { FallbackIcon } from '../components/message-table-cells.js';
import { agentDisplayNameSignal } from '../services/agent-display-name.js';
import { agentPlatformSignal } from '../services/agent-platform-store.js';
import {
  getAgents,
  getSpecificityAssignments,
  getMessageCount,
  getMessages,
  getMessageFilterOptions,
  getRoutingStatus,
} from '../services/api.js';
import { useCursorPagination } from '../services/cursor-pagination.js';
import { getModelDisplayName, preloadModelDisplayNames } from '../services/model-display.js';
import { PROVIDERS, SPECIFICITY_STAGES } from '../services/providers.js';
import { providerIcon } from '../components/ProviderIcon.js';
import { platformIcon, ALL_TIERS, TIER_LABELS_ALL } from 'thinker-shared';
import { analyticsPing, messagePing } from '../services/sse.js';
import { useSignal } from '../lib/signal.js';
import { useResource } from '../lib/use-resource.js';
import { Button, ButtonLink, Skel } from '../components/ui.js';
import { t, tMaybe } from '../i18n/index.js';

// SetupModal belongs to the harness-setup area; typed here by its props
// contract so this page does not depend on how that component is written.
const SetupModal = SetupModalImpl as unknown as ComponentType<{
  open: boolean;
  agentName: string;
  agentPlatform?: string | null;
  agentCategory?: string | null;
  onClose: () => void;
}>;

interface MessagesData {
  items: MessageRow[];
  next_cursor: string | null;
  total_count: number;
  total_count_exact?: boolean;
  providers: string[];
  provider_labels?: Record<string, string>;
}

interface MessageFilterOptionsData {
  providers: string[];
  provider_labels?: Record<string, string>;
  /** Every model this tenant has used in range — the Model filter's options. */
  models?: string[];
}

interface AgentFilterOption {
  agent_name: string;
  agent_platform?: string | null;
  agent_category?: string | null;
}

type ParamPatch = Record<string, string | undefined>;

const SPECIFICITY_FILTER_PREFIX = 'specificity:';
const MESSAGE_STATUS_FILTERS = ['ok', 'failed', 'cancelled'] as const;
type MessageStatusFilter = (typeof MESSAGE_STATUS_FILTERS)[number];
type MessageStatusFilterValue = '' | MessageStatusFilter;
const MESSAGE_TRIGGER_FILTERS = ['none', 'fallback'] as const;
type MessageTriggerFilter = (typeof MESSAGE_TRIGGER_FILTERS)[number];

const isMessageStatusFilter = (value: unknown): value is MessageStatusFilter =>
  typeof value === 'string' && (MESSAGE_STATUS_FILTERS as readonly string[]).includes(value);

const normalizeStatusFilter = (value: unknown): MessageStatusFilterValue =>
  isMessageStatusFilter(value) ? value : '';

const MESSAGE_RANGE_FILTERS = ['24h', '7d', '30d', '90d', '365d'] as const;
type MessageRangeFilter = (typeof MESSAGE_RANGE_FILTERS)[number];
type MessageRangeFilterValue = '' | MessageRangeFilter;

const isMessageRangeFilter = (value: unknown): value is MessageRangeFilter =>
  typeof value === 'string' && (MESSAGE_RANGE_FILTERS as readonly string[]).includes(value);

const normalizeRangeFilter = (value: unknown): MessageRangeFilterValue =>
  isMessageRangeFilter(value) ? value : '';

const isMessageTriggerFilter = (value: unknown): value is MessageTriggerFilter =>
  typeof value === 'string' && (MESSAGE_TRIGGER_FILTERS as readonly string[]).includes(value);

const normalizeTriggerFilters = (value: unknown): MessageTriggerFilter[] =>
  typeof value === 'string' ? value.split(',').filter(isMessageTriggerFilter) : [];

/** The recovery select's states: default, any kind, one kind, or none at all. */
const TRIGGER_CHOICES = ['fallback', 'none'] as const;
type TriggerChoice = '' | (typeof TRIGGER_CHOICES)[number];

const isTriggerChoice = (value: unknown): value is TriggerChoice =>
  value === '' ||
  (typeof value === 'string' && (TRIGGER_CHOICES as readonly string[]).includes(value));

const ATTEMPT_STATUS_FILTERS = ['has_failed', 'has_succeeded'] as const;
type AttemptStatusFilter = (typeof ATTEMPT_STATUS_FILTERS)[number];

const isAttemptStatusFilter = (value: unknown): value is AttemptStatusFilter =>
  typeof value === 'string' && (ATTEMPT_STATUS_FILTERS as readonly string[]).includes(value);

const normalizeAttemptStatusFilters = (value: unknown): AttemptStatusFilter[] =>
  typeof value === 'string' ? value.split(',').filter(isAttemptStatusFilter) : [];

// A plain select over the useful recovery readings. The wire stays a comma
// list (?trigger=fallback); unknown kinds in an old deep link are ignored.
const triggerListToChoice = (list: MessageTriggerFilter[]): TriggerChoice => {
  if (list.includes('fallback')) return 'fallback';
  if (list.includes('none')) return 'none';
  return '';
};
const triggerChoiceToParam = (choice: TriggerChoice): string | undefined => choice || undefined;

const splitList = (value: string | null): string[] =>
  value ? value.split(',').filter(Boolean) : [];

/** Runs `onChange` when `value` changes after mount (Solid's `on(..., { defer: true })`). */
function useOnChange<T>(value: T, onChange: (value: T) => void): void {
  const previous = useRef(value);
  const callback = useRef(onChange);
  callback.current = onChange;
  useEffect(() => {
    if (Object.is(previous.current, value)) return;
    previous.current = value;
    callback.current(value);
  }, [value]);
}

const SKELETON_WIDTHS = [90, 55, 40, 40, 35, 35, 110, 90, 35, 50];

function TableSkeleton() {
  return (
    <div className="table-wrap" aria-busy="true">
      <table className="data">
        <thead>
          <tr>
            <th>{t('messages.log.skeleton.date')}</th>
            <th>{t('messages.log.skeleton.request')}</th>
            <th>{t('messages.log.skeleton.cost')}</th>
            <th>{t('messages.log.skeleton.totalTokens')}</th>
            <th>{t('messages.log.skeleton.input')}</th>
            <th>{t('messages.log.skeleton.output')}</th>
            <th>{t('messages.log.skeleton.model')}</th>
            <th>{t('messages.log.skeleton.cache')}</th>
            <th>{t('messages.log.skeleton.latency')}</th>
            <th>{t('messages.log.skeleton.status')}</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 10 }, (_, row) => (
            <tr key={row}>
              {SKELETON_WIDTHS.map((width, col) => (
                <td key={col}>
                  <Skel width={width} height={12} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExampleImage() {
  return (
    <img
      src="/example-messages.svg"
      alt={t('messages.log.exampleAlt')}
      className="mt-6 w-full max-w-2xl rounded-surface border border-line"
      loading="lazy"
    />
  );
}

export default function MessageLog() {
  const params = useParams<{ agentName?: string }>();
  const routeAgent = params.agentName ?? '';
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const agentDisplayName = useSignal(agentDisplayNameSignal);
  const agentPlatformInfo = useSignal(agentPlatformSignal);
  const messagePingValue = useSignal(messagePing);
  const analyticsPingValue = useSignal(analyticsPing);

  const agentParam = searchParams.get('agent');
  const statusParam = searchParams.get('status');
  const requestParam = searchParams.get('request');
  const providerParam = searchParams.get('provider');
  const connectionsParam = searchParams.get('connections');
  const triggerParam = searchParams.get('trigger');
  const attemptsParam = searchParams.get('attempts');
  const modelParam = searchParams.get('model');
  const rangeParam = searchParams.get('range');

  useEffect(() => preloadModelDisplayNames(), []);

  /** Merges `patch` into the URL in one navigation (empty values drop the key). */
  const writeParams = useCallback(
    (patch: ParamPatch, options: { replace?: boolean } | undefined = { replace: true }) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      }, options);
    },
    [setSearchParams],
  );

  const columns = useMemo(() => {
    const base = DETAILED_COLUMNS;
    if (routeAgent) return base;
    // Global Requests spans every harness, so show which harness each row belongs to.
    const at = base.indexOf('model');
    return [...base.slice(0, at), 'agent' as const, ...base.slice(at)];
  }, [routeAgent]);

  // Seed from ?agent= (set by AgentMessagesRedirect) so "View more" on a
  // harness overview lands pre-filtered; only meaningful in global mode —
  // when the route itself carries an agent, that param scopes the query.
  const [agentFilter, setAgentFilter] = useState(!routeAgent && agentParam ? agentParam : '');
  useOnChange(agentParam, (agent) => {
    if (!routeAgent) setAgentFilter(agent ?? '');
  });

  const agentListResource = useResource(async () => {
    if (routeAgent) return [] as AgentFilterOption[];
    // includePlayground=true so the reserved Playground agent appears in the
    // filter and the log can be narrowed to Playground runs.
    const data = (await getAgents(true)) as { agents?: AgentFilterOption[] } | AgentFilterOption[];
    return (Array.isArray(data) ? data : (data?.agents ?? [])) as AgentFilterOption[];
  }, [routeAgent]);
  const agentListRaw = agentListResource.data;
  const agentPlatformMap = useMemo(() => {
    const map = new Map<string, { platform: string | null; category: string | null }>();
    for (const a of agentListRaw ?? []) {
      map.set(a.agent_name, {
        platform: a.agent_platform ?? null,
        category: a.agent_category ?? null,
      });
    }
    return map;
  }, [agentListRaw]);
  const agentFilterOptions: SelectOption[] = [
    { label: t('messages.log.filters.allHarnesses'), value: '' },
    ...(agentListRaw ?? [])
      .map((a) => a.agent_name)
      .sort()
      .map((a) => {
        const info = agentPlatformMap.get(a);
        const iconPath = info?.platform ? platformIcon(info.platform, info.category) : null;
        return {
          label: a,
          value: a,
          icon: iconPath ? (
            <img
              src={iconPath}
              alt=""
              width="14"
              height="14"
              className="platform-icon shrink-0 rounded-[3px]"
            />
          ) : (
            <span className="inline-block size-3.5 shrink-0" />
          ),
        };
      }),
  ];

  // `?connections=` deep-links a pre-filtered log (dashboard connection cards
  // link here); `?provider=` is the legacy form and folds into it below.
  const [connectionsFilter, setConnectionsFilterValue] = useState<string[]>(() =>
    splitList(connectionsParam),
  );
  const connectionsRef = useRef(connectionsFilter);
  connectionsRef.current = connectionsFilter;
  const setConnectionsFilter = (values: string[]) => {
    setConnectionsFilterValue(values);
    writeParams({ connections: values.length ? values.join(',') : undefined });
  };
  const connectionConfig = useResource(async () => {
    try {
      return await getProviderConnections();
    } catch {
      return null;
    }
  }, []);
  const connectionGroups = connectionConfig.data?.providers;
  // Legacy `?provider=openai` deep links select every connection of that
  // provider once the connection list is known.
  useEffect(() => {
    if (!providerParam || !connectionGroups) return;
    let selected = connectionsRef.current;
    if (selected.length === 0) {
      const ids = connectionGroups
        .filter((g) => g.provider === providerParam)
        .flatMap((g) => g.connections.map((c) => c.id));
      if (ids.length > 0) {
        selected = ids;
        setConnectionsFilterValue(ids);
      }
    }
    writeParams({
      provider: undefined,
      connections: selected.length ? selected.join(',') : undefined,
    });
  }, [providerParam, connectionGroups, writeParams]);

  const [triggerFilter, setTriggerFilter] = useState<TriggerChoice>(() =>
    triggerListToChoice(normalizeTriggerFilters(triggerParam)),
  );
  // Rewrite a stale deep link (e.g. a recovery kind the dashboard no longer
  // offers) to what the filter actually applies, so the URL never claims a
  // filter that is not in effect.
  useEffect(() => {
    const applied = triggerChoiceToParam(triggerFilter);
    if (triggerParam !== null && triggerParam !== applied) writeParams({ trigger: applied });
    // Mount only: the check concerns the deep link the page was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Attempt-status facet: a plain select (all / with a failed attempt / with
  // a succeeded attempt). NOT derivable from Status + Recovery — "has a failed
  // attempt" is Status=Failed UNION Recovery!=none, and those two AND together.
  // The connection cards on GlobalOverview and ConnectionDetail deep-link here
  // with ?attempts=, so this is also what keeps those drill-downs honest.
  const [attemptStatusFilter, setAttemptStatusFilterValue] = useState<'' | AttemptStatusFilter>(
    () => normalizeAttemptStatusFilters(attemptsParam)[0] ?? '',
  );
  const setAttemptStatusFilter = (value: string) => {
    const next = isAttemptStatusFilter(value) ? value : '';
    setAttemptStatusFilterValue(next);
    writeParams({ attempts: next || undefined });
  };

  // `?model=` narrows the log to requests that touched one of these models.
  // Navigation can change it while this page stays mounted, so the filter
  // follows the URL the way status and range do.
  const [modelsFilter, setModelsFilterValue] = useState<string[]>(() => splitList(modelParam));
  useOnChange(modelParam, (model) => setModelsFilterValue(splitList(model)));
  const setModelsFilter = (values: string[]) => {
    setModelsFilterValue(values);
    writeParams({ model: values.length ? values.join(',') : undefined });
  };

  // `?range=` scopes the log to a rolling window; deep links from dashboard
  // cards carry it so the list total can match the card that sent us here.
  const [rangeFilter, setRangeFilterValue] = useState<MessageRangeFilterValue>(() =>
    normalizeRangeFilter(rangeParam),
  );
  useOnChange(rangeParam, (range) => setRangeFilterValue(normalizeRangeFilter(range)));
  const [tierFilter, setTierFilter] = useState('');
  const [originFilter, setOriginFilter] = useState('');
  const [statusFilterValue, setStatusFilterValue] = useState<MessageStatusFilterValue>(() =>
    normalizeStatusFilter(statusParam),
  );
  useOnChange(statusParam, (status) => setStatusFilterValue(normalizeStatusFilter(status)));
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupCompleted] = useState(
    () => !!localStorage.getItem(`setup_completed_${params.agentName}`),
  );

  const routingStatus = useResource(
    () => getRoutingStatus(decodeURIComponent(routeAgent)),
    [routeAgent],
    { enabled: !!routeAgent },
  );

  const tierMetadataAgentName = agentFilter || (routeAgent ? decodeURIComponent(routeAgent) : '');
  const specificityAssignments = useResource(
    () =>
      tierMetadataAgentName
        ? getSpecificityAssignments(tierMetadataAgentName)
        : Promise.resolve([] as Array<{ category: string; is_active: boolean }>),
    [tierMetadataAgentName],
  );

  const hasProviders = (routingStatus.data as { enabled?: boolean } | undefined)?.enabled === true;

  const pager = useCursorPagination(50);

  const setStatusFilter = (value: string) => {
    const next = normalizeStatusFilter(value);
    setStatusFilterValue(next);
    writeParams({ status: next || undefined });
  };
  const setTriggerFilterValue = (value: string) => {
    const next = isTriggerChoice(value) ? value : '';
    setTriggerFilter(next);
    writeParams({ trigger: triggerChoiceToParam(next) });
  };
  const setRangeFilter = (value: string) => {
    const next = normalizeRangeFilter(value);
    setRangeFilterValue(next);
    writeParams({ range: next || undefined });
  };

  const messageFilters = useMemo(() => {
    const q: Record<string, string> = {};
    if (connectionsFilter.length) q.connections = connectionsFilter.join(',');
    const trigger = triggerChoiceToParam(triggerFilter);
    if (trigger) q.trigger = trigger;
    if (attemptStatusFilter) q.attempts = attemptStatusFilter;
    if (modelsFilter.length) q.model = modelsFilter.join(',');
    if (tierFilter) {
      if (tierFilter.startsWith(SPECIFICITY_FILTER_PREFIX)) {
        q.specificity_category = tierFilter.slice(SPECIFICITY_FILTER_PREFIX.length);
      } else {
        q.routing_tier = tierFilter;
      }
    }
    if (statusFilterValue) q.status = statusFilterValue;
    if (rangeFilter) q.range = rangeFilter;
    if (originFilter) q.origin = originFilter;
    const agentName = agentFilter || routeAgent;
    if (agentName) q.agent_name = agentName;
    return q;
  }, [
    connectionsFilter,
    triggerFilter,
    attemptStatusFilter,
    modelsFilter,
    tierFilter,
    statusFilterValue,
    rangeFilter,
    originFilter,
    agentFilter,
    routeAgent,
  ]);
  const filtersKey = JSON.stringify(messageFilters);

  // A filter change starts over from the first page. Done during render (not
  // in an effect) so the new query never goes out with the old page's cursor.
  const [pagerFiltersKey, setPagerFiltersKey] = useState(filtersKey);
  if (pagerFiltersKey !== filtersKey) {
    setPagerFiltersKey(filtersKey);
    pager.resetPage();
  }

  const messageQueryKey = JSON.stringify({
    filters: filtersKey,
    cursor: pager.currentCursor,
    limit: pager.pageSize,
  });
  const messages = useResource(async () => {
    const q: Record<string, string> = { ...messageFilters };
    if (pager.currentCursor) q.cursor = pager.currentCursor;
    q.limit = String(pager.pageSize);
    // Live message events refresh only the bounded page. Exact totals have
    // their own slower resource below, so ingest cannot put COUNT(*) back on
    // the 500ms feed path.
    q.include_total = 'false';
    q.include_filter_options = 'false';
    return { key: messageQueryKey, data: (await getMessages(q)) as MessagesData };
  }, [messageQueryKey, messagePingValue]);
  const data = messages.data?.data;

  const messageCount = useResource(
    async () => ({
      key: filtersKey,
      data: (await getMessageCount(JSON.parse(filtersKey))) as MessagesData | undefined,
    }),
    [filtersKey, analyticsPingValue],
  );

  // The resource keeps its previous value during refetches. Show the table
  // skeleton when the requested filters or page change, but keep existing rows
  // visible for the frequent background SSE ping refetches.
  const messageQueryChanging = messages.loading && messages.data?.key !== messageQueryKey;

  const messageFilterOptions = useResource(() => {
    const q: Record<string, string> = {};
    const agentName = agentFilter || routeAgent;
    if (agentName) q.agent_name = agentName;
    if (rangeFilter) q.range = rangeFilter;
    return getMessageFilterOptions(q) as Promise<MessageFilterOptionsData>;
  }, [agentFilter, routeAgent, rangeFilter, analyticsPingValue]);
  const filterOptions = messageFilterOptions.data;

  // Models the tenant has actually used in range, labelled the way the Model
  // column renders them. A model already picked stays listed even if it drops
  // out of the window, so an active filter never loses its own option.
  const modelOptions: MultiSelectOption[] = [
    ...new Set([...(filterOptions?.models ?? []), ...modelsFilter]),
  ]
    .sort()
    .map((model) => ({ value: model, label: getModelDisplayName(model) }));

  const displayedItems = data?.items ?? [];

  const { recordResponse } = pager;
  useEffect(() => {
    if (data) recordResponse(data.next_cursor);
  }, [data, recordResponse]);

  const hasActiveFilters =
    agentFilter !== '' ||
    connectionsFilter.length > 0 ||
    triggerFilter !== '' ||
    attemptStatusFilter !== '' ||
    modelsFilter.length > 0 ||
    tierFilter !== '' ||
    originFilter !== '' ||
    statusFilterValue !== '' ||
    rangeFilter !== '';

  const exactTotal =
    messageCount.data?.key === filtersKey ? messageCount.data.data?.total_count : undefined;

  const hasNoData = !!data && (exactTotal ?? data.total_count) === 0;

  const totalForPager = (() => {
    if (exactTotal !== undefined) return exactTotal;
    if (!data) return 0;
    if (data.total_count_exact !== false) return data.total_count;
    return (pager.currentPage - 1) * pager.pageSize + data.total_count;
  })();

  const showEmptyState = hasNoData && !hasActiveFilters && !hasProviders;
  const isFilteredEmpty = hasNoData && hasActiveFilters;
  const showMessages = !hasNoData || (hasProviders && !hasActiveFilters);

  const clearFilters = () => {
    setAgentFilter('');
    setConnectionsFilterValue([]);
    setTriggerFilter('');
    setAttemptStatusFilterValue('');
    setModelsFilterValue([]);
    setTierFilter('');
    setOriginFilter('');
    setStatusFilterValue('');
    setRangeFilterValue('');
    // One write: several setSearchParams calls in a tick would overwrite each other.
    writeParams({
      connections: undefined,
      trigger: undefined,
      attempts: undefined,
      model: undefined,
      status: undefined,
      range: undefined,
    });
  };

  const activeSpecificityCategories = new Set(
    (specificityAssignments.data ?? [])
      .filter((assignment) => assignment.is_active)
      .map((assignment) => assignment.category),
  );

  const tierOptions: SelectOption[] = [
    { label: t('messages.log.filters.allTiers'), value: '' },
    ...ALL_TIERS.map((tier) => ({
      label: tMaybe(`routing.stages.${tier}.label`) ?? TIER_LABELS_ALL[tier],
      value: tier,
    })),
    ...SPECIFICITY_STAGES.filter((stage) => activeSpecificityCategories.has(stage.id)).map(
      (stage) => ({
        label: stage.label,
        value: `${SPECIFICITY_FILTER_PREFIX}${stage.id}`,
      }),
    ),
  ];

  /** Resolve provider ID to display name */
  const providerDisplayName = (id: string): string => {
    if (id === 'thinker') return 'Thinker';
    const prov = PROVIDERS.find((p) => p.id === id);
    if (prov) return prov.name;
    // Custom providers arrive as `custom:<uuid>` — the backend ships a label
    // map alongside the provider list so the dropdown can show their names.
    return filterOptions?.provider_labels?.[id] ?? id;
  };

  const authTypeLabel = (authType: string): string => {
    if (authType === 'subscription') return t('messages.log.authType.subscription');
    if (authType === 'api_key') return t('messages.log.authType.api_key');
    if (authType === 'local') return t('messages.log.authType.local');
    return authType;
  };
  // Every connection the tenant has, active or not: the log keeps history for
  // connections that were since disabled.
  const connectionOptions: MultiSelectOption[] = (connectionGroups ?? []).flatMap((group) =>
    group.connections.map((conn) => ({
      value: conn.id,
      label: `${group.display_name ?? providerDisplayName(group.provider)} · ${conn.label}`,
      icon: providerIcon(group.provider, 14) ?? undefined,
      description:
        authTypeLabel(group.auth_type) + (conn.is_active ? '' : ` · ${t('messages.log.inactive')}`),
    })),
  );

  const rangeOptions: SelectOption[] = [
    { label: t('messages.log.range.all'), value: '' },
    { label: t('messages.log.range.24h'), value: '24h' },
    { label: t('messages.log.range.7d'), value: '7d' },
    { label: t('messages.log.range.30d'), value: '30d' },
    { label: t('messages.log.range.90d'), value: '90d' },
    { label: t('messages.log.range.365d'), value: '365d' },
  ];

  const attemptStatusOptions: SelectOption[] = [
    { label: t('messages.log.attemptStatus.all'), value: '' },
    { label: t('messages.log.attemptStatus.has_failed'), value: 'has_failed' },
    { label: t('messages.log.attemptStatus.has_succeeded'), value: 'has_succeeded' },
  ];

  const statusOptions: SelectOption[] = [
    { label: t('messages.log.status.all'), value: '' },
    { label: t('messages.log.status.ok'), value: 'ok' },
    { label: t('messages.log.status.failed'), value: 'failed' },
    // The caller hung up — not a Thinker or provider failure, so it is no
    // longer folded into Failed and needs its own way in.
    { label: t('messages.log.status.cancelled'), value: 'cancelled' },
  ];

  const triggerOptions: SelectOption[] = [
    { label: t('messages.log.trigger.all'), value: '' },
    {
      label: t('messages.log.trigger.fallback'),
      value: 'fallback',
      icon: (
        <span className="recovery-opt-icon inline-flex text-info" aria-hidden="true">
          <FallbackIcon />
        </span>
      ),
    },
    {
      label: t('messages.log.trigger.none'),
      value: 'none',
      icon: (
        <span className="recovery-opt-icon inline-flex text-muted" aria-hidden="true">
          <Ban className="size-3.5" />
        </span>
      ),
    },
  ];

  // Who failed. The gateway origin collapses every Thinker-authored origin (setup,
  // limits, bad requests, internal errors) into one choice, since from a user's
  // point of view they share a fix path that has nothing to do with a provider.
  const originOptions: SelectOption[] = [
    { label: t('messages.log.origin.all'), value: '' },
    // The query value is still the backend's legacy origin name; only the label changed.
    { label: 'Thinker', value: 'thinker' },
    { label: t('messages.log.origin.provider'), value: 'provider' },
    { label: t('messages.log.origin.transport'), value: 'transport' },
  ];

  // Drawer state. `?request=<id>` deep-links a request into the side panel
  // (the Recent Requests lists and the alerts bell navigate here).
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(requestParam || null);
  useOnChange(requestParam, (request) => {
    if (request) setSelectedMessageId(request);
  });
  const openDrawer = (id: string) => setSelectedMessageId(id);
  const closeDrawer = useCallback(() => {
    setSelectedMessageId(null);
    if (requestParam) writeParams({ request: undefined }, undefined);
  }, [requestParam, writeParams]);
  // Close drawer when clicking outside the table (not on a message row)
  const handlePageClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!selectedMessageId) return;
    const target = e.target as HTMLElement;
    // If clicking inside the drawer itself, ignore
    if (target.closest('.drawer')) return;
    // If clicking on a message row, the row handler will switch content
    if (target.closest('.msg-row--clickable')) return;
    closeDrawer();
  };

  const agentLabel = agentDisplayName ?? decodeURIComponent(routeAgent);
  const filterBox = 'w-full sm:w-44';

  const renderBody = () => {
    if (messages.error) {
      return <ErrorState error={messages.error} onRetry={() => void messages.reload()} />;
    }
    return (
      <>
        {showEmptyState ? (
          <div className="empty">
            <h3>{t('messages.log.noRequestsYet')}</h3>
            {routeAgent && setupCompleted ? (
              <>
                <p className="max-w-md text-sm">{t('messages.log.connectProviderHint')}</p>
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={() =>
                    navigate(`/harnesses/${encodeURIComponent(routeAgent)}/routing`, {
                      state: { openProviders: true },
                    })
                  }
                >
                  {t('messages.log.connectProvider')}
                </Button>
              </>
            ) : routeAgent ? (
              <>
                <p className="max-w-md text-sm">{t('messages.log.emptyAgent')}</p>
                <Button size="sm" className="mt-3" onClick={() => setSetupOpen(true)}>
                  {t('messages.log.setUpHarness')}
                </Button>
              </>
            ) : (
              <>
                <p className="max-w-md text-sm">{t('messages.log.emptyGlobal')}</p>
                <ButtonLink to="/harnesses" size="sm" className="mt-3">
                  {t('messages.log.goToHarnesses')}
                </ButtonLink>
              </>
            )}
            <ExampleImage />
          </div>
        ) : null}
        {isFilteredEmpty ? (
          <section className="panel">
            <div className="panel-head">
              <span className="text-sm font-semibold text-ink">{t('messages.log.title')}</span>
              <span className="text-xs text-muted">{t('messages.log.zeroResults')}</span>
            </div>
            <div className="empty">
              <h3>{t('messages.log.noMatchTitle')}</h3>
              <p className="max-w-md text-sm">{t('messages.log.noMatchHint')}</p>
              <Button
                variant="ghost"
                size="sm"
                className="message-log__clear-btn mt-3"
                onClick={clearFilters}
              >
                {t('messages.log.clearFilters')}
              </Button>
            </div>
          </section>
        ) : null}
        {showMessages ? (
          <>
            {hasNoData && hasProviders ? (
              <div className="waiting-banner notice is-info mb-3 flex items-center gap-2">
                <Sprout aria-hidden="true" className="size-4 shrink-0" />
                <p>{t('messages.log.waiting')}</p>
              </div>
            ) : null}
            <div className="mb-2 flex items-center justify-end">
              <span className="text-xs text-muted">
                {t('messages.log.total', { count: totalForPager })}
              </span>
            </div>
            <div className="table-wrap">
              <MessageTable
                items={displayedItems}
                columns={columns}
                agentName={routeAgent || undefined}
                customProviderName={() => undefined}
                agentPlatformLookup={(name) => agentPlatformMap.get(name)}
                onRowSelect={openDrawer}
                selectedRowId={selectedMessageId}
                rowIdPrefix="msg-"
                showHeaderTooltips
                expandable
              />
            </div>
            <Pagination
              currentPage={pager.currentPage}
              totalItems={totalForPager}
              pageSize={pager.pageSize}
              hasNextPage={pager.hasNextPage}
              isLoading={messages.loading}
              onPrevious={pager.previousPage}
              onNext={pager.nextPage}
            />
          </>
        ) : null}
      </>
    );
  };

  return (
    <div className="page full" onClick={handlePageClick}>
      <title>
        {routeAgent
          ? t('messages.log.pageTitleAgent', { agent: agentLabel })
          : t('messages.log.pageTitle')}
      </title>
      <meta
        name="description"
        content={
          routeAgent
            ? t('messages.log.metaDescriptionAgent', { agent: agentLabel })
            : t('messages.log.metaDescription')
        }
      />
      <div className="page-head justify-end">
        <div className="page-actions w-full lg:w-auto lg:justify-end">
          {!showEmptyState ? (
            <>
              {!routeAgent ? (
                <div className={filterBox}>
                  <Select
                    value={agentFilter}
                    onChange={setAgentFilter}
                    options={agentFilterOptions}
                  />
                </div>
              ) : null}
              <div className={filterBox}>
                <MultiSelect
                  values={connectionsFilter}
                  onChange={setConnectionsFilter}
                  options={connectionOptions}
                  placeholder={t('messages.log.filters.allConnections')}
                  label={t('messages.log.filters.connection')}
                />
              </div>
              <div className={filterBox}>
                <Select
                  value={triggerFilter}
                  onChange={setTriggerFilterValue}
                  options={triggerOptions}
                  label={t('messages.log.filters.recovery')}
                />
              </div>
              <div className={filterBox}>
                <Select
                  value={attemptStatusFilter}
                  onChange={setAttemptStatusFilter}
                  options={attemptStatusOptions}
                  label={t('messages.log.filters.attemptStatus')}
                />
              </div>
              <div className={filterBox}>
                <MultiSelect
                  values={modelsFilter}
                  onChange={setModelsFilter}
                  options={modelOptions}
                  placeholder={t('messages.log.filters.allModels')}
                  label={t('messages.log.filters.model')}
                />
              </div>
              <div className={filterBox}>
                <Select
                  value={statusFilterValue}
                  onChange={setStatusFilter}
                  options={statusOptions}
                  label={t('messages.log.filters.status')}
                />
              </div>
              <div className={filterBox}>
                <Select
                  value={originFilter}
                  onChange={setOriginFilter}
                  options={originOptions}
                  label={t('messages.log.filters.origin')}
                />
              </div>
              <div className={filterBox}>
                <Select value={tierFilter} onChange={setTierFilter} options={tierOptions} />
              </div>
              <div className={filterBox}>
                <Select
                  value={rangeFilter}
                  onChange={setRangeFilter}
                  options={rangeOptions}
                  label={t('messages.log.filters.period')}
                />
              </div>
            </>
          ) : null}
          {showEmptyState && routeAgent && !setupCompleted ? (
            <Button size="sm" onClick={() => setSetupOpen(true)}>
              {t('messages.log.setUpHarness')}
            </Button>
          ) : null}
        </div>
      </div>

      {(data !== undefined || !messages.loading) && !messageQueryChanging ? (
        renderBody()
      ) : (
        <TableSkeleton />
      )}

      {routeAgent ? (
        <SetupModal
          open={setupOpen}
          agentName={decodeURIComponent(routeAgent)}
          agentPlatform={agentPlatformInfo.platform}
          agentCategory={agentPlatformInfo.category}
          onClose={() => setSetupOpen(false)}
        />
      ) : null}
      <RequestDrawer messageId={selectedMessageId} onClose={closeDrawer} />
    </div>
  );
}
