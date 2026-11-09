import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ChevronDown, ChevronUp, GripVertical, Route, X } from 'lucide-react';
import type {
  AuthType,
  AvailableModel,
  CustomProviderData,
  ModelCapability,
  ModelRoute,
  RequestParamDefaults,
  RoutingProvider,
} from '../services/api.js';
import { PROVIDERS } from '../services/providers.js';
import { customProviderColor } from '../services/formatters.js';
import { providerIcon, customProviderLogo } from './ProviderIcon.js';
import { authBadgeFor } from './AuthBadge.js';
import ModelPickerModal from './ModelPickerModal.js';
import ModelParamsAffordance from './ModelParamsAffordance.jsx';
import { AuthIcon, routeAccountLabel } from './RouteAccount.js';
import { beginRouteDrag, registerRouteDropZone, type RouteDragPayload } from './route-drag.js';
import { toast } from '../services/toast-store.js';
import { t } from '../i18n/index.js';
import { FloatingWindow, cx } from './ui.js';

/** Primary + 5 fallbacks. */
const MAX_ROUTES = 6;

export interface ModelChainManagerProps {
  agentName: string;
  chainId: string;
  chainName: string;
  /** Current chain: primary first, then the fallbacks. */
  routes: ModelRoute[];
  models: AvailableModel[];
  customProviders: CustomProviderData[];
  connectedProviders: RoutingProvider[];
  requiredCapability?: ModelCapability;
  /** Persists the whole chain; an empty list clears it. */
  onSave: (routes: ModelRoute[]) => Promise<void>;
  onClose: () => void;
  /** Model params scope of the chain (`header:<id>`, `virtual:<id>`, tier). */
  paramsScope?: string;
  /** Per-route request params; each flow row gets the params affordance when set. */
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

/** Comparable form of a chain: what the server stores for each route. */
const chainKey = (routes: ModelRoute[]): string =>
  routes
    .map((r) => `${r.provider.toLowerCase()}|${r.authType}|${r.model}|${r.keyLabel ?? ''}`)
    .join('\n');

const sameRoute = (a: ModelRoute, b: ModelRoute): boolean =>
  a.model === b.model &&
  a.provider.toLowerCase() === b.provider.toLowerCase() &&
  a.authType === b.authType &&
  (a.keyLabel ?? '') === (b.keyLabel ?? '');

/**
 * Non-modal window to build a route chain: the flow (primary on top, then the
 * fallbacks) on the left, the model catalog on the right. Models are dragged
 * from the catalog into any gap of the flow; flow rows are dragged to reorder.
 * Every change is saved at once.
 */
export default function ModelChainManager(props: ModelChainManagerProps) {
  const [routes, setRoutes] = useState<ModelRoute[]>(props.routes);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  /**
   * Chain this window saved and is waiting to see back from the server. One
   * save is two requests (primary, then fallbacks) and the page reloads after
   * each, so the props pass through a half-saved chain; following them made
   * the rows flicker. While a chain is pending, reloads that differ from it
   * are ignored; the first one that matches ends the wait.
   */
  const pendingRef = useRef<{ key: string; settled: boolean } | null>(null);
  const latestPropsRef = useRef(props.routes);
  latestPropsRef.current = props.routes;
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  // Follow the saved chain when the page reloads it.
  const propsKey = chainKey(props.routes);
  useEffect(() => {
    const pending = pendingRef.current;
    if (pending) {
      if (pending.key !== propsKey) return;
      if (pending.settled) pendingRef.current = null;
      return;
    }
    setRoutes(props.routes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propsKey]);

  const commit = async (next: ModelRoute[]) => {
    const previous = routes;
    const key = chainKey(next);
    pendingRef.current = { key, settled: false };
    if (settleTimer.current) clearTimeout(settleTimer.current);
    setRoutes(next);
    setStatus('saving');
    try {
      await props.onSave(next);
      if (pendingRef.current?.key !== key) return; // a newer change took over
      setStatus('saved');
      if (chainKey(latestPropsRef.current) === key) {
        pendingRef.current = null;
        return;
      }
      pendingRef.current = { key, settled: true };
      // If the server stores the chain differently, stop waiting and show its version.
      settleTimer.current = setTimeout(() => {
        if (pendingRef.current?.key !== key) return;
        pendingRef.current = null;
        setRoutes(latestPropsRef.current);
      }, 4000);
    } catch {
      if (pendingRef.current?.key !== key) return;
      pendingRef.current = null;
      // The API error is already on screen; show the saved chain again.
      setRoutes(previous);
      setStatus('failed');
    }
  };

  const insertRoute = (route: ModelRoute, index: number) => {
    if (routes.some((r) => sameRoute(r, route))) {
      toast.error(t('routing.manager.duplicate'));
      return;
    }
    if (routes.length >= MAX_ROUTES) {
      toast.error(t('routing.manager.full'));
      return;
    }
    const next = [...routes];
    next.splice(Math.min(index, next.length), 0, route);
    void commit(next);
  };

  const moveRoute = (from: number, to: number) => {
    // `to` is a gap index (0..length); removing `from` shifts later gaps.
    const target = to > from ? to - 1 : to;
    if (target === from) return;
    const next = [...routes];
    const [item] = next.splice(from, 1);
    next.splice(target, 0, item!);
    void commit(next);
  };

  const removeRoute = (index: number) => {
    void commit(routes.filter((_, i) => i !== index));
  };

  /**
   * Gap the pointer points at: the number of flow items whose middle is above
   * it. The whole flow column is one drop target, so dropping on an item (its
   * upper or lower half) works as well as dropping on a gap.
   */
  const gapAt = (clientY: number): number => {
    const items = listRef.current?.querySelectorAll<HTMLElement>('[data-flow-item]') ?? [];
    let index = 0;
    for (const el of items) {
      const rect = el.getBoundingClientRect();
      if (clientY > rect.top + rect.height / 2) index += 1;
    }
    return index;
  };

  const handleDrop = (payload: RouteDragPayload, clientY: number) => {
    const index = gapAt(clientY);
    setDropIndex(null);
    if (payload.kind === 'flow') moveRoute(payload.index, index);
    else insertRoute(payload.route, index);
  };

  // The zone is registered once; the ref always points at this render's handlers.
  const dropRef = useRef(handleDrop);
  dropRef.current = handleDrop;
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    return registerRouteDropZone({
      el,
      onHover: (clientY) => setDropIndex(clientY === null ? null : gapAt(clientY)),
      onDrop: (payload, clientY) => dropRef.current(payload, clientY),
    });
  }, []);

