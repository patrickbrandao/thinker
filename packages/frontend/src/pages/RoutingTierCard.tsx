import { useState, type DragEvent } from 'react';
import { Pencil, Undo2 } from 'lucide-react';
import { PROVIDERS } from '../services/providers.js';
import type { StageDef } from '../services/providers.js';
import { getModelLabel } from '../services/provider-utils.js';
import { providerIcon, customProviderLogo } from '../components/ProviderIcon.js';
import { authBadgeFor } from '../components/AuthBadge.js';
import {
  pricePerM,
  resolveProviderId,
  inferProviderFromModel,
  usedKeyLabelsForModelInTier,
} from '../services/routing-utils.js';
import { customProviderColor, formatPerRequestCost } from '../services/formatters.js';
import FallbackList from '../components/FallbackList.js';
import ModelParamsAffordance from '../components/ModelParamsAffordance.jsx';
import RouteKeyChip from '../components/RouteKeyChip.js';
import { Button, Modal, Skel, cx } from '../components/ui.js';
import { setFallbacks as setFallbacksApi } from '../services/api.js';
import { toast } from '../services/toast-store.js';
import { t } from '../i18n/index.js';
import { stageLabel } from '../services/routing.js';
import { modelParamsScopeForTier } from 'thinker-shared';
import type {
  TierAssignment,
  AvailableModel,
  AuthType,
  ModelRoute,
  RequestParamDefaults,
  RoutingProvider,
  CustomProviderData,
} from '../services/api.js';

/** @internal Exported for testing only. */
export function providerIdForModel(model: string, apiModels: AvailableModel[]): string | undefined {
  const m =
    apiModels.find((x) => x.model_name === model) ??
    apiModels.find((x) => x.model_name.startsWith(model + '-'));
  if (m) {
    const dbId = resolveProviderId(m.provider);
    // OpenRouter is the one provider where the vendor prefix is genuinely the
    // best attribution: an OR row for `anthropic/claude-…` should show the
    // Anthropic logo, not the OpenRouter logo. For every other registered
    // first-party provider the stored `m.provider` is the truth — Groq's
    // `qwen/qwen3-32b` is being served BY Groq, so it must show the Groq
    // logo (and use Groq's pricing) regardless of the model-id prefix.
    if (dbId && dbId !== 'openrouter' && PROVIDERS.find((p) => p.id === dbId)) {
      return dbId;
    }
    const prefixId = inferProviderFromModel(m.model_name);
    if (prefixId && PROVIDERS.find((p) => p.id === prefixId)) return prefixId;
    return dbId ?? prefixId;
  }
  const prefix = inferProviderFromModel(model);
  if (prefix && PROVIDERS.find((p) => p.id === prefix)) return prefix;
  for (const prov of PROVIDERS) {
    if (
      prov.models.some(
        (pm) =>
          pm.value === model ||
          model.startsWith(pm.value + '-') ||
          pm.value.startsWith(model + '-'),
      )
    ) {
      return prov.id;
    }
  }
  return undefined;
}

export interface RoutingTierCardProps {
  stage: StageDef;
  tier: TierAssignment | undefined;
  models: AvailableModel[];
  customProviders: CustomProviderData[];
  activeProviders: RoutingProvider[];
  tiersLoading: boolean;
  changingTier: string | null;
  resettingTier: string | null;
  resettingAll: boolean;
  addingFallback: string | null;
  agentName: string;
  onDropdownOpen: (tierId: string) => void;
  onOverride: (
    tierId: string,
    model: string,
    providerId: string,
    authType?: AuthType,
    providerKeyLabel?: string,
  ) => void | Promise<void>;
  onPinKey?: (
    tierId: string,
    providerId: string,
    providerKeyLabel: string | null,
    authType?: AuthType,
  ) => void;
  onReset: (tierId: string) => void;
  onFallbackUpdate: (
    tierId: string,
    fallbacks: string[],
    fallbackRoutes?: ModelRoute[] | null,
  ) => void;
  onAddFallback: (tierId: string) => void;
  getFallbacksFor: (tierId: string) => string[];
  connectedProviders: RoutingProvider[];
  persistFallbacks?: (
    agentName: string,
    tier: string,
    models: string[],
    routes?: ModelRoute[],
  ) => Promise<unknown>;
  persistClearFallbacks?: (agentName: string, tier: string) => Promise<unknown>;
  /**
   * Read saved per-route params from the parent's loaded map. The
   * affordance reads through this so saving in one slot reflects on every
   * other slot that resolves to the same `(provider, authType, model)`.
   */
  getModelParams?: (
    scope: string,
    provider: string,
    authType: AuthType,
    model: string,
  ) => RequestParamDefaults | null;
  /**
   * Persist new params for a single route. Parent owns the server call
   * and the local cache update; the card just threads the callback down.
   */
  setModelParams?: (
    scope: string,
    provider: string,
    authType: AuthType,
    model: string,
    params: RequestParamDefaults | null,
  ) => Promise<unknown>;
}

