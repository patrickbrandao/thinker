import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, Settings } from 'lucide-react';
import type {
  AuthType,
  AvailableModel,
  CustomProviderData,
  ModelRoute,
  RequestParamDefaults,
  ResponseMode,
  RoutingProvider,
} from '../services/api.js';
import { providerIcon, customProviderLogo } from './ProviderIcon.js';
import { authBadgeFor } from './AuthBadge.js';
import { pricePerM } from '../services/routing-utils.js';
import { customProviderColor, formatPerRequestCost } from '../services/formatters.js';
import ModelChainManager from './ModelChainManager.js';
import NotInCatalogBadge from './NotInCatalogBadge.js';
import { AuthIcon, routeAccountLabel } from './RouteAccount.js';
import { routeNotInCatalog } from '../lib/route-catalog.js';
import { t } from '../i18n/index.js';
import { Button, cx, useClickOutside } from './ui.js';

/**
 * A named chain of concrete routes: a primary (`override_route`) and up to 5
 * fallbacks. Header tiers, virtual models (ADR 0004) and the `auto` model
 * share this shape and this card; each wrapper adds its own header details
 * and menu.
 */
export interface RouteChain {
  id: string;
  name: string;
  override_route: ModelRoute | null;
  fallback_routes: ModelRoute[] | null;
  response_mode?: ResponseMode;
}

export interface RouteChainCardProps {
  agentName: string;
  chain: RouteChain;
  /** Modifier class on the card root, e.g. `routing-card--virtual-model`. */
  cardClass: string;
  /** Extra classes toggled on the card root. */
  classList?: Record<string, boolean>;
  models: AvailableModel[];
  customProviders: CustomProviderData[];
  connectedProviders: RoutingProvider[];
  /** Saves the primary route. Throws when the save fails. */
  onOverride: (
    model: string,
    provider: string,
    authType?: AuthType,
    providerKeyLabel?: string,
  ) => void | Promise<void>;
  onFallbacksUpdate: (fallbacks: string[], routes?: ModelRoute[] | null) => void;
  persistFallbacks: (models: string[], routes?: ModelRoute[]) => Promise<unknown>;
  persistClearFallbacks: () => Promise<unknown>;
  /** Clears the primary and its fallbacks; enables emptying the chain in the manager. */
  persistClearChain?: () => Promise<unknown>;
  /** Model params scope for every route of the chain (`header:<id>`, `virtual:<id>`). */
  paramsScope: string;
  /** Items of the options menu. `close` hides the menu. No menu when absent. */
  renderMenu?: (close: () => void) => ReactNode;
  /** Rendered next to the name, inside the title. */
  titleExtra?: ReactNode;
  /** Rendered before the name, e.g. a drag handle. */
  titleLeading?: ReactNode;
  /** Replaces the plain name in the title. */
  titleContent?: ReactNode;
  /** Rendered under the header, before the routes. */
  details?: ReactNode;
  /** Per-route params, threaded from the routing page boundary to the manager window. */
  getModelParams?: (
    scope: string,
    provider: string,
    authType: AuthType,
    model: string,
  ) => RequestParamDefaults | null;
  setModelParams?: (
    scope: string,
    provider: string,
    authType: AuthType,
    model: string,
    params: RequestParamDefaults | null,
  ) => Promise<unknown>;
}

/**
 * The chain as a read-only flow, top to bottom. Everything is edited in the
 * "Manage model" window (`ModelChainManager`): the routes and each model's
 * request params.
 */
