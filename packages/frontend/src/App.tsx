import { useLocation } from '@solidjs/router';
import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
  type ParentComponent,
} from 'solid-js';
import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import AuthGuard from './components/AuthGuard.jsx';
import MeGate from './components/MeGate.jsx';
import VersionIndicator from './components/VersionIndicator.jsx';
import { connectSse } from './services/sse.js';
import { RightSidebarProvider, useRightSidebar } from './services/right-sidebar.jsx';
import { t } from './i18n/index.js';

const SseConnector: ParentComponent = (props) => {
  onMount(() => {
    const cleanup = connectSse();
    onCleanup(cleanup);
  });
  return <>{props.children}</>;
};

const AppInner: ParentComponent = (props) => {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = createSignal(false);
  // The sidebar is global and rendered identically on every authenticated
  // route. Guest/setup routes never reach this component, so we show the
  // sidebar everywhere except the root redirect ("/") which navigates away
  // immediately and needs no nav chrome.
  const showSidebar = () => location.pathname !== '/';
  const { content: rightSidebar } = useRightSidebar();

  createEffect<string | undefined>((previousPath) => {
    const currentPath = location.pathname;
    if (currentPath === previousPath) return currentPath;
    setMobileNavOpen(false);
    return currentPath;
  });

  return (
    <div class="app-shell">
      <a href="#main-content" class="skip-link">
        {t('nav.skipToContent')}
      </a>
      <Header
        showMobileNavToggle={showSidebar()}
        mobileNavOpen={mobileNavOpen()}
        onMobileNavToggle={() => setMobileNavOpen((open) => !open)}
      />
      <Show when={showSidebar()}>
        <Show when={mobileNavOpen()}>
          <button
            type="button"
            class="mobile-nav-backdrop"
            aria-label={t('nav.closeMenu')}
            onClick={() => setMobileNavOpen(false)}
          />
        </Show>
      </Show>
      <div class="app-body" classList={{ 'app-body--with-sidebar': showSidebar() }}>
        <Show when={showSidebar()}>
          <Sidebar mobileOpen={mobileNavOpen()} onNavigate={() => setMobileNavOpen(false)} />
        </Show>
        <main
          id="main-content"
          class="main-content"
          classList={{ 'main-content--full': !showSidebar() }}
          aria-label={t('nav.dashboardContent')}
        >
          {props.children}
        </main>
        {rightSidebar()}
      </div>
      <VersionIndicator />
    </div>
  );
};

const App: ParentComponent = (props) => {
  return (
    <AuthGuard>
      <MeGate>
        <SseConnector>
          <RightSidebarProvider>
            <AppInner>{props.children}</AppInner>
          </RightSidebarProvider>
        </SseConnector>
      </MeGate>
    </AuthGuard>
  );
};

export default App;
