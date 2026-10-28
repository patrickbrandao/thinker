import { useMemo } from 'react';
import { PROVIDERS } from '../services/providers.js';
import { providerIcon, customProviderLogo } from '../components/ProviderIcon.js';
import { customProviderColor } from '../services/formatters.js';
import { authBadgeFor, authLabel } from '../components/AuthBadge.js';
import type { RoutingProvider, CustomProviderData } from '../services/api.js';
import { Skel } from '../components/ui.js';
import { t } from '../i18n/index.js';

/** Skeleton placeholder rendered while routing data is loading. */
export function RoutingLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      {/* Provider icons + buttons row */}
      <div className="flex items-center justify-between gap-2">
        <Skel width={160} height={20} />
        <div className="flex gap-2">
          <Skel width={110} height={32} />
          <Skel width={170} height={32} />
        </div>
      </div>
      {/* Tabs row */}
      <div className="flex items-center justify-between gap-2">
        <Skel width={260} height={34} />
        <Skel width={140} height={22} />
      </div>
      {/* Description line */}
      <Skel width={320} height={14} />
      {/* Content rectangle */}
      <Skel width="100%" height={300} />
    </div>
  );
}

export interface ActiveProviderIconsProps {
  activeProviders: RoutingProvider[];
  customProviders: CustomProviderData[];
}

interface ProviderGroup {
  provider: string;
  auth_type: string;
  keys: RoutingProvider[];
}

const tooltipClass =
  'routing-providers-info__tooltip pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 hidden -translate-x-1/2 flex-col gap-0.5 whitespace-nowrap rounded-control border border-line bg-elev px-2.5 py-1.5 text-xs text-dim group-hover:flex';

function CustomProviderIcon({
  provider,
  customProviders,
}: {
  provider: string;
  customProviders: CustomProviderData[];
}) {
  const cp = customProviders?.find((c) => `custom:${c.id}` === provider);
  const logo = cp ? customProviderLogo(cp.name, 16, cp.base_url) : null;
  const name = cp?.name ?? 'C';
  return (
    <span className="inline-flex items-center" title={cp?.name ?? provider}>
      {logo ?? (
        <span
          className="provider-card__logo-letter inline-flex size-4 items-center justify-center rounded-full text-[9px] font-semibold text-on-accent"
          style={{ background: customProviderColor(name) }}
        >
          {name.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

/** Renders the provider icons row and connection count above the tier cards. */
export function ActiveProviderIcons({
  activeProviders,
  customProviders,
}: ActiveProviderIconsProps) {
  const grouped = useMemo<ProviderGroup[]>(() => {
    const map = new Map<string, ProviderGroup>();
    for (const prov of activeProviders) {
      const key = `${prov.provider}::${prov.auth_type}`;
      const existing = map.get(key);
      if (existing) existing.keys.push(prov);
      else map.set(key, { provider: prov.provider, auth_type: prov.auth_type, keys: [prov] });
    }
    return [...map.values()];
  }, [activeProviders]);

  return (
    <div className="routing-providers-info flex items-center gap-2 text-sm text-muted">
      <span className="flex items-center gap-1.5">
        {grouped.map((group) => {
          const key = `${group.provider}::${group.auth_type}`;
          if (group.provider.startsWith('custom:')) {
            return (
              <CustomProviderIcon
                key={key}
                provider={group.provider}
                customProviders={customProviders}
              />
            );
          }
          const provName = PROVIDERS.find((p) => p.id === group.provider)?.name ?? group.provider;
          const keyCount = group.keys.length;
          return (
            <span key={key} className="group relative inline-flex items-center gap-0.5">
              {providerIcon(group.provider, 16)}
              {authBadgeFor(group.auth_type, 12)}
              {keyCount > 1 ? (
                <span className={tooltipClass}>
                  <strong className="text-ink">
                    {t('routing.panels.keyCount', {
                      count: keyCount,
                      auth: authLabel(group.auth_type),
                    })}
                  </strong>
                  {group.keys.map((k) => (
                    <span key={k.id}>{k.label || t('routing.panels.defaultKey')}</span>
                  ))}
                </span>
              ) : (
                <span className={tooltipClass}>
                  <strong className="text-ink">{provName}</strong>
                  <span>{authLabel(group.auth_type)}</span>
                </span>
              )}
            </span>
          );
        })}
      </span>
      <span>{t('routing.panels.connections', activeProviders.length)}</span>
    </div>
  );
}
