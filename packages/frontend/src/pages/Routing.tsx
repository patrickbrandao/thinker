import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { Layers, RefreshCw, Settings } from 'lucide-react';
import RoutingModals from '../components/RoutingModals.js';
import { buildPipelineHelp } from '../components/RoutingPipelineCard.js';
import RoutingTabs from '../components/RoutingTabs.js';
import ResponseModeModal from '../components/ResponseModeModal.js';
import { toast } from '../services/toast-store.js';
import { t } from '../i18n/index.js';
import ReadOnlyRegion from '../components/ReadOnlyRegion.jsx';
import { me, roleCan } from '../services/session-store.js';
import { agentDisplayNameSignal } from '../services/agent-display-name.js';
import SetupModal from '../components/SetupModal.jsx';
import { isRecentlyCreated, isSetupPending, clearSetupPending } from '../services/recent-agents.js';
import { agentPlatform, agentCategory } from '../services/agent-platform-store.js';
import { useAgentName } from '../services/routing.js';
import { useSignal } from '../lib/signal.js';
import { useResource } from '../lib/use-resource.js';
import { Button, Modal, cx } from '../components/ui.js';
import RoutingDefaultTierSection from './RoutingDefaultTierSection.js';
import RoutingSpecificitySection from './RoutingSpecificitySection.js';
import RoutingHeaderTiersSection from './RoutingHeaderTiersSection.js';
import RoutingVirtualModelsSection from './RoutingVirtualModelsSection.js';
import RoutingTierCard from './RoutingTierCard.js';
import HeaderTierCard from '../components/HeaderTierCard.js';
import { RoutingLoadingSkeleton, ActiveProviderIcons, RoutingFooter } from './RoutingPanels.js';
import { useRoutingActions } from './RoutingActions.js';
import {
  listHeaderTiers,
  overrideHeaderTier,
  toggleHeaderTier,
  type HeaderTier,
} from '../services/api/header-tiers.js';
import {
  getTierAssignments,
  setTierResponseMode,
  getAvailableModels,
  getProviders,
  getCustomProviders,
  getEnabledProviders,
  getSpecificityAssignments,
  setSpecificityResponseMode,
  overrideSpecificity,
  resetSpecificity,
  refreshModels,
  getPricingHealth,
  getComplexityStatus,
  toggleComplexity,
  listModelParams,
  setModelParams as setModelParamsApi,
  deleteModelParams,
  modelParamsKey,
  type AgentModelParamsRow,
  type AuthType,
  type RequestParamDefaults,
  type ResponseMode,
} from '../services/api.js';
import { parseCustomProviderParams, parseProviderDeepLink } from '../services/routing-params.js';
import { DEFAULT_STAGE, STAGES } from '../services/providers.js';
import NoConnectionsPrompt from '../components/NoConnectionsPrompt.jsx';

const PREFILL_PARAMS = ['provider', 'name', 'baseUrl', 'apiKey', 'models'];

