import { useEffect, useMemo, useRef, useState, startTransition } from 'react';
import { KeyRound, Layers, RefreshCw, Search, Server, User } from 'lucide-react';
import {
  refreshModels,
  refreshProviderModels,
  type AuthType,
  type AvailableModel,
  type CustomProviderData,
  type ModelCapability,
  type ModelModality,
  type RoutingProvider,
  type TierAssignment,
} from '../services/api.js';
import { PROVIDERS, STAGES, SPECIFICITY_STAGES, DEFAULT_STAGE } from '../services/providers.js';
import { customProviderColor, formatPerRequestCost } from '../services/formatters.js';
import { inferProviderFromModel, pricePerM, resolveProviderId } from '../services/routing-utils.js';
import { providerIcon, customProviderLogo } from './ProviderIcon.js';
import { toast } from '../services/toast-store.js';
import { t } from '../i18n/index.js';
import ModelCapabilityBadges, {
  CAPABILITY_ICONS,
  CAPABILITY_LABELS,
  ModelModalityBadges,
} from './ModelCapabilityBadges.js';
import VirtualList from './VirtualList.js';
import { Button, Modal, Tabs, cx, type TabItem } from './ui.js';

const PICKER_NARROW_QUERY = '(max-width: 640px)';
const PICKER_GROUP_HEADER_HEIGHT = 32;
const PICKER_MODEL_ROW_HEIGHT = 40;
/** Stacked label + four cells + gaps + padding in the ≤640px layout. */
const PICKER_MODEL_ROW_HEIGHT_NARROW = 160;

type ModalModel = { value: string; label: string; pricing: AvailableModel; authType: AuthType };
type PickerItem =
  | { kind: 'header'; provId: string; name: string; authType: AuthType }
  | { kind: 'model'; provId: string; name: string; model: ModalModel };
/** Picker tab: one auth category, or every connected provider at once. */
type PickerTab = AuthType | 'all';

/** Price text color by billing: dark blue for subscriptions, dark orange for usage-based. */
const PRICE_COLOR: Record<AuthType, string> = {
  subscription: 'routing-modal__model-price--subscription text-[#1e3a8a] [.dark_&]:text-[#93c5fd]',
  api_key: 'routing-modal__model-price--api-key text-[#9a3412] [.dark_&]:text-[#fdba74]',
  local: 'text-muted',
};

interface Props {
  tierId: string;
  agentName?: string;
  models: AvailableModel[];
  tiers: TierAssignment[];
  customProviders?: CustomProviderData[];
  connectedProviders?: RoutingProvider[];
  onSelect: (tierId: string, modelName: string, providerId: string, authType?: AuthType) => void;
  onClose: () => void;
  onConnectProviders?: () => void;
  onProviderRefreshed?: () => void | Promise<void>;
  requiredCapability?: ModelCapability;
}

/** Resolve a display label for a model name, handling vendor-prefixed IDs. */
function labelForModel(
  name: string,
  labels: Map<string, string>,
  providerIds: Set<string>,
): string {
  const direct = labels.get(name);
  if (direct) return direct;
  const slash = name.indexOf('/');
  if (slash !== -1) {
    const bare = name.substring(slash + 1);
    const found = labels.get(bare);
    if (found) return found;
    return bare;
  }
  const parts = name.split('.');
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!providerIds.has(parts[i]!.toLowerCase())) continue;
    const bare = parts.slice(i + 1).join('.');
    const found = labels.get(bare);
    if (found) return found;
    return bare;
  }
  return name;
}

const isFreeModel = (m: AvailableModel): boolean =>
  m.input_price_per_token != null &&
  m.output_price_per_token != null &&
  Number(m.input_price_per_token) === 0 &&
  Number(m.output_price_per_token) === 0;

const ACTION_CAPABILITIES: readonly ModelCapability[] = ['stream', 'tools'];
const MODALITY_ORDER: readonly ModelModality[] = ['text', 'image', 'audio', 'video'];
const DEFAULT_MODALITIES: readonly ModelModality[] = ['text'];

