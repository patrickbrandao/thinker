import { useEffect, useMemo, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { LayoutGrid, List, Pencil, Plus, Shapes } from 'lucide-react';
import {
  getAgents,
  getCustomProviders,
  getProviders as getAgentProviders,
} from '../../services/api.js';
import {
  getProviders as getGlobalProviders,
  getProviderUsage,
  mergeUsage,
  type TenantProviderSummary,
} from '../../services/api/providers.js';
import { analyticsPing, routingPing } from '../../services/sse.js';
import { renameProviderKey } from '../../services/api/routing.js';
import { getPlaygroundAgent } from '../../services/api/playground.js';
import type { AuthType, CustomProviderData, RoutingProvider } from '../../services/api.js';
import type { CustomProviderPrefill, ProviderDeepLink } from '../../services/routing-params.js';
import { PROVIDERS, subscriptionCatalog, type ProviderDef } from '../../services/providers.js';
import { providerIcon } from '../../components/ProviderIcon.jsx';
import { toast } from '../../services/toast-store.js';
import { t } from '../../i18n/index.js';
import { me, roleCan } from '../../services/session-store.js';
import ProviderSelectModal from '../../components/ProviderSelectModal.jsx';
import CustomProviderForm from '../../components/CustomProviderForm.jsx';
import LocalServerForm from '../../components/LocalServerForm.jsx';
import type { LocalServerType } from '../../services/api.js';
import { Badge, Button, Modal, cx } from '../../components/ui.js';
import { useResource } from '../../lib/use-resource.js';
import { useSignal } from '../../lib/signal.js';

type ProviderPageKind = 'subscriptions' | 'byok' | 'local';
type ViewMode = 'list' | 'grid';
/** Which part of the page to render: the registered connections, the
 *  supported-provider catalog, or both stacked (the default). */
type PageView = 'connections' | 'catalog' | 'both';

interface ProviderConnectionsPageProps {
  kind: ProviderPageKind;
  view?: PageView;
}

interface AgentRow {
  agent_name: string;
}

interface PageCopy {
  title: string;
  heading: string;
  subtitle: string;
  addLabel: string;
  customAddLabel?: string;
  /** Catalog page the list's add button opens (pages split into list + catalog). */
  addPath?: string;
  addPageLabel?: string;
  emptyLabel?: string;
  connectedHeading: string;
  supportedHeading: string;
  authType: AuthType;
  activeLabel: (count: number) => string;
}

/** Page copy, read at render time so it follows the active language. */
const pageCopy = (kind: ProviderPageKind): PageCopy => {
  if (kind === 'subscriptions')
    return {
      title: t('providers.page.subscriptions.title'),
      heading: t('providers.kind.subscriptions'),
      subtitle: t('providers.page.subscriptions.subtitle'),
      addLabel: t('providers.connect'),
      addPath: '/providers/subscriptions/add',
      addPageLabel: t('providers.page.connectProvider'),
      emptyLabel: t('providers.page.noSubscriptionConnections'),
      connectedHeading: t('providers.page.subscriptions.connectedHeading'),
      supportedHeading: t('providers.page.subscriptions.supportedHeading'),
      authType: 'subscription',
      activeLabel: (n) => t('providers.page.activeConnections', n),
    };
  if (kind === 'byok')
    return {
      title: t('providers.page.byok.title'),
      heading: t('providers.kind.byok'),
      subtitle: t('providers.page.byok.subtitle'),
      addLabel: t('providers.connect'),
      customAddLabel: t('providers.page.addCustomProvider'),
      addPath: '/providers/usage-based/add',
      addPageLabel: t('providers.page.addProvider'),
      emptyLabel: t('providers.page.noConnections'),
      connectedHeading: t('providers.page.byok.connectedHeading'),
      supportedHeading: t('providers.page.byok.supportedHeading'),
      authType: 'api_key',
      activeLabel: (n) => t('providers.page.activeKeys', n),
    };
  return {
    title: t('providers.page.local.title'),
    heading: t('providers.kind.local'),
    subtitle: t('providers.page.local.subtitle'),
    addLabel: t('providers.connect'),
    connectedHeading: t('providers.page.local.connectedHeading'),
    supportedHeading: '',
    addPath: '/providers/local/add',
    addPageLabel: t('providers.page.addAiServer'),
    emptyLabel: t('providers.page.noLocalServers'),
    authType: 'local',
    activeLabel: (n) => t('providers.page.activeConnections', n),
  };
};

const providerListForKind = (
  kind: ProviderPageKind,
  hasConnection: (providerId: string) => boolean,
): ProviderDef[] => {
  if (kind === 'subscriptions') return subscriptionCatalog(PROVIDERS, hasConnection);
  if (kind === 'local') return PROVIDERS.filter((provider) => provider.localOnly);
  return PROVIDERS.filter((provider) => !provider.subscriptionOnly && !provider.localOnly);
};

const standardProviderName = (providerId: string): string | null =>
  PROVIDERS.find((provider) => provider.id === providerId)?.name ?? null;

const customProviderName = (
  providerId: string,
  customProviders: readonly CustomProviderData[],
): string | null => {
  if (!providerId.startsWith('custom:')) return null;
  const id = providerId.slice('custom:'.length);
  return customProviders.find((provider) => provider.id === id)?.name ?? null;
};

const providerDisplayName = (
  providerId: string,
  customProviders: readonly CustomProviderData[],
): string =>
  customProviderName(providerId, customProviders) ?? standardProviderName(providerId) ?? providerId;

const StatusBadge = ({ active }: { active: boolean }) =>
  active ? (
    <Badge tone="ok">{t('providers.active')}</Badge>
  ) : (
    <Badge>{t('providers.inactive')}</Badge>
  );

function ProviderMark({
  providerId,
  name,
  size = 20,
}: {
  providerId: string;
  name: string;
  size?: number;
}) {
  const icon = providerIcon(providerId, size);
  if (icon)
    return (
      <span className="flex shrink-0 items-center" style={{ width: size, height: size }}>
        {icon}
      </span>
    );
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-[4px] bg-accent-tint font-semibold text-accent',
        size > 40 ? 'text-xl' : size > 20 ? 'text-xs' : 'text-[11px]',
      )}
      style={{ width: size, height: size }}
    >
      {(name || providerId).charAt(0).toUpperCase()}
    </span>
  );
}

