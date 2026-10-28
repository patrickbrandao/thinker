import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Plus } from 'lucide-react';
import type { AuthType, PlaygroundHistoryRunSummary } from '../services/api.js';
import {
  getAvailableModels,
  getPlaygroundAgent,
  getPlaygroundRun,
  getCustomProviders,
  getProviders,
  listPlaygroundRuns,
} from '../services/api.js';
import {
  getOrCreatePlaygroundStore,
  MAX_COLUMNS,
  usePlaygroundStore,
  type PlaygroundColumn as ColumnData,
} from '../services/playground-store.js';
import { toast } from '../services/toast-store.js';
import { t } from '../i18n/index.js';
import { roleCan } from '../services/session-store.js';
import { useResource } from '../lib/use-resource.js';
import PlaygroundColumn from '../components/playground/PlaygroundColumn.jsx';
import PlaygroundPrompt from '../components/playground/PlaygroundPrompt.jsx';
import PlaygroundSummaryTable from '../components/playground/PlaygroundSummaryTable.jsx';
import PlaygroundModelPicker from '../components/playground/PlaygroundModelPicker.jsx';
import PlaygroundEmptyState from '../components/playground/PlaygroundEmptyState.jsx';
import PlaygroundRecentSidebar from '../components/playground/PlaygroundHistoryDrawer.jsx';
import RequestHeadersPopover from '../components/playground/RequestHeadersPopover.jsx';
import {
  activeHeaderCount,
  blankEntry,
  loadStoredHeaderEntries,
  persistHeaderNames,
  toHeaderRecord,
  type HeaderEntry,
} from '../services/playground-request-headers.js';
import { CodeIcon } from '../components/playground/icons.jsx';
import { useRightSidebar } from '../services/right-sidebar.jsx';
import { Kbd, cx } from '../components/ui.jsx';

// Web Storage can throw (blocked site data, private mode, quota) or be missing
// entirely. These preferences are conveniences, so failures fall back silently.
function readStorage(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    /* storage unavailable: nothing to remember */
  }
}

/** Phones start with the history panel closed (it would cover the page). */
function isPhoneWidth(): boolean {
  try {
    return window.matchMedia?.('(max-width: 767px)').matches ?? false;
  } catch {
    return false;
  }
}

function findDisplayName(
  available: { model_name: string; display_name?: string | null }[],
  modelName: string,
): string {
  const match = available.find((m) => m.model_name === modelName);
  return match?.display_name ?? modelName;
}

function findWinners(columns: readonly ColumnData[]): {
  cheapestCost?: number;
  fastestDuration?: number;
} {
  const success = columns.filter((c) => c.status === 'success' && c.metrics);
  if (success.length < 2) return {};

  let cheapestCost = Number.POSITIVE_INFINITY;
  for (const c of success) {
    const cost = c.metrics?.cost;
    if (cost != null && cost < cheapestCost) cheapestCost = cost;
  }

  let fastestDuration = Number.POSITIVE_INFINITY;
  for (const c of success) {
    const dur = c.metrics?.durationMs ?? Number.POSITIVE_INFINITY;
    if (dur < fastestDuration) fastestDuration = dur;
  }

  return {
    cheapestCost: cheapestCost < Number.POSITIVE_INFINITY ? cheapestCost : undefined,
    fastestDuration: fastestDuration < Number.POSITIVE_INFINITY ? fastestDuration : undefined,
  };
}

interface PlaygroundProps {
  onBestModelChange?: (
    selection: { model: string; provider: string; authType: AuthType } | null,
  ) => void;
  /**
   * Rendered inside another page (onboarding wizard): no document title,
   * no page header, and no run-history sidebar.
   */
  embedded?: boolean;
}

