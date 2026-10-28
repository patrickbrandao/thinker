import type {
  AuthType,
  AvailableModel,
  CustomProviderData,
  RequestParamDefaults,
  ResponseMode,
  RoutingProvider,
  TierAssignment,
} from '../services/api.js';
import { DEFAULT_STAGE, STAGES, type StageDef } from '../services/providers.js';
import RoutingDeprecationNotice from '../components/RoutingDeprecationNotice.js';
import { cx } from '../components/ui.js';
import RoutingTierCard from './RoutingTierCard.js';
import { t } from '../i18n/index.js';

export interface RoutingDefaultTierSectionProps {
  agentName: string;
  tier: TierAssignment | undefined;
  models: AvailableModel[];
  customProviders: CustomProviderData[];
  activeProviders: RoutingProvider[];
  connectedProviders: RoutingProvider[];
  tiersLoading: boolean;
  changingTier: string | null;
  resettingTier: string | null;
  resettingAll: boolean;
  addingFallback: string | null;
  onDropdownOpen: (tierId: string) => void;
  onOverride: (tierId: string, model: string, provider: string, authType?: AuthType) => void;
  onPinKey?: (
    tierId: string,
    providerId: string,
    providerKeyLabel: string | null,
    authType?: AuthType,
  ) => void;
  onReset: (tierId: string) => void;
  onFallbackUpdate: (tierId: string, fallbacks: string[]) => void;
  onAddFallback: (tierId: string) => void;
  getFallbacksFor: (tierId: string) => string[];
  getTier: (tierId: string) => TierAssignment | undefined;
  complexityEnabled: boolean;
  togglingComplexity: boolean;
  onToggleComplexity: () => void;
  /**
   * Gate for the deprecated "Route by complexity" toggle. When false the
   * toggle is hidden entirely and the section shows only the single default
   * model + fallbacks. Hidden for agents that never enabled complexity
   * routing (see `legacyComplexityVisible` in Routing.tsx). Defaults to shown.
   */
  showComplexityToggle?: boolean;
  responseMode: ResponseMode;
  changingResponseMode: boolean;
  onResponseModeChange: (mode: ResponseMode) => void | Promise<void>;
  embedded?: boolean;
  /**
   * Read saved per-route params from the parent's loaded map. Threaded
   * down to every model row across the tier card + fallback list so each
   * affordance shows the configured-state badge without per-row fetches.
   */
  getModelParams?: (
    scope: string,
    provider: string,
    authType: AuthType,
    model: string,
  ) => RequestParamDefaults | null;
  /**
   * Persist new params for a single route. Parent is responsible for the
   * server call and the local cache update; this section just threads the
   * callback down to the affordance.
   */
  setModelParams?: (
    scope: string,
    provider: string,
    authType: AuthType,
    model: string,
    params: RequestParamDefaults | null,
  ) => Promise<unknown>;
}

export default function RoutingDefaultTierSection(props: RoutingDefaultTierSectionProps) {
  const card = (stage: StageDef, tier: TierAssignment | undefined) => (
    <RoutingTierCard
      key={stage.id}
      stage={stage}
      tier={tier}
      models={props.models}
      customProviders={props.customProviders}
      activeProviders={props.activeProviders}
      tiersLoading={props.tiersLoading}
      changingTier={props.changingTier}
      resettingTier={props.resettingTier}
      resettingAll={props.resettingAll}
      addingFallback={props.addingFallback}
      agentName={props.agentName}
      onDropdownOpen={props.onDropdownOpen}
      onOverride={props.onOverride}
      onPinKey={props.onPinKey}
      onReset={props.onReset}
      onFallbackUpdate={props.onFallbackUpdate}
      onAddFallback={props.onAddFallback}
      getFallbacksFor={props.getFallbacksFor}
      connectedProviders={props.connectedProviders}
      getModelParams={props.getModelParams}
      setModelParams={props.setModelParams}
    />
  );

  const cards = props.complexityEnabled ? (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {STAGES.map((stage) => card(stage, props.getTier(stage.id)))}
    </div>
  ) : (
    <div className={cx('grid grid-cols-1', props.embedded && 'mx-auto w-full max-w-2xl')}>
      {card(DEFAULT_STAGE, props.tier)}
    </div>
  );

  const subtitle = props.complexityEnabled
    ? t('routing.defaultTier.complexitySubtitle')
    : t('routing.defaultSubtitle');

  const showComplexityToggle = props.showComplexityToggle ?? true;
  const controls = showComplexityToggle ? (
    <button
      type="button"
      role="switch"
      aria-checked={props.complexityEnabled}
      className="flex shrink-0 items-center gap-2 text-sm text-dim disabled:opacity-50"
      disabled={props.togglingComplexity}
      onClick={() => props.onToggleComplexity()}
    >
      <span>{t('routing.defaultTier.routeByComplexity')}</span>
      {/* Visual track only; the button above carries the switch semantics. */}
      <span
        className="switch pointer-events-none"
        aria-hidden="true"
        aria-checked={props.complexityEnabled}
      />
    </button>
  ) : null;

  // Deprecation banner: shown to legacy/invested agents (the only ones with the
  // toggle) while complexity routing is actually active.
  const deprecationNotice =
    showComplexityToggle && props.complexityEnabled ? (
      <RoutingDeprecationNotice title={t('routing.deprecation.title')}>
        {t('routing.deprecation.body')}
      </RoutingDeprecationNotice>
    ) : null;

  if (props.embedded) {
    return (
      <div className="flex flex-col gap-4">
        {deprecationNotice}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-muted">{subtitle}</span>
          {controls}
        </div>
        {cards}
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      {deprecationNotice}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold text-ink">{t('routing.defaultTier.title')}</h2>
          <span className="text-sm text-muted">{subtitle}</span>
        </div>
        {controls}
      </div>
      {cards}
    </section>
  );
}
