import { Link, Outlet, useLocation, useParams } from 'react-router';
import { Tabs, type TabItem } from '../components/ui.js';
import { agentPath } from '../services/routing.js';
import { agentDisplayName, agentDisplayNameSignal } from '../services/agent-display-name.js';
import { agentPlatformIcon, agentPlatformSignal } from '../services/agent-platform-store.js';
import { useSignal } from '../lib/signal.js';
import { t } from '../i18n/index.js';

type TabKey = 'overview' | 'routing' | 'providers' | 'guardrails' | 'settings';

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * AgentDetail — the tabbed shell of a harness: back-link, platform icon and
 * name, then Overview / Routing / Providers / Limits / Settings tabs. The tab
 * content is the nested route, rendered through <Outlet />.
 */
export default function AgentDetail() {
  const params = useParams<{ agentName: string }>();
  const location = useLocation();
  // Re-render when the guard resolves the display name or the platform.
  useSignal(agentDisplayNameSignal);
  useSignal(agentPlatformSignal);

  const agentName = safeDecode(params.agentName ?? '');
  const path = (sub: string) => agentPath(agentName, sub);
  const name = agentDisplayName() ?? agentName;
  const icon = agentPlatformIcon();

  const pathname = location.pathname;
  const active: TabKey =
    pathname === path('/routing')
      ? 'routing'
      : pathname.startsWith(path('/providers'))
        ? 'providers'
        : pathname.startsWith(path('/guardrails'))
          ? 'guardrails'
          : pathname.startsWith(path('/settings'))
            ? 'settings'
            : 'overview';

  const tabs: TabItem<TabKey>[] = [
    { key: 'overview', label: t('harnesses.detail.overview'), to: path('') },
    { key: 'routing', label: t('harnesses.detail.routing'), to: path('/routing') },
    { key: 'providers', label: t('harnesses.detail.providers'), to: path('/providers') },
    { key: 'guardrails', label: t('harnesses.detail.limits'), to: path('/guardrails') },
    { key: 'settings', label: t('harnesses.detail.settings'), to: path('/settings') },
  ];

  return (
    <div className="page wide">
      <title>{`${name} | Thinker`}</title>

      <Link to="/harnesses" className="text-sm text-muted hover:text-ink">
        {t('harnesses.detail.back')}
      </Link>

      <div className="mt-2 flex min-w-0 items-center gap-3">
        {icon ? (
          <img src={icon} alt="" width={28} height={28} className="shrink-0 rounded-control" />
        ) : null}
        <h1 className="truncate">{name}</h1>
      </div>

      <Tabs items={tabs} value={active} label={name} className="mb-5 mt-3" />

      <Outlet />
    </div>
  );
}