export default function Routing() {
  const agentName = useAgentName() ?? '';
  // Raw URL segment, used for the setup localStorage keys (as before).
  const agentSlug = encodeURIComponent(agentName);
  const location = useLocation();
  const locationState = location.state as
    { openProviders?: boolean; newApiKey?: string } | null | undefined;
  const [searchParams, setSearchParams] = useSearchParams();
  useSignal(me);
  const canManage = roleCan.manageProviders();
  const displayName = useSignal(agentDisplayNameSignal);

  // Newly created agents land on this tab; show the setup modal here too (it
  // used to live only on Overview). The open gate keys off a persistent
  // "setup pending" flag (localStorage) so the modal reliably reopens after a
  // page refresh until the user dismisses or completes it. The in-memory
  // `isRecentlyCreated` is kept as an in-session OR but is not required to
  // survive reloads.
  const [setupOpen, setSetupOpen] = useState(
    () =>
      (isSetupPending(agentName) || isRecentlyCreated(agentName)) &&
      !localStorage.getItem(`setup_completed_${agentSlug}`) &&
      !localStorage.getItem(`setup_dismissed_${agentSlug}`),
  );

  const searchRecord = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams]);
  const customProviderPrefill = useMemo(
    () => parseCustomProviderParams(searchRecord),
    [searchRecord],
  );
  const providerDeepLink = useMemo(() => parseProviderDeepLink(searchRecord), [searchRecord]);

  const tiers = useResource(() => getTierAssignments(agentName), [agentName]);
  const models = useResource(() => getAvailableModels(agentName), [agentName]);
  const connectedProviders = useResource(() => getProviders(agentName), [agentName]);
  const customProviders = useResource(() => getCustomProviders(agentName), [agentName]);
  const enabledProviders = useResource(
    () => getEnabledProviders(agentName).catch(() => ({ enabled: [] as string[] })),
    [agentName],
  );
  const specificityAssignments = useResource(
    () => getSpecificityAssignments(agentName),
    [agentName],
  );
  const headerTiers = useResource(
    () => listHeaderTiers(agentName).catch(() => [] as HeaderTier[]),
    [agentName],
  );
  const complexityStatus = useResource(() => getComplexityStatus(agentName), [agentName]);
  const [togglingComplexity, setTogglingComplexity] = useState(false);
  const [changingDefaultResponseMode, setChangingDefaultResponseMode] = useState(false);
  const [changingSpecificityResponseMode, setChangingSpecificityResponseMode] = useState(false);
  const complexityEnabled = complexityStatus.data?.enabled ?? true;

  // ── Routing deprecation gate ──────────────────────────────────────────────
  // Complexity and task-specific routing are being retired. We hide both from
  // agents that never configured them (the "clean" cohort) while keeping them
  // fully visible for agents that already invested in them (the "legacy"
  // cohort). The gate keys off config-presence — not signup date — so long-time
  // users who never touched these features also get the simplified surface.
  // Stickiness is scoped per agent: once an agent reveals a deprecated surface
  // we remember it for that agent (so toggling complexity off mid-session
  // doesn't yank the control away), but the gate compares the remembered agent
  // against the current one, so switching agents re-evaluates from the new
  // agent's own config and never carries a legacy reveal onto a clean agent.
  const hasComplexityConfig =
    (complexityStatus.data?.enabled ?? false) ||
    (tiers.data?.some((tier) => tier.tier !== 'default' && tier.override_route !== null) ?? false);
  const hasSpecificityConfig =
    specificityAssignments.data?.some((a) => a.is_active || a.override_route !== null) ?? false;
  const [legacyComplexityAgent, setLegacyComplexityAgent] = useState<string | null>(null);
  const [legacySpecificityAgent, setLegacySpecificityAgent] = useState<string | null>(null);
  useEffect(() => {
    if (hasComplexityConfig) setLegacyComplexityAgent(agentName);
    if (hasSpecificityConfig) setLegacySpecificityAgent(agentName);
  }, [agentName, hasComplexityConfig, hasSpecificityConfig]);
  const legacyComplexityVisible = hasComplexityConfig || legacyComplexityAgent === agentName;
  const legacySpecificityVisible = hasSpecificityConfig || legacySpecificityAgent === agentName;
  const isCleanAgent = !legacyComplexityVisible && !legacySpecificityVisible;

  // For the unified (no-tabs) view: capture openers from HeaderTiersSection
  // so the header button, dashed add-card, and card edit buttons can trigger modals.
  const headerTierOpener = useRef<(() => void) | undefined>(undefined);
  const headerTierCreator = useRef<(() => void) | undefined>(undefined);
  const headerTierEditor = useRef<((tier: HeaderTier) => void) | undefined>(undefined);

  // Per-route model params, fetched once and threaded down. Scope separates
  // default/complexity tiers, task-specific tiers, and custom header tiers so
  // the same model can have different values in different routing surfaces.
  const modelParams = useResource(
    () => listModelParams(agentName).catch(() => [] as AgentModelParamsRow[]),
    [agentName],
  );
  const modelParamsMap = useMemo(() => {
    const map = new Map<string, RequestParamDefaults>();
    for (const row of modelParams.data ?? []) {
      map.set(modelParamsKey(row.scope, row.provider, row.authType, row.model), row.params);
    }
    return map;
  }, [modelParams.data]);
  const getModelParamsFor = (
    scope: string,
    provider: string,
    authType: AuthType,
    model: string,
  ): RequestParamDefaults | null =>
    modelParamsMap.get(modelParamsKey(scope, provider, authType, model)) ?? null;

  const sameRoute =
    (scope: string, provider: string, authType: AuthType, model: string) =>
    (r: AgentModelParamsRow) =>
      r.scope === scope &&
      r.provider.toLowerCase() === provider.toLowerCase() &&
      r.authType === authType &&
      r.model === model;

  const setModelParamsFor = async (
    scope: string,
    provider: string,
    authType: AuthType,
    model: string,
    next: RequestParamDefaults | null,
  ): Promise<void> => {
    const matches = sameRoute(scope, provider, authType, model);
    if (next === null) {
      // Dialog returns null when the user collapses back to the provider's
      // natural default. Delete the row so the table stays clean and the
      // dashboard snapshot reflects the provider default, not an explicit
      // override.
      await deleteModelParams(agentName, { scope, provider, authType, model });
      modelParams.setData((rows) => (rows ?? []).filter((r) => !matches(r)));
      return;
    }
    const saved = await setModelParamsApi(agentName, {
      scope,
      provider,
      authType,
      model,
      params: next,
    });
    modelParams.setData((rows) => [...(rows ?? []).filter((r) => !matches(r)), saved]);
  };

  const refetchAll = async () => {
    await Promise.all([
      connectedProviders.reload(),
      customProviders.reload(),
      tiers.reload(),
      models.reload(),
      specificityAssignments.reload(),
      headerTiers.reload(),
      enabledProviders.reload(),
    ]);
  };

  const [dropdownTier, setDropdownTier] = useState<string | null>(null);
  const [specificityDropdown, setSpecificityDropdown] = useState<string | null>(null);
  const [changingSpecificity, setChangingSpecificity] = useState<string | null>(null);
  const [resettingSpecificity, setResettingSpecificity] = useState<string | null>(null);
  const [showProviderModal, setShowProviderModal] = useState(
    () => !!locationState?.openProviders || !!customProviderPrefill || !!providerDeepLink,
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const [responseModeModalOpen, setResponseModeModalOpen] = useState(false);
  const [instructionModal, setInstructionModal] = useState<'enable' | 'disable' | null>(null);
  const [instructionProvider, setInstructionProvider] = useState<string | null>(null);
  const [fallbackPickerTier, setFallbackPickerTier] = useState<string | null>(null);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const pricingHealth = useResource(() => getPricingHealth(), []);
  const pricingWarningShown = useRef(false);
  const [wasEnabledBeforeModal, setWasEnabledBeforeModal] = useState(false);
  const [hadProvidersBeforeModal, setHadProvidersBeforeModal] = useState(false);

  useEffect(() => {
    const health = pricingHealth.data;
    if (!health) return;
    if (health.model_count > 0) {
      pricingWarningShown.current = false;
      return;
    }
    if (pricingWarningShown.current) return;
    pricingWarningShown.current = true;
    toast.warning(
      health.sync_enabled === false
        ? t('routing.page.pricingSyncOff')
        : t('routing.page.pricingUnavailable'),
    );
  }, [pricingHealth.data]);

  const actions = useRoutingActions({
    agentName,
    tiers: tiers.data,
    mutateTiers: tiers.setData,
    refetchAll,
    setInstructionModal,
  });

  const defaultTierIds = (enabled: boolean) =>
    enabled ? STAGES.map((stage) => stage.id) : ['default'];

  const defaultResponseMode: ResponseMode = defaultTierIds(complexityEnabled).every(
    (id) => actions.getTier(id)?.response_mode === 'stream',
  )
    ? 'stream'
    : 'buffered';

  // `enabled` lets the complexity toggle apply the mode to the tiers of the
  // state it just switched to, before the new status has re-rendered.
  const handleDefaultResponseModeChange = async (
    responseMode: ResponseMode,
    enabled: boolean = complexityEnabled,
  ) => {
    const ids = defaultTierIds(enabled);
    setChangingDefaultResponseMode(true);
    try {
      const updated = await Promise.all(
        ids.map((tier) => setTierResponseMode(agentName, tier, responseMode)),
      );
      tiers.setData((prev) => {
        const byTier = new Map(updated.map((row) => [row.tier, row]));
        const merged = (prev ?? []).map((row) => byTier.get(row.tier) ?? row);
        for (const row of updated) {
          if (!merged.some((existing) => existing.tier === row.tier)) merged.push(row);
        }
        return merged;
      });
      toast.success(
        responseMode === 'stream'
          ? t('routing.streamModeEnabled')
          : t('routing.bufferedModeEnabled'),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('routing.responseModeFailed'));
    } finally {
      setChangingDefaultResponseMode(false);
    }
  };

  const handleToggleComplexity = async () => {
    const shouldInheritStreaming = defaultResponseMode === 'stream';
    setTogglingComplexity(true);
    try {
      const result = await toggleComplexity(agentName);
      complexityStatus.setData(result);
      if (shouldInheritStreaming) {
        await handleDefaultResponseModeChange('stream', result.enabled);
      }
    } catch {
      toast.error(t('routing.page.toggleComplexityFailed'));
    } finally {
      setTogglingComplexity(false);
    }
  };

  const activeSpecificityAssignments =
    specificityAssignments.data?.filter((assignment) => assignment.is_active) ?? [];

  const specificityResponseMode: ResponseMode =
    activeSpecificityAssignments.length > 0 &&
    activeSpecificityAssignments.every((assignment) => assignment.response_mode === 'stream')
      ? 'stream'
      : 'buffered';

  const handleSpecificityResponseModeChange = async (responseMode: ResponseMode) => {
    const active = activeSpecificityAssignments;
    if (active.length === 0) return;
    setChangingSpecificityResponseMode(true);
    try {
      const updated = await Promise.all(
        active.map((assignment) =>
          setSpecificityResponseMode(agentName, assignment.category, responseMode),
        ),
      );
      specificityAssignments.setData((prev) => {
        const byCategory = new Map(updated.map((row) => [row.category, row]));
        return prev?.map((row) => byCategory.get(row.category) ?? row);
      });
      toast.success(
        responseMode === 'stream'
          ? t('routing.streamModeEnabled')
          : t('routing.bufferedModeEnabled'),
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('routing.page.specificityResponseModeFailed'),
      );
    } finally {
      setChangingSpecificityResponseMode(false);
    }
  };

  const hasCustomTiersEnabled = headerTiers.data?.some((tier) => tier.enabled) ?? false;

  const handleOverride: typeof actions.handleOverride = async (...args) => {
    setDropdownTier(null);
    return actions.handleOverride(...args);
  };

  const hasAnySpecificityActive = specificityAssignments.data?.some((a) => a.is_active) ?? false;

  const isSpecificityTier = (tierId: string) =>
    specificityAssignments.data?.some((a) => a.category === tierId) ?? false;

  const handleAddFallback: typeof actions.handleAddFallback = async (
    tierId,
    modelName,
    providerId,
    authType,
    providerKeyLabel,
  ) => {
    setFallbackPickerTier(null);
    if (isSpecificityTier(tierId)) {
      const sa = specificityAssignments.data?.find((a) => a.category === tierId);
      const currentRoutes = sa?.fallback_routes ?? [];
      const current = currentRoutes.map((r) => r.model);
      if (current.includes(modelName)) return;
      const updated = [...current, modelName];
      // Pass explicit (provider, authType, model) routes so the backend can
      // disambiguate when the same model id is offered by multiple connected
      // providers (e.g. OpenAI subscription + OpenAI API key both expose
      // gpt-4o). Without this the backend silently stores nothing.
      const updatedRoutes =
        authType !== undefined
          ? [...currentRoutes, { provider: providerId, authType, model: modelName }]
          : undefined;
      try {
        const { setSpecificityFallbacks } = await import('../services/api.js');
        await setSpecificityFallbacks(agentName, tierId, updated, updatedRoutes);
        await specificityAssignments.reload();
        toast.success(t('routing.fallbackAdded'));
      } catch {
        toast.error(t('routing.fallbackAddFailed'));
      }
      return;
    }
    return actions.handleAddFallback(tierId, modelName, providerId, authType, providerKeyLabel);
  };

  const enabledProviderIds = new Set(enabledProviders.data?.enabled ?? []);
  const enabledConnectedProviders = (connectedProviders.data ?? []).filter((provider) =>
    enabledProviderIds.has(provider.id),
  );
  const isEnabled = enabledConnectedProviders.some((p) => p.is_active);
  const activeProviders = enabledConnectedProviders.filter((p) => p.is_active);
  const hasProviders = activeProviders.length > 0;
  const hasOverrides = tiers.data?.some((tier) => tier.override_route !== null) ?? false;
  const modelList = models.data ?? [];
  const customProviderList = customProviders.data ?? [];

  // Kept for callers that reopen the provider modal (e.g. future toolbar).
  const openProviderModal = () => {
    setWasEnabledBeforeModal(isEnabled);
    setHadProvidersBeforeModal((connectedProviders.data?.length ?? 0) > 0);
    setShowProviderModal(true);
  };
  void openProviderModal;

  const closeProviderModal = () => {
    setShowProviderModal(false);
    if (customProviderPrefill || providerDeepLink) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const key of PREFILL_PARAMS) next.delete(key);
        return next;
      });
    }
    if (!wasEnabledBeforeModal && isEnabled && hadProvidersBeforeModal) {
      setInstructionModal('enable');
    }
  };

  const handleSpecificityOverride = async (
    category: string,
    model: string,
    provider: string,
    authType?: 'api_key' | 'subscription' | 'local',
    providerKeyLabel?: string,
  ) => {
    setChangingSpecificity(category);
    try {
      await overrideSpecificity(agentName, category, model, provider, authType, providerKeyLabel);
      await specificityAssignments.reload();
    } catch {
      toast.error(t('routing.page.specificityModelFailed'));
    } finally {
      setChangingSpecificity(null);
    }
  };

  /**
   * Pin a task-specific (specificity) tier to a labeled provider key.
   * Re-uses the same PUT endpoint as `handleSpecificityOverride` — the
   * model/provider/auth_type stay the same, only the key label changes.
   */
  const handleSpecificityPinKey = async (
    category: string,
    provider: string,
    providerKeyLabel: string | null,
    authType?: 'api_key' | 'subscription' | 'local',
  ) => {
    const assignment = specificityAssignments.data?.find((a) => a.category === category);
    const effective = assignment?.override_route ?? null;
    const model = effective?.model;
    if (!assignment || !model || !provider) return;
    setChangingSpecificity(category);
    try {
      await overrideSpecificity(
        agentName,
        category,
        model,
        provider,
        authType ?? effective?.authType,
        providerKeyLabel ?? undefined,
      );
      await specificityAssignments.reload();
      toast.success(
        providerKeyLabel
          ? t('routing.pinnedToKey', { label: providerKeyLabel })
          : t('routing.keyPinCleared'),
      );
    } catch {
      // toast handled upstream
    } finally {
      setChangingSpecificity(null);
    }
  };

  const mutateHeaderTiers = headerTiers.setData;
  const pipelineHelp = buildPipelineHelp(
    hasAnySpecificityActive,
    hasCustomTiersEnabled,
    complexityEnabled,
  );
  const headerTierList = headerTiers.data ?? [];
  const name = displayName ?? agentName;

  const renderUnified = () => (
    <ReadOnlyRegion readOnly={!canManage}>
      {/* ── Unified view for clean agents (no tabs) ──────── */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-dim">{t('routing.defaultSubtitle')}</span>
        {headerTierList.length > 0 ? (
          <Button
            size="sm"
            className="routing-section__cta"
            onClick={() => headerTierOpener.current?.()}
          >
            {t('routing.manageCustomRouting')}
          </Button>
        ) : (
          <Button
            size="sm"
            className="routing-section__cta"
            onClick={() => headerTierCreator.current?.()}
          >
            {t('routing.createCustomTier')}
          </Button>
        )}
      </div>
      <div
        className={cx(
          'grid grid-cols-1 gap-3 md:grid-cols-2',
          hasCustomTiersEnabled && 'xl:grid-cols-3',
        )}
      >
        <RoutingTierCard
          stage={DEFAULT_STAGE}
          tier={actions.getTier('default')}
          models={modelList}
          customProviders={customProviderList}
          activeProviders={activeProviders}
          tiersLoading={tiers.loading}
          changingTier={actions.changingTier}
          resettingTier={actions.resettingTier}
          resettingAll={actions.resettingAll}
          addingFallback={actions.addingFallback}
          agentName={agentName}
          onDropdownOpen={(tierId) => setDropdownTier(tierId)}
          onOverride={handleOverride}
          onPinKey={actions.handlePinKey}
          onReset={actions.handleReset}
          onFallbackUpdate={actions.handleFallbackUpdate}
          onAddFallback={(tierId) => setFallbackPickerTier(tierId)}
          getFallbacksFor={actions.getFallbacksFor}
          connectedProviders={enabledConnectedProviders}
          getModelParams={getModelParamsFor}
          setModelParams={setModelParamsFor}
        />
        {headerTierList
          .filter((tier) => tier.enabled)
          .map((tier) => (
            <HeaderTierCard
              key={tier.id}
              agentName={agentName}
              tier={tier}
              models={modelList}
              customProviders={customProviderList}
              connectedProviders={enabledConnectedProviders}
              onOverride={async (m, p, a, label) => {
                try {
                  await overrideHeaderTier(agentName, tier.id, m, p, a, label);
                  await headerTiers.reload();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : t('routing.updateTierFailed'));
                }
              }}
              onFallbacksUpdate={(_fallbacks, updatedRoutes) => {
                if (updatedRoutes === undefined) {
                  void headerTiers.reload();
                  return;
                }
                mutateHeaderTiers((prev) =>
                  prev?.map((row) =>
                    row.id === tier.id ? { ...row, fallback_routes: updatedRoutes } : row,
                  ),
                );
              }}
              onEdit={() => headerTierEditor.current?.(tier)}
              onDisable={async () => {
                try {
                  await toggleHeaderTier(agentName, tier.id, false);
                  await headerTiers.reload();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : t('routing.toggleTierFailed'));
                }
              }}
              getModelParams={getModelParamsFor}
              setModelParams={setModelParamsFor}
            />
          ))}
        {/* Dashed add-card */}
        <button
          type="button"
          className="routing-unified-add-card flex min-h-40 flex-col items-center justify-center gap-2 rounded-surface border border-dashed border-line-strong bg-transparent text-sm text-muted transition-colors hover:border-accent hover:text-ink"
          onClick={() => headerTierCreator.current?.()}
        >
          <Layers className="size-5" aria-hidden="true" />
          <span>{t('routing.createCustomTier')}</span>
        </button>
      </div>
      {/* Headless section for modals only */}
      <RoutingHeaderTiersSection
        agentName={agentName}
        models={modelList}
        customProviders={customProviderList}
        connectedProviders={enabledConnectedProviders}
        externalTiers={headerTiers.data}
        externalRefetch={() => void headerTiers.reload()}
        externalMutate={mutateHeaderTiers}
        headless
        onOpenRef={(opener) => {
          headerTierOpener.current = opener;
        }}
        onCreateRef={(opener) => {
          headerTierCreator.current = opener;
        }}
        onEditRef={(opener) => {
          headerTierEditor.current = opener;
        }}
        getModelParams={getModelParamsFor}
        setModelParams={setModelParamsFor}
      />
    </ReadOnlyRegion>
  );

  const renderTabs = () => (
    <RoutingTabs
      specificityEnabled={hasAnySpecificityActive}
      customEnabled={hasCustomTiersEnabled}
      showSpecificity={legacySpecificityVisible}
      pipelineHelp={pipelineHelp}
    >
      {{
        default: (
          <ReadOnlyRegion readOnly={!canManage}>
            <RoutingDefaultTierSection
              agentName={agentName}
              tier={actions.getTier('default')}
              models={modelList}
              customProviders={customProviderList}
              activeProviders={activeProviders}
              connectedProviders={enabledConnectedProviders}
              tiersLoading={tiers.loading}
              changingTier={actions.changingTier}
              resettingTier={actions.resettingTier}
              resettingAll={actions.resettingAll}
              addingFallback={actions.addingFallback}
              onDropdownOpen={(tierId) => setDropdownTier(tierId)}
              onOverride={handleOverride}
              onPinKey={actions.handlePinKey}
              onReset={actions.handleReset}
              onFallbackUpdate={actions.handleFallbackUpdate}
              onAddFallback={(tierId) => setFallbackPickerTier(tierId)}
              getFallbacksFor={actions.getFallbacksFor}
              getTier={actions.getTier}
              complexityEnabled={complexityEnabled}
              togglingComplexity={togglingComplexity}
              onToggleComplexity={handleToggleComplexity}
              showComplexityToggle={legacyComplexityVisible}
              responseMode={defaultResponseMode}
              changingResponseMode={changingDefaultResponseMode}
              onResponseModeChange={(mode) => handleDefaultResponseModeChange(mode)}
              embedded
              getModelParams={getModelParamsFor}
              setModelParams={setModelParamsFor}
            />
          </ReadOnlyRegion>
        ),
        specificity: (
          <ReadOnlyRegion readOnly={!canManage}>
            <RoutingSpecificitySection
              agentName={agentName}
              assignments={specificityAssignments.data}
              models={modelList}
              customProviders={customProviderList}
              activeProviders={activeProviders}
              connectedProviders={enabledConnectedProviders}
              changingTier={changingSpecificity}
              resettingTier={resettingSpecificity}
              resettingAll={false}
              addingFallback={null}
              onDropdownOpen={(category) => setSpecificityDropdown(category)}
              onOverride={handleSpecificityOverride}
              onPinKey={handleSpecificityPinKey}
              onReset={async (category) => {
                setResettingSpecificity(category);
                try {
                  await resetSpecificity(agentName, category);
                  await specificityAssignments.reload();
                } catch {
                  toast.error(t('routing.page.resetFailed'));
                } finally {
                  setResettingSpecificity(null);
                }
              }}
              onFallbackUpdate={(category, _updatedFallbacks, updatedRoutes) => {
                if (updatedRoutes === undefined) return;
                specificityAssignments.setData((prev) =>
                  prev?.map((a) =>
                    a.category === category ? { ...a, fallback_routes: updatedRoutes } : a,
                  ),
                );
              }}
              onAddFallback={(category) => setFallbackPickerTier(category)}
              responseMode={specificityResponseMode}
              changingResponseMode={changingSpecificityResponseMode}
              onResponseModeChange={handleSpecificityResponseModeChange}
              refetchAll={refetchAll}
              refetchSpecificity={async () => {
                await specificityAssignments.reload();
              }}
              embedded
              getModelParams={getModelParamsFor}
              setModelParams={setModelParamsFor}
            />
          </ReadOnlyRegion>
        ),
        custom: (
          <ReadOnlyRegion readOnly={!canManage}>
            <RoutingHeaderTiersSection
              agentName={agentName}
              models={modelList}
              customProviders={customProviderList}
              connectedProviders={enabledConnectedProviders}
              externalTiers={headerTiers.data}
              externalRefetch={() => void headerTiers.reload()}
              externalMutate={mutateHeaderTiers}
              embedded
              getModelParams={getModelParamsFor}
              setModelParams={setModelParamsFor}
            />
          </ReadOnlyRegion>
        ),
      }}
    </RoutingTabs>
  );

  return (
    <div className="flex flex-col gap-4">
      <title>{t('common.pageTitle', { page: t('routing.page.title', { name }) })}</title>
      <meta name="description" content={t('routing.page.metaDescription', { name })} />

      {connectedProviders.data === undefined || enabledProviders.data === undefined ? (
        <RoutingLoadingSkeleton />
      ) : !hasProviders ? (
        <NoConnectionsPrompt />
      ) : (
        <>
          <ReadOnlyRegion readOnly={!canManage} notice={t('routing.page.readOnlyNotice')}>
            {/* Provider icons + action buttons in a single row */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              {isEnabled ? (
                <ActiveProviderIcons
                  activeProviders={activeProviders}
                  customProviders={customProviderList}
                />
              ) : null}
              <div className="ml-auto flex flex-wrap gap-2">
                {isEnabled ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={refreshingModels}
                    onClick={async () => {
                      setRefreshingModels(true);
                      try {
                        await refreshModels(agentName);
                        void models.reload();
                        void tiers.reload();
                        toast.success(t('routing.page.modelsRefreshed'));
                      } catch {
                        toast.error(t('routing.page.refreshModelsFailed'));
                      } finally {
                        setRefreshingModels(false);
                      }
                    }}
                  >
                    <RefreshCw
                      className={cx('size-3.5', refreshingModels && 'animate-spin')}
                      aria-hidden="true"
                    />
                    {refreshingModels
                      ? t('routing.page.refreshing')
                      : t('routing.page.refreshModels')}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  className="response-mode-btn"
                  onClick={() => setResponseModeModalOpen(true)}
                >
                  <Settings className="size-3.5" aria-hidden="true" />
                  {t('routing.page.responseModeLabel', {
                    mode:
                      defaultResponseMode === 'stream'
                        ? t('routing.stream')
                        : t('routing.buffered'),
                  })}
                </Button>
              </div>
            </div>
          </ReadOnlyRegion>

          {isCleanAgent ? renderUnified() : renderTabs()}

          <ReadOnlyRegion readOnly={!canManage}>
            <RoutingVirtualModelsSection
              agentName={agentName}
              models={modelList}
              customProviders={customProviderList}
              connectedProviders={enabledConnectedProviders}
              getModelParams={getModelParamsFor}
              setModelParams={setModelParamsFor}
            />

            <RoutingFooter
              hasOverrides={hasOverrides}
              resettingAll={actions.resettingAll}
              resettingTier={actions.resettingTier}
              onResetAll={actions.handleResetAll}
              onShowInstructions={() => setInstructionModal('enable')}
              onShowHowRoutingWorks={() => setHelpOpen(true)}
            />
          </ReadOnlyRegion>

          <Modal
            open={helpOpen && !!pipelineHelp}
            title={t('routing.howRoutingWorks')}
            onClose={() => setHelpOpen(false)}
          >
            {pipelineHelp}
            <div className="actions">
              <Button size="sm" onClick={() => setHelpOpen(false)}>
                {t('routing.page.gotIt')}
              </Button>
            </div>
          </Modal>
        </>
      )}

      {responseModeModalOpen ? (
        <ResponseModeModal
          responseMode={defaultResponseMode}
          onResponseModeChange={async (mode) => {
            await handleDefaultResponseModeChange(mode);
          }}
          disabled={changingDefaultResponseMode}
          tiers={tiers.data ?? []}
          models={modelList}
          onClose={() => setResponseModeModalOpen(false)}
          onReplace={(tierId) => {
            setResponseModeModalOpen(false);
            setDropdownTier(tierId);
          }}
        />
      ) : null}

      <RoutingModals
        agentName={agentName}
        dropdownTier={dropdownTier}
        onDropdownClose={() => setDropdownTier(null)}
        specificityDropdown={specificityDropdown}
        onSpecificityDropdownClose={() => setSpecificityDropdown(null)}
        onSpecificityOverride={(category, model, provider, authType) => {
          setSpecificityDropdown(null);
          void handleSpecificityOverride(category, model, provider, authType);
        }}
        fallbackPickerTier={fallbackPickerTier}
        onFallbackPickerClose={() => setFallbackPickerTier(null)}
        showProviderModal={showProviderModal}
        onProviderModalClose={closeProviderModal}
        customProviderPrefill={customProviderPrefill}
        providerDeepLink={providerDeepLink}
        instructionModal={instructionModal}
        instructionProvider={instructionProvider}
        onInstructionClose={() => {
          setInstructionModal(null);
          setInstructionProvider(null);
        }}
        models={modelList}
        tiers={tiers.data ?? []}
        specificityAssignments={specificityAssignments.data ?? []}
        customProviders={customProviderList}
        connectedProviders={enabledConnectedProviders}
        getTier={(tierId) => {
          const generalist = actions.getTier(tierId);
          if (generalist) return generalist;
          const sa = specificityAssignments.data?.find((a) => a.category === tierId);
          return sa ? { ...sa, tier: sa.category } : undefined;
        }}
        onOverride={handleOverride}
        onAddFallback={handleAddFallback}
        onProviderUpdate={refetchAll}
        onProviderPoll={async () => {
          await connectedProviders.reload();
        }}
      />

      <SetupModal
        open={setupOpen}
        agentName={agentName}
        apiKey={locationState?.newApiKey ?? null}
        agentPlatform={agentPlatform()}
        agentCategory={agentCategory()}
        onClose={() => {
          localStorage.setItem(`setup_dismissed_${agentSlug}`, '1');
          clearSetupPending(agentName);
          setSetupOpen(false);
        }}
        onDone={() => {
          localStorage.setItem(`setup_completed_${agentSlug}`, '1');
          clearSetupPending(agentName);
          setSetupOpen(false);
        }}
      />
    </div>
  );
}