/** The servers of one local type, each with its address and an Edit action. */
function LocalServerList({
  servers,
  canManage,
  onEdit,
}: {
  servers: CustomProviderData[];
  canManage: boolean;
  onEdit: (cp: CustomProviderData) => void;
}) {
  if (servers.length === 0) {
    return <div className="text-xs text-muted">{t('providerSetup.localServer.noServers')}</div>;
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {servers.map((cp) => {
        const c = cp.local_config;
        const address = c ? `${c.host}:${c.port}${c.path_prefix}` : cp.base_url;
        return (
          <li key={cp.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0">
              <span className="block truncate font-medium text-ink">{cp.name}</span>
              <span className="block truncate font-mono text-xs text-muted">
                {address} · {t('providerSetup.localServer.modelCount', cp.models.length)}
              </span>
            </span>
            {canManage ? (
              <Button variant="ghost" size="sm" onClick={() => onEdit(cp)}>
                {t('providerSetup.localServer.edit')}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** A local server's address: scheme, host, port and path prefix. */
const localServerUrl = (cp: CustomProviderData): string => {
  const c = cp.local_config;
  return c ? `${c.scheme}://${c.host}:${c.port}${c.path_prefix}` : cp.base_url;
};

/** The registered local servers; the column headers show even when empty. */
function LocalServersTable({
  servers,
  connectionFor,
  canManage,
  onEdit,
  onOpen,
}: {
  servers: CustomProviderData[];
  connectionFor: (cp: CustomProviderData) => { id: string; is_active: boolean } | undefined;
  canManage: boolean;
  onEdit: (cp: CustomProviderData) => void;
  onOpen: (connectionId: string) => void;
}) {
  return (
    <div className="table-wrap mb-6">
      <table className="data">
        <thead>
          <tr>
            <th>{t('providers.page.colName')}</th>
            <th>{t('providers.page.colUrl')}</th>
            <th className="num">{t('providers.page.colModels')}</th>
            <th>{t('providers.page.colStatus')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {servers.map((cp) => {
            const connection = connectionFor(cp);
            return (
              <tr
                key={cp.id}
                className={connection ? 'cursor-pointer' : undefined}
                onClick={() => connection && onOpen(connection.id)}
              >
                <td>
                  <span className="flex items-center gap-2.5">
                    <ProviderMark providerId={cp.local_type ?? cp.id} name={cp.name} />
                    <span className="row-title">{cp.name}</span>
                  </span>
                </td>
                <td className="font-mono text-xs text-muted">{localServerUrl(cp)}</td>
                <td className="num">{cp.models.length}</td>
                <td>
                  <StatusBadge active={connection?.is_active ?? false} />
                </td>
                <td className="row-actions">
                  <span className="inline-flex items-center justify-end gap-2">
                    {canManage ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="whitespace-nowrap"
                        onClick={(event) => {
                          event.stopPropagation();
                          onEdit(cp);
                        }}
                      >
                        {t('providerSetup.localServer.edit')}
                      </Button>
                    ) : null}
                    {connection ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="whitespace-nowrap"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpen(connection.id);
                        }}
                      >
                        {t('providers.page.viewDetails')}
                      </Button>
                    ) : null}
                  </span>
                </td>
              </tr>
            );
          })}
          {servers.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-6 text-center text-muted">
                {t('providers.page.noLocalServers')}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function ActiveLabel({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-ok">
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  );
}

export default function ProviderConnectionsPage({
  kind,
  view = 'both',
}: ProviderConnectionsPageProps) {
  useSignal(me);
  const copy = pageCopy(kind);
  const canManage = roleCan.manageProviders();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showModal, setShowModal] = useState(false);
  const [showCustomModal, setShowCustomModal] = useState(false);
  // Local page: the server being added (no editData) or edited.
  const [localEditor, setLocalEditor] = useState<{
    type: LocalServerType;
    editData?: CustomProviderData;
  } | null>(null);
  const [deepLink, setDeepLink] = useState<ProviderDeepLink | null>(null);
  const [customProviderPrefill, setCustomProviderPrefill] = useState<CustomProviderPrefill | null>(
    null,
  );
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // Inline rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);

  const analyticsTick = useSignal(analyticsPing);
  const routingTick = useSignal(routingPing);

  // CONFIG resource — paints the page immediately (cheap endpoint, no
  // agent_messages scan).
  const config = useResource(async () => {
    try {
      return await getGlobalProviders();
    } catch {
      return { providers: [], model_counts: {} };
    }
  }, []);

  // USAGE resource — the expensive 30d aggregation, fetched independently. Its
  // deps include the SSE pings so coalesced message activity (analyticsPing) or
  // a provider connect/disconnect/rename (routingPing) re-runs the usage fetch.
  const usage = useResource(async () => {
    try {
      return (await getProviderUsage()).providers;
    } catch {
      return [];
    }
  }, [analyticsTick, routingTick]);

  // Coordinate a usage refetch alongside config on connect/disconnect/rename.
  const refetchGlobalProviders = () => Promise.all([config.reload(), usage.reload()]);

  // Merge config + usage by (provider, auth_type). While usage is still loading
  // every row carries zeroed usage. Usage numbers live on the Overview; here
  // they only decide whether an inactive connection still lists.
  const mergedProviders = useMemo(
    () => mergeUsage(config.data?.providers ?? [], usage.data),
    [config.data, usage.data],
  );

  const agents = useResource(async () => {
    try {
      const result = (await getAgents()) as { agents?: AgentRow[] } | AgentRow[];
      return Array.isArray(result) ? result : (result.agents ?? []);
    } catch {
      return [] as AgentRow[];
    }
  }, []);

  // Connections belong to the organization; the agent name only addresses the
  // routing endpoints. With no harness yet, the reserved Playground agent
  // stands in, so providers can be connected before the first harness.
  const noHarness = agents.data !== undefined && agents.data.length === 0;
  const playgroundAgent = useResource(
    async () => {
      try {
        return (await getPlaygroundAgent()).name;
      } catch {
        return '';
      }
    },
    [],
    { enabled: noHarness },
  );
  const firstAgentName = agents.data?.[0]?.agent_name ?? playgroundAgent.data ?? '';

  const modalProviders = useResource(async (): Promise<RoutingProvider[]> => {
    if (!firstAgentName) return [];
    try {
      return await getAgentProviders(firstAgentName);
    } catch {
      return [];
    }
  }, [firstAgentName]);

  const customProviders = useResource(async (): Promise<CustomProviderData[]> => {
    if (!firstAgentName) return [];
    try {
      return await getCustomProviders(firstAgentName);
    } catch {
      return [];
    }
  }, [firstAgentName]);

  const connectedSummaries = mergedProviders.filter(
    (provider) => provider.auth_type === copy.authType,
  );

  const hasUsage = (summary: TenantProviderSummary) =>
    summary.consumption_tokens > 0 || summary.consumption_messages > 0;

  const connectedRows: Array<{
    summary: TenantProviderSummary;
    connection: TenantProviderSummary['connections'][number];
    name: string;
  }> = [];
  for (const summary of connectedSummaries) {
    for (const connection of summary.connections) {
      if (!connection.is_active && kind !== 'subscriptions' && !hasUsage(summary)) continue;
      connectedRows.push({
        summary,
        connection,
        name: providerDisplayName(summary.provider, customProviders.data ?? []),
      });
    }
  }

  const connectedByProvider = new Map<string, TenantProviderSummary>();
  for (const summary of connectedSummaries) connectedByProvider.set(summary.provider, summary);

  const catalogProviders = providerListForKind(
    kind,
    (providerId) =>
      connectedByProvider.get(providerId)?.connections.some((connection) => connection.is_active) ??
      false,
  );

  const activeConnectionCount = (providerId: string) =>
    connectedByProvider.get(providerId)?.connections.filter((connection) => connection.is_active)
      .length ?? 0;

  const activeLabel = (count: number) => {
    if (kind === 'local') return t('providers.connected');
    return copy.activeLabel(count);
  };

  const startRename = (connectionId: string, currentLabel: string, e: SyntheticEvent) => {
    e.stopPropagation();
    setRenamingId(connectionId);
    setRenameValue(currentLabel);
    setRenameError('');
  };

  const cancelRename = (e?: SyntheticEvent) => {
    e?.stopPropagation();
    setRenamingId(null);
    setRenameError('');
  };

  const submitRename = async (
    provider: string,
    currentLabel: string,
    authType: string,
    e?: SyntheticEvent,
  ) => {
    e?.stopPropagation();
    const newLabel = renameValue.trim();
    if (!newLabel) {
      setRenameError(t('providers.nameEmpty'));
      return;
    }
    if (newLabel === currentLabel) {
      cancelRename();
      return;
    }
    if (!firstAgentName) return;
    setRenameBusy(true);
    setRenameError('');
    try {
      await renameProviderKey(
        firstAgentName,
        provider,
        currentLabel,
        newLabel,
        authType as AuthType,
      );
      toast.success(t('providers.connectionRenamed'));
      setRenamingId(null);
      void refetchGlobalProviders();
    } catch (err: unknown) {
      setRenameError((err as { message?: string })?.message ?? t('providers.renameFailed'));
    } finally {
      setRenameBusy(false);
    }
  };

  const openModal = (providerId?: string) => {
    setCustomProviderPrefill(null);
    // Deep-link with the page's auth type so the connection form opens in the
    // matching mode (e.g. the Subscriptions page opens the OAuth/subscription
    // flow rather than the API-key form for providers that support both).
    setDeepLink(providerId ? { providerId, authType: copy.authType } : null);
    void modalProviders.reload();
    setShowModal(true);
  };

  // Deep-link support: visiting a provider page with ?add=true auto-opens the
  // connect modal so onboarding surfaces can route a user straight into adding
  // a provider. React on every navigation (not just initial mount) and clear the
  // param (replace) so a refresh or back-nav doesn't re-trigger it.
  const addParam = searchParams.get('add');
  useEffect(() => {
    if (addParam !== 'true') return;
    if (view === 'connections' && copy.addPath) {
      void navigate(`${copy.addPath}?add=true`, { replace: true });
      return;
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('add');
        return next;
      },
      { replace: true },
    );
    openModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addParam]);

  const handleCustomModalClose = () => {
    setShowCustomModal(false);
    void refetchGlobalProviders();
    void customProviders.reload();
  };

  const handleModalClose = () => {
    setShowModal(false);
    setDeepLink(null);
    setCustomProviderPrefill(null);
    void refetchGlobalProviders();
  };

  const handleModalUpdate = async () => {
    await Promise.all([
      modalProviders.reload(),
      refetchGlobalProviders(),
      customProviders.reload(),
    ]);
  };

  const closeLocalEditor = () => {
    setLocalEditor(null);
    void Promise.all([refetchGlobalProviders(), customProviders.reload(), modalProviders.reload()]);
  };

  const localServers = (type: string) =>
    (customProviders.data ?? []).filter((cp) => cp.local_type === type);

  const goToConnection = (id: string) => navigate(`/providers/connections/${id}`);

  const addServerButton = (type: string) =>
    canManage ? (
      <Button
        variant="ghost"
        size="sm"
        className="whitespace-nowrap"
        disabled={!firstAgentName}
        onClick={() => setLocalEditor({ type: type as LocalServerType })}
      >
        {t('providerSetup.localServer.addServer')}
      </Button>
    ) : null;

  const connectButton = (providerId: string) =>
    canManage ? (
      <Button
        variant="ghost"
        size="sm"
        className="whitespace-nowrap"
        disabled={!firstAgentName}
        onClick={() => openModal(providerId)}
      >
        {copy.addLabel}
      </Button>
    ) : null;

  return (
    <div className="page wide">
      <title>{copy.title}</title>
      {view === 'connections' && canManage ? (
        <div className="page-head justify-end">
          <div className="page-actions">
            <Button size="sm" onClick={() => void navigate(copy.addPath ?? '')}>
              <Plus size={14} aria-hidden="true" />
              {copy.addPageLabel}
            </Button>
            {copy.customAddLabel ? (
              <Button variant="ghost" size="sm" onClick={() => setShowCustomModal(true)}>
                <Shapes size={14} aria-hidden="true" />
                {copy.customAddLabel}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {kind === 'local' && view === 'connections' ? (
        <LocalServersTable
          servers={(customProviders.data ?? []).filter((cp) => cp.local_type)}
          connectionFor={(cp) => connectedByProvider.get(`custom:${cp.id}`)?.connections[0]}
          canManage={canManage}
          onEdit={(cp) => setLocalEditor({ type: cp.local_type as LocalServerType, editData: cp })}
          onOpen={goToConnection}
        />
      ) : null}

      {view === 'connections' && kind !== 'local' && connectedRows.length === 0 ? (
        <div className="panel px-4 py-8 text-center text-sm text-muted">{copy.emptyLabel}</div>
      ) : null}

      {view !== 'catalog' &&
      !(kind === 'local' && view === 'connections') &&
      connectedRows.length > 0 ? (
        <>
          {view === 'both' ? (
            <h2 className="mb-3 text-sm font-semibold text-ink">{copy.connectedHeading}</h2>
          ) : null}
          <div className="table-wrap mb-6">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('providers.page.colProvider')}</th>
                  <th>{t('providers.page.colConnection')}</th>
                  <th className="num">{t('providers.page.colModels')}</th>
                  <th>{t('providers.page.colStatus')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {connectedRows.map((row) => {
                  const authType = row.summary.auth_type ?? copy.authType;

                  return (
                    <tr
                      key={row.connection.id}
                      className="group/row cursor-pointer"
                      tabIndex={0}
                      onClick={() => goToConnection(row.connection.id)}
                      onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          goToConnection(row.connection.id);
                        }
                      }}
                    >
                      <td>
                        <span className="flex items-center gap-2.5">
                          <ProviderMark providerId={row.summary.provider} name={row.name} />
                          <span className="row-title">{row.name}</span>
                          {row.summary.provider.startsWith('custom:') && kind !== 'local' ? (
                            <Badge tone="outline">{t('providers.custom')}</Badge>
                          ) : null}
                        </span>
                      </td>
                      <td className="text-muted" onClick={(e) => e.stopPropagation()}>
                        {renamingId === row.connection.id ? (
                          <>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                className="field h-7 w-32"
                                aria-invalid={renameError ? true : undefined}
                                value={renameValue}
                                autoFocus
                                onChange={(e) => {
                                  setRenameValue(e.currentTarget.value);
                                  setRenameError('');
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter')
                                    void submitRename(
                                      row.summary.provider,
                                      row.connection.label,
                                      authType,
                                      e,
                                    );
                                  if (e.key === 'Escape') cancelRename(e);
                                }}
                              />
                              <Button
                                size="sm"
                                disabled={renameBusy}
                                onClick={(e) =>
                                  void submitRename(
                                    row.summary.provider,
                                    row.connection.label,
                                    authType,
                                    e,
                                  )
                                }
                              >
                                {t('common.save')}
                              </Button>
                              <Button variant="ghost" size="sm" onClick={cancelRename}>
                                {t('common.cancel')}
                              </Button>
                            </div>
                            {renameError ? (
                              <div className="mt-0.5 text-xs text-danger">{renameError}</div>
                            ) : null}
                          </>
                        ) : (
                          <span className="inline-flex cursor-default items-center gap-1.5">
                            {row.connection.label}
                            {canManage ? (
                              <button
                                type="button"
                                className="inline-flex cursor-pointer items-center rounded-control border-0 bg-transparent p-0.5 text-muted opacity-0 transition-opacity group-hover/row:opacity-100 hover:text-ink focus-visible:opacity-100"
                                onClick={(e) =>
                                  startRename(row.connection.id, row.connection.label, e)
                                }
                                aria-label={t('providers.page.renameAria', {
                                  label: row.connection.label,
                                })}
                              >
                                <Pencil size={13} aria-hidden="true" />
                              </button>
                            ) : null}
                          </span>
                        )}
                      </td>
                      <td className="num">{row.connection.cached_model_count}</td>
                      <td>
                        <StatusBadge active={row.connection.is_active} />
                      </td>
                      <td className="row-actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="whitespace-nowrap"
                          onClick={(event) => {
                            event.stopPropagation();
                            goToConnection(row.connection.id);
                          }}
                        >
                          {t('providers.page.viewDetails')}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {view !== 'connections' ? (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            {copy.supportedHeading ? (
              <h2 className="m-0 text-sm font-semibold text-ink">{copy.supportedHeading}</h2>
            ) : (
              <span />
            )}
            <div className="segmented" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'grid'}
                aria-label={t('providers.page.gridView')}
                className="inline-flex items-center"
                onClick={() => setViewMode('grid')}
              >
                <LayoutGrid size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'list'}
                aria-label={t('providers.page.listView')}
                className="inline-flex items-center"
                onClick={() => setViewMode('list')}
              >
                <List size={14} aria-hidden="true" />
              </button>
            </div>
          </div>

          {viewMode === 'list' ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('providers.page.colProvider')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {catalogProviders.map((provider) => {
                    const activeCount = activeConnectionCount(provider.id);
                    return (
                      <tr key={provider.id}>
                        <td>
                          <span className="flex items-center gap-2.5">
                            <ProviderMark providerId={provider.id} name={provider.name} />
                            <span className="row-title">{provider.name}</span>
                          </span>
                          {kind === 'local' ? (
                            <LocalServerList
                              servers={localServers(provider.id)}
                              canManage={canManage}
                              onEdit={(cp) =>
                                setLocalEditor({
                                  type: provider.id as LocalServerType,
                                  editData: cp,
                                })
                              }
                            />
                          ) : null}
                        </td>
                        <td className="row-actions">
                          <span className="inline-flex items-center justify-end gap-2">
                            {activeCount > 0 ? (
                              <ActiveLabel>{activeLabel(activeCount)}</ActiveLabel>
                            ) : null}
                            {kind === 'local'
                              ? addServerButton(provider.id)
                              : connectButton(provider.id)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card-grid">
              {catalogProviders.map((provider) => {
                const activeCount = activeConnectionCount(provider.id);
                return (
                  <div key={provider.id} className="card flex flex-col gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <ProviderMark providerId={provider.id} name={provider.name} size={48} />
                      <span className="truncate text-[1.25rem] leading-tight font-semibold text-ink">
                        {provider.name}
                      </span>
                    </div>
                    {kind === 'local' ? (
                      <LocalServerList
                        servers={localServers(provider.id)}
                        canManage={canManage}
                        onEdit={(cp) =>
                          setLocalEditor({ type: provider.id as LocalServerType, editData: cp })
                        }
                      />
                    ) : null}
                    <div className="flex items-center justify-between gap-3">
                      {activeCount > 0 ? (
                        <ActiveLabel>{activeLabel(activeCount)}</ActiveLabel>
                      ) : (
                        <span />
                      )}
                      {kind === 'local' ? addServerButton(provider.id) : connectButton(provider.id)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : null}

      {showModal && firstAgentName ? (
        <ProviderSelectModal
          agentName={firstAgentName}
          providers={modalProviders.data ?? []}
          customProviders={customProviders.data ?? []}
          customProviderPrefill={customProviderPrefill}
          providerDeepLink={deepLink}
          initialTab={copy.authType}
          onUpdate={handleModalUpdate}
          onClose={handleModalClose}
        />
      ) : null}

      <Modal
        open={!!localEditor && !!firstAgentName}
        onClose={() => setLocalEditor(null)}
        label={t('providerSetup.localServer.addServer')}
        wide
      >
        {localEditor ? (
          <LocalServerForm
            agentName={firstAgentName}
            type={localEditor.type}
            editData={localEditor.editData}
            takenNames={(customProviders.data ?? []).map((cp) => cp.name)}
            onSaved={closeLocalEditor}
            onCancel={() => setLocalEditor(null)}
          />
        ) : null}
      </Modal>

      <Modal
        open={showCustomModal && !!firstAgentName}
        onClose={handleCustomModalClose}
        label={t('providers.page.addCustomProvider')}
        wide
      >
        <CustomProviderForm
          agentName={firstAgentName}
          onCreated={handleCustomModalClose}
          onBack={handleCustomModalClose}
        />
      </Modal>
    </div>
  );
}
