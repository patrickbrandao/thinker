import { Fragment } from 'react';
import { Link } from 'react-router';
import { t, tMaybe } from '../../i18n/index.js';
import {
  proxyPath,
  type Egress,
  type EgressHop,
  type ProxyStatus,
} from '../../services/api/proxies.js';
import { Badge, cx } from '../ui.js';

export const endpointOf = (p: { scheme: string; host: string; port: number }) =>
  `${p.scheme}://${p.host.includes(':') ? `[${p.host}]` : p.host}:${p.port}`;

const STATUS_TONE: Record<ProxyStatus, 'ok' | 'warn' | 'danger' | 'neutral' | 'outline'> = {
  ok: 'ok',
  degraded: 'warn',
  failing: 'danger',
  idle: 'neutral',
  disabled: 'outline',
};

export function ProxyStatusBadge({ status }: { status: ProxyStatus }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'neutral'}>
      {tMaybe(`proxies.status.${status}`) ?? status}
    </Badge>
  );
}

/** A hop or log result code in words ("ok", "Auth required (407)", ...). */
export function resultLabel(code: string): string {
  return tMaybe(`proxies.results.${code}`) ?? code;
}

export function sourceTypeLabel(type: string): string {
  return tMaybe(`proxies.sources.${type}`) ?? type;
}

export function formatBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Proxy name linking to its page, or "Direct" / "Global proxy". */
export function EgressName({ egress }: { egress: Pick<Egress, 'kind' | 'proxy_id' | 'name'> }) {
  if (egress.kind === 'direct') return <span>{t('proxies.egress.direct')}</span>;
  if (egress.kind === 'global') return <span>{t('proxies.egress.global')}</span>;
  const name = egress.name ?? t('proxies.egress.deletedProxy');
  return egress.proxy_id ? (
    <Link to={proxyPath(egress.proxy_id)} className="link-action">
      {name}
    </Link>
  ) : (
    <span>{name}</span>
  );
}

/** Each hop of a chain in order: "proxy A failed (auth_407) → proxy B ok". */
export function EgressHops({ hops, className }: { hops: EgressHop[]; className?: string }) {
  return (
    <span className={cx('inline-flex flex-wrap items-center gap-x-1.5 gap-y-1', className)}>
      {hops.map((hop, i) => (
        <Fragment key={`${hop.position}-${i}`}>
          {i > 0 ? (
            <span className="text-faint" aria-hidden="true">
              →
            </span>
          ) : null}
          <span
            className="inline-flex items-center gap-1"
            title={
              hop.error ?? (hop.ms != null ? t('proxies.common.ms', { ms: hop.ms }) : undefined)
            }
          >
            <EgressName egress={hop} />
            <Badge
              tone={
                hop.result === 'ok'
                  ? 'ok'
                  : hop.result === 'skipped_disabled'
                    ? 'neutral'
                    : 'danger'
              }
            >
              {resultLabel(hop.result)}
            </Badge>
          </span>
        </Fragment>
      ))}
    </span>
  );
}
