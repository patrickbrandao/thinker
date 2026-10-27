import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import { NAVIGATION, isNavActive, navLabel } from '../../config/navigation.js';
import { roleCan } from '../../services/session-store.js';
import {
  THINKER_LOGO_URL,
  THINKER_LOGO_DARK_URL,
  THINKER_MARK_URL,
} from '../../services/thinker-links.js';
import { t } from '../../i18n/index.js';
import { cx } from '../ui.jsx';
import AddAgentModal from '../AddAgentModal.jsx';
import UserMenu from './UserMenu.jsx';

/**
 * Left navigation: icon + label per item, collapsible to icons only. The
 * user menu and the collapse toggle sit at the bottom.
 */
export default function Sidebar({
  collapsed,
  onToggleCollapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNavigate: () => void;
}) {
  const { pathname } = useLocation();
  const [addOpen, setAddOpen] = useState(false);
  const version = __THINKER_VERSION__;

  return (
    <aside className="sidebar" aria-label={t('nav.navigation')}>
      <Link to="/overview" className="sidebar-brand" onClick={onNavigate}>
        {collapsed ? (
          <img src={THINKER_MARK_URL} alt="Thinker" className="logo-mark" />
        ) : (
          <span className="logo-word">
            <img src={THINKER_LOGO_URL} alt="Thinker" className="logo-light" />
            <img src={THINKER_LOGO_DARK_URL} alt="" className="logo-dark" />
          </span>
        )}
      </Link>

      <nav className="sidebar-nav" id="agent-navigation">
        {NAVIGATION.map((group) => (
          <div className="nav-group" key={group.key}>
            {group.label ? <div className="nav-group-label">{t(group.label)}</div> : null}
            {group.items.map((item) => {
              const active = isNavActive(item, pathname);
              const Icon = item.icon;
              const label = navLabel(item);
              return (
                <div className="nav-row" key={item.key}>
                  <Link
                    to={item.to}
                    className={cx('nav-item', active && 'is-active')}
                    aria-current={active ? 'page' : undefined}
                    title={collapsed ? label : undefined}
                    onClick={onNavigate}
                  >
                    <Icon aria-hidden="true" />
                    <span className="nav-label">{label}</span>
                  </Link>
                  {item.key === 'harnesses' && roleCan.editHarnesses() ? (
                    <button
                      type="button"
                      className="nav-action"
                      title={t('nav.createHarness')}
                      aria-label={t('nav.createHarness')}
                      onClick={() => setAddOpen(true)}
                    >
                      <Plus size={14} />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-foot">
        <UserMenu />
        <button
          type="button"
          className="collapse-btn desktop-only"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? t('shell.sidebar.expand') : t('shell.sidebar.collapse')}
          title={collapsed ? t('shell.sidebar.expand') : t('shell.sidebar.collapse')}
          aria-pressed={collapsed}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          <span className="collapse-label">{t('shell.sidebar.collapse')}</span>
        </button>
        {version ? (
          <div className="version-tag" aria-label={t('nav.version', { version })}>
            v{version}
          </div>
        ) : null}
      </div>

      <AddAgentModal open={addOpen} onClose={() => setAddOpen(false)} />
    </aside>
  );
}