const wasFetchedToday = (fetchedAt: string | null | undefined, now: Date): boolean => {
  if (!fetchedAt) return false;
  const fetched = new Date(fetchedAt);
  if (Number.isNaN(fetched.getTime())) return false;
  return (
    fetched.getFullYear() === now.getFullYear() &&
    fetched.getMonth() === now.getMonth() &&
    fetched.getDate() === now.getDate()
  );
};

const unavailableCapabilityLabel = (capability: ModelCapability): string => {
  return t('models.picker.unavailable', { capability: CAPABILITY_LABELS[capability] });
};

const isUsable = (p: { is_active: boolean; has_api_key: boolean; cached_model_count?: number }) =>
  p.is_active && (p.has_api_key || (p.cached_model_count ?? 0) > 0);

/** Column template shared by the table head and each model row (stacks under 640px). */
const ROW_COLUMNS = 'sm:grid-cols-[minmax(0,1fr)_92px_72px_56px_128px] sm:items-center sm:gap-3';
const ROW_GRID = `grid grid-cols-1 gap-1 ${ROW_COLUMNS}`;

const pillClass = (active: boolean) =>
  cx(
    'routing-modal__cap-pill inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
    active
      ? 'routing-modal__cap-pill--active border-accent bg-accent-tint text-accent'
      : 'border-line text-muted hover:bg-s2 hover:text-ink',
  );