export default function Playground({ onBestModelChange, embedded }: PlaygroundProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const runParam = searchParams.get('run');
  /** Writes (or clears, with null) the `?run=` param, keeping the others. */
  const setRunParam = useCallback(
    (runId: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (runId) next.set('run', runId);
          else next.delete('run');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const agent = useResource(getPlaygroundAgent, []);
  // Only the resolved name (from the server) drives the data fetches and the
  // store key, so models/providers aren't requested (404) before the reserved
  // agent row is guaranteed to exist server-side.
  const resolvedAgentName = agent.data?.name;
  // Display fallback for UI text that needs a name before resolution.
  const agentName = resolvedAgentName ?? 'Playground';

  const available = useResource(() => getAvailableModels(resolvedAgentName!), [resolvedAgentName], {
    enabled: !!resolvedAgentName,
  });
  const providers = useResource(() => getProviders(resolvedAgentName!), [resolvedAgentName], {
    enabled: !!resolvedAgentName,
  });
  const customProviders = useResource(
    () => getCustomProviders(resolvedAgentName!),
    [resolvedAgentName],
    { enabled: !!resolvedAgentName },
  );

  // The store is keyed by the server-assigned name so it survives navigation.
  const store = usePlaygroundStore(
    useMemo(() => getOrCreatePlaygroundStore(agentName), [agentName]),
  );
  const columns = store.columns;
  const running = store.isAnyRunning();

  const [pickerForColumn, setPickerForColumn] = useState<string | null>(null);
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [historyOpen, setHistoryOpen] = useState(
    () =>
      !embedded &&
      !isPhoneWidth() &&
      readStorage(() => localStorage, 'thinker.playground.recentOpen') !== 'false',
  );
  const [historyRuns, setHistoryRuns] = useState<PlaygroundHistoryRunSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [liveRunId, setLiveRunId] = useState<string | null>(null);
  const [viewingHistory, setViewingHistory] = useState<ColumnData[] | null>(null);
  const [completedResults, setCompletedResults] = useState<ColumnData[] | null>(null);
  const [headerEntries, setHeaderEntries] = useState<HeaderEntry[]>(loadStoredHeaderEntries);
  const [headersOpen, setHeadersOpen] = useState(false);
  // Best pick for a run shown read-only as an overlay (store isn't loaded in
  // that path, so its best state is tracked separately).
  const [overlayBestId, setOverlayBestId] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  // Async callbacks (history refresh, run restore) read the latest state.
  const viewingHistoryRef = useRef(viewingHistory);
  viewingHistoryRef.current = viewingHistory;

  const hasConnectedProviders = (providers.data ?? []).some((p) => p.is_active);
  const effectiveBestId = viewingHistory ? overlayBestId : store.bestColumnId();

  const handleMarkBest = (col: ColumnData) => {
    if (viewingHistory) return; // read-only overlay
    const next =
      col.columnDbId != null && col.columnDbId !== store.bestColumnId()
        ? { model: col.model, provider: col.provider, authType: col.authType }
        : null;
    void store
      .markBest(col)
      .then(() => onBestModelChange?.(next))
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : t('playground.failedSetBest')),
      );
  };

  const toggleRecent = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    writeStorage(() => localStorage, 'thinker.playground.recentOpen', String(next));
  };

  const handleNewPlayground = () => {
    store.reset();
    setViewingHistory(null);
    setCompletedResults(null);
    setActiveRunId(null);
    setLiveRunId(null);
    setOverlayBestId(null);
    setRunParam(null);
    writeStorage(() => sessionStorage, 'thinker.playground.lastRun', null);
    // pickDefaults reseeds via its effect since the columns are now empty.
    requestAnimationFrame(() => promptRef.current?.focus());
  };

  // Cmd+K (Mac) / Ctrl+K (Windows) opens the model picker
  // Shift+Cmd+O (Mac) / Ctrl+Shift+O (Windows) starts a new playground
  const shortcutsRef = useRef({ canAdd: false, newPlayground: handleNewPlayground });
  shortcutsRef.current = {
    canAdd: !running && columns.length < MAX_COLUMNS && !viewingHistory,
    newPlayground: handleNewPlayground,
  };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        if (shortcutsRef.current.canAdd) {
          e.preventDefault();
          // Here ⌘K adds a model, so keep the shell's command palette closed.
          e.stopImmediatePropagation();
          setShowAddPicker(true);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        shortcutsRef.current.newPlayground();
      }
    };
    // Capture phase so it runs before the shell's window listener.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // Restore the last viewed run on page load, but only if the store doesn't
  // already have columns (the user navigated away and back while a playground
  // was running: the cached store still has state).
  const restoringRef = useRef<string | null>(null);
  useEffect(() => {
    // If the store already has completed columns, snapshot them for the summary table
    if (columns.length > 0 && !running && !completedResults) {
      setCompletedResults([...columns]);
    }
    if (columns.length > 0 || !resolvedAgentName) return;
    const runId = runParam || readStorage(() => sessionStorage, 'thinker.playground.lastRun');
    if (!runId || activeRunId || restoringRef.current === runId) return;
    restoringRef.current = runId;
    getPlaygroundRun(runId)
      .then((detail) => {
        store.loadHistoryRun(detail);
        setCompletedResults([...store.columns]);
        setActiveRunId(runId);
        setRunParam(runId);
      })
      .catch(() => {
        setRunParam(null);
        writeStorage(() => sessionStorage, 'thinker.playground.lastRun', null);
      })
      .finally(() => {
        restoringRef.current = null;
      });
  }, [
    store,
    columns,
    running,
    completedResults,
    runParam,
    activeRunId,
    resolvedAgentName,
    setRunParam,
  ]);

  const updateHeaders = (entries: HeaderEntry[]) => {
    setHeaderEntries(entries);
    persistHeaderNames(entries);
  };

  const openHeaders = () => {
    if (headerEntries.length === 0) setHeaderEntries([blankEntry()]);
    setHeadersOpen(true);
  };

  const handleSubmit = () => {
    const promptText = store.prompt().trim();
    const models = store.columns.map((c) => c.displayName ?? c.model);
    setCompletedResults(null);
    const runId = store.runAll({ requestHeaders: toHeaderRecord(headerEntries) });
    if (!runId) return;

    // Add to history immediately so user sees the running playground
    setHistoryRuns((prev) => [
      {
        id: runId,
        prompt: promptText,
        createdAt: new Date().toISOString(),
        modelCount: models.length,
        models,
        starred: false,
        bestColumnId: null,
      },
      ...prev.filter((r) => r.id !== runId),
    ]);
    setActiveRunId(runId);
    setLiveRunId(runId);
    setViewingHistory(null);
    setRunParam(runId);
    writeStorage(() => sessionStorage, 'thinker.playground.lastRun', runId);
  };

  const handleRetry = (id: string) => {
    void store.retryColumn(id, { requestHeaders: toHeaderRecord(headerEntries) });
  };

  const refreshHistory = useCallback(async (): Promise<PlaygroundHistoryRunSummary[] | null> => {
    setHistoryLoading(true);
    try {
      const runs = await listPlaygroundRuns();
      setHistoryRuns(runs);
      return runs;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('playground.failedLoadHistory'));
      return null;
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (historyOpen) void refreshHistory();
  }, [historyOpen, refreshHistory]);

  // Refresh history once per run, on the transition from running → idle.
  const prevRunningRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const prev = prevRunningRef.current;
    prevRunningRef.current = running;
    if (!(prev === true && running === false)) return;
    setLiveRunId(null);
    // Snapshot completed results so the summary table survives column removals
    setCompletedResults([...store.columns]);
    if (embedded) return;
    void refreshHistory().then((runs) => {
      // If the user isn't viewing a past run, auto-select the latest
      if (viewingHistoryRef.current) return;
      const latest = runs?.[0];
      if (latest) {
        setActiveRunId(latest.id);
        setRunParam(latest.id);
      }
    });
  }, [running, store, embedded, refreshHistory, setRunParam]);

  useEffect(() => {
    const a = available.data;
    const p = providers.data;
    if (!a || !p) return;
    // Don't overwrite existing columns (e.g. after navigating away and back)
    if (columns.length > 0) return;
    store.pickDefaults(a, p);
  }, [available.data, providers.data, store, columns.length]);

  useEffect(() => {
    for (const col of columns) {
      if (col.status === 'success' && col.metrics) {
        setAnnouncement(
          t('playground.responded', {
            name: col.displayName ?? col.model,
            ms: col.metrics.durationMs,
          }),
        );
      }
    }
  }, [columns]);

  const handlePickModel = (
    columnId: string,
    model: string,
    provider: string,
    authType?: AuthType,
  ) => {
    const displayName = findDisplayName(available.data ?? [], model);
    store.replaceColumnModel(columnId, model, provider, authType ?? 'api_key', displayName);
    setPickerForColumn(null);
  };

  const handleAddModel = (
    _columnId: string,
    model: string,
    provider: string,
    authType?: AuthType,
  ) => {
    const displayName = findDisplayName(available.data ?? [], model);
    store.addColumn(model, provider, authType ?? 'api_key', displayName);
    setShowAddPicker(false);
  };

  const handlePickHistory = async (runId: string) => {
    // If clicking on the live (currently running) run, just show live columns
    if (runId === liveRunId) {
      setViewingHistory(null);
      setCompletedResults(null);
      setActiveRunId(runId);
      setRunParam(runId);
      return;
    }
    try {
      const detail = await getPlaygroundRun(runId);
      if (store.isAnyRunning() || !hasConnectedProviders) {
        // Don't touch the store -- show history as a read-only overlay
        const cols: ColumnData[] = detail.columns.map((c, i) => ({
          id: `hist-${i}`,
          model: c.model,
          provider: c.provider,
          authType: (c.authType ?? 'api_key') as AuthType,
          displayName: c.displayName ?? c.model,
          status: c.status === 'success' ? ('success' as const) : ('error' as const),
          response: c.content ?? undefined,
          metrics: c.metrics ?? undefined,
          headers: c.headers ?? undefined,
          error: c.errorMessage ?? undefined,
          columnDbId: c.id,
        }));
        setViewingHistory(cols);
        setCompletedResults(cols);
        setOverlayBestId(detail.bestColumnId ?? null);
      } else {
        // No run in progress and providers available, safe to replace the store
        store.loadHistoryRun(detail);
        setViewingHistory(null);
        setCompletedResults([...store.columns]);
      }
      setActiveRunId(runId);
      setRunParam(runId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('playground.failedLoadRun'));
    }
  };

  const handleStarToggle = (runId: string, starred: boolean) => {
    setHistoryRuns((prev) => prev.map((r) => (r.id === runId ? { ...r, starred } : r)));
  };

  // The history panel lives in the shell's right sidebar. Its callbacks go
  // through a ref so the element only changes when its data does (setting the
  // sidebar re-renders this page through the context).
  const sidebarHandlers = useRef({
    toggle: toggleRecent,
    select: handlePickHistory,
    star: handleStarToggle,
    newPlayground: handleNewPlayground,
  });
  sidebarHandlers.current = {
    toggle: toggleRecent,
    select: handlePickHistory,
    star: handleStarToggle,
    newPlayground: handleNewPlayground,
  };
  const { setContent: setRightSidebar } = useRightSidebar();
  useEffect(() => {
    if (embedded) return;
    setRightSidebar(
      <PlaygroundRecentSidebar
        open={historyOpen}
        loading={historyLoading}
        runs={historyRuns}
        activeRunId={activeRunId}
        onToggle={() => sidebarHandlers.current.toggle()}
        onSelect={(id) => void sidebarHandlers.current.select(id)}
        onStarToggle={(id, starred) => sidebarHandlers.current.star(id, starred)}
        onNewPlayground={() => sidebarHandlers.current.newPlayground()}
      />,
    );
  }, [embedded, historyOpen, historyLoading, historyRuns, activeRunId, setRightSidebar]);
  useEffect(() => {
    if (embedded) return;
    return () => setRightSidebar(null);
  }, [embedded, setRightSidebar]);

  // Compute winners from whatever set is actually rendered — when a history
  // run is open its columns drive the badges, not the live store.
  const shownColumns = viewingHistory ?? columns;
  const winners = findWinners(shownColumns);
  const loaded = !!available.data && !!providers.data;
  const canPrompt = hasConnectedProviders && roleCan.editHarnesses();
  const headerCount = activeHeaderCount(headerEntries);
  const mac = typeof navigator !== 'undefined' && !!navigator.platform?.includes('Mac');

  return (
    <div
      className={cx(
        'playground flex min-h-full flex-col',
        embedded ? 'playground--embedded gap-4' : 'page wide w-full gap-5 pb-0',
      )}
    >
      {!embedded ? (
        <>
          <title>{t('playground.pageTitle')}</title>
          <meta name="description" content={t('playground.metaDescription')} />
        </>
      ) : null}

      {(loaded && hasConnectedProviders) || viewingHistory ? (
        <>
          <div
            className="playground__columns grid flex-1 auto-rows-fr grid-flow-col gap-3 overflow-x-auto pb-1 [grid-auto-columns:minmax(min(300px,85vw),1fr)]"
            aria-label={t('playground.columnsLabel')}
          >
            {shownColumns.map((col) => (
              <PlaygroundColumn
                key={col.id}
                column={col}
                isCheapest={col.metrics?.cost != null && col.metrics.cost === winners.cheapestCost}
                isFastest={
                  col.metrics?.durationMs != null &&
                  col.metrics.durationMs === winners.fastestDuration
                }
                isBest={col.columnDbId != null && col.columnDbId === effectiveBestId}
                readOnly={!!viewingHistory || !hasConnectedProviders}
                onRemove={viewingHistory ? () => {} : store.removeColumn}
                onChangeModel={viewingHistory ? () => {} : setPickerForColumn}
                onRetry={handleRetry}
                onMarkBest={viewingHistory ? undefined : () => handleMarkBest(col)}
              />
            ))}
            {!viewingHistory && columns.length < MAX_COLUMNS ? (
              <button
                type="button"
                className="playground__add flex min-h-72 flex-col items-center justify-center gap-2 rounded-surface border border-dashed border-line-strong text-sm font-medium text-muted hover:border-accent hover:bg-accent-tint hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => setShowAddPicker(true)}
                aria-label={t('playground.addModelColumn')}
                disabled={running}
              >
                <Plus size={20} aria-hidden="true" />
                <span>{t('playground.addModel')}</span>
                <span className="flex gap-0.5 max-md:hidden" aria-hidden="true">
                  <Kbd>{mac ? '⌘' : 'Ctrl' /* i18n-ignore: key name */}</Kbd>
                  <Kbd>K</Kbd>
                </span>
              </button>
            ) : null}
          </div>

          <PlaygroundSummaryTable
            columns={viewingHistory ?? completedResults ?? columns}
            bestColumnId={effectiveBestId}
            onMarkBest={viewingHistory ? undefined : handleMarkBest}
          />

          <div
            className={cx('sticky bottom-0 z-10 -mx-1 bg-bg px-1 pb-4 pt-2', embedded && 'pb-0')}
          >
            {canPrompt ? (
              <PlaygroundPrompt
                ref={(el) => {
                  promptRef.current = el;
                }}
                value={store.prompt()}
                onChange={store.setPrompt}
                onSubmit={handleSubmit}
                onRecallPrevious={store.recallPreviousPrompt}
                disabled={running || columns.length === 0}
                running={running}
                historyOpen={historyOpen}
                headersSlot={
                  <div className="playground-prompt__headers-slot relative">
                    <button
                      type="button"
                      className="playground-prompt__headers icon-btn relative"
                      aria-label={t('playground.requestHeadersButton')}
                      aria-expanded={headersOpen}
                      title={t('playground.customRequestHeaders')}
                      onClick={() => (headersOpen ? setHeadersOpen(false) : openHeaders())}
                    >
                      <CodeIcon size={16} />
                      {headerCount > 0 ? (
                        <span className="playground-prompt__headers-badge absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-on-accent">
                          {headerCount}
                        </span>
                      ) : null}
                    </button>
                    <RequestHeadersPopover
                      open={headersOpen}
                      entries={headerEntries}
                      onChange={updateHeaders}
                      onClose={() => setHeadersOpen(false)}
                    />
                  </div>
                }
              />
            ) : (
              <div className="playground-prompt playground-prompt--info notice is-info">
                <span className="playground-prompt__info-text">
                  {roleCan.editHarnesses()
                    ? t('playground.connectProvider')
                    : t('playground.readOnly')}
                </span>
              </div>
            )}
          </div>
        </>
      ) : loaded ? (
        <PlaygroundEmptyState
          onConnect={() => {
            /* Will be replaced with cards in follow-up */
          }}
        />
      ) : null}

      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      {pickerForColumn ? (
        <PlaygroundModelPicker
          columnId={pickerForColumn}
          models={available.data ?? []}
          customProviders={customProviders.data}
          connectedProviders={providers.data}
          onSelect={handlePickModel}
          onClose={() => setPickerForColumn(null)}
        />
      ) : null}

      {showAddPicker ? (
        <PlaygroundModelPicker
          columnId="new"
          models={available.data ?? []}
          customProviders={customProviders.data}
          connectedProviders={providers.data}
          onSelect={handleAddModel}
          onClose={() => setShowAddPicker(false)}
        />
      ) : null}
    </div>
  );
}
