import { Link } from 'react-router';
import { ListFilter, Plus } from 'lucide-react';
import ErrorState from '../components/ErrorState.js';
import { ButtonLink, EmptyState } from '../components/ui.js';
import { ipPrefixListPath, listIpPrefixLists } from '../services/api/ip-prefix-lists.js';
import { formatDateTime } from '../services/formatters.js';
import { roleCan } from '../services/session-store.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';

/**
 * IP prefix lists of the organization (/ip-prefix-lists): named sets of
 * addresses and prefixes a harness can restrict its keys to. Admin-only.
 */
export default function IpPrefixLists() {
  const canManage = roleCan.manageProviders();
  const res = useResource(listIpPrefixLists, [], { enabled: canManage });
  const lists = res.data?.lists ?? [];

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
            <ButtonLink size="sm" className="shrink-0" to="/ip-prefix-lists/new">
              <Plus aria-hidden="true" />
              {t('ipLists.create')}
            </ButtonLink>
          </div>
          {res.error ? (
            <ErrorState error={res.error} onRetry={() => void res.reload()} />
          ) : !res.loading && lists.length === 0 ? (
            <EmptyState
              icon={<ListFilter aria-hidden="true" />}
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
                  </tr>
                </thead>
                <tbody>
                  {res.loading && lists.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-muted">
                        {t('common.loading')}
                      </td>
                    </tr>
                  ) : null}
                  {lists.map((list) => (
                    <tr key={list.id}>
                      <td>
                        <Link
                          to={ipPrefixListPath(list.id)}
                          className="row-title inline-flex items-center gap-2 hover:underline"
                        >
                          <ListFilter aria-hidden="true" className="size-4 shrink-0 text-muted" />
                          {list.name}
                        </Link>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