export default function ModelPickerModal(props: Props) {
  const connected = props.connectedProviders ?? [];
  const hasSubscription = connected.some((p) => isUsable(p) && p.auth_type === 'subscription');
  const hasApiKey = connected.some((p) => isUsable(p) && p.auth_type === 'api_key');
  const hasLocal = connected.some((p) => isUsable(p) && p.auth_type === 'local');
  // Show the tab strip whenever the user has models in more than one auth
  // category — otherwise the picker is single-category and the tabs add
  // noise. Local counts as its own category alongside subscription/api_key.
  const showTabs = [hasSubscription, hasApiKey, hasLocal].filter(Boolean).length > 1;

  // Default to the first connected category (subscription > api_key > local)
  // so the picker opens on something the user actually has. When nothing is
  // connected the default is 'api_key' — matches the pre-local behavior so
  // existing snapshots / tests that assume the free-only pill is visible
  // (only shown for api_key) don't start failing.
  const [activeTab, setActiveTab] = useState<PickerTab>(() => {
    if (showTabs) return 'all';
    if (hasSubscription) return 'subscription';
    if (hasLocal && !hasApiKey) return 'local';
    return 'api_key';
  });
  const [search, setSearch] = useState('');
  const [showFreeOnly, setShowFreeOnly] = useState(false);
  /** Required capabilities: only show models that have ALL of these. */
  const [requiredCapabilities, setRequiredCapabilities] = useState<Set<ModelCapability>>(() =>
    props.requiredCapability ? new Set([props.requiredCapability]) : new Set(),
  );
  const [refreshingProvId, setRefreshingProvId] = useState<string | null>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const latest = useRef(props);
  latest.current = props;

  // Parent callbacks refetch the data this modal reads. Keep the current
  // picker visible (as a transition) while those settle.
  const notifyProviderRefreshed = (): Promise<void> =>
    new Promise((resolve) => {
      startTransition(() => {
        void Promise.resolve(latest.current.onProviderRefreshed?.()).finally(resolve);
      });
    });

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    if (typeof window.matchMedia === 'function') {
      const media = window.matchMedia(PICKER_NARROW_QUERY);
      const sync = () => setIsNarrow(media.matches);
      sync();
      media.addEventListener('change', sync);
      cleanup = () => media.removeEventListener('change', sync);
    }

    const agentName = props.agentName;
    if (!agentName) return cleanup;
    const now = new Date();
    const needsRefresh = (props.connectedProviders ?? []).some(
      (provider) =>
        provider.is_active &&
        !provider.provider.startsWith('custom:') &&
        !wasFetchedToday(provider.models_fetched_at, now),
    );
    if (!needsRefresh) return cleanup;

    const refreshKey = `thinker:routing-model-refresh:${agentName}`;
    const today = now.toDateString();
    if (sessionStorage.getItem(refreshKey) === today) return cleanup;
    sessionStorage.setItem(refreshKey, today);

    void refreshModels(agentName)
      .then(() => notifyProviderRefreshed())
      .catch(() => undefined);
    return cleanup;
    // Runs once on open, like Solid's onMount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleCapability = (cap: ModelCapability) => {
    const current = new Set(requiredCapabilities);
    if (current.has(cap)) current.delete(cap);
    else current.add(cap);
    setRequiredCapabilities(current);
  };

  /** Action capabilities that exist on at least one model in the current tab. */
  const availableCapabilities = useMemo((): ModelCapability[] => {
    const found = new Set<ModelCapability>();
    for (const m of props.models) {
      for (const c of m.capabilities ?? []) found.add(c);
    }
    return ACTION_CAPABILITIES.filter((c) => found.has(c));
  }, [props.models]);

  const handleRefreshGroup = async (provId: string, displayName: string, authType: AuthType) => {
    if (!props.agentName) return;
    if (provId.startsWith('custom:')) return;
    setRefreshingProvId(provId);
    try {
      const result = await refreshProviderModels(props.agentName, provId, authType);
      if (result.ok) {
        toast.success(t('models.picker.refreshed', displayName, result.model_count));
      } else {
        toast.error(result.error ?? t('models.picker.refreshFailed', { name: displayName }));
      }
      await notifyProviderRefreshed();
    } catch {
      // network/server error toast already raised by fetchMutate
    } finally {
      setRefreshingProvId(null);
    }
  };

  const groupedModels = useMemo(() => {
    const q = search.toLowerCase().trim();
    const labels = new Map<string, string>();
    for (const prov of PROVIDERS) {
      for (const m of prov.models) labels.set(m.value, m.label);
    }
    const providerIds = new Set(PROVIDERS.map((p) => p.id.toLowerCase()));
    const cpNames = new Map<string, string>();
    for (const cp of props.customProviders ?? []) cpNames.set(`custom:${cp.id}`, cp.name);
    const tab = activeTab;
    const connectedList = props.connectedProviders ?? [];
    const hasConnectedProviders = connectedList.length > 0;

    /** `auth\0provider` keys of every active connection (any auth type). */
    let allowedProviders: Set<string> | undefined;
    if (hasConnectedProviders) {
      allowedProviders = new Set<string>();
      for (const p of connectedList) {
        if (!p.is_active) continue;
        allowedProviders.add(`${p.auth_type}\0${p.provider.toLowerCase()}`);
        const resolved = resolveProviderId(p.provider);
        if (resolved) allowedProviders.add(`${p.auth_type}\0${resolved}`);
      }
    }
    /** Auth type of a row: the model's own, else the tab's (or the provider's connection). */
    const authFor = (m: AvailableModel, provId: string): AuthType => {
      if (m.auth_type) return m.auth_type;
      if (tab !== 'all') return tab;
      const conn = connectedList.find(
        (p) =>
          p.is_active &&
          (p.provider.toLowerCase() === provId || resolveProviderId(p.provider) === provId),
      );
      return conn?.auth_type ?? 'api_key';
    };

    type Group = { provId: string; name: string; authType: AuthType; models: ModalModel[] };
    const groupMap = new Map<string, Group>();
    const freeOnly = tab === 'api_key' && showFreeOnly;

    for (const m of props.models) {
      // Filter by the model's own auth_type to prevent subscription models
      // from leaking into the API Keys tab and vice versa (e.g. when the
      // same provider is connected with both auth types and they have
      // different model access levels).
      if (showTabs && tab !== 'all' && m.auth_type && m.auth_type !== tab) continue;
      if (freeOnly && !isFreeModel(m)) continue;
      if (requiredCapabilities.size > 0) {
        const caps = m.capabilities ?? [];
        let pass = true;
        for (const r of requiredCapabilities) {
          if (!caps.includes(r)) {
            pass = false;
            break;
          }
        }
        if (!pass) continue;
      }
      const dbProvId = resolveProviderId(m.provider);
      const prefixProvId = inferProviderFromModel(m.model_name);
      // OpenRouter is the one provider where the vendor prefix is genuinely
      // the best attribution: an OR row for `anthropic/claude-…` should be
      // grouped under Anthropic, not OpenRouter. For every other registered
      // first-party provider the stored `m.provider` is the truth — Groq's
      // `qwen/qwen3-32b` is being served BY Groq, so it must group under
      // Groq (and use Groq's pricing) regardless of the model-id prefix.
      // Mirrors the precedence rule in RoutingTierCard.providerIdForModel.
      const provId =
        dbProvId && dbProvId !== 'openrouter' && PROVIDERS.find((p) => p.id === dbProvId)
          ? dbProvId
          : prefixProvId && PROVIDERS.find((p) => p.id === prefixProvId)
            ? prefixProvId
            : (dbProvId ?? prefixProvId);
      if (!provId) continue;
      const authType = authFor(m, provId);
      if (allowedProviders && !allowedProviders.has(`${authType}\0${provId}`)) continue;
      const groupKey = `${authType}\0${provId}`;
      if (!groupMap.has(groupKey)) {
        const isCustom = provId.startsWith('custom:');
        const provDef = PROVIDERS.find((p) => p.id === provId);
        const name = isCustom
          ? (m.provider_display_name ?? cpNames.get(provId) ?? m.provider)
          : (provDef?.name ?? m.provider);
        groupMap.set(groupKey, { provId, name, authType, models: [] });
      }
      const label =
        m.display_name && m.display_name !== m.model_name
          ? m.display_name
          : labelForModel(m.model_name, labels, providerIds);
      groupMap.get(groupKey)!.models.push({ value: m.model_name, label, pricing: m, authType });
    }

    const groups: Group[] = [];
    for (const group of groupMap.values()) {
      group.models.sort((a, b) => {
        if (a.value === 'openrouter/free') return -1;
        if (b.value === 'openrouter/free') return 1;
        return a.label.localeCompare(b.label);
      });
      if (q) {
        const nameMatch = group.name.toLowerCase().includes(q);
        const filtered = nameMatch
          ? group.models
          : group.models.filter(
              (m) => m.label.toLowerCase().includes(q) || m.value.toLowerCase().includes(q),
            );
        if (filtered.length > 0) groups.push({ ...group, models: filtered });
      } else if (group.models.length > 0) {
        groups.push(group);
      }
    }
    groups.sort((a, b) => a.name.localeCompare(b.name) || a.authType.localeCompare(b.authType));
    return groups;
  }, [
    search,
    activeTab,
    showFreeOnly,
    requiredCapabilities,
    showTabs,
    props.models,
    props.customProviders,
    props.connectedProviders,
  ]);

  const pickerItems = useMemo((): PickerItem[] => {
    const items: PickerItem[] = [];
    for (const group of groupedModels) {
      items.push({
        kind: 'header',
        provId: group.provId,
        name: group.name,
        authType: group.authType,
      });
      for (const model of group.models) {
        items.push({ kind: 'model', provId: group.provId, name: group.name, model });
      }
    }
    return items;
  }, [groupedModels]);

  const pickerItemHeight = (item: PickerItem) =>
    item.kind === 'header'
      ? PICKER_GROUP_HEADER_HEIGHT
      : isNarrow
        ? PICKER_MODEL_ROW_HEIGHT_NARROW
        : PICKER_MODEL_ROW_HEIGHT;

  const pickerResetKey = `${activeTab}\0${search}\0${showFreeOnly}\0${[...requiredCapabilities].sort().join(',')}`;

  /** Returns the role of a model in the current tier: "Primary", "Fallback 1", etc. or null */
  const modelRole = (
    modelName: string,
    providerId?: string,
    authType?: AuthType,
  ): string | null => {
    const tier = props.tiers.find((r) => r.tier === props.tierId);
    if (!tier) return null;
    const primaryRoute = tier.override_route ?? null;
    if (primaryRoute) {
      const matches =
        providerId && authType
          ? primaryRoute.model === modelName &&
            primaryRoute.provider.toLowerCase() === providerId.toLowerCase() &&
            primaryRoute.authType === authType
          : primaryRoute.model === modelName;
      if (matches) return t('models.positionPrimary');
    }
    const fbRoutes = tier.fallback_routes ?? [];
    const idx =
      providerId && authType
        ? fbRoutes.findIndex(
            (r) =>
              r.model === modelName &&
              r.provider.toLowerCase() === providerId.toLowerCase() &&
              r.authType === authType,
          )
        : fbRoutes.findIndex((r) => r.model === modelName);
    if (idx !== -1) return t('models.positionFallback', { n: idx + 1 });
    return null;
  };

  const totalVisibleModels = groupedModels.reduce((sum, g) => sum + g.models.length, 0);
  /** Total models available (ignoring search) — used to decide whether to show search bar */
  const totalAvailableModels = search ? props.models.length : totalVisibleModels;
  const showSearch = totalAvailableModels > 5;

  useEffect(() => {
    if (!showSearch) return;
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [showSearch]);

  const isAll = activeTab === 'all';
  const isSub = activeTab === 'subscription';
  const isLocal = activeTab === 'local';
  const isPaid = activeTab === 'api_key';
  const missingRequiredCapability = (model: AvailableModel): string | null => {
    const required = props.requiredCapability;
    if (!required) return null;
    return (model.capabilities ?? []).includes(required)
      ? null
      : unavailableCapabilityLabel(required);
  };
  const actionCapabilitiesFor = (model: AvailableModel): readonly ModelCapability[] =>
    ACTION_CAPABILITIES.filter((capability) => (model.capabilities ?? []).includes(capability));
  const inputModalitiesFor = (model: AvailableModel): readonly ModelModality[] => {
    if (model.input_modalities && model.input_modalities.length > 0) return model.input_modalities;
    const caps = new Set(model.capabilities ?? []);
    const modalities = MODALITY_ORDER.filter(
      (modality) => modality === 'text' || caps.has(modality),
    );
    return modalities.length > 0 ? modalities : DEFAULT_MODALITIES;
  };
  const outputModalitiesFor = (model: AvailableModel): readonly ModelModality[] =>
    model.output_modalities && model.output_modalities.length > 0
      ? model.output_modalities
      : DEFAULT_MODALITIES;

  // Resolve the routing-tier label for the subtitle. Callers outside the
  // routing context (e.g. the Playground) pass a non-tier id, so there is no
  // matching stage — render no subtitle instead of a bare "tier".
  const tierLabel = [DEFAULT_STAGE, ...STAGES, ...SPECIFICITY_STAGES].find(
    (s) => s.id === props.tierId,
  )?.label;

  const tabItems: TabItem<PickerTab>[] = [
    {
      key: 'all',
      label: t('models.picker.allProviders'),
      icon: <Layers className="size-3.5" aria-hidden="true" />,
    },
  ];
  if (hasSubscription)
    tabItems.push({
      key: 'subscription',
      label: t('models.picker.subscription'),
      icon: <User className="size-3.5" aria-hidden="true" />,
    });
  if (hasApiKey)
    tabItems.push({
      key: 'api_key',
      label: t('models.picker.usageBased'),
      icon: <KeyRound className="size-3.5" aria-hidden="true" />,
    });
  if (hasLocal)
    tabItems.push({
      key: 'local',
      label: t('models.picker.local'),
      icon: <Server className="size-3.5" aria-hidden="true" />,
    });

  const emptyMessage = search.trim()
    ? t('models.noSearchMatch')
    : showFreeOnly
      ? t('models.picker.noFree')
      : isAll
        ? t('models.picker.noAll')
        : isSub
          ? t('models.picker.noSubscription')
          : isLocal
            ? t('models.picker.noLocal')
            : t('models.picker.noApiKey');

  const renderGroupIcon = (provId: string, name: string) => {
    if (!provId.startsWith('custom:')) return providerIcon(provId, 16);
    const cp = (props.customProviders ?? []).find((c) => `custom:${c.id}` === provId);
    return (
      customProviderLogo(name, 16, cp?.base_url) ?? (
        <span
          className="provider-card__logo-letter inline-flex size-4 items-center justify-center rounded-full text-[9px] font-semibold text-on-accent"
          style={{ background: customProviderColor(name) }}
        >
          {name.charAt(0).toUpperCase()}
        </span>
      )
    );
  };

  const renderModelRow = (provId: string, model: ModalModel) => {
    const disabledReason = missingRequiredCapability(model.pricing);
    const disabled = disabledReason !== null;
    // The label cell truncates with an ellipsis, so the hover tooltip carries
    // the full name (and the model id when it differs) ahead of any disabled
    // reason.
    const tooltip = [model.label, model.value !== model.label ? model.value : null, disabledReason]
      .filter(Boolean)
      .join('\n');
    const role = modelRole(model.value, provId, model.authType);
    const actionCaps = actionCapabilitiesFor(model.pricing);
    const cellLabel = 'routing-modal__model-cell-label text-xs text-faint sm:hidden';
    return (
      <button
        type="button"
        className={cx(
          // pl-8 indents the row 20px past the provider header (px-3).
          'routing-modal__model w-full rounded-control py-2 pl-8 pr-3 text-left text-sm sm:h-10 sm:py-0',
          ROW_GRID,
          disabled
            ? 'routing-modal__model--disabled cursor-not-allowed opacity-50'
            : 'cursor-pointer hover:bg-s2',
        )}
        disabled={disabled}
        title={tooltip}
        onClick={() => props.onSelect(props.tierId, model.value, provId, model.authType)}
      >
        <span className="routing-modal__model-left flex min-w-0 items-center">
          <span className="routing-modal__model-label flex min-w-0 items-center gap-2 font-medium text-ink">
            <span className="truncate">{model.label}</span>
            {role ? (
              <span className="routing-modal__role-tag badge is-accent shrink-0">{role}</span>
            ) : null}
          </span>
        </span>
        <span className="routing-modal__model-cell flex items-center justify-between gap-2 sm:justify-start">
          <span className={cellLabel}>{t('models.picker.colCapabilities')}</span>
          {actionCaps.length > 0 ? (
            <ModelCapabilityBadges capabilities={actionCaps} compact iconOnly />
          ) : (
            <span
              className="model-capability-badges model-capability-badges--compact"
              aria-label={t('models.picker.noStreamOrTools')}
            />
          )}
        </span>
        <span className="routing-modal__model-cell flex items-center justify-between gap-2 sm:justify-start">
          <span className={cellLabel}>{t('models.picker.colInput')}</span>
          <ModelModalityBadges
            modalities={inputModalitiesFor(model.pricing)}
            direction="input"
            compact
            iconOnly
          />
        </span>
        <span className="routing-modal__model-cell flex items-center justify-between gap-2 sm:justify-start">
          <span className={cellLabel}>{t('models.picker.colOutput')}</span>
          <ModelModalityBadges
            modalities={outputModalitiesFor(model.pricing)}
            direction="output"
            compact
            iconOnly
          />
        </span>
        <span className="routing-modal__model-cell routing-modal__model-cell--price flex items-center justify-between gap-2 sm:justify-end">
          <span className={cellLabel}>{t('models.picker.colPrice')}</span>
          <span
            className={cx(
              'routing-modal__model-price text-right font-mono text-xs',
              PRICE_COLOR[model.authType],
            )}
          >
            {model.authType === 'api_key'
              ? model.pricing
                ? t('models.picker.priceInOut', {
                    input: pricePerM(model.pricing.input_price_per_token),
                    output: pricePerM(model.pricing.output_price_per_token),
                  })
                : null
              : model.authType === 'local'
                ? t('models.picker.runsLocally')
                : (formatPerRequestCost(model.pricing.cost_per_request) ??
                  t('models.picker.included'))}
          </span>
        </span>
      </button>
    );
  };

  return (
    <Modal
      open
      wide
      onClose={props.onClose}
      label={t('models.picker.title')}
      title={
        <span className="flex flex-col gap-0.5">
          <span id="model-picker-title">{t('models.picker.title')}</span>
          {tierLabel ? (
            <span className="routing-modal__subtitle text-xs font-normal text-muted">
              {t('models.picker.tierSubtitle', { label: tierLabel })}
            </span>
          ) : null}
        </span>
      }
    >
      <div className="routing-modal flex flex-col gap-3">
        {showTabs ? (
          <Tabs
            className="!mb-0"
            items={tabItems}
            value={activeTab}
            onChange={(key: PickerTab) => {
              setActiveTab(key);
              if (key !== 'api_key') setShowFreeOnly(false);
            }}
          />
        ) : null}

        {showSearch ? (
          <div className="routing-modal__search-wrap search-bar">
            <Search aria-hidden="true" />
            <input
              ref={searchRef}
              className="routing-modal__search field !w-full"
              type="text"
              placeholder={t('models.searchPlaceholder')}
              aria-label={t('models.searchLabel')}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
          </div>
        ) : null}

        <div className="routing-modal__filter-bar flex flex-wrap items-center justify-between gap-2">
          <div className="routing-modal__filter-left flex items-center gap-2">
            {isPaid ? (
              <button
                type="button"
                className={pillClass(showFreeOnly)}
                aria-pressed={showFreeOnly}
                onClick={() => setShowFreeOnly(!showFreeOnly)}
              >
                {t('models.picker.freeOnly')}
              </button>
            ) : null}
          </div>
          <div className="routing-modal__filter-right flex flex-wrap items-center gap-2">
            {availableCapabilities.map((cap) => (
              <button
                key={cap}
                type="button"
                className={pillClass(requiredCapabilities.has(cap))}
                aria-pressed={requiredCapabilities.has(cap)}
                onClick={() => toggleCapability(cap)}
              >
                <span
                  className="routing-modal__filter-pill-icon inline-flex"
                  dangerouslySetInnerHTML={{ __html: CAPABILITY_ICONS[cap] }}
                />
                {CAPABILITY_LABELS[cap]}
              </button>
            ))}
          </div>
        </div>

        {groupedModels.length > 0 ? (
          <div
            className={cx(
              'routing-modal__table-head hidden border-b border-line pb-2 pl-8 pr-3 text-xs font-medium uppercase tracking-wide text-faint',
              'sm:grid',
              ROW_COLUMNS,
            )}
            aria-hidden="true"
          >
            <span>{t('models.picker.colModel')}</span>
            <span>{t('models.picker.colCapabilities')}</span>
            <span>{t('models.picker.colInput')}</span>
            <span>{t('models.picker.colOutput')}</span>
            <span className="sm:text-right">{t('models.picker.colPrice')}</span>
          </div>
        ) : null}

        {pickerItems.length > 0 ? (
          <VirtualList
            // Remount on a filter change: VirtualList's shrink-clamp reads the
            // pre-reset offset and would undo the resetKey jump to the top.
            key={pickerResetKey}
            className="routing-modal__list -mx-1 max-h-[55vh] overflow-y-auto px-1"
            items={pickerItems}
            itemHeight={pickerItemHeight}
            resetKey={pickerResetKey}
          >
            {(item) =>
              item.kind === 'header' ? (
                <div className="routing-modal__group-header flex h-8 items-center gap-2 px-3 text-xs font-semibold text-muted">
                  <span className="routing-modal__group-icon inline-flex shrink-0">
                    {renderGroupIcon(item.provId, item.name)}
                  </span>
                  <span className="routing-modal__group-name truncate">{item.name}</span>
                  {isAll ? (
                    <span className="routing-modal__group-auth shrink-0 font-normal text-faint">
                      {item.authType === 'subscription'
                        ? t('models.picker.subscription')
                        : item.authType === 'local'
                          ? t('models.picker.local')
                          : t('models.picker.usageBased')}
                    </span>
                  ) : null}
                  {props.agentName && !item.provId.startsWith('custom:') ? (
                    <button
                      type="button"
                      className="routing-modal__group-refresh icon-btn ml-auto size-6"
                      disabled={refreshingProvId !== null}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRefreshGroup(item.provId, item.name, item.authType);
                      }}
                      aria-label={t('models.picker.refreshModels', { name: item.name })}
                      title={t('models.picker.refreshModels', { name: item.name })}
                    >
                      <RefreshCw
                        aria-hidden="true"
                        className={cx(
                          'size-3',
                          refreshingProvId === item.provId &&
                            'routing-modal__group-refresh-icon--spinning animate-spin',
                        )}
                      />
                    </button>
                  ) : null}
                </div>
              ) : (
                renderModelRow(item.provId, item.model)
              )
            }
          </VirtualList>
        ) : (
          <div className="routing-modal__list">
            <div className="routing-modal__empty empty">
              <p className="text-sm">{emptyMessage}</p>
              {!search.trim() && !showFreeOnly && props.onConnectProviders ? (
                <Button size="sm" onClick={() => props.onConnectProviders?.()}>
                  {t('models.picker.connectProvider')}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
