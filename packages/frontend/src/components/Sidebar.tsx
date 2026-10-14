import { A, useLocation } from '@solidjs/router';
import { Show, createSignal, createResource, type Component } from 'solid-js';
import { checkMcpEnabled } from '../services/setup-status.js';
import AddAgentModal from './AddAgentModal.jsx';

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
      aria-label="Navigation"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('a.sidebar__link')) {
          handleNav();
        }
      }}
    >
      <A
        href="/overview"
        class="sidebar__link"
        classList={{ active: isGlobalActive('/overview') }}
        aria-current={isGlobalActive('/overview') ? 'page' : undefined}
      >
        Overview
      </A>
      <A
        href="/messages"
        class="sidebar__link"
        classList={{ active: isGlobalActive('/messages') }}
        aria-current={isGlobalActive('/messages') ? 'page' : undefined}
      >
        Requests
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
          Harnesses
        </A>
        <button
          type="button"
          class="sidebar__section-add"
          title="Create new harness"
          aria-label="Create new harness"
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
      </div>
      <div class="sidebar__section-label">PROVIDERS</div>
      <A
        href="/providers/local"
        class="sidebar__link"
        classList={{ active: isGlobalActive('/providers/local') }}
        aria-current={isGlobalActive('/providers/local') ? 'page' : undefined}
      >
        Local
      </A>
      <A
        href="/providers/usage-based"
        class="sidebar__link"
        classList={{ active: isGlobalActive('/providers/usage-based') }}
        aria-current={isGlobalActive('/providers/usage-based') ? 'page' : undefined}
      >
        Usage-based
      </A>
      <A
        href="/providers/subscriptions"
        class="sidebar__link"
        classList={{ active: isGlobalActive('/providers/subscriptions') }}
        aria-current={isGlobalActive('/providers/subscriptions') ? 'page' : undefined}
      >
        Subscriptions
      </A>

      {/* Integrations: surfaces that drive Thinker from outside the dashboard.
          The "New" pills are a showcase device, not structure — delete the two
          spans once these stop being new. n8n joins here when it gets a page. */}
      <div class="sidebar__section-label">INTEGRATIONS</div>
      <Show when={mcpEnabled()}>
        <A
          href="/integrations/mcp"
          class="sidebar__link"
          classList={{ active: isGlobalActive('/integrations/mcp') }}
          aria-current={isGlobalActive('/integrations/mcp') ? 'page' : undefined}
        >
          MCP server
          <span class="sidebar__badge">New</span>
        </A>
      </Show>
      <A
        href="/integrations/cli"
        class="sidebar__link"
        classList={{ active: isGlobalActive('/integrations/cli') }}
        aria-current={isGlobalActive('/integrations/cli') ? 'page' : undefined}
      >
        CLI
        <span class="sidebar__badge">New</span>
      </A>

      <div class="sidebar__section-label">TOOLS</div>
      <A
        href="/playground"
        class="sidebar__link"
        classList={{ active: isGlobalActive('/playground') }}
        aria-current={isGlobalActive('/playground') ? 'page' : undefined}
      >
        Playground
      </A>

      {/* Create-harness modal, opened by the + button next to the Harnesses nav link */}
      <AddAgentModal open={addModalOpen()} onClose={() => setAddModalOpen(false)} />
    </nav>
  );
};

export default Sidebar;