export default function RouteChainCard(props: RouteChainCardProps) {
  const [managerOpen, setManagerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useClickOutside(menuRef, menuOpen, closeMenu);

  const routes: ModelRoute[] = [
    ...(props.chain.override_route ? [props.chain.override_route] : []),
    ...(props.chain.fallback_routes ?? []),
  ];
  const isStreamMode = props.chain.response_mode === 'stream';

  /** Saves a whole chain built in the manager: primary first, then fallbacks. */
  const saveChain = async (next: ModelRoute[]): Promise<void> => {
    const [primary, ...rest] = next;
    if (!primary) {
      if (!props.persistClearChain) throw new Error('chain cannot be cleared');
      await props.persistClearChain();
      props.onFallbacksUpdate([], undefined);
      return;
    }
    await props.onOverride(
      primary.model,
      primary.provider,
      primary.authType,
      primary.keyLabel ?? undefined,
    );
    if (rest.length > 0) {
      const models = rest.map((r) => r.model);
      await props.persistFallbacks(models, rest);
      props.onFallbacksUpdate(models, rest);
    } else {
      await props.persistClearFallbacks();
      props.onFallbacksUpdate([], []);
    }
  };

  const modelInfo = (r: ModelRoute): AvailableModel | undefined =>
    props.models.find(
      (m) => m.model_name === r.model && m.provider.toLowerCase() === r.provider.toLowerCase(),
    ) ??
    props.models.find((m) => m.model_name === r.model) ??
    props.models.find((m) => m.model_name.startsWith(r.model + '-'));

  const renderIcon = (r: ModelRoute) => {
    const provId = r.provider.toLowerCase();
    if (provId.startsWith('custom:')) {
      const cp = props.customProviders.find((p) => `custom:${p.id}` === provId);
      const logo = cp ? customProviderLogo(cp.name, 24) : null;
      return (
        logo ?? (
          <span
            className="routing-card__override-icon inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-on-accent"
            style={{ backgroundColor: customProviderColor(provId.slice('custom:'.length)) }}
          >
            {(cp?.name ?? 'C').charAt(0).toUpperCase()}
          </span>
        )
      );
    }
    return (
      <span className="routing-card__override-icon relative inline-flex shrink-0">
        {providerIcon(provId, 24)}
        {authBadgeFor(r.authType, 10)}
      </span>
    );
  };

  const priceText = (r: ModelRoute, info: AvailableModel | undefined): string => {
    if (r.authType === 'subscription') {
      return formatPerRequestCost(info?.cost_per_request) ?? t('routing.cardSubscription');
    }
    if (r.authType === 'local' || !info) return '';
    const input = Number(info.input_price_per_token);
    const output = Number(info.output_price_per_token);
    if (info.input_price_per_token != null && input === 0 && output === 0) {
      return t('routing.free');
    }
    return t('routing.cardPrice', {
      input: pricePerM(info.input_price_per_token),
      output: pricePerM(info.output_price_per_token),
    });
  };

  const renderRoute = (r: ModelRoute, index: number) => {
    const info = modelInfo(r);
    const label = info?.display_name ?? r.model;
    const skipped = isStreamMode && !(info?.capabilities?.includes('stream') ?? false);
    const account = routeAccountLabel(r, props.connectedProviders);
    const price = priceText(r, info);
    return (
      <div key={`${r.provider}|${r.authType}|${r.model}|${r.keyLabel ?? ''}`}>
        {index > 0 ? (
          <div className="routing-card__flow-arrow flex h-4 items-center justify-center text-faint">
            <ArrowDown aria-hidden="true" className="size-3" />
          </div>
        ) : null}
        <div
          className={cx(
            'routing-card__route flex items-center gap-2 rounded-control border border-line bg-sunken px-2.5 py-2',
            index === 0 && 'routing-card__model-chip',
            skipped && 'routing-card__route--skipped opacity-60',
          )}
          title={skipped ? t('routing.skippedWhileStream') : undefined}
        >
          <span className="inline-flex shrink-0">{renderIcon(r)}</span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span
              className={cx(
                'routing-card__main truncate text-ink',
                index === 0 ? 'text-sm font-medium' : 'text-sm',
              )}
              title={r.model}
            >
              {label}
            </span>
            <span className="routing-card__chip-meta flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <span
                className="routing-card__account inline-flex min-w-0 items-center gap-1 font-medium text-ink"
                title={t('models.picker.account', { label: account })}
              >
                <AuthIcon authType={r.authType} />
                <span className="truncate">{account}</span>
              </span>
              {price ? <span className="routing-card__chip-price">{price}</span> : null}
              {skipped ? (
                <span className="routing-card__skipped-badge badge is-warn">
                  {t('routing.skippedInStream')}
                </span>
              ) : null}
              {routeNotInCatalog(r, props.models) ? <NotInCatalogBadge /> : null}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const rootClasses = Object.entries(props.classList ?? {})
    .filter(([, on]) => on)
    .map(([name]) => name);

  return (
    <div
      className={cx('routing-card card flex flex-col gap-3 p-3', props.cardClass, ...rootClasses)}
    >
      <div className="routing-card__header flex min-h-7 items-center justify-between gap-2">
        <span className="routing-card__tier header-tier-card__title flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink">
          {props.titleLeading}
          {props.titleContent ?? (
            <span className="header-tier-card__name truncate">{props.chain.name}</span>
          )}
          {props.titleExtra}
          {props.renderMenu ? (
            <div ref={menuRef} className="header-tier-card__kebab relative">
              <button
                type="button"
                className="header-tier-card__icon-btn icon-btn size-6"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-label={t('routing.chain.optionsFor', { name: props.chain.name })}
                aria-expanded={menuOpen}
                title={t('routing.chain.options')}
              >
                <Settings aria-hidden="true" className="size-3.5" />
              </button>
              {menuOpen ? (
                <div className="header-tier-card__menu menu left-0 top-full mt-1 font-normal">
                  {props.renderMenu(closeMenu)}
                </div>
              ) : null}
            </div>
          ) : null}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="routing-card__header-add"
          onClick={() => setManagerOpen(true)}
        >
          {t('routing.manageModel')}
        </Button>
      </div>

      {props.details}

      {routes.length > 0 ? (
        <div className="routing-card__body routing-card__flow flex flex-col">
          {routes.map(renderRoute)}
        </div>
      ) : null}

      {managerOpen ? (
        <ModelChainManager
          agentName={props.agentName}
          chainId={props.chain.id}
          chainName={props.chain.name}
          routes={routes}
          models={props.models}
          customProviders={props.customProviders}
          connectedProviders={props.connectedProviders}
          requiredCapability={isStreamMode ? 'stream' : undefined}
          onSave={saveChain}
          onClose={() => setManagerOpen(false)}
          paramsScope={props.paramsScope}
          getModelParams={props.getModelParams}
          setModelParams={props.setModelParams}
        />
      ) : null}
    </div>
  );
}
