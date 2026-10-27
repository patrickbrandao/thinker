import {
  createResource,
  createSignal,
  For,
  lazy,
  Show,
  Suspense,
  type Accessor,
  type Component,
  type Signal,
} from 'solid-js';
import { createStore, reconcile, unwrap } from 'solid-js/store';
import VirtualModelCard from '../components/VirtualModelCard.js';
import VirtualModelSnippetModal from '../components/VirtualModelSnippetModal.js';
import {
  deleteVirtualModel,
  listVirtualModels,
  reorderVirtualModels,
  setVirtualModelOverride,
  setVirtualModelResponseMode,
  toggleVirtualModel,
  updateVirtualModel,
  type VirtualModel,
} from '../services/api/virtual-models.js';
import type {
  AuthType,
  AvailableModel,
  CustomProviderData,
  ModelRoute,
  RequestParamDefaults,
  ResponseMode,
  RoutingProvider,
} from '../services/api.js';
import { toast } from '../services/toast-store.js';
import { richText } from '../components/VirtualModelsHint.js';
import { t } from '../i18n/index.js';
import { deleteVirtualModelPrompt } from '../services/virtual-model-form.js';
import '../styles/routing-header-tiers.css';
import '../styles/routing-virtual-models.css';

// The create/edit modal only mounts on click; keep it out of the route chunk.
const VirtualModelModal = lazy(() => import('../components/VirtualModelModal.js'));

