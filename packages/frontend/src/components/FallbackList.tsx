import { Fragment, useRef, useState, type DragEvent } from 'react';
import { X } from 'lucide-react';
import {
  clearFallbacks,
  setFallbacks,
  type AuthType,
  type AvailableModel,
  type CustomProviderData,
  type ModelRoute,
  type RequestParamDefaults,
  type ResponseMode,
  type RoutingProvider,
} from '../services/api.js';
import { customProviderColor } from '../services/formatters.js';
import { getModelLabel } from '../services/provider-utils.js';
import { PROVIDERS } from '../services/providers.js';
import {
  resolveProviderId,
  stripCustomPrefix,
  type RouteSlots,
  usedKeyLabelsForModelInTier,
} from '../services/routing-utils.js';
import { toast } from '../services/toast-store.js';
import { t } from '../i18n/index.js';
import { authBadgeFor } from './AuthBadge.js';
import { providerIcon, customProviderLogo } from './ProviderIcon.js';
import ModelParamsAffordance from './ModelParamsAffordance.jsx';
import RouteKeyChip from './RouteKeyChip.js';
import { cx } from './ui.js';
import { modelParamsScopeForTier } from 'thinker-shared';

interface FallbackListProps {
  agentName: string;
  tier: string;
  tierData?: RouteSlots;
  fallbacks: string[];
  // Optional structured route per fallback. When present (length matches
  // fallbacks), each row renders provider/auth from the route instead of
  // re-deriving them from `models`/`connectedProviders` — this fixes the
  // same-name-different-auth ambiguity reported in issue #1708 without
  // changing the visible UI for users whose data has been backfilled.
  fallbackRoutes?: ModelRoute[] | null;
  responseMode?: ResponseMode;
  models: AvailableModel[];
  customProviders: CustomProviderData[];
  connectedProviders: RoutingProvider[];
  // FallbackList always passes both arguments. The second is optional in the
  // signature so parents whose optimistic-state model doesn't track
  // fallback_routes separately can omit it and still type-check; the next
  // list refresh from the server fills routes back in.
  onUpdate: (updatedFallbacks: string[], updatedRoutes?: ModelRoute[] | null) => void;
  onAddFallback: () => void;
  adding?: boolean;
  primaryDragging?: boolean;
  onPrimaryDropAtSlot?: (slot: number) => void;
  onFallbackDragStart?: (index: number) => void;
  onFallbackDragEnd?: () => void;
  persistFallbacks?: (
    agentName: string,
    tier: string,
    models: string[],
    routes?: ModelRoute[],
  ) => Promise<unknown>;
  persistClearFallbacks?: (agentName: string, tier: string) => Promise<unknown>;
  /**
   * Per-route params getter, threaded from the routing page boundary. When
   * present, every fallback row whose provider consumes a known param key
   * renders a `<ModelParamsAffordance>` for its own `(provider, authType,
   * model)` tuple. Saving from a fallback row updates the parent's cache
   * just like saving from the primary chip does.
   */
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
  swappingIndex?: number | null;
  /**
   * Notified when a reorder-drop starts and finishes persisting. The parent
   * uses it to lock its own drag sources (the primary chip) for the duration,
   * so a second swap can't be started against a tier whose fallback order is
   * still being written.
   */
  onReorderingChange?: (reordering: boolean) => void;
  modelParamsScope?: string;
}

function FallbackUndoIcon({ size, className }: { size: 20 | 16; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M9 10h6c2.21 0 4 1.79 4 4s-1.79 4-4 4h-3v2h3c3.31 0 6-2.69 6-6s-2.69-6-6-6H9V4L3 9l6 5z" />
    </svg>
  );
}

const addButtonClass = 'btn btn-ghost btn-sm fallback-list__add self-start';

