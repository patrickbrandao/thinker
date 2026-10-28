import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import {
  BookOpen,
  ChevronRight,
  Copy,
  Menu as MenuIcon,
  Moon,
  Search,
  Settings,
  Sun,
} from 'lucide-react';
import { activeNavItem, navLabel } from '../../config/navigation.js';
import { useAgentName } from '../../services/routing.js';
import { roleCan } from '../../services/session-store.js';
import { agentDisplayNameSignal } from '../../services/agent-display-name.js';
import { agentPlatformIcon, agentPlatformSignal } from '../../services/agent-platform-store.js';
import {
  connectionBreadcrumbBackLabel,
  connectionBreadcrumbSignal,
} from '../../services/connection-breadcrumb-store.js';
import { THINKER_DOCS_URL, THINKER_PROVIDERS_DOCS_URL } from '../../services/thinker-links.js';
import { effectiveTheme, themePreference, toggleTheme } from '../../lib/theme.js';
import { useSignal } from '../../lib/signal.js';
import { t } from '../../i18n/index.js';
import { IconButton, Menu, MenuItem } from '../ui.jsx';
import { providerIcon } from '../ProviderIcon.jsx';
import DuplicateAgentModal from '../DuplicateAgentModal.jsx';
import AlertsMenu from './AlertsMenu.jsx';

export default function Topbar({
  onOpenSearch,
  onOpenMobileNav,
}: {
  onOpenSearch: () => void;
  onOpenMobileNav: () => void;
}) {
  const { pathname } = useLocation();
  const agentName = useAgentName();
  const displayName = useSignal(agentDisplayNameSignal);
  useSignal(agentPlatformSignal);
  const connection = useSignal(connectionBreadcrumbSignal);
  useSignal(themePreference);
  const [duplicateOpen, setDuplicateOpen] = useState(false);

  const section = activeNavItem(pathname);
  const docsUrl = pathname.startsWith('/providers') ? THINKER_PROVIDERS_DOCS_URL : THINKER_DOCS_URL;
  const dark = effectiveTheme() === 'dark';
  const platformIcon = agentPlatformIcon();
  const version = __THINKER_VERSION__;

  return (
    <header className="topbar">
      <IconButton
        label={t('nav.openMenu')}
        className="mobile-only"
        onClick={onOpenMobileNav}
        aria-controls="agent-navigation"
      >
        <MenuIcon />
      </IconButton>

      <nav className="crumbs" aria-label={t('shell.topbar.breadcrumb')}>
        {agentName ? (
          <>
            <Link to="/harnesses">{t('nav.harnesses')}</Link>
            <ChevronRight aria-hidden="true" />
            {platformIcon ? <img src={platformIcon} alt="" width={14} height={14} /> : null}
            <span className="crumb-current">{displayName ?? agentName}</span>
            <Menu
              label={t('nav.harnessActions')}
              trigger={(props) => (
                <IconButton label={t('nav.harnessActions')} {...props}>
                  <Settings />
                </IconButton>
              )}
            >
              <MenuItem
                icon={<Settings />}
                to={`/harnesses/${encodeURIComponent(agentName)}/settings`}
              >
                {t('nav.settings')}
              </MenuItem>
              {roleCan.editHarnesses() ? (
                <MenuItem icon={<Copy />} onSelect={() => setDuplicateOpen(true)}>
                  {t('nav.duplicateHarness')}
                </MenuItem>
              ) : null}
            </Menu>
          </>
        ) : connection.name && pathname.startsWith('/providers/connections') ? (
          <>
            <Link to={connection.backLink}>{connectionBreadcrumbBackLabel()}</Link>
            <ChevronRight aria-hidden="true" />
            {connection.providerId ? providerIcon(connection.providerId, 14) : null}
            <span className="crumb-current">{connection.name}</span>
            {connection.label ? <span className="badge">{connection.label}</span> : null}
          </>
        ) : section ? (
          <span className="crumb-title">
            <section.icon aria-hidden="true" />
            <span className="crumb-current">{navLabel(section)}</span>
          </span>
        ) : null}
      </nav>

      <div className="topbar-actions">
        {version ? (
          <span className="topbar-version" title={t('nav.version', { version })}>
            v{version}
          </span>
        ) : null}
        <a
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="icon-btn"
          aria-label={t('nav.docs')}
          title={t('nav.docs')}
        >
          <BookOpen aria-hidden="true" />
        </a>
        <IconButton label={t('shell.topbar.search')} onClick={onOpenSearch}>
          <Search />
        </IconButton>
        <IconButton
          label={dark ? t('shell.topbar.themeLight') : t('shell.topbar.themeDark')}
          onClick={toggleTheme}
        >
          {dark ? <Sun /> : <Moon />}
        </IconButton>
        <AlertsMenu />
      </div>

      {agentName ? (
        <DuplicateAgentModal
          open={duplicateOpen}
          sourceName={agentName}
          onClose={() => setDuplicateOpen(false)}
        />
      ) : null}
    </header>
  );
}