export interface RoutingVirtualModelsSectionProps {
  agentName: Accessor<string>;
  models: Accessor<AvailableModel[]>;
  customProviders: Accessor<CustomProviderData[]>;
  connectedProviders: Accessor<RoutingProvider[]>;
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

type BusyField = 'enabled' | 'continue_on_default' | 'response_mode';

/** Move `ids[from]` to position `to`. */
export function moveId(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return next;
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}

/**
 * Resource storage that reconciles by `id`: a refetch or a reorder keeps each
 * row's object, so `<For>` moves the cards instead of remounting them (and
 * whatever has focus inside a card survives a reload).
 */
function createReconciledSignal<T>(value: T): Signal<T> {
  const [store, setStore] = createStore({ value });
  return [
    () => store.value,
    (next: unknown) => {
      const resolved =
        typeof next === 'function' ? (next as (prev: T) => T)(unwrap(store.value)) : next;
      setStore('value', reconcile(resolved as T, { key: 'id' }));
      return store.value;
    },
  ] as Signal<T>;
}

/**
 * "Virtual models" on a harness's Routing page (ADR 0004): model names the
 * harness can send in `model`, each with its own chain. Kept apart from the
 * custom (header) tiers, which match on headers instead.
 */
const RoutingVirtualModelsSection: Component<RoutingVirtualModelsSectionProps> = (props) => {
  const [list, { refetch, mutate }] = createResource<VirtualModel[], string>(
    () => props.agentName(),
    (name, info) =>
      listVirtualModels(name).catch((err) => {
        toast.error(err instanceof Error ? err.message : t('models.section.loadFailed'));
        // A failed reload keeps what is on screen.
        return info.refetching ? (info.value ?? []) : ([] as VirtualModel[]);
      }),
    { storage: (init) => createReconciledSignal(init) },
  );
  const items = (): VirtualModel[] => list() ?? [];

  const [modal, setModal] = createSignal<VirtualModel | 'new' | null>(null);
  const [snippetFor, setSnippetFor] = createSignal<VirtualModel | null>(null);
  const [busy, setBusy] = createSignal<{ id: string; field: BusyField } | null>(null);
  const [dragId, setDragId] = createSignal<string | null>(null);
  const [dropId, setDropId] = createSignal<string | null>(null);
  const [armedId, setArmedId] = createSignal<string | null>(null);
  const [announcement, setAnnouncement] = createSignal('');
  let listEl: HTMLDivElement | undefined;

  const replace = (saved: VirtualModel) =>
    mutate((prev) => prev?.map((v) => (v.id === saved.id ? saved : v)));

  /**
   * `shadows` and `context_length` are computed on read, and a chain or name
   * change moves them: reload the list after every write.
   */
  const reload = () => void refetch();

  const runBusy = async (id: string, field: BusyField, action: () => Promise<VirtualModel>) => {
    setBusy({ id, field });
    try {
      replace(await action());
      reload();
    } catch {
      // fetchMutate already showed the backend message.
    } finally {
      setBusy(null);
    }
  };

  const handleToggle = (vm: VirtualModel, enabled: boolean) =>
    runBusy(vm.id, 'enabled', async () => {
      const saved = await toggleVirtualModel(props.agentName(), vm.id, enabled);
      toast.success(
        enabled
          ? t('models.section.isActive', { name: vm.name })
          : t('models.section.isInactive', { name: vm.name }),
      );
      return saved;
    });

  const handleContinueOnDefault = (vm: VirtualModel, value: boolean) =>
    runBusy(vm.id, 'continue_on_default', () =>
      updateVirtualModel(
        props.agentName(),
        vm.id,
        { continue_on_default: value },
        { silent: false },
      ),
    );

  const handleResponseMode = (vm: VirtualModel, mode: ResponseMode) =>
    runBusy(vm.id, 'response_mode', () =>
      setVirtualModelResponseMode(props.agentName(), vm.id, mode),
    );

  const handleOverride = async (
    vm: VirtualModel,
    model: string,
    provider: string,
    authType?: AuthType,
    keyLabel?: string,
  ) => {
    try {
      replace(
        await setVirtualModelOverride(
          props.agentName(),
          vm.id,
          model,
          provider,
          authType,
          keyLabel,
        ),
      );
      reload();
    } catch {
      // fetchMutate already showed the backend message.
    }
  };

  const handleFallbacksUpdate = (vm: VirtualModel, routes: ModelRoute[] | null | undefined) => {
    // A reset clears the primary too: only the reload knows the result.
    if (routes !== undefined) {
      mutate((prev) => prev?.map((v) => (v.id === vm.id ? { ...v, fallback_routes: routes } : v)));
    }
    reload();
  };

  const handleDelete = async (vm: Pick<VirtualModel, 'id' | 'name'>) => {
    try {
      await deleteVirtualModel(props.agentName(), vm.id);
      mutate((prev) => prev?.filter((v) => v.id !== vm.id));
      toast.success(t('models.section.deleted', { name: vm.name }));
    } catch {
      // fetchMutate already showed the backend message.
    }
  };

  /** Focus the moved card's handle again, after `<For>` has moved it. */
  const focusHandle = (id: string) => {
    const handle = [...(listEl?.querySelectorAll<HTMLElement>('[data-vm-handle]') ?? [])].find(
      (el) => el.dataset.vmHandle === id,
    );
    handle?.focus();
  };

  const reorder = async (from: number, to: number, opts: { refocus?: boolean } = {}) => {
    const current = items();
    if (from === to || from < 0 || to < 0 || from >= current.length || to >= current.length) {
      return;
    }
    const ids = moveId(
      current.map((v) => v.id),
      from,
      to,
    );
    const byId = new Map(current.map((v) => [v.id, v]));
    const moved = current[from]!;
    mutate(ids.map((id, i) => ({ ...byId.get(id)!, sort_order: i })));
    // Moving a node out of the DOM drops its focus, even when it is reused.
    if (opts.refocus) focusHandle(moved.id);
    setAnnouncement(`"${moved.name}" moved to position ${to + 1} of ${ids.length}`);
    try {
      await reorderVirtualModels(props.agentName(), ids);
    } catch {
      void refetch();
    }
  };

  const endDrag = () => {
    setDragId(null);
    setDropId(null);
    setArmedId(null);
  };

  const createButton = (label = t('models.section.create')) => (
    <button
      type="button"
      class="btn btn--primary btn--sm routing-section__cta"
      onClick={() => setModal('new')}
    >
      {label}
    </button>
  );

  return (
    <div class="routing-section routing-section--virtual-models">
      <div class="routing-section__header routing-section__header--header-tiers">
        <div>
          <h2 class="routing-section__title">{t('models.section.title')}</h2>
          <p class="routing-section__subtitle">{t('models.section.subtitle')}</p>
        </div>
        <Show when={items().length > 0}>{createButton()}</Show>
      </div>

      <Show
        when={items().length > 0}
        fallback={
          <Show when={!list.loading}>
            <div class="routing-section__empty">
              <div class="routing-section__empty-title">{t('models.section.emptyTitle')}</div>
              <div class="routing-section__empty-desc">
                {richText(t('models.section.emptyDesc'), {
                  example: <code>deepseek/flash</code>,
                })}
              </div>
              {createButton()}
            </div>
          </Show>
        }
      >
        <div class="routing-cards virtual-model-list" role="list" ref={listEl}>
          <For each={items()}>
            {(vm, index) => (
              <div
                class="virtual-model-slot"
                classList={{
                  'virtual-model-slot--dragging': dragId() === vm.id,
                  'virtual-model-slot--drop-target': dropId() === vm.id && dragId() !== vm.id,
                }}
                role="listitem"
                draggable={armedId() === vm.id}
                onDragStart={(e) => {
                  setDragId(vm.id);
                  e.dataTransfer?.setData('text/plain', vm.id);
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (!dragId()) return;
                  e.preventDefault();
                  setDropId(vm.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = items().findIndex((v) => v.id === dragId());
                  endDrag();
                  void reorder(from, index());
                }}
                onDragEnd={endDrag}
              >
                <VirtualModelCard
                  agentName={props.agentName()}
                  virtualModel={vm}
                  models={props.models()}
                  customProviders={props.customProviders()}
                  connectedProviders={props.connectedProviders()}
                  busy={busy()?.id === vm.id ? busy()!.field : null}
                  onOverride={(m, p, a, label) => handleOverride(vm, m, p, a, label)}
                  onFallbacksUpdate={(_models, routes) => handleFallbacksUpdate(vm, routes)}
                  onToggle={(enabled) => void handleToggle(vm, enabled)}
                  onContinueOnDefaultChange={(value) => void handleContinueOnDefault(vm, value)}
                  onResponseModeChange={(mode) => void handleResponseMode(vm, mode)}
                  onEdit={() => setModal(vm)}
                  onDelete={() => {
                    if (confirm(deleteVirtualModelPrompt(vm.name))) void handleDelete(vm);
                  }}
                  onShowExample={() => setSnippetFor(vm)}
                  onMoveUp={index() > 0 ? () => void reorder(index(), index() - 1) : undefined}
                  onMoveDown={
                    index() < items().length - 1
                      ? () => void reorder(index(), index() + 1)
                      : undefined
                  }
                  getModelParams={props.getModelParams}
                  setModelParams={props.setModelParams}
                  dragHandle={
                    <Show when={items().length > 1}>
                      <button
                        type="button"
                        class="virtual-model-card__drag"
                        data-vm-handle={vm.id}
                        aria-label={t('models.section.reorder', { name: vm.name })}
                        title={t('models.section.dragToReorder')}
                        onPointerDown={() => setArmedId(vm.id)}
                        onPointerUp={() => {
                          if (!dragId()) setArmedId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                            e.preventDefault();
                            void reorder(index(), index() - 1, { refocus: true });
                          } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                            e.preventDefault();
                            void reorder(index(), index() + 1, { refocus: true });
                          }
                        }}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="12"
                          height="12"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <circle cx="9" cy="6" r="1.6" />
                          <circle cx="15" cy="6" r="1.6" />
                          <circle cx="9" cy="12" r="1.6" />
                          <circle cx="15" cy="12" r="1.6" />
                          <circle cx="9" cy="18" r="1.6" />
                          <circle cx="15" cy="18" r="1.6" />
                        </svg>
                      </button>
                    </Show>
                  }
                />
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={modal()} keyed>
        {(state) => (
          <Suspense fallback={null}>
            <VirtualModelModal
              agentName={props.agentName()}
              existing={items()}
              editing={state === 'new' ? undefined : state}
              models={props.models()}
              customProviders={props.customProviders()}
              connectedProviders={props.connectedProviders()}
              onClose={() => setModal(null)}
              onSaved={(saved) => {
                const created = state === 'new';
                setModal(null);
                if (created) {
                  mutate((prev) => [...(prev ?? []), saved]);
                  setSnippetFor(saved);
                  toast.success(t('models.section.created', { name: saved.name }));
                } else {
                  replace(saved);
                }
                reload();
              }}
              onPartialSave={(saved) => {
                replace(saved);
                reload();
              }}
              onDelete={
                state === 'new'
                  ? undefined
                  : (id) => {
                      setModal(null);
                      void handleDelete({ id, name: state.name });
                    }
              }
            />
          </Suspense>
        )}
      </Show>

      <div class="sr-only" role="status" aria-live="polite">
        {announcement()}
      </div>

      <Show when={snippetFor()} keyed>
        {(vm) => (
          <VirtualModelSnippetModal
            agentName={props.agentName()}
            virtualModel={vm}
            onClose={() => setSnippetFor(null)}
          />
        )}
      </Show>
    </div>
  );
};

export default RoutingVirtualModelsSection;
