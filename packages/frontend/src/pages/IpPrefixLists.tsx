import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { EthernetPort, Pencil, Plus, Trash2 } from 'lucide-react';
import ActionMenu from '../components/ActionMenu.js';
import ErrorState from '../components/ErrorState.js';
import IpAclWindow from '../components/IpAclWindow.js';
import { Button, EmptyState, Modal } from '../components/ui.js';
import {
  deleteIpPrefixList,
  listIpPrefixLists,
  type IpPrefixListView,
} from '../services/api/ip-prefix-lists.js';
import { formatDateTime } from '../services/formatters.js';
import { roleCan } from '../services/session-store.js';
import { toast } from '../services/toast-store.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';

/**
 * IP ACLs of the organization (/ip-prefix-lists): named sets of addresses and
 * prefixes a harness key can be restricted to. Admin-only. `?edit=<id>`
 * (or `?edit=new`) opens the floating editor.
 */
export default function IpPrefixLists() {
  const canManage = roleCan.manageProviders();
  const res = useResource(listIpPrefixLists, [], { enabled: canManage });
  const lists = res.data?.lists ?? [];
  const [params, setParams] = useSearchParams();
  const editing = canManage ? params.get('edit') : null;
  const [removeTarget, setRemoveTarget] = useState<IpPrefixListView | null>(null);
  const [removing, setRemoving] = useState(false);

  const openEditor = (id: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set('edit', id);
        else next.delete('edit');
        return next;
      },
      { replace: true },
    );

  const handleSaved = (saved: IpPrefixListView) => {
    res.setData((prev) => {
      const items = prev?.lists ?? [];
      return {
        lists: items.some((x) => x.id === saved.id)
          ? items.map((x) => (x.id === saved.id ? saved : x))
          : [...items, saved],
      };
    });
    openEditor(null);
    void res.reload();
  };

  const handleDeleted = (id: string) => {
    res.setData((prev) => ({ lists: (prev?.lists ?? []).filter((x) => x.id !== id) }));
    openEditor(null);
    void res.reload();
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await deleteIpPrefixList(removeTarget.id);
      toast.success(t('ipLists.toast.deleted'));
      handleDeleted(removeTarget.id);
      setRemoveTarget(null);
    } catch {
      // toasted (409 when a key started using it meanwhile)
      void res.reload();
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="page">
      <title>{t('common.pageTitle', { page: t('ipLists.title') })}</title>
      <meta name="description" content={t('ipLists.metaDescription')} />
      {!canManage ? (
        <div className="notice is-info">
          <span>{t('ipLists.adminOnly')}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <p className="m-0 max-w-3xl text-sm text-muted">{t('ipLists.subtitle')}</p>
            <Button size="sm" className="shrink-0" onClick={() => openEditor('new')}>
              <Plus aria-hidden="true" />
              {t('ipLists.create')}
            </Button>
          </div>
          {res.error ? (
            <ErrorState error={res.error} onRetry={() => void res.reload()} />
          ) : !res.loading && lists.length === 0 ? (
            <EmptyState
              icon={<EthernetPort aria-hidden="true" />}
              title={t('ipLists.list.emptyTitle')}
              description={t('ipLists.list.emptyBody')}
            />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('ipLists.list.name')}</th>
                    <th className="num">{t('ipLists.list.entries')}</th>
                    <th>{t('ipLists.list.harnesses')}</th>
                    <th>{t('ipLists.list.updated')}</th>
                    <th className="text-right">
                      <span className="sr-only">{t('ipLists.list.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {res.loading && lists.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-muted">
                        {t('common.loading')}
                      </td>
                    </tr>
                  ) : null}
                  {lists.map((list) => {
                    const inUse = list.keys.length > 0;
                    return (
                      <tr key={list.id}>
                        <td>
                          <button
                            type="button"
                            className="row-title inline-flex items-center gap-2 text-left hover:underline"
                            onClick={() => openEditor(list.id)}
                          >
                            <EthernetPort
                              aria-hidden="true"
                              className="size-4 shrink-0 text-muted"
                            />
                            {list.name}
                          </button>
                          {list.description ? (
                            <div className="row-sub">{list.description}</div>
                          ) : null}
                        </td>
                        <td className="num">{list.entries.length}</td>
                        <td className="text-sm">
                          {list.harnesses.length ? (
                            list.harnesses.map((h) => h.displayName || h.name).join(', ')
                          ) : (
                            <span className="text-muted">{t('ipLists.list.none')}</span>
                          )}
                        </td>
                        <td className="text-sm text-dim">{formatDateTime(list.updatedAt)}</td>
                        <td className="text-right">
                          <ActionMenu
                            ariaLabel={t('ipLists.list.menu', { name: list.name })}
                            items={[
                              {
                                label: t('ipLists.list.edit'),
                                icon: <Pencil aria-hidden="true" />,
                                onClick: () => openEditor(list.id),
                              },
                              {
                                label: t('ipLists.list.remove'),
                                icon: <Trash2 aria-hidden="true" />,
                                danger: true,
                                disabled: inUse,
                                title: inUse ? t('ipLists.list.removeInUse') : undefined,
                                onClick: () => setRemoveTarget(list),
                              },
                            ]}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <IpAclWindow
        listId={editing}
        onClose={() => openEditor(null)}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
      />

      <Modal
        open={!!removeTarget}
        title={t('ipLists.removeModal.title')}
        onClose={() => setRemoveTarget(null)}
      >
        <p className="text-sm text-dim">
          {t('ipLists.removeModal.body', { name: removeTarget?.name ?? '' })}
        </p>
        <div className="actions">
          <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" size="sm" busy={removing} onClick={() => void handleRemove()}>
            {t('ipLists.removeModal.submit')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
