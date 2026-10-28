import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Copy, LayoutGrid, Plus, Rows3, Trash2 } from 'lucide-react';
import { platformIcon } from 'thinker-shared';
import ErrorState from '../components/ErrorState.js';
import ActionMenu from '../components/ActionMenu.js';
import AddAgentModal from '../components/AddAgentModal.js';
import DuplicateAgentModal from '../components/DuplicateAgentModal.js';
import Sparkline from '../components/Sparkline.js';
import RichText from '../components/RichText.js';
import { Button, EmptyState, Modal, Skel } from '../components/ui.js';
import { getAgents, deleteAgent } from '../services/api.js';
import { toast } from '../services/toast-store.js';
import { me, roleCan } from '../services/session-store.js';
import { formatCost, formatNumber, formatTime } from '../services/formatters.js';
import { agentPing, analyticsPing } from '../services/sse.js';
import { useSignal } from '../lib/signal.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';

interface Agent {
  agent_name: string;
  display_name?: string;
  agent_category?: string | null;
  agent_platform?: string | null;
  message_count: number;
  last_active: string;
  total_cost: number;
  total_tokens: number;
  sparkline: number[];
}

interface AgentsData {
  agents: Agent[];
}

type HarnessView = 'grid' | 'table';
const VIEW_STORAGE_KEY = 'thinker_harness_view';

function readStoredView(): HarnessView {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'table' ? 'table' : 'grid';
  } catch {
    return 'grid';
  }
}

const harnessPath = (name: string) => `/harnesses/${encodeURIComponent(name)}`;

function TableHead() {
  return (
    <thead>
      <tr>
        <th>{t('harnesses.workspace.colHarness')}</th>
        <th className="num">{t('harnesses.workspace.colRequests')}</th>
        <th className="num">{t('harnesses.workspace.colTokens')}</th>
        <th className="num">{t('harnesses.workspace.colCost')}</th>
        <th>{t('harnesses.workspace.colLastActive')}</th>
        <th aria-label={t('common.actions')} />
      </tr>
    </thead>
  );
}

