import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Layers } from 'lucide-react';
import HeaderTierCard from '../components/HeaderTierCard.js';
import HeaderTierSnippetModal from '../components/HeaderTierSnippetModal.js';
import { Button, Modal, cx } from '../components/ui.js';
import {
  listHeaderTiers,
  deleteHeaderTier,
  overrideHeaderTier,
  setHeaderTierResponseMode,
  toggleHeaderTier,
  type HeaderTier,
} from '../services/api/header-tiers.js';
import type {
  AvailableModel,
  AuthType,
  CustomProviderData,
  ModelRoute,
  RequestParamDefaults,
  ResponseMode,
  RoutingProvider,
} from '../services/api.js';
import { toast } from '../services/toast-store.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';

// The create/edit header-tier modal only mounts on click. Lazy-load it so the
// Routing route's custom-tiers section stays lean.
const HeaderTierModal = lazy(() => import('../components/HeaderTierModal.js'));

type TiersMutator = (prev: HeaderTier[] | undefined) => HeaderTier[] | undefined;

export interface RoutingHeaderTiersSectionProps {
  agentName: string;
  models: AvailableModel[];
  customProviders: CustomProviderData[];
  connectedProviders: RoutingProvider[];
  /**
   * Tiers owned by the parent. `undefined` (or absent) makes the section load
   * its own list; `null` means the parent owns the list but it is still loading.
   */
  externalTiers?: HeaderTier[] | null;
  externalRefetch?: () => void;
  externalMutate?: (mutator: TiersMutator) => void;
  embedded?: boolean;
  /**
   * When true, the section renders only its modals (manage, create/edit,
   * snippet) without the card grid or header. The parent is responsible for
   * rendering the cards and triggering modal opens via the `onOpenRef`
   * callback. Used by the unified routing view for clean agents.
   */
  headless?: boolean;
  /**
   * Called once with an opener function the parent can use to trigger the
   * manage-or-create modal. Only meaningful when `headless` is true.
   */
  onOpenRef?: (opener: () => void) => void;
  /**
   * Called once with a function to open the create modal directly.
   * Only meaningful when `headless` is true.
   */
  onCreateRef?: (opener: () => void) => void;
  /**
   * Called once with a function to open the edit modal for a specific tier.
   * Only meaningful when `headless` is true.
   */
  onEditRef?: (opener: (tier: HeaderTier) => void) => void;
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

export default function RoutingHeaderTiersSection(props: RoutingHeaderTiersSectionProps) {
  const external = props.externalTiers !== undefined;
  const internal = useResource(
    () =>
      listHeaderTiers(props.agentName).catch((err) => {
        toast.error(err instanceof Error ? err.message : t('routing.headerTiers.loadFailed'));
        return [] as HeaderTier[];
      }),
    [props.agentName],
    { enabled: !external },
  );

  const refetch = () => {
    if (props.externalRefetch) props.externalRefetch();
    else void internal.reload();
  };

  const mutate = (update: TiersMutator) => {
    if (props.externalMutate) props.externalMutate(update);
    else internal.setData(update);
  };

  // Apply an optimistic update to the resource so the UI reflects fallback
  // changes immediately, mirroring the tier path. Without this the refetch
  // races the persist call and shows stale data on first click.
  // When the caller doesn't know the new routes (e.g. tier reset, which also
  // clears override_route), fall back to a refetch.
  const applyFallbackUpdate = (
    tierId: string,
    updatedRoutes: ModelRoute[] | null | undefined,
  ): void => {
    if (updatedRoutes === undefined) {
      refetch();
      return;
    }
    mutate((prev) =>
      prev?.map((tier) =>
        tier.id === tierId ? { ...tier, fallback_routes: updatedRoutes } : tier,
      ),
    );
  };

  const [manageOpen, setManageOpen] = useState(false);
  // Create/edit modal: `null` = closed, `'new'` = create, otherwise editing.
  const [modalTier, setModalTier] = useState<HeaderTier | 'new' | null>(null);
  // After a tier is freshly created, auto-open the SDK snippet modal.
  const [snippetTier, setSnippetTier] = useState<HeaderTier | null>(null);
  // Which tier is currently being toggled (loading state).
  const [toggling, setToggling] = useState<string | null>(null);
  const togglingRef = useRef<string | null>(null);
  const [changingResponseMode, setChangingResponseMode] = useState<string | null>(null);

  const tiers: HeaderTier[] = (external ? props.externalTiers : internal.data) ?? [];
  const enabledTiers = tiers.filter((tier) => tier.enabled);

  const handleOverride = async (
    id: string,
    model: string,
    provider: string,
    authType?: AuthType,
    providerKeyLabel?: string,
  ): Promise<void> => {
    try {
      await overrideHeaderTier(props.agentName, id, model, provider, authType, providerKeyLabel);
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('routing.updateTierFailed'));
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    try {
      await deleteHeaderTier(props.agentName, id);
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('routing.deleteTierFailed'));
    }
  };