export default function FallbackList(props: FallbackListProps) {
  const [removingIndex, setRemovingIndex] = useState<number | null>(null);
  const [dragIndex, setDragIndexState] = useState<number | null>(null);
  const [dropSlot, setDropSlotState] = useState<number | null>(null);
  const [reorderingIndex, setReorderingIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Drag handlers read the latest drag state synchronously (dragover fires
  // before React re-renders), so mirror it in refs.
  const dragIndexRef = useRef<number | null>(null);
  const dropSlotRef = useRef<number | null>(null);
  const setDragIndex = (value: number | null) => {
    dragIndexRef.current = value;
    setDragIndexState(value);
  };
  const setDropSlot = (value: number | null) => {
    dropSlotRef.current = value;
    setDropSlotState(value);
  };

  /**
   * A row whose new position is still being persisted. Covers both the
   * primary/fallback swap driven by the parent (`swappingIndex`) and a
   * reorder inside this list, which used to persist with no feedback at all.
   */
  const isPending = (index: number): boolean =>
    props.swappingIndex === index || reorderingIndex === index;

  /**
   * True while any drag-initiated update for this tier is in flight. Rows stay
   * put until it resolves, so a retry-because-nothing-happened drag can't fire
   * a second overlapping write against the same tier. Also gates every other
   * fallback mutation (remove, key-pin, add) for the duration: each of those
   * persists the full fallback list independently, so one firing while a
   * reorder's `persistSet` is still in flight is a race, and whichever
   * response lands last silently overwrites the other's write.
   */
  const dragLocked = props.swappingIndex != null || reorderingIndex !== null;

  const modelLabel = (model: string): string => {
    const info = props.models.find((m) => m.model_name === model);
    if (info?.display_name) return info.display_name;
    if (info) {
      const provId = resolveProviderId(info.provider);
      if (provId) return getModelLabel(provId, model);
    }
    return stripCustomPrefix(model);
  };
  const modelParamsScope = props.modelParamsScope ?? modelParamsScopeForTier(props.tier);

  const modelInfoFor = (model: string, index: number): AvailableModel | undefined => {
    const route = props.fallbackRoutes?.[index];
    if (route) {
      const routeProvider = resolveProviderId(route.provider)?.toLowerCase();
      const routeMatch = props.models.find((m) => {
        const modelProvider = resolveProviderId(m.provider)?.toLowerCase();
        return (
          m.model_name === route.model &&
          modelProvider === routeProvider &&
          (!m.auth_type || m.auth_type === route.authType)
        );
      });
      if (routeMatch) return routeMatch;
    }
    return (
      props.models.find((m) => m.model_name === model) ??
      props.models.find((m) => m.model_name.startsWith(model + '-'))
    );
  };

  const skippedInStream = (model: string, index: number): boolean =>
    props.responseMode === 'stream' &&
    !(modelInfoFor(model, index)?.capabilities?.includes('stream') ?? false);

  /**
   * Active labeled keys for (provider, auth_type), sorted by priority. Used
   * to decide whether to render the key chip on a fallback row — chip only
   * shows when 2+ keys exist (single-key users see the row exactly as
   * before).
   */
  const keysForFallback = (
    providerId: string | undefined,
    auth: string | null,
  ): RoutingProvider[] => {
    if (!providerId || !auth || auth === 'local') return [];
    return props.connectedProviders
      .filter(
        (p) =>
          p.provider.toLowerCase() === providerId.toLowerCase() &&
          p.auth_type === auth &&
          p.is_active &&
          p.has_api_key,
      )
      .slice()
      .sort((a, b) => a.priority - b.priority);
  };

  const persistSet = props.persistFallbacks ?? setFallbacks;
  const persistClear = props.persistClearFallbacks ?? clearFallbacks;

  /**
   * Update the keyLabel pin on a single fallback row. Reads/writes through the
   * structured `fallbackRoutes` so the persisted shape stays canonical
   * (ModelRoute[] with `keyLabel`); the encoded string list is rebuilt to
   * keep optimistic-update parents that still consume `string[]` working.
   */
  const setLabelAt = async (index: number, newLabel: string | null) => {
    const original = [...props.fallbacks];
    const originalRoutes = props.fallbackRoutes ? [...props.fallbackRoutes] : null;
    const updatedRoutes: ModelRoute[] | null = originalRoutes
      ? originalRoutes.map((r, i) =>
          i === index ? ({ ...r, keyLabel: newLabel ?? null } as ModelRoute) : r,
        )
      : null;
    // Bare model names — no `||<label>` encoding now that the structured
    // `fallbackRoutes` carries keyLabel directly. The model list is just for
    // the optimistic-update parents that still consume `string[]`; the
    // canonical persisted shape is the route array.
    const updated = [...props.fallbacks];
    props.onUpdate(updated, updatedRoutes);
    try {
      await persistSet(props.agentName, props.tier, updated, updatedRoutes ?? undefined);
      toast.success(
        newLabel
          ? t('routing.fallbacks.pinned', { label: newLabel })
          : t('routing.fallbacks.pinCleared'),
      );
    } catch {
      props.onUpdate(original, originalRoutes);
    }
  };

  const providerIdFor = (model: string, index: number): string | undefined => {
    const route = props.fallbackRoutes?.[index];
    if (route) return resolveProviderId(route.provider);
    const info = props.models.find((m) => m.model_name === model);
    if (info) return resolveProviderId(info.provider);
    return undefined;
  };

  const authTypeFor = (providerId: string | undefined, index: number): string | null => {
    const route = props.fallbackRoutes?.[index];
    if (route) return route.authType;
    if (!providerId) return null;
    const provs = props.connectedProviders.filter(
      (p) => p.provider.toLowerCase() === providerId.toLowerCase(),
    );
    if (provs.some((p) => p.auth_type === 'subscription')) return 'subscription';
    if (provs.some((p) => p.auth_type === 'api_key')) return 'api_key';
    return null;
  };

  const providerTitle = (providerId: string | undefined, authType: string | null): string => {
    if (!providerId) return '';
    const provDef = PROVIDERS.find((p) => p.id === providerId);
    const name = provDef?.name ?? providerId;
    const method =
      authType === 'subscription'
        ? t('routing.fallbacks.subscription')
        : t('routing.fallbacks.apiKey');
    return `${name} (${method})`;
  };

  const reorderRoutes = (
    routes: ModelRoute[] | null | undefined,
    transform: (r: ModelRoute[]) => ModelRoute[],
  ): ModelRoute[] | null => {
    if (!routes || routes.length === 0) return null;
    const next = transform([...routes]);
    return next.length > 0 ? next : null;
  };

  const handleRemove = async (index: number) => {
    setRemovingIndex(index);
    const original = [...props.fallbacks];
    const originalRoutes = props.fallbackRoutes ? [...props.fallbackRoutes] : null;
    const updated = props.fallbacks.filter((_, i) => i !== index);
    const updatedRoutes = reorderRoutes(props.fallbackRoutes, (rs) =>
      rs.filter((_, i) => i !== index),
    );
    props.onUpdate(updated, updatedRoutes);
    try {
      if (updated.length === 0) {
        await persistClear(props.agentName, props.tier);
      } else {
        await persistSet(props.agentName, props.tier, updated, updatedRoutes ?? undefined);
      }
      toast.success(t('routing.fallbacks.removed'));
    } catch {
      props.onUpdate(original, originalRoutes);
    } finally {
      setRemovingIndex(null);
    }
  };

  const handleDragStart = (index: number, e: DragEvent) => {
    setDragIndex(index);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
      e.dataTransfer.setData('application/x-fallback', String(index));
    }
    props.onFallbackDragStart?.(index);
  };

  /**
   * Compute the drop slot from cursor Y relative to card positions.
   * This runs on the container so it works even when hovering
   * the gaps between cards or the indicator divs.
   */
  const computeSlot = (clientY: number): number | null => {
    const list = listRef.current;
    if (!list) return null;
    const from = dragIndexRef.current;
    const isPrimaryDrag = props.primaryDragging && from === null;
    if (from === null && !isPrimaryDrag) return null;

    const cards = list.querySelectorAll<HTMLElement>('.fallback-list__card');
    if (cards.length === 0) return isPrimaryDrag ? 0 : null;

    // Find which slot the cursor is closest to.
    // Slots are: before card 0, between card 0 and 1, ..., after last card.
    let slot = cards.length; // default: after the last card
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i]!.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (clientY < midY) {
        slot = i;
        break;
      }
    }

    // Don't show indicator at the dragged item's current position (no-op move)
    if (!isPrimaryDrag && (slot === from || slot === from! + 1)) return null;
    return slot;
  };

  const handleContainerDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    setDropSlot(computeSlot(e.clientY));
  };

  const handleContainerDragLeave = (e: DragEvent) => {
    // DragEvent.relatedTarget can be null while crossing children. Fall back
    // to the pointer coordinates so an internal transition does not erase the
    // pending drop slot before the browser dispatches drop.
    const related = e.relatedTarget;
    if (related instanceof Node && listRef.current?.contains(related)) return;

    const bounds = listRef.current?.getBoundingClientRect();
    const pointerIsOutside =
      !bounds ||
      e.clientX < bounds.left ||
      e.clientX > bounds.right ||
      e.clientY < bounds.top ||
      e.clientY > bounds.bottom;
    if (related instanceof Node || pointerIsOutside) {
      setDropSlot(null);
    }
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    const fromIndex = dragIndexRef.current;
    const toSlot = dropSlotRef.current;
    setDragIndex(null);
    setDropSlot(null);

    // Primary model dropped into fallback list
    if (props.primaryDragging && fromIndex === null && toSlot !== null) {
      props.onPrimaryDropAtSlot?.(toSlot);
      return;
    }

    if (fromIndex === null || toSlot === null) return;

    const insertAt = toSlot > fromIndex ? toSlot - 1 : toSlot;
    if (insertAt === fromIndex) return;

    const original = [...props.fallbacks];
    const originalRoutes = props.fallbackRoutes ? [...props.fallbackRoutes] : null;
    const reordered = [...props.fallbacks];
    const moved = reordered.splice(fromIndex, 1)[0]!;
    reordered.splice(insertAt, 0, moved);
    const reorderedRoutes = reorderRoutes(props.fallbackRoutes, (rs) => {
      const movedRoute = rs.splice(fromIndex, 1)[0]!;
      rs.splice(insertAt, 0, movedRoute);
      return rs;
    });

    props.onUpdate(reordered, reorderedRoutes);
    setReorderingIndex(insertAt);
    props.onReorderingChange?.(true);
    try {
      await persistSet(props.agentName, props.tier, reordered, reorderedRoutes ?? undefined);
      toast.success(t('routing.fallbacks.orderUpdated'));
    } catch {
      props.onUpdate(original, originalRoutes);
    } finally {
      setReorderingIndex(null);
      props.onReorderingChange?.(false);
    }
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDropSlot(null);
    props.onFallbackDragEnd?.();
  };

  const indicatorClass = (active: boolean) =>
    cx(
      'fallback-list__drop-indicator h-0.5 rounded-full transition-colors',
      active ? 'fallback-list__drop-indicator--active bg-accent' : 'bg-transparent',
    );

  const renderCustomIcon = (provId: string | undefined, model: string) => {
    const cp = props.customProviders.find((c) => `custom:${c.id}` === provId);
    const logo = customProviderLogo(cp?.name ?? '', 14, cp?.base_url, model);
    const title = cp?.name ?? t('routing.fallbacks.custom');
    if (logo) {
      return (
        <span className="fallback-list__icon inline-flex shrink-0" title={title}>
          {logo}
        </span>
      );
    }
    return (
      <span
        className="provider-card__logo-letter fallback-list__icon inline-flex size-3.5 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold text-on-accent"
        title={title}
        style={{ background: customProviderColor(cp?.name ?? '') }}
      >
        {(cp?.name ?? 'C').charAt(0).toUpperCase()}
      </span>
    );
  };

  const addLabel = (
    <>
      <FallbackUndoIcon size={16} />
      {t('routing.fallbacks.add')}
    </>
  );

  return (
    <div className="fallback-list flex flex-col gap-2">
      {props.fallbacks.length > 0 || props.primaryDragging ? (
        <div
          ref={listRef}
          className="fallback-list__items flex flex-col gap-1"
          onDragOver={handleContainerDragOver}
          onDragLeave={handleContainerDragLeave}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
        >
          {props.fallbacks.map((entry, i) => {
            // Each fallback row reads its model + (optional) keyLabel pin
            // from the structured `fallbackRoutes`, which is the canonical
            // location for the pin now that `||<label>` encoding has been
            // dropped. The bare `entry` string carries only the model name.
            const model = entry;
            const route = props.fallbackRoutes?.[i];
            const pinnedLabel = route?.keyLabel ?? null;
            const provId = providerIdFor(model, i);
            const isCustom = provId?.startsWith('custom:');
            const auth = authTypeFor(provId, i);
            const title = providerTitle(provId, auth);
            const keys = keysForFallback(provId, auth);
            const skipped = skippedInStream(model, i);
            const pending = isPending(i);
            const label = modelLabel(model);
            return (
              <Fragment key={`${i}-${entry}`}>
                <div className={indicatorClass(dropSlot === i)} />
                <div
                  className={cx(
                    'fallback-list__card flex min-h-9 items-center gap-2 rounded-control border border-line bg-elev px-2.5 py-1.5 text-sm',
                    !dragLocked && 'cursor-grab',
                    dragIndex === i && 'fallback-list__card--dragging',
                    pending && 'fallback-list__card--swapping',
                    skipped && 'fallback-list__card--skipped opacity-60',
                  )}
                  title={skipped ? t('routing.skippedWhileStream') : undefined}
                  draggable={!dragLocked}
                  onDragStart={(e) => handleDragStart(i, e)}
                  // Bind dragend on the draggable row itself rather than only
                  // on the container. When a fallback row is dropped onto the
                  // primary slot (outside this container), the container's
                  // onDragEnd doesn't always fire — the row gets re-rendered
                  // with a new model name as part of the optimistic swap, the
                  // drag source unmounts, and the container loses the bubbled
                  // event. Result: dragIndex stays set and the row keeps the
                  // --dragging class until the next refetch. Resetting on the
                  // row itself catches every drop target.
                  onDragEnd={handleDragEnd}
                >
                  {pending ? (
                    <>
                      <span className="skel size-3.5 shrink-0 rounded-full" />
                      <span className="skel h-3 w-[100px]" />
                    </>
                  ) : (
                    <>
                      {provId && !isCustom ? (
                        <span
                          className="fallback-list__icon relative inline-flex shrink-0"
                          title={title}
                        >
                          {providerIcon(provId, 14)}
                          {authBadgeFor(auth, 8)}
                        </span>
                      ) : null}
                      {isCustom ? renderCustomIcon(provId, model) : null}
                      <span className="fallback-list__model min-w-0 flex-1 truncate text-ink">
                        {label}
                      </span>
                      {skipped ? (
                        <span className="routing-card__skipped-badge badge is-warn">
                          {t('routing.skippedInStream')}
                        </span>
                      ) : null}
                      {keys.length > 1 ? (
                        <RouteKeyChip
                          keys={keys}
                          currentLabel={pinnedLabel ?? undefined}
                          modelLabel={label}
                          usedLabels={usedKeyLabelsForModelInTier(
                            props.tierData,
                            model,
                            i,
                            keys[0]?.label,
                          )}
                          buttonClass="fallback-list__key-chip"
                          allowClear
                          disabled={dragLocked}
                          onPick={(picked) => setLabelAt(i, picked)}
                        />
                      ) : null}
                      {props.getModelParams &&
                      props.setModelParams &&
                      provId &&
                      auth &&
                      auth !== 'local' ? (
                        <ModelParamsAffordance
                          provider={provId}
                          authType={(auth as AuthType) ?? undefined}
                          model={model}
                          slotLabel={label}
                          scope={modelParamsScope}
                          agentName={props.agentName}
                          getParams={props.getModelParams}
                          setParams={props.setModelParams}
                        />
                      ) : null}
                      <button
                        type="button"
                        className="fallback-list__remove icon-btn size-6 shrink-0"
                        onClick={() => handleRemove(i)}
                        title={t('routing.fallbacks.removeTitle')}
                        aria-label={t('routing.fallbacks.removeModel', { model: label })}
                        disabled={removingIndex !== null || dragLocked}
                      >
                        {removingIndex === i ? (
                          <span className="spinner size-2.5" />
                        ) : (
                          <X className="size-3" aria-hidden="true" />
                        )}
                      </button>
                    </>
                  )}
                </div>
              </Fragment>
            );
          })}
          <div className={indicatorClass(dropSlot === props.fallbacks.length)} />
        </div>
      ) : null}
      {props.fallbacks.length > 0 ? (
        props.fallbacks.length < 5 ? (
          <button
            type="button"
            className={addButtonClass}
            onClick={props.onAddFallback}
            disabled={props.adding || removingIndex !== null || dragLocked}
          >
            {props.adding ? <span className="spinner" /> : addLabel}
          </button>
        ) : null
      ) : (
        <div className="fallback-list__empty flex flex-col items-start gap-1 rounded-control border border-dashed border-line px-3 py-3 text-sm">
          <FallbackUndoIcon size={20} className="fallback-list__empty-icon text-faint" />
          <span className="fallback-list__empty-title font-medium text-ink">
            {t('routing.fallbacks.emptyTitle')}
          </span>
          <span className="fallback-list__empty-desc text-xs text-muted">
            {t('routing.fallbacks.emptyDesc')}
          </span>
          <button
            type="button"
            className={cx(addButtonClass, 'mt-1')}
            onClick={props.onAddFallback}
            disabled={props.adding}
          >
            {props.adding ? <span className="spinner" /> : addLabel}
          </button>
        </div>
      )}
    </div>
  );
}