  const modelInfo = (r: ModelRoute): AvailableModel | undefined =>
    props.models.find(
      (m) => m.model_name === r.model && m.provider.toLowerCase() === r.provider.toLowerCase(),
    ) ?? props.models.find((m) => m.model_name === r.model);

  const providerName = (provId: string): string => {
    if (provId.startsWith('custom:')) {
      return props.customProviders.find((c) => `custom:${c.id}` === provId)?.name ?? provId;
    }
    return PROVIDERS.find((p) => p.id === provId)?.name ?? provId;
  };

  const authText = (a: AuthType): string =>
    a === 'subscription'
      ? t('models.picker.subscription')
      : a === 'local'
        ? t('models.picker.local')
        : t('models.picker.usageBased');

  const accountText = (r: ModelRoute): string => routeAccountLabel(r, props.connectedProviders);

  const renderIcon = (r: ModelRoute) => {
    const provId = r.provider.toLowerCase();
    if (provId.startsWith('custom:')) {
      const name = providerName(provId);
      return (
        customProviderLogo(name, 24) ?? (
          <span
            className="inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold text-on-accent"
            style={{ background: customProviderColor(provId.slice('custom:'.length)) }}
          >
            {name.charAt(0).toUpperCase()}
          </span>
        )
      );
    }
    return (
      <span className="relative inline-flex">
        {providerIcon(provId, 24)}
        {authBadgeFor(r.authType, 10)}
      </span>
    );
  };

  /** A gap of the flow: an arrow at rest, an accent line where a drop lands. Fixed height, so
   * highlighting it never shifts the items under the pointer. */
  const renderGap = (index: number, arrow: boolean) => (
    <div
      key={`gap-${index}`}
      className="chain-manager__gap relative flex h-5 items-center justify-center text-faint"
    >
      {dropIndex === index ? (
        <span className="chain-manager__gap-line absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-accent" />
      ) : arrow ? (
        <ArrowDown aria-hidden="true" className="size-3.5" />
      ) : null}
    </div>
  );