  const handleToggle = async (id: string, enabled: boolean): Promise<void> => {
    togglingRef.current = id;
    setToggling(id);
    try {
      await toggleHeaderTier(props.agentName, id, enabled);
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('routing.toggleTierFailed'));
    } finally {
      togglingRef.current = null;
      setToggling(null);
    }
  };

  const handleResponseModeChange = async (id: string, responseMode: ResponseMode) => {
    setChangingResponseMode(id);
    try {
      const updated = await setHeaderTierResponseMode(props.agentName, id, responseMode);
      mutate((prev) => prev?.map((tier) => (tier.id === id ? updated : tier)));
      toast.success(
        responseMode === 'stream'
          ? t('routing.streamModeEnabled')
          : t('routing.bufferedModeEnabled'),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('routing.responseModeFailed'));
    } finally {
      setChangingResponseMode(null);
    }
  };

  const tierCountRef = useRef(tiers.length);
  tierCountRef.current = tiers.length;
  const openCreateOrManage = () => {
    if (tierCountRef.current > 0) setManageOpen(true);
    else setModalTier('new');
  };

  // Expose openers to the parent for headless mode. They read state through
  // refs, so handing them over once on mount is enough.
  useEffect(() => {
    props.onOpenRef?.(openCreateOrManage);
    props.onCreateRef?.(() => setModalTier('new'));
    props.onEditRef?.((tier) => setModalTier(tier));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDeleteFromEdit = async (id: string) => {
    await handleDelete(id);
    setModalTier(null);
  };

  const manageButton =
    tiers.length > 0 ? (
      <Button size="sm" className="routing-section__cta" onClick={openCreateOrManage}>
        {t('routing.manageCustomRouting')}
      </Button>
    ) : null;

  const modals = (
    <>
      <Modal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        label={t('routing.manageCustomRouting')}
      >
        <div className="header-tier-manage-modal">
          <h2 id="manage-tiers-title" className="text-base font-semibold text-ink">
            {t('routing.manageCustomRouting')}
          </h2>
          <p className="mt-1 text-sm text-dim">{t('routing.headerTiers.manageDesc')}</p>
          <div className="mt-4 flex flex-col divide-y divide-line rounded-control border border-line">
            {tiers.map((tier) => {
              const loading = toggling === tier.id;
              const toggle = () => {
                if (togglingRef.current !== tier.id) void handleToggle(tier.id, !tier.enabled);
              };
              return (
                <div
                  key={tier.id}
                  className="specificity-modal__row flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 hover:bg-s2"
                  role="button"
                  tabIndex={0}
                  aria-pressed={tier.enabled}
                  onClick={toggle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggle();
                    }
                  }}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-ink">{tier.name}</span>
                    <span className="truncate font-mono text-xs text-muted">
                      {tier.header_key}: {tier.header_value}
                    </span>
                  </div>
                  {loading ? (
                    <span className="spinner" aria-hidden="true" />
                  ) : (
                    <span
                      className="switch pointer-events-none"
                      aria-checked={tier.enabled}
                      aria-hidden="true"
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div className="actions mt-4 flex flex-wrap justify-between gap-2">
            <Button
              variant="ghost"
              className="header-tier-manage__create-btn"
              onClick={() => {
                setManageOpen(false);
                setModalTier('new');
              }}
            >
              <Layers aria-hidden="true" className="size-4" />
              {t('routing.headerTiers.createNew')}
            </Button>
            <Button onClick={() => setManageOpen(false)}>{t('common.done')}</Button>
          </div>
        </div>
      </Modal>

      {modalTier ? (
        <Suspense fallback={null}>
          <HeaderTierModal
            key={modalTier === 'new' ? 'new' : modalTier.id}
            agentName={props.agentName}
            existingTiers={tiers}
            editing={modalTier === 'new' ? undefined : modalTier}
            models={props.models}
            onClose={() => setModalTier(null)}
            onSaved={(saved: HeaderTier) => {
              const wasCreate = modalTier === 'new';
              setModalTier(null);
              refetch();
              if (wasCreate) setSnippetTier(saved);
            }}
            onDelete={modalTier !== 'new' ? handleDeleteFromEdit : undefined}
          />
        </Suspense>
      ) : null}

      {snippetTier ? (
        <HeaderTierSnippetModal
          key={snippetTier.id}
          agentName={props.agentName}
          tier={snippetTier}
          customProviders={props.customProviders}
          onClose={() => setSnippetTier(null)}
        />
      ) : null}
    </>
  );

  if (props.headless) {
    // Headless mode: render only the modals, no cards or header.
    // The parent renders cards and triggers openCreateOrManage via onOpenRef.
    return modals;
  }

  const content = (
    <>
      {enabledTiers.length > 0 ? (
        <div className="routing-cards header-tier-list grid gap-3">
          {enabledTiers.map((tier) => (
            <HeaderTierCard
              key={tier.id}
              agentName={props.agentName}
              tier={tier}
              models={props.models}
              customProviders={props.customProviders}
              connectedProviders={props.connectedProviders}
              onOverride={(m: string, p: string, a?: AuthType, label?: string) =>
                handleOverride(tier.id, m, p, a, label)
              }
              onFallbacksUpdate={(_fallbacks: string[], updatedRoutes?: ModelRoute[] | null) =>
                applyFallbackUpdate(tier.id, updatedRoutes)
              }
              onEdit={() => setModalTier(tier)}
              onDisable={() => void handleToggle(tier.id, false)}
              changingResponseMode={changingResponseMode === tier.id}
              onResponseModeChange={(mode: ResponseMode) =>
                void handleResponseModeChange(tier.id, mode)
              }
              getModelParams={props.getModelParams}
              setModelParams={props.setModelParams}
            />
          ))}
        </div>
      ) : (
        <EmptySection
          title={t('routing.headerTiers.emptyTitle')}
          desc={t('routing.headerTiers.emptyDesc')}
        >
          <Button size="sm" onClick={openCreateOrManage}>
            {tiers.length > 0 ? t('routing.manageCustomRouting') : t('routing.createCustomTier')}
          </Button>
        </EmptySection>
      )}
      {modals}
    </>
  );

  if (props.embedded) {
    return (
      <div>
        <div className="routing-section__header mb-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-dim">{t('routing.headerTiers.subtitle')}</span>
          {manageButton}
        </div>
        {content}
      </div>
    );
  }

  return (
    <section className="routing-section routing-section--header-tiers flex flex-col gap-4">
      <div
        className={cx('routing-section__header flex flex-wrap items-start justify-between gap-3')}
      >
        <div>
          <h2 className="text-base font-semibold text-ink">{t('routing.headerTiers.title')}</h2>
          <p className="mt-0.5 text-sm text-dim">{t('routing.headerTiers.subtitle')}</p>
        </div>
        {manageButton}
      </div>
      {content}
    </section>
  );
}

/** Dashed empty block shared by the routing sections. */
function EmptySection({
  title,
  desc,
  children,
}: {
  title: ReactNode;
  desc: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="routing-section__empty flex flex-col items-center gap-2 rounded-surface border border-dashed border-line px-4 py-8 text-center">
      <div className="text-sm font-semibold text-ink">{title}</div>
      <div className="max-w-md text-sm text-muted">{desc}</div>
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}
