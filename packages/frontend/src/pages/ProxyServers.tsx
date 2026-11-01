import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Network, Plus } from 'lucide-react';
import ErrorState from '../components/ErrorState.js';
import { endpointOf, ProxyStatusBadge } from '../components/proxy/ProxyParts.js';
import ProviderDefaultsTab from '../components/proxy/ProviderDefaultsTab.js';
import ProxyProfilesTab from '../components/proxy/ProxyProfilesTab.js';
import { Badge, ButtonLink, EmptyState, Switch, Tabs } from '../components/ui.js';
import { listProxies, proxyPath, updateProxy, type ProxyView } from '../services/api/proxies.js';
import { formatNumber } from '../services/formatters.js';
import { roleCan } from '../services/session-store.js';
import { toast } from '../services/toast-store.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';

type Tab = 'servers' | 'profiles' | 'providers';
const TABS: Tab[] = ['servers', 'profiles', 'providers'];

/**
 * Proxy configuration (/proxy-servers): proxy servers, outbound profiles
 * (ordered chains) and the default outbound path of each provider.
 */
export default function ProxyServers() {
  const canManage = roleCan.manageProviders();
  const [params] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : 'servers';

  return (
    <div className="page">
      <title>{t('common.pageTitle', { page: t('proxies.title') })}</title>
      <meta name="description" content={t('proxies.metaDescription')} />
      {!canManage ? (
        <div className="notice is-info">
          <span>{t('proxies.adminOnly')}</span>
        </div>
      ) : (
        <>
          <Tabs<Tab>
            className="mb-4"
            label={t('proxies.title')}
            value={tab}
            items={[
              { key: 'servers', label: t('proxies.tabs.servers'), to: '/proxy-servers' },
              {
                key: 'profiles',
                label: t('proxies.tabs.profiles'),
                to: '/proxy-servers?tab=profiles',
              },
              {
                key: 'providers',
                label: t('proxies.tabs.providers'),
                to: '/proxy-servers?tab=providers',
              },
            ]}
          />
          {tab === 'profiles' ? (
            <ProxyProfilesTab />
          ) : tab === 'providers' ? (
            <ProviderDefaultsTab />
          ) : (
            <ServersTab />
          )}
        </>
      )}
    </div>
  );
}

/** Workspace proxy servers: outbound HTTP proxies and their 7-day health. */
function ServersTab() {
  const res = useResource(listProxies, []);
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
    <div>
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <p className="m-0 max-w-3xl text-sm text-muted">{t('proxies.subtitle')}</p>
          <ButtonLink to="/proxy-servers/new" size="sm" className="shrink-0">
            <Plus aria-hidden="true" />
            {t('proxies.create')}
          </ButtonLink>
        </div>

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
      </div>
    </div>
  );
}
