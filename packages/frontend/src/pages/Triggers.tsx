import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { FlaskConical, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import ErrorState from '../components/ErrorState.js';
import TriggerDeliveries from '../components/triggers/TriggerDeliveries.js';
import TriggerEditor from '../components/triggers/TriggerEditor.js';
import { TriggerTypeTag } from '../components/triggers/TriggerParts.js';
import { eventLabel, providerOf, triggerTestPath } from '../components/triggers/trigger-form.js';
import { Badge, Button, EmptyState, IconButton, Modal, Switch, Tabs } from '../components/ui.js';
import {
  deleteTrigger,
  listTriggers,
  updateTrigger,
  type TriggerView,
} from '../services/api/triggers.js';
import { roleCan } from '../services/session-store.js';
import { toast } from '../services/toast-store.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';

type Tab = 'triggers' | 'deliveries';

/**
 * Workspace triggers: delivery targets for harness and workspace events.
 * Admins and owners manage them and see deliveries; everyone else reads the list.
 */
export default function Triggers() {
  const canManage = roleCan.manageProviders();
  const triggers = useResource(listTriggers, []);
  const [tab, setTab] = useState<Tab>('triggers');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<TriggerView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TriggerView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const list = triggers.data ?? [];

  const openEditor = (trigger: TriggerView | null) => {
    setEditing(trigger);
    setEditorOpen(true);
  };
  const closeEditor = useCallback(() => setEditorOpen(false), []);
  const closeDelete = useCallback(() => setDeleteTarget(null), []);

  const handleSaved = (saved: TriggerView) => {
    setEditorOpen(false);
    triggers.setData((prev) => {
      const items = prev ?? [];
      return items.some((x) => x.id === saved.id)
        ? items.map((x) => (x.id === saved.id ? saved : x))
        : [...items, saved];
    });
    void triggers.reload();
  };

  const toggle = async (trigger: TriggerView, enabled: boolean) => {
    setToggling(trigger.id);
    try {
      const saved = await updateTrigger(trigger.id, { enabled });
      triggers.setData((prev) => prev?.map((x) => (x.id === trigger.id ? saved : x)));
      toast.success(enabled ? t('triggers.toast.enabled') : t('triggers.toast.disabled'));
    } catch {
      // toasted
    } finally {
      setToggling(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteTrigger(deleteTarget.id);
      triggers.setData((prev) => prev?.filter((x) => x.id !== deleteTarget.id));
      toast.success(t('triggers.toast.deleted'));
      setDeleteTarget(null);
    } catch {
      // toasted
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="page">
      <title>{t('common.pageTitle', { page: t('triggers.title') })}</title>
      <meta name="description" content={t('triggers.metaDescription')} />

      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <p className="max-w-3xl text-sm text-muted">{t('triggers.subtitle')}</p>
          {canManage && tab === 'triggers' ? (
            <Button size="sm" className="shrink-0" onClick={() => openEditor(null)}>
              <Plus aria-hidden="true" />
              {t('triggers.create')}
            </Button>
          ) : null}
        </div>

        {canManage ? (
          <Tabs<Tab>
            label={t('triggers.title')}
            value={tab}
            onChange={setTab}
            items={[
              { key: 'triggers', label: t('triggers.tabs.triggers'), count: list.length },
              { key: 'deliveries', label: t('triggers.tabs.deliveries') },
            ]}
          />
        ) : (
          <div className="notice is-info">
            <span>{t('triggers.readOnlyNotice')}</span>
          </div>
        )}

        {tab === 'deliveries' && canManage ? (
          <TriggerDeliveries triggers={list} />
        ) : triggers.error ? (
          <ErrorState error={triggers.error} onRetry={() => void triggers.reload()} />
        ) : !triggers.loading && list.length === 0 ? (
          <EmptyState
            icon={<Zap aria-hidden="true" />}
            title={t('triggers.list.emptyTitle')}
            description={
              canManage ? t('triggers.list.emptyBody') : t('triggers.list.emptyBodyReadOnly')
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('triggers.list.name')}</th>
                  <th>{t('triggers.list.type')}</th>
                  <th>{t('triggers.list.enabled')}</th>
                  <th>{t('triggers.list.harnesses')}</th>
                  <th className="text-right">{t('triggers.list.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {triggers.loading && list.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-muted">
                      {t('common.loading')}
                    </td>
                  </tr>
                ) : null}
                {list.map((trigger) => (
                  <tr key={trigger.id}>
                    <td>
                      <button
                        type="button"
                        className="row-title text-left hover:underline"
                        onClick={() => openEditor(trigger)}
                      >
                        {trigger.name}
                      </button>
                      {trigger.workspace_events?.length ? (
                        <div
                          className="row-sub"
                          title={trigger.workspace_events.map((e) => eventLabel(e)).join(', ')}
                        >
                          {t('triggers.list.workspaceEvents', trigger.workspace_events.length)}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <TriggerTypeTag type={trigger.type} provider={providerOf(trigger)} />
                    </td>
                    <td>
                      {canManage ? (
                        <Switch
                          checked={trigger.enabled}
                          disabled={toggling === trigger.id}
                          label={t('triggers.list.toggle', { name: trigger.name })}
                          onChange={(v) => void toggle(trigger, v)}
                        />
                      ) : (
                        <Badge tone={trigger.enabled ? 'ok' : 'neutral'}>
                          {trigger.enabled ? t('common.enabled') : t('common.disabled')}
                        </Badge>
                      )}
                    </td>
                    <td className="text-dim">
                      {t('triggers.list.harnessCount', trigger.harness_count ?? 0)}
                    </td>
                    <td>
                      <div className="row-actions">
                        {canManage ? (
                          <>
                            <IconButton
                              label={t('triggers.list.editNamed', { name: trigger.name })}
                              onClick={() => openEditor(trigger)}
                            >
                              <Pencil aria-hidden="true" />
                            </IconButton>
                            <Link
                              to={triggerTestPath(trigger.id)}
                              className="icon-btn"
                              aria-label={t('triggers.list.testNamed', { name: trigger.name })}
                              title={t('triggers.list.testNamed', { name: trigger.name })}
                            >
                              <FlaskConical aria-hidden="true" />
                            </Link>
                            <IconButton
                              label={t('triggers.list.deleteNamed', { name: trigger.name })}
                              className="hover:text-danger"
                              onClick={() => setDeleteTarget(trigger)}
                            >
                              <Trash2 aria-hidden="true" />
                            </IconButton>
                          </>
                        ) : (
                          <Button variant="quiet" size="sm" onClick={() => openEditor(trigger)}>
                            {t('triggers.list.view')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TriggerEditor
        open={editorOpen}
        trigger={editing}
        readOnly={!canManage}
        onClose={closeEditor}
        onSaved={handleSaved}
      />

      <Modal open={!!deleteTarget} title={t('triggers.deleteModal.title')} onClose={closeDelete}>
        <p className="text-sm text-dim">
          {t('triggers.deleteModal.body', { name: deleteTarget?.name ?? '' })}
          {deleteTarget?.harness_count
            ? ` ${t('triggers.deleteModal.bound', deleteTarget.harness_count)}`
            : null}
        </p>
        <div className="actions">
          <Button variant="ghost" size="sm" onClick={closeDelete}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" size="sm" busy={deleting} onClick={() => void handleDelete()}>
            {t('triggers.deleteModal.submit')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