const effectiveRoute = (
  t: TierAssignment,
): { provider: string; authType: AuthType; model: string; keyLabel?: string | null } | null =>
  t.override_route;

const effectiveModel = (t: TierAssignment): string | null => effectiveRoute(t)?.model ?? null;

/** Placeholder for the primary chip while tiers load or a swap is in flight. */
function ChipSkeleton() {
  return (
    <div className="routing-card__model-chip rounded-control border border-line bg-sunken p-2.5">
      <div className="routing-card__chip-main flex items-center gap-2">
        <Skel width={14} height={14} />
        <Skel width={120} height={12} />
      </div>
      <div className="routing-card__chip-footer mt-2">
        <Skel width={150} height={10} />
      </div>
    </div>
  );
}

export default function RoutingTierCard(props: RoutingTierCardProps) {
  const tier = props.tier;
  const stageId = props.stage.id;
  const eff = tier ? effectiveModel(tier) : null;
  const manualProviderId = tier?.override_route?.provider;
  const isManual = tier?.override_route != null;
  const hasFallbacks = (tier?.fallback_routes ?? []).length > 0;
  const hasCustomizations = isManual || hasFallbacks;
  const [confirmReset, setConfirmReset] = useState(false);
  const [primaryDragging, setPrimaryDragging] = useState(false);
  const [fallbackDragging, setFallbackDragging] = useState<number | null>(null);
  const [primaryDropTarget, setPrimaryDropTarget] = useState(false);
  const [swappingFbIndex, setSwappingFbIndex] = useState<number | null>(null);
  // Set while FallbackList persists a reorder. The primary chip is a drag
  // source into that same list, so it stays locked until the write lands.
  const [fallbackReordering, setFallbackReordering] = useState(false);

  const handlePrimaryDragStart = (e: DragEvent) => {
    setPrimaryDragging(true);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'primary');
      e.dataTransfer.setData('application/x-primary', 'true');
    }
  };

  const handlePrimaryDragEnd = () => {
    setPrimaryDragging(false);
    setPrimaryDropTarget(false);
  };

  const handlePrimaryDragOver = (e: DragEvent) => {
    if (fallbackDragging === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    setPrimaryDropTarget(true);
  };

  const handlePrimaryDrop = (e: DragEvent) => {
    e.preventDefault();
    setPrimaryDropTarget(false);
    const fbIndex = fallbackDragging;
    if (fbIndex === null) return;
    setFallbackDragging(null);
    void swapPrimaryWithFallback(fbIndex);
  };

  const persist = (newFallbacks: string[], newRoutes: ModelRoute[] | null) => {
    const persistFn = props.persistFallbacks ?? setFallbacksApi;
    return persistFn(props.agentName, stageId, newFallbacks, newRoutes ?? undefined);
  };

  const handlePrimaryDropAtSlot = async (slot: number) => {
    if (!tier) return;
    const currentModel = eff;
    if (!currentModel) return;
    setSwappingFbIndex(slot > 0 ? slot - 1 : 0);
    // Carry the full primary route through the swap. Without this, the same
    // model name on a different auth (subscription vs api_key) collapses back
    // to "first match in discovery" when the backend rebuilds fallback_routes
    // — and the UI ends up rendering a ghost row whose auth no longer matches.
    const currentRoute = effectiveRoute(tier);
    const fallbacks = props.getFallbacksFor(stageId);
    const fallbackRoutes = tier.fallback_routes ?? null;
    // Build the unified list: insert current primary at drop slot
    const newFallbacks = [...fallbacks];
    newFallbacks.splice(slot, 0, currentModel);
    const newPrimary = newFallbacks.shift()!;
    if (newPrimary === currentModel && slot === 0) {
      setSwappingFbIndex(null);
      return;
    } // no-op
    // Build the parallel route list when we have full coverage. The route
    // shape carries `keyLabel`, so multi-key pins ride along with the swap
    // automatically — primary→fallback or fallback→primary keeps the same
    // (provider, authType, model, keyLabel) tuple. If any fallback predates
    // the dual-write migration we drop to the bare model-name persist.
    const buildRoutes = (): typeof fallbackRoutes => {
      if (!currentRoute || !fallbackRoutes || fallbackRoutes.length !== fallbacks.length) {
        return null;
      }
      const next = [...fallbackRoutes];
      next.splice(slot, 0, currentRoute);
      next.shift();
      return next;
    };
    const newRoutes = buildRoutes();
    // Resolve the new primary's route for the override call.
    const newPrimaryRoute =
      newRoutes && newRoutes.length === newFallbacks.length
        ? // newPrimary came from position 0 of the post-splice list, which
          // corresponds to the original fallback at the same slot
          fallbackRoutes![0]
        : null;
    // Optimistic update: set BOTH model names and routes so the FallbackList
    // doesn't render new names against stale fallback_routes (causes a gray
    // ghost row when the routes describe a different auth than the new model).
    props.onFallbackUpdate(stageId, newFallbacks, newRoutes);
    try {
      await persist(newFallbacks, newRoutes);
    } catch {
      props.onFallbackUpdate(stageId, fallbacks, fallbackRoutes);
      toast.error(t('routing.fallbacksUpdateFailed'));
      setSwappingFbIndex(null);
      return;
    }
    const provId = newPrimaryRoute?.provider ?? providerIdForModel(newPrimary, props.models);
    try {
      await props.onOverride(
        stageId,
        newPrimary,
        provId ?? '',
        newPrimaryRoute?.authType,
        newPrimaryRoute?.keyLabel ?? undefined,
      );
    } finally {
      setSwappingFbIndex(null);
    }
  };

  const swapPrimaryWithFallback = async (fbIndex: number) => {
    if (!tier) return;
    const currentModel = eff;
    if (!currentModel) return;
    setSwappingFbIndex(fbIndex);
    const currentRoute = effectiveRoute(tier);
    const fallbacks = props.getFallbacksFor(stageId);
    const fbModel = fallbacks[fbIndex];
    if (!fbModel) {
      setSwappingFbIndex(null);
      return;
    }
    const fallbackRoutes = tier.fallback_routes ?? null;
    const fbRoute = fallbackRoutes?.[fbIndex] ?? null;
    // Swap: fallback model goes to primary, current primary takes its place.
    // Carry routes alongside model names so same-name-different-auth swaps
    // don't collapse to a single auth on persist. The route shape carries
    // `keyLabel`, so the multi-key pin rides along with this swap too.
    const newFallbacks = [...fallbacks];
    newFallbacks[fbIndex] = currentModel;
    const newRoutes =
      fallbackRoutes && currentRoute && fallbackRoutes.length === fallbacks.length
        ? fallbackRoutes.map((r, i) => (i === fbIndex ? currentRoute : r))
        : null;
    props.onFallbackUpdate(stageId, newFallbacks, newRoutes);
    try {
      await persist(newFallbacks, newRoutes);
    } catch {
      props.onFallbackUpdate(stageId, fallbacks, fallbackRoutes);
      toast.error(t('routing.fallbacksUpdateFailed'));
      setSwappingFbIndex(null);
      return;
    }
    const provId = fbRoute?.provider ?? providerIdForModel(fbModel, props.models);
    try {
      await props.onOverride(
        stageId,
        fbModel,
        provId ?? '',
        fbRoute?.authType,
        fbRoute?.keyLabel ?? undefined,
      );
    } finally {
      setSwappingFbIndex(null);
    }
  };

  const modelInfo = (modelName: string): AvailableModel | undefined =>
    props.models.find((m) => m.model_name === modelName) ??
    props.models.find((m) => m.model_name.startsWith(modelName + '-'));

  const labelFor = (modelName: string): string => {
    const info = modelInfo(modelName);
    if (info) {
      if (info.display_name) {
        const provName = info.provider_display_name;
        return provName ? `${provName} / ${info.display_name}` : info.display_name;
      }
      const prefixId = inferProviderFromModel(modelName);
      const provId =
        prefixId && PROVIDERS.find((p) => p.id === prefixId)
          ? prefixId
          : resolveProviderId(info.provider);
      if (provId) return getModelLabel(provId, modelName);
    }
    return modelName;
  };

  const priceLabel = (modelName: string): string => {
    const info = modelInfo(modelName);
    if (!info) return '';
    return t('routing.pricePerM', {
      input: pricePerM(info.input_price_per_token),
      output: pricePerM(info.output_price_per_token),
    });
  };

  const isStreamMode = tier?.response_mode === 'stream';
  const changing = props.changingTier === stageId;
  const resetting = props.resettingTier === stageId;

  const renderPrimary = (modelName: string) => {
    const provId = manualProviderId ?? providerIdForModel(modelName, props.models);
    const primarySkipped =
      isStreamMode && !(modelInfo(modelName)?.capabilities?.includes('stream') ?? false);
    const effectiveAuth = ((): AuthType | null => {
      const route = tier ? effectiveRoute(tier) : null;
      if (route?.authType) return route.authType;
      if (!provId) return null;
      const provs = props.activeProviders.filter(
        (p) => p.provider.toLowerCase() === provId.toLowerCase(),
      );
      if (provs.some((p) => p.auth_type === 'subscription')) return 'subscription';
      if (provs.some((p) => p.auth_type === 'api_key')) return 'api_key';
      return null;
    })();
    if (swappingFbIndex !== null || changing) return <ChipSkeleton />;

    const label = labelFor(modelName);
    const customProvider = provId?.startsWith('custom:')
      ? props.customProviders?.find((c) => `custom:${c.id}` === provId)
      : undefined;
    const customLogo = customProvider
      ? customProviderLogo(customProvider.name, 14, customProvider.base_url, modelName)
      : null;
    const skippedBadge = primarySkipped ? (
      <span className="routing-card__skipped-badge rounded-full bg-warn-tint px-1.5 py-px text-[10px] font-medium text-warn">
        {t('routing.skippedInStream')}
      </span>
    ) : null;

    return (
      <div
        className={cx(
          'routing-card__model-chip group cursor-grab rounded-control border bg-sunken p-2.5 transition-colors',
          primaryDropTarget ? 'border-accent bg-accent-tint' : 'border-line',
          primaryDragging && 'routing-card__model-chip--dragging opacity-50',
          primaryDropTarget && 'routing-card__model-chip--drop-target',
          primarySkipped && 'routing-card__model-chip--skipped opacity-60',
        )}
        title={primarySkipped ? t('routing.skippedWhileStream') : undefined}
        draggable={!fallbackReordering}
        onDragStart={handlePrimaryDragStart}
        onDragEnd={handlePrimaryDragEnd}
        onDragOver={handlePrimaryDragOver}
        onDragLeave={() => setPrimaryDropTarget(false)}
        onDrop={handlePrimaryDrop}
      >
        <div className="routing-card__chip-main flex items-center justify-between gap-2">
          <div className="routing-card__override flex min-w-0 items-center gap-1.5">
            {provId?.startsWith('custom:') ? (
              <span className="routing-card__override-icon relative inline-flex shrink-0">
                {customLogo ?? (
                  <span
                    className="provider-card__logo-letter inline-flex size-3.5 items-center justify-center rounded-full text-[8px] font-semibold text-white"
                    style={{ background: customProviderColor(customProvider?.name ?? 'C') }}
                  >
                    {(customProvider?.name ?? 'C').charAt(0).toUpperCase()}
                  </span>
                )}
              </span>
            ) : provId ? (
              <span className="routing-card__override-icon relative inline-flex shrink-0">
                {providerIcon(provId, 14)}
                {authBadgeFor(effectiveAuth, 8)}
              </span>
            ) : null}
            <span className="routing-card__main truncate text-sm font-medium text-ink">
              {label}
            </span>
            {!isManual ? (
              <span className="routing-card__auto-tag rounded-full bg-s2 px-1.5 text-[10px] text-muted">
                {t('routing.auto')}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <PrimaryKeyChip
              tier={tier}
              provId={provId}
              effectiveAuth={effectiveAuth}
              connectedProviders={props.connectedProviders}
              modelLabel={label}
              modelName={modelName}
              onPinKey={(keyLabel) => {
                if (!provId) return;
                props.onPinKey?.(stageId, provId, keyLabel, effectiveAuth ?? undefined);
              }}
              disabled={changing}
            />
            {props.setModelParams && props.getModelParams && effectiveAuth ? (
              <ModelParamsAffordance
                provider={provId}
                authType={effectiveAuth}
                model={modelName}
                slotLabel={label}
                scope={modelParamsScopeForTier(stageId)}
                agentName={props.agentName}
                getParams={props.getModelParams}
                setParams={props.setModelParams}
                disabled={changing}
              />
            ) : null}
            <button
              type="button"
              className="routing-card__chip-action icon-btn size-6"
              onClick={() => props.onDropdownOpen(stageId)}
              disabled={changing}
              aria-label={t('routing.changeModelFor', { name: stageLabel(props.stage) })}
              title={t('routing.change')}
            >
              <Pencil aria-hidden="true" className="size-3" />
            </button>
          </div>
        </div>
        <div className="routing-card__chip-footer mt-1.5">
          <span className="routing-card__chip-meta flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span className="routing-card__chip-price">
              {effectiveAuth === 'subscription'
                ? (formatPerRequestCost(modelInfo(modelName)?.cost_per_request) ??
                  t('routing.includedInSubscription'))
                : priceLabel(modelName)}
            </span>
            {skippedBadge}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="routing-card card flex flex-col gap-3 p-3">
      <div className="routing-card__header flex min-h-7 items-center justify-between gap-2">
        <span className="routing-card__tier flex items-center gap-1.5 text-sm font-semibold text-ink">
          {stageId === 'default' ? (
            <>
              {t('routing.tierCard.virtualModelLabel')}
              <code className="routing-card__auto rounded-control border border-accent bg-accent-tint px-1.5 py-px font-mono font-bold text-accent">
                auto
              </code>
            </>
          ) : (
            stageLabel(props.stage)
          )}
        </span>
        <div className="flex items-center gap-1">
          {hasCustomizations ? (
            <Button
              variant="quiet"
              size="sm"
              className="routing-card__header-action routing-card__header-action--danger"
              onClick={() => setConfirmReset(true)}
              disabled={resetting || props.resettingAll}
            >
              {resetting ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <Undo2 aria-hidden="true" className="size-3" />
              )}
              {t('routing.reset')}
            </Button>
          ) : null}
          {!eff && !props.tiersLoading ? (
            <Button
              variant="ghost"
              size="sm"
              className="routing-card__header-add"
              onClick={() => props.onDropdownOpen(stageId)}
            >
              {t('routing.addModel')}
            </Button>
          ) : null}
        </div>
      </div>
      {props.tiersLoading ? (
        <div className="routing-card__body">
          <ChipSkeleton />
        </div>
      ) : (
        <>
          <div className="routing-card__body">{eff ? renderPrimary(eff) : null}</div>
          {eff ? (
            <div className="routing-card__right">
              <FallbackList
                agentName={props.agentName}
                tier={stageId}
                tierData={tier}
                fallbacks={props.getFallbacksFor(stageId)}
                fallbackRoutes={tier?.fallback_routes ?? null}
                models={props.models}
                customProviders={props.customProviders}
                connectedProviders={props.activeProviders}
                onUpdate={(updatedFallbacks, updatedRoutes) =>
                  // Thread routes through optimistic state so the UI doesn't
                  // render the new model list against stale fallback_routes
                  // (the gray "ghost row" bug for same-name-different-auth).
                  props.onFallbackUpdate(stageId, updatedFallbacks, updatedRoutes)
                }
                onAddFallback={() => props.onAddFallback(stageId)}
                adding={props.addingFallback === stageId}
                primaryDragging={primaryDragging}
                onPrimaryDropAtSlot={handlePrimaryDropAtSlot}
                onFallbackDragStart={(index) => setFallbackDragging(index)}
                onFallbackDragEnd={() => setFallbackDragging(null)}
                persistFallbacks={props.persistFallbacks}
                persistClearFallbacks={props.persistClearFallbacks}
                getModelParams={props.getModelParams}
                setModelParams={props.setModelParams}
                swappingIndex={swappingFbIndex}
                onReorderingChange={setFallbackReordering}
                modelParamsScope={modelParamsScopeForTier(stageId)}
                responseMode={tier?.response_mode ?? 'buffered'}
              />
            </div>
          ) : null}
        </>
      )}

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        label={t('routing.tierCard.resetTitle')}
      >
        <h2 id="reset-tier-modal-title" className="mb-3 text-base font-semibold text-ink">
          {t('routing.tierCard.resetTitle')}
        </h2>
        <p className="mb-5 text-sm text-dim">{t('routing.tierCard.resetBody')}</p>
        <div className="actions flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmReset(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={resetting}
            onClick={() => {
              setConfirmReset(false);
              props.onReset(stageId);
            }}
          >
            {resetting ? <span className="spinner" aria-hidden="true" /> : t('routing.reset')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/**
 * Compact inline chip for the primary model row that shows the currently-
 * pinned provider key and lets the user change it without leaving the card.
 * Mirrors the pill on each fallback row so multi-key users see a consistent
 * affordance across primary + fallbacks. Renders nothing when only one key
 * exists for the provider — single-key users never see it.
 */
interface PrimaryKeyChipProps {
  tier: TierAssignment | undefined;
  provId: string | undefined;
  effectiveAuth: AuthType | null;
  connectedProviders: RoutingProvider[];
  modelLabel: string;
  modelName: string;
  onPinKey: (label: string | null) => void;
  disabled: boolean;
}

function PrimaryKeyChip(props: PrimaryKeyChipProps) {
  const id = props.provId;
  const auth = props.effectiveAuth;
  const keys =
    !id || !auth || auth === 'local'
      ? []
      : props.connectedProviders
          .filter(
            (p) =>
              p.provider.toLowerCase() === id.toLowerCase() &&
              p.auth_type === auth &&
              p.is_active &&
              p.has_api_key,
          )
          .slice()
          .sort((a, b) => a.priority - b.priority);
  if (keys.length <= 1) return null;

  // The pinned key label lives inside the explicit primary route's `keyLabel`
  // field. When no pin is set, fall back to the first connected key.
  const pinned = props.tier?.override_route?.keyLabel ?? null;

  return (
    <RouteKeyChip
      keys={keys}
      currentLabel={pinned}
      modelLabel={props.modelLabel}
      usedLabels={usedKeyLabelsForModelInTier(
        props.tier,
        props.modelName,
        'primary',
        keys[0]?.label,
      )}
      buttonClass="routing-card__key-chip"
      disabled={props.disabled}
      leadingMargin
      menuMinWidth={140}
      onPick={(label) => {
        if (label) props.onPinKey(label);
      }}
    />
  );
}