export default function Workspace() {
  useSignal(me);
  const agentTick = useSignal(agentPing);
  const analyticsTick = useSignal(analyticsPing);
  const canEdit = roleCan.editHarnesses();
  const data = useResource(() => getAgents() as Promise<AgentsData>, [agentTick, analyticsTick]);

  const [modalOpen, setModalOpen] = useState(false);
  const [view, setView] = useState<HarnessView>(readStoredView);
  const switchView = (next: HarnessView) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      /* storage unavailable */
    }
  };

  // Deep-link support: visiting /harnesses?add=true opens the connect modal so
  // onboarding surfaces can route a user straight into creating an agent. This
  // reacts on every navigation, not just mount, and clears the param (replace)
  // so a refresh or back-navigation doesn't re-trigger it.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('add') !== 'true') return;
    setModalOpen(true);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('add');
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  const [duplicateSource, setDuplicateSource] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Shared by the grid card menu and the table row menu so both views stay in sync.
  const harnessActionItems = (agentName: string) => [
    {
      label: t('harnesses.workspace.duplicate'),
      icon: <Copy className="size-3.5" aria-hidden="true" />,
      onClick: () => setDuplicateSource(agentName),
    },
    {
      label: t('common.delete'),
      danger: true,
      icon: <Trash2 className="size-3.5" aria-hidden="true" />,
      onClick: () => {
        setDeleteTarget(agentName);
        setDeleteConfirmName('');
      },
    },
  ];

  const closeDeleteModal = () => {
    setDeleteTarget(null);
    setDeleteConfirmName('');
  };

  const handleDelete = async () => {
    const target = deleteTarget;
    if (!target || deleteConfirmName !== target) return;
    setDeleting(true);
    try {
      await deleteAgent(target);
      toast.success(t('harnesses.deleted', { name: target }));
      closeDeleteModal();
      await data.reload();
    } catch {
      // error toast handled by fetchMutate
    } finally {
      setDeleting(false);
    }
  };

  const agents = data.data?.agents ?? [];
  const firstLoad = data.loading && !data.data && !data.error;

  const viewToggle = (
    <div className="segmented" role="group" aria-label={t('harnesses.workspace.layout')}>
      <button
        type="button"
        aria-pressed={view === 'grid'}
        aria-label={t('harnesses.workspace.gridView')}
        title={t('harnesses.workspace.gridView')}
        onClick={() => switchView('grid')}
      >
        <LayoutGrid className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-pressed={view === 'table'}
        aria-label={t('harnesses.workspace.tableView')}
        title={t('harnesses.workspace.tableView')}
        onClick={() => switchView('table')}
      >
        <Rows3 className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );

  const skeleton =
    view === 'table' ? (
      <div className="table-wrap">
        <table className="data">
          <TableHead />
          <tbody>
            {[1, 2, 3, 4, 5].map((i) => (
              <tr key={i}>
                <td>
                  <Skel width="40%" />
                </td>
                <td>
                  <Skel width="60%" />
                </td>
                <td>
                  <Skel width="60%" />
                </td>
                <td>
                  <Skel width="50%" />
                </td>
                <td>
                  <Skel width="70%" />
                </td>
                <td className="workspace-table__actions">
                  <Skel width={20} height={20} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="card-grid">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="card flex flex-col gap-3">
            <Skel width="60%" height={18} />
            <div className="flex gap-4">
              <Skel width="30%" height={14} />
              <Skel width="30%" height={14} />
            </div>
            <Skel width="100%" height={50} />
          </div>
        ))}
      </div>
    );

  const tableView = (
    <div className="table-wrap">
      <table className="data">
        <TableHead />
        <tbody>
          {agents.map((agent) => {
            const icon = platformIcon(agent.agent_platform, agent.agent_category);
            return (
              <tr key={agent.agent_name}>
                <td>
                  <Link
                    to={harnessPath(agent.agent_name)}
                    className="row-title inline-flex items-center gap-2 hover:underline"
                  >
                    {icon ? (
                      <img
                        src={icon}
                        alt=""
                        width="16"
                        height="16"
                        className="workspace-table__icon shrink-0"
                      />
                    ) : null}
                    {agent.display_name ?? agent.agent_name}
                  </Link>
                </td>
                <td className="num">{formatNumber(agent.message_count)}</td>
                <td className="num">{formatNumber(agent.total_tokens)}</td>
                <td className="num">{formatCost(agent.total_cost) ?? '—'}</td>
                <td>{agent.last_active ? formatTime(agent.last_active) : '—'}</td>
                <td className="workspace-table__actions">
                  {canEdit ? (
                    <div className="row-actions">
                      <ActionMenu
                        ariaLabel={t('harnesses.workspace.actionsFor', {
                          name: agent.agent_name,
                        })}
                        items={harnessActionItems(agent.agent_name)}
                      />
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const gridView = (
    <div className="agents-grid card-grid">
      {agents.map((agent) => {
        const icon = platformIcon(agent.agent_platform, agent.agent_category);
        return (
          <div key={agent.agent_name} className="relative">
            <Link
              to={harnessPath(agent.agent_name)}
              className="agent-card card flex flex-col gap-3 transition-colors hover:border-line-strong"
            >
              <div className="flex min-w-0 items-center gap-2 pr-8">
                {icon ? (
                  <img
                    src={icon}
                    alt=""
                    width="18"
                    height="18"
                    className="agent-card__platform-icon shrink-0"
                  />
                ) : null}
                <span className="truncate text-sm font-semibold text-ink">
                  {agent.display_name ?? agent.agent_name}
                </span>
              </div>
              <div className="flex gap-6">
                <div className="flex flex-col">
                  <span className="text-xs text-muted">{t('harnesses.workspace.colTokens')}</span>
                  <span className="font-mono text-sm text-ink">
                    {formatNumber(agent.total_tokens)}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-muted">{t('harnesses.workspace.colRequests')}</span>
                  <span className="font-mono text-sm text-ink">
                    {formatNumber(agent.message_count)}
                  </span>
                </div>
              </div>
              <div className="text-accent">
                <Sparkline data={agent.sparkline} width={280} height={50} />
              </div>
            </Link>
            {canEdit ? (
              <div className="absolute right-2 top-2">
                <ActionMenu
                  className="agent-card__menu"
                  ariaLabel={t('harnesses.workspace.actionsFor', { name: agent.agent_name })}
                  items={harnessActionItems(agent.agent_name)}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="page">
      <title>{t('common.pageTitle', { page: t('harnesses.workspace.title') })}</title>
      <meta name="description" content={t('harnesses.workspace.metaDescription')} />
      <div className="page-head justify-end">
        <div className="page-actions">
          {viewToggle}
          {canEdit ? (
            <Button size="sm" onClick={() => setModalOpen(true)}>
              <Plus aria-hidden="true" />
              {t('harnesses.workspace.connect')}
            </Button>
          ) : null}
        </div>
      </div>

      {firstLoad ? (
        skeleton
      ) : data.error ? (
        <ErrorState error={data.error} onRetry={() => void data.reload()} />
      ) : agents.length === 0 ? (
        <div className="panel">
          <EmptyState
            title={t('harnesses.workspace.emptyTitle')}
            description={t('harnesses.workspace.emptyBody')}
            action={
              canEdit ? (
                <Button size="sm" className="mt-2" onClick={() => setModalOpen(true)}>
                  {t('harnesses.workspace.connectFirst')}
                </Button>
              ) : null
            }
          />
        </div>
      ) : view === 'grid' ? (
        gridView
      ) : (
        tableView
      )}

      <AddAgentModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <DuplicateAgentModal
        open={duplicateSource !== null}
        sourceName={duplicateSource ?? ''}
        onClose={() => setDuplicateSource(null)}
        onDuplicated={() => void data.reload()}
      />

      <Modal
        open={deleteTarget !== null}
        onClose={closeDeleteModal}
        title={t('harnesses.workspace.deleteTitle', { name: deleteTarget ?? '' })}
      >
        <p className="mb-4 text-sm text-muted">
          <RichText
            text={t('harnesses.workspace.deleteBody')}
            parts={{ name: <strong className="text-ink">{deleteTarget}</strong> }}
          />
        </p>
        <label className="label" htmlFor="workspace-delete-confirm">
          <RichText
            text={t('harnesses.workspace.deleteConfirm')}
            parts={{ name: <strong className="text-ink">"{deleteTarget}"</strong> }}
          />
        </label>
        <input
          id="workspace-delete-confirm"
          className="field"
          type="text"
          value={deleteConfirmName}
          onChange={(e) => setDeleteConfirmName(e.currentTarget.value)}
          placeholder={deleteTarget ?? ''}
        />
        <div className="actions">
          <Button variant="ghost" size="sm" onClick={closeDeleteModal} disabled={deleting}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => void handleDelete()}
            disabled={deleteConfirmName !== deleteTarget}
            busy={deleting}
          >
            {deleting ? null : t('harnesses.workspace.deleteButton')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