  const flow = (
    <div className="chain-manager__flow flex h-full min-h-0 flex-col gap-2">
      <div>
        <h3 className="text-sm font-semibold text-ink">{t('routing.manager.flow')}</h3>
        <p className="text-xs text-muted">{t('routing.manager.flowHint')}</p>
      </div>
      <div
        ref={listRef}
        className="chain-manager__flow-list flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        {routes.length === 0 ? (
          <div
            className={cx(
              'chain-manager__empty flex h-32 items-center justify-center rounded-control border border-dashed p-4 text-center text-sm',
              dropIndex === 0
                ? 'border-accent bg-accent-tint text-accent'
                : 'border-line text-muted',
            )}
          >
            {t('routing.manager.dropEmpty')}
          </div>
        ) : (
          <>
            {renderGap(0, false)}
            {routes.map((r, i) => {
              const info = modelInfo(r);
              const label = info?.display_name ?? r.model;
              const provId = r.provider.toLowerCase();
              return (
                <div key={`${r.provider}|${r.authType}|${r.model}|${r.keyLabel ?? ''}`}>
                  <div
                    className="chain-manager__item flex cursor-grab select-none items-center gap-2 rounded-control border border-line bg-sunken p-2 hover:border-line-strong"
                    data-flow-item
                    onPointerDown={(e) => {
                      // The row's own buttons (move, remove) keep their clicks.
                      if ((e.target as HTMLElement).closest('button')) return;
                      beginRouteDrag(e, { kind: 'flow', index: i }, label);
                    }}
                  >
                    <GripVertical
                      aria-hidden="true"
                      className="chain-manager__grip size-4 shrink-0 cursor-grab text-faint"
                    />
                    <span className="inline-flex shrink-0">{renderIcon(r)}</span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-ink" title={r.model}>
                          {label}
                        </span>
                      </span>
                      <span
                        className="chain-manager__account mt-0.5 flex min-w-0 items-center gap-1 text-xs font-medium text-ink"
                        title={`${providerName(provId)} · ${authText(r.authType)} · ${accountText(r)}`}
                      >
                        <AuthIcon authType={r.authType} />
                        <span className="truncate">{accountText(r)}</span>
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center">
                      {props.paramsScope &&
                      props.getModelParams &&
                      props.setModelParams &&
                      r.authType !== 'local' ? (
                        <ModelParamsAffordance
                          provider={provId}
                          authType={r.authType}
                          model={r.model}
                          slotLabel={label}
                          scope={props.paramsScope}
                          agentName={props.agentName}
                          getParams={props.getModelParams}
                          setParams={props.setModelParams}
                        />
                      ) : null}
                      <button
                        type="button"
                        className="icon-btn size-6"
                        disabled={i === 0 || status === 'saving'}
                        onClick={() => moveRoute(i, i - 1)}
                        aria-label={t('routing.manager.moveUp')}
                        title={t('routing.manager.moveUp')}
                      >
                        <ChevronUp aria-hidden="true" className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        className="icon-btn size-6"
                        disabled={i === routes.length - 1 || status === 'saving'}
                        onClick={() => moveRoute(i, i + 2)}
                        aria-label={t('routing.manager.moveDown')}
                        title={t('routing.manager.moveDown')}
                      >
                        <ChevronDown aria-hidden="true" className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        className="icon-btn size-6"
                        disabled={status === 'saving'}
                        onClick={() => removeRoute(i)}
                        aria-label={t('routing.manager.remove', { name: label })}
                        title={t('routing.manager.remove', { name: label })}
                      >
                        <X aria-hidden="true" className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  {renderGap(i + 1, i < routes.length - 1)}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );

  return (
    <FloatingWindow
      open
      title={t('routing.manager.title', { name: props.chainName })}
      icon={<Route aria-hidden="true" className="size-4" />}
      onClose={props.onClose}
      className="chain-manager floating-window--xwide"
      footer={
        <span className="mr-auto self-center text-xs text-muted" aria-live="polite">
          {status === 'saving'
            ? t('routing.manager.saving')
            : status === 'saved'
              ? t('routing.manager.saved')
              : status === 'failed'
                ? t('routing.manager.saveFailed')
                : ''}
        </span>
      }
    >
      <div className="chain-manager__layout grid h-full min-h-0 grid-cols-1 gap-4 md:grid-cols-[minmax(280px,2fr)_3fr]">
        {flow}
        <div className="chain-manager__catalog flex min-h-0 min-w-0 flex-col gap-2 md:border-l md:border-line md:pl-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">{t('routing.manager.catalog')}</h3>
            <p className="text-xs text-muted">{t('routing.manager.catalogHint')}</p>
          </div>
          <ModelPickerModal
            embedded
            draggableRows
            tierId={props.chainId}
            agentName={props.agentName}
            models={props.models}
            tiers={[]}
            customProviders={props.customProviders}
            connectedProviders={props.connectedProviders}
            requiredCapability={props.requiredCapability}
            onClose={props.onClose}
            onSelect={(_tier, model, provider, authType, keyLabel) =>
              insertRoute(
                keyLabel
                  ? { model, provider, authType: authType ?? 'api_key', keyLabel }
                  : { model, provider, authType: authType ?? 'api_key' },
                routes.length,
              )
            }
          />
        </div>
      </div>
    </FloatingWindow>
  );
}
