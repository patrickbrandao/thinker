import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import Sidebar from './components/shell/Sidebar.jsx';
import Topbar from './components/shell/Topbar.jsx';
import CommandPalette from './components/shell/CommandPalette.jsx';
import AuthGuard from './components/AuthGuard.jsx';
import MeGate from './components/MeGate.jsx';
import { connectSse } from './services/sse.js';
import { RightSidebarProvider, useRightSidebar } from './services/right-sidebar.jsx';
import { cx } from './components/ui.jsx';
import { t } from './i18n/index.js';

const COLLAPSED_KEY = 'thinker.sidebarCollapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function Shell() {
  const { pathname } = useLocation();
  const { content: rightSidebar } = useRightSidebar();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => connectSse(), []);
  useEffect(() => setMobileOpen(false), [pathname]);

  // ⌘K / Ctrl+K anywhere opens the palette.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // Storage blocked: the choice lasts for this page only.
      }
      return next;
    });
  }, []);

  const closePalette = useCallback(() => setPaletteOpen(false), []);

  return (
    <div className={cx('app', collapsed && 'is-collapsed', mobileOpen && 'is-mobile-open')}>
      <a href="#main-content" className="skip-link">
        {t('nav.skipToContent')}
      </a>
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        onNavigate={() => {
          setMobileOpen(false);
          window.dispatchEvent(new CustomEvent('sidebar-navigate'));
        }}
      />
      {mobileOpen ? (
        <button
          type="button"
          className="mobile-backdrop"
          aria-label={t('nav.closeMenu')}
          onClick={() => setMobileOpen(false)}
        />
      ) : null}
      <div className="app-main">
        <Topbar
          onOpenSearch={() => setPaletteOpen(true)}
          onOpenMobileNav={() => setMobileOpen(true)}
        />
        <div className="app-content">
          <main id="main-content" className="app-scroll" aria-label={t('nav.dashboardContent')}>
            <Outlet />
          </main>
          {rightSidebar}
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </div>
  );
}

/** The authenticated dashboard: session, /me, SSE and the console shell. */
export default function App() {
  return (
    <AuthGuard>
      <MeGate>
        <RightSidebarProvider>
          <Shell />
        </RightSidebarProvider>
      </MeGate>
    </AuthGuard>
  );
}
