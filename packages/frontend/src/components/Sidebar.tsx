import { A, useLocation } from '@solidjs/router';
import { Show, createSignal, createResource, type Component } from 'solid-js';
import { checkMcpEnabled } from '../services/setup-status.js';
import { isInstanceAdmin, me, roleCan } from '../services/session-store.js';
import AddAgentModal from './AddAgentModal.jsx';
import OrgSwitcher from './OrgSwitcher.jsx';
import { t } from '../i18n/index.js';

interface SidebarProps {
  mobileOpen?: boolean;
  onNavigate?: () => void;
}

/**
 * Returns true when the given route matches the current location either
 * exactly or as a path prefix (so `/harnesses` stays active on `/harnesses/:name/*`).
 */
function makeIsGlobalActive(pathname: () => string) {
  return (route: string): boolean => {
    const p = pathname();
    return p === route || p.startsWith(route + '/');
  };
}

const Sidebar: Component<SidebarProps> = (props) => {
  const location = useLocation();
  const isGlobalActive = makeIsGlobalActive(() => location.pathname);
  const [addModalOpen, setAddModalOpen] = createSignal(false);
  // An install served over plain HTTP cannot host the MCP OAuth resource, so
  // the backend runs without the endpoint entirely. The entry waits for the
  // status rather than appearing and then vanishing on the installs that don't
  // have it.
  const [mcpEnabled] = createResource(checkMcpEnabled);

  const handleNav = () => {
    props.onNavigate?.();
    window.dispatchEvent(new CustomEvent('sidebar-navigate'));
  };

  return (
    <nav
      id="agent-navigation"
      class="sidebar"
      classList={{ 'sidebar--mobile-open': props.mobileOpen === true }}
      aria-label={t('nav.navigation')}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('a.sidebar__link')) {
          handleNav();
        }
      }}
    >
      <Show when={me()}>
        <OrgSwitcher />
      </Show>
      <A
        href="/overview"
        class="sidebar__link"
        classList={{ active: isGlobalActive('/overview') }}
        aria-current={isGlobalActive('/overview') ? 'page' : undefined}
      >
        {t('nav.overview')}
      </A>
      <A
        href="/messages"
        class="sidebar__link"
        classList={{ active: isGlobalActive('/messages') }}
        aria-current={isGlobalActive('/messages') ? 'page' : undefined}
      >
        {t('nav.requests')}
      </A>
      {/* Harnesses is a plain nav entry to the /harnesses page; the + keeps
          the one-click create from the nav. */}
      <div class="sidebar__link-row">
        <A
          href="/harnesses"
          class="sidebar__link"
          classList={{ active: isGlobalActive('/harnesses') }}
          aria-current={isGlobalActive('/harnesses') ? 'page' : undefined}
        >
          {t('nav.harnesses')}
        </A>
        <Show when={roleCan.editHarnesses()}>
          <button
            type="button"
            class="sidebar__section-add"
            title={t('nav.createHarness')}
            aria-label={t('nav.createHarness')}
            onClick={() => setAddModalOpen(true)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M19 12.998h-6v6h-2v-6H5v-2h6v-6h2v6h6z" />
            </svg>
          </button>
        </Show>
      </div>
      <div class="sidebar__section-label">{t('nav.sectionProviders')}</div>
      <A
        href="/providers/local"
        class="sidebar__link"
        classList={{ active: isGlobalActive('/providers/local') }}
        aria-current={isGlobalActive('/providers/local') ? 'page' : undefined}
      >
        {t('nav.local')}
      </A>
      <A
        href="/providers/usage-based"
        class="sidebar__link"
        classList={{ active: isGlobalActive('/providers/usage-based') }}
        aria-current={isGlobalActive('/providers/usage-based') ? 'page' : undefined}
      >
        {t('nav.usageBased')}
      </A>
      <A
        href="/providers/subscriptions"
        class="sidebar__link"
        classList={{ active: isGlobalActive('/providers/subscriptions') }}
        aria-current={isGlobalActive('/providers/subscriptions') ? 'page' : undefined}
      >
        {t('nav.subscriptions')}
      </A>

      {/* Integrations: surfaces that drive Thinker from outside the dashboard.
          The "New" pills are a showcase device, not structure — delete the two
          spans once these stop being new. n8n joins here when it gets a page. */}
      <div class="sidebar__section-label">{t('nav.sectionIntegrations')}</div>
      <Show when={mcpEnabled()}>
        <A
          href="/integrations/mcp"
          class="sidebar__link"
          classList={{ active: isGlobalActive('/integrations/mcp') }}
          aria-current={isGlobalActive('/integrations/mcp') ? 'page' : undefined}
        >
          {t('nav.mcpServer')}
          <span class="sidebar__badge">{t('common.new')}</span>
        </A>
      </Show>
      <A
        href="/integrations/cli"
        class="sidebar__link"
        classList={{ active: isGlobalActive('/integrations/cli') }}
        aria-current={isGlobalActive('/integrations/cli') ? 'page' : undefined}
      >
        CLI
        <span class="sidebar__badge">{t('common.new')}</span>
      </A>

      <div class="sidebar__section-label">{t('nav.sectionTools')}</div>
      <A
        href="/playground"
        class="sidebar__link"
        classList={{ active: isGlobalActive('/playground') }}
        aria-current={isGlobalActive('/playground') ? 'page' : undefined}
      >
        {t('nav.playground')}
      </A>

      <Show when={me()}>
        <div class="sidebar__section-label">{t('nav.sectionOrganization')}</div>
        <A
          href="/organization"
          class="sidebar__link"
          classList={{ active: isGlobalActive('/organization') }}
          aria-current={isGlobalActive('/organization') ? 'page' : undefined}
        >
          {t('nav.membersSettings')}
        </A>
        <Show when={isInstanceAdmin()}>
          <A
            href="/admin/users"
            class="sidebar__link"
            classList={{ active: isGlobalActive('/admin/users') }}
            aria-current={isGlobalActive('/admin/users') ? 'page' : undefined}
          >
            {t('nav.users')}
          </A>
        </Show>
      </Show>

      {/* Create-harness modal, opened by the + button next to the Harnesses nav link */}
      <AddAgentModal open={addModalOpen()} onClose={() => setAddModalOpen(false)} />
    </nav>
  );
};

export default Sidebar;
