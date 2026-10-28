import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { KeyRound, Server, UserRound } from 'lucide-react';
import { t } from '../i18n/index.js';

function ProviderKindCard({
  to,
  icon,
  title,
  desc,
}: {
  to: string;
  icon: ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      to={to}
      className="card flex flex-col gap-2 text-dim no-underline transition-colors hover:border-line-strong hover:no-underline"
    >
      <span className="inline-flex size-8 items-center justify-center rounded-control bg-s2 [&_svg]:size-[18px]">
        {icon}
      </span>
      <span className="text-sm font-semibold text-ink">{title}</span>
      <span className="text-[13px] leading-relaxed">{desc}</span>
      {/* Visual affordance only: the whole card is the link. */}
      <span className="btn btn-sm mt-auto self-start" aria-hidden="true">
        {t('providers.connectProvider')}
      </span>
    </Link>
  );
}

/** Empty state offering the three ways to connect a provider. */
export default function NoConnectionsPrompt() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-[15px] font-semibold text-ink">
          {t('providers.noConnections.title')}
        </span>
        <span className="text-sm text-muted">{t('providers.noConnections.desc')}</span>
      </div>
      <div className="card-grid">
        <ProviderKindCard
          to="/providers/subscriptions"
          icon={<UserRound className="text-info" aria-hidden="true" />}
          title={t('providers.kind.subscriptions')}
          desc={t('providers.noConnections.subscriptionsDesc')}
        />
        <ProviderKindCard
          to="/providers/usage-based"
          icon={<KeyRound className="text-warn" aria-hidden="true" />}
          title={t('providers.kind.byok')}
          desc={t('providers.noConnections.byokDesc')}
        />
        <ProviderKindCard
          to="/providers/local"
          icon={<Server className="text-accent" aria-hidden="true" />}
          title={t('providers.kind.local')}
          desc={t('providers.noConnections.localDesc')}
        />
      </div>
    </div>
  );
}
