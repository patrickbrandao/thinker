import { lazy, Suspense, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { GripVertical } from 'lucide-react';
import VirtualModelCard from '../components/VirtualModelCard.js';
import VirtualModelSnippetModal from '../components/VirtualModelSnippetModal.js';
import RichText from '../components/RichText.js';
import { Button, cx } from '../components/ui.js';
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
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';
import { deleteVirtualModelPrompt } from '../services/virtual-model-form.js';

// The create/edit modal only mounts on click; keep it out of the route chunk.
const VirtualModelModal = lazy(() => import('../components/VirtualModelModal.js'));

export interface RoutingVirtualModelsSectionProps {
  agentName: string;
  models: AvailableModel[];
  customProviders: CustomProviderData[];
  connectedProviders: RoutingProvider[];
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
 * "Virtual models" on a harness's Routing page (ADR 0004): model names the
 * harness can send in `model`, each with its own chain. Kept apart from the
 * custom (header) tiers, which match on headers instead. Cards are keyed by
 * id, so a reload or a reorder moves them instead of remounting them.
 */
export default function RoutingVirtualModelsSection(props: RoutingVirtualModelsSectionProps) {
  const dataRef = useRef<VirtualModel[] | undefined>(undefined);
  const list = useResource<VirtualModel[]>(
    () =>
      listVirtualModels(props.agentName).catch((err) => {
        toast.error(err instanceof Error ? err.message : t('models.section.loadFailed'));
        // A failed reload keeps what is on screen.
        return dataRef.current ?? [];
      }),
    [props.agentName],
  );
  dataRef.current = list.data;
  const items: VirtualModel[] = list.data ?? [];
  const mutate = list.setData;

  const [modal, setModal] = useState<VirtualModel | 'new' | null>(null);
  const [snippetFor, setSnippetFor] = useState<VirtualModel | null>(null);
  const [busy, setBusy] = useState<{ id: string; field: BusyField } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const replace = (saved: VirtualModel) =>
    mutate((prev) => prev?.map((v) => (v.id === saved.id ? saved : v)));

  /**
   * `shadows` and `context_length` are computed on read, and a chain or name
   * change moves them: reload the list after every write.
   */
  const reload = () => void list.reload();

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
      const saved = await toggleVirtualModel(props.agentName, vm.id, enabled);
      toast.success(
        enabled
          ? t('models.section.isActive', { name: vm.name })
          : t('models.section.isInactive', { name: vm.name }),
      );
      return saved;
    });

  const handleContinueOnDefault = (vm: VirtualModel, value: boolean) =>
    runBusy(vm.id, 'continue_on_default', () =>
      updateVirtualModel(props.agentName, vm.id, { continue_on_default: value }, { silent: false }),
    );

  const handleResponseMode = (vm: VirtualModel, mode: ResponseMode) =>
    runBusy(vm.id, 'response_mode', () =>
      setVirtualModelResponseMode(props.agentName, vm.id, mode),
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
        await setVirtualModelOverride(props.agentName, vm.id, model, provider, authType, keyLabel),
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
      await deleteVirtualModel(props.agentName, vm.id);
      mutate((prev) => prev?.filter((v) => v.id !== vm.id));
      toast.success(t('models.section.deleted', { name: vm.name }));
    } catch {
      // fetchMutate already showed the backend message.
    }
  };

  /** Focus the moved card's handle again, after React has moved it. */
  const focusHandle = (id: string) => {
    const handle = [
      ...(listRef.current?.querySelectorAll<HTMLElement>('[data-vm-handle]') ?? []),
    ].find((el) => el.dataset.vmHandle === id);
    handle?.focus();
  };

  const reorder = async (from: number, to: number, opts: { refocus?: boolean } = {}) => {
    const current = items;
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
    const next = ids.map((id, i) => ({ ...byId.get(id)!, sort_order: i }));
    // Moving a node in the DOM drops its focus, even when it is reused: commit
    // the move now so the handle can be focused again right after.
    flushSync(() => {
      mutate(next);
      setAnnouncement(`"${moved.name}" moved to position ${to + 1} of ${ids.length}`);
    });
    if (opts.refocus) focusHandle(moved.id);
    try {
      await reorderVirtualModels(props.agentName, ids);
    } catch {
      reload();
    }
  };

  const endDrag = () => {
    setDragId(null);
    setDropId(null);
    setArmedId(null);
  };

  const createButton = (
    <Button size="sm" className="routing-section__cta" onClick={() => setModal('new')}>
      {t('models.section.create')}
    </Button>
  );

  return (
    <section className="routing-section routing-section--virtual-models flex flex-col gap-4">
      <div className="routing-section__header flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">{t('models.section.title')}</h2>
          <p className="mt-0.5 text-sm text-dim">{t('models.section.subtitle')}</p>
        </div>
        {items.length > 0 ? createButton : null}
      </div>

      {items.length > 0 ? (
        <div ref={listRef} className="routing-cards virtual-model-list grid gap-3" role="list">
          {items.map((vm, index) => (
            <div
              key={vm.id}
              className={cx(
                'virtual-model-slot rounded-surface transition-opacity',
                dragId === vm.id && 'virtual-model-slot--dragging opacity-50',
                dropId === vm.id &&
                  dragId !== vm.id &&
                  'virtual-model-slot--drop-target outline-2 outline-offset-2 outline-accent',
              )}
              role="listitem"
              draggable={armedId === vm.id}
              onDragStart={(e) => {
                setDragId(vm.id);
                e.dataTransfer?.setData('text/plain', vm.id);
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setDropId(vm.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = items.findIndex((v) => v.id === dragId);
                endDrag();
                void reorder(from, index);
              }}
              onDragEnd={endDrag}
            >
              <VirtualModelCard
                agentName={props.agentName}
                virtualModel={vm}
                models={props.models}
                customProviders={props.customProviders}
                connectedProviders={props.connectedProviders}
                busy={busy?.id === vm.id ? busy.field : null}
                onOverride={(m: string, p: string, a?: AuthType, label?: string) =>
                  handleOverride(vm, m, p, a, label)
                }
                onFallbacksUpdate={(_models: string[], routes?: ModelRoute[] | null) =>
                  handleFallbacksUpdate(vm, routes)
                }
                onToggle={(enabled: boolean) => void handleToggle(vm, enabled)}
                onContinueOnDefaultChange={(value: boolean) =>
                  void handleContinueOnDefault(vm, value)
                }
                onResponseModeChange={(mode: ResponseMode) => void handleResponseMode(vm, mode)}
                onEdit={() => setModal(vm)}
                onDelete={() => {
                  if (confirm(deleteVirtualModelPrompt(vm.name))) void handleDelete(vm);
                }}
                onShowExample={() => setSnippetFor(vm)}
                onMoveUp={index > 0 ? () => void reorder(index, index - 1) : undefined}
                onMoveDown={
                  index < items.length - 1 ? () => void reorder(index, index + 1) : undefined
                }
                getModelParams={props.getModelParams}
                setModelParams={props.setModelParams}
                dragHandle={
                  items.length > 1 ? (
                    <button
                      type="button"
                      className="virtual-model-card__drag icon-btn size-6 cursor-grab"
                      data-vm-handle={vm.id}
                      aria-label={t('models.section.reorder', { name: vm.name })}
                      title={t('models.section.dragToReorder')}
                      onPointerDown={() => setArmedId(vm.id)}
                      onPointerUp={() => {
                        if (!dragId) setArmedId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                          e.preventDefault();
                          void reorder(index, index - 1, { refocus: true });
                        } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                          e.preventDefault();
                          void reorder(index, index + 1, { refocus: true });
                        }
                      }}
                    >
                      <GripVertical aria-hidden="true" className="size-3.5" />
                    </button>
                  ) : null
                }
              />
            </div>
          ))}
        </div>
      ) : !list.loading ? (
        <div className="routing-section__empty flex flex-col items-center gap-2 rounded-surface border border-dashed border-line px-4 py-8 text-center">
          <div className="text-sm font-semibold text-ink">{t('models.section.emptyTitle')}</div>
          <div className="max-w-md text-sm text-muted">
            <RichText
              text={t('models.section.emptyDesc')}
              parts={{ example: <code className="font-mono text-ink">deepseek/flash</code> }}
            />
          </div>
          <div className="mt-2">{createButton}</div>
        </div>
      ) : null}

      {modal ? (
        <Suspense fallback={null}>
          <VirtualModelModal
            key={modal === 'new' ? 'new' : modal.id}
            agentName={props.agentName}
            existing={items}
            editing={modal === 'new' ? undefined : modal}
            models={props.models}
            customProviders={props.customProviders}
            connectedProviders={props.connectedProviders}
            onClose={() => setModal(null)}
            onSaved={(saved: VirtualModel) => {
              const created = modal === 'new';
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
            onPartialSave={(saved: VirtualModel) => {
              replace(saved);
              reload();
            }}
            onDelete={
              modal === 'new'
                ? undefined
                : (id: string) => {
                    setModal(null);
                    void handleDelete({ id, name: modal.name });
                  }
            }
          />
        </Suspense>
      ) : null}

      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      {snippetFor ? (
        <VirtualModelSnippetModal
          key={snippetFor.id}
          agentName={props.agentName}
          virtualModel={snippetFor}
          onClose={() => setSnippetFor(null)}
        />
      ) : null}
    </section>
  );
}
