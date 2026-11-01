import { useState } from 'react';
import { Link } from 'react-router';
import { Network, Plus } from 'lucide-react';
import ErrorState from '../components/ErrorState.js';
import { endpointOf, ProxyStatusBadge } from '../components/proxy/ProxyParts.js';
import { Badge, ButtonLink, EmptyState, Switch } from '../components/ui.js';
import { listProxies, proxyPath, updateProxy, type ProxyView } from '../services/api/proxies.js';
import { formatNumber } from '../services/formatters.js';
import { roleCan } from '../services/session-store.js';
import { toast } from '../services/toast-store.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';

/** Workspace proxy servers (/proxy-servers): outbound HTTP proxies and their 7-day health. */
export default function ProxyServers() {
  const canManage = roleCan.manageProviders();
  const res = useResource(listProxies, [], { enabled: canManage });
  const [toggling, setToggling] = useState<string | null>(null);
  const list = res.data?.proxies ?? [];
  const global = res.data?.global ?? null;

  const toggle = async (proxy: ProxyView, enabled: boolean) => {
    setToggling(proxy.id);
    try {
      const saved = await updateProxy(proxy.id, { enabled });
      res.setData((prev) =>
        prev
          ? {
              ...prev,
              proxies: prev.proxies.map((x) => (x.id === proxy.id ? { ...x, ...saved } : x)),
            }
          : prev,
      );
      toast.success(enabled ? t('proxies.toast.enabled') : t('proxies.toast.disabled'));
    } catch {
      // toasted
    } finally {
      setToggling(null);
    }
  };

  return (
    <div className="page">
      <title>{t('common.pageTitle', { page: t('proxies.title') })}</title>
      <meta name="description" content={t('proxies.metaDescription')} />

      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <p className="max-w-3xl text-sm text-muted">{t('proxies.subtitle')}</p>
          {canManage ? (
            <ButtonLink to="/proxy-servers/new" size="sm" className="shrink-0">
              <Plus aria-hidden="true" />
              {t('proxies.create')}
            </ButtonLink>
          ) : null}
        </div>

        {!canManage ? (
          <div className="notice is-info">
            <span>{t('proxies.adminOnly')}</span>
          </div>
        ) : (
          <>
            {global ? (
              <div className="notice is-info">
                <span>
                  {t('proxies.global.note')} <code>{global.url}</code>
                  {global.no_proxy.length ? (
                    <>
                      {' '}
                      {t('proxies.global.noProxy')} <code>{global.no_proxy.join(', ')}</code>
                    </>
                  ) : null}
                </span>
              </div>
            ) : null}

            {res.error ? (
              <ErrorState error={res.error} onRetry={() => void res.reload()} />
            ) : !res.loading && list.length === 0 ? (
              <EmptyState
                icon={<Network aria-hidden="true" />}
                title={t('proxies.list.emptyTitle')}
                description={t('proxies.list.emptyBody')}
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('proxies.list.name')}</th>
                      <th>{t('proxies.list.endpoint')}</th>
                      <th>{t('proxies.list.status')}</th>
                      <th className="num">{t('proxies.list.connections')}</th>
                      <th className="num">{t('proxies.list.failures')}</th>
                      <th className="num">{t('proxies.list.avgTunnel')}</th>
                      <th className="num">{t('proxies.list.bindings')}</th>
                      <th>{t('proxies.list.enabled')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.loading && list.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-muted">
                          {t('common.loading')}
                        </td>
                      </tr>
                    ) : null}
                    {list.map((proxy) => (
                      <tr key={proxy.id}>
                        <td>
                          <Link to={proxyPath(proxy.id)} className="row-title hover:underline">
                            {proxy.name}
                          </Link>
                          {proxy.debug_enabled ? (
                            <div className="row-sub">
                              <Badge tone="info">{t('proxies.list.debug')}</Badge>
                            </div>
                          ) : null}
                        </td>
                        <td className="font-mono text-xs text-dim">{endpointOf(proxy)}</td>
                        <td>
                          <ProxyStatusBadge status={proxy.status} />
                        </td>
                        <td className="num">{formatNumber(proxy.stats_7d?.connections ?? 0)}</td>
                        <td className="num">
                          {proxy.stats_7d?.failures ? (
                            <span className="text-danger">
                              {formatNumber(proxy.stats_7d.failures)}
                            </span>
                          ) : (
                            '0'
                          )}
                        </td>
                        <td className="num">
                          {proxy.stats_7d?.avg_tunnel_ms != null
                            ? t('proxies.common.ms', {
                                ms: Math.round(proxy.stats_7d.avg_tunnel_ms),
                              })
                            : '—'}
                        </td>
                        <td className="num">{proxy.binding_count}</td>
                        <td>
                          <Switch
                            checked={proxy.enabled}
                            disabled={toggling === proxy.id}
                            label={t('proxies.list.toggle', { name: proxy.name })}
                            onChange={(v) => void toggle(proxy, v)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
