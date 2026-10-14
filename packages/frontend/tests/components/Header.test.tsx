import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';

const mockSignOut = vi.fn().mockResolvedValue(undefined);
const mockNavigate = vi.fn();
const mockLocationReplace = vi.fn();
let mockPathname = '/';

vi.mock('@solidjs/router', () => ({
  A: (props: any) => (
    <a href={props.href} class={props.class}>
      {props.children}
    </a>
  ),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: mockPathname }),
}));

vi.mock('../../src/services/auth-client.js', () => ({
  authClient: {
    useSession: () => () => ({
      data: { user: { id: 'u1', name: 'Alice', email: 'alice@test.com' } },
      isPending: false,
    }),
    signOut: (...args: unknown[]) => mockSignOut(...args),
  },
}));

let mockAgentName: string | null = null;
vi.mock('../../src/services/routing.js', () => ({
  useAgentName: () => () => mockAgentName,
}));

vi.mock('../../src/services/api.js', () => ({
  duplicateAgent: vi.fn(),
  getDuplicatePreview: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/services/recent-agents.js', () => ({
  markAgentCreated: vi.fn(),
}));

vi.mock('../../src/services/toast-store.js', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

let mockAgentDisplayName: string | null = null;
vi.mock('../../src/services/agent-display-name.js', () => ({
  agentDisplayName: () => mockAgentDisplayName,
}));

import Header from '../../src/components/Header';
import { setConnectionBreadcrumb } from '../../src/services/connection-breadcrumb-store';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(window, 'location', 'get').mockReturnValue({
    ...window.location,
    replace: mockLocationReplace,
  });
  sessionStorage.clear();
  mockPathname = '/';
  mockAgentName = null;
  mockAgentDisplayName = null;
  mockLocationReplace.mockReset();
  // The breadcrumb store is a real module-level signal; reset it so a value
  // set in one test never leaks into another.
  setConnectionBreadcrumb(null);
});

describe('Header', () => {
  it('renders logo', () => {
    const { container } = render(() => <Header />);
    const imgs = container.querySelectorAll('img');
    expect(imgs.length).toBe(2);
  });

  it('shows user initials', () => {
    render(() => <Header />);
    expect(screen.getByText('A')).toBeDefined();
  });

  it('shows user menu button', () => {
    render(() => <Header />);
    expect(screen.getByLabelText('User menu')).toBeDefined();
  });

  it('opens dropdown on click', async () => {
    render(() => <Header />);
    await fireEvent.click(screen.getByLabelText('User menu'));
    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.getByText('alice@test.com')).toBeDefined();
  });

  it('shows Account Preferences link in dropdown', async () => {
    render(() => <Header />);
    await fireEvent.click(screen.getByLabelText('User menu'));
    expect(screen.getByText('Account Preferences')).toBeDefined();
  });

  it('shows Log out button in dropdown', async () => {
    render(() => <Header />);
    await fireEvent.click(screen.getByLabelText('User menu'));
    expect(screen.getByText('Log out')).toBeDefined();
  });

  it('calls signOut when Log out clicked', async () => {
    render(() => <Header />);
    await fireEvent.click(screen.getByLabelText('User menu'));
    await fireEvent.click(screen.getByText('Log out'));
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('navigates to login after signOut', async () => {
    render(() => <Header />);
    await fireEvent.click(screen.getByLabelText('User menu'));
    await fireEvent.click(screen.getByText('Log out'));
    await vi.waitFor(() => {
      expect(mockLocationReplace).toHaveBeenCalledWith('/login');
    });
  });

  it('closes dropdown when clicking outside', async () => {
    render(() => <Header />);
    await fireEvent.click(screen.getByLabelText('User menu'));
    expect(screen.getByText('Alice')).toBeDefined();
    await fireEvent.click(document.body);
    expect(screen.queryByText('Alice')).toBeNull();
  });

  it('renders the closed mobile navigation toggle', () => {
    render(() => <Header showMobileNavToggle mobileNavOpen={false} />);

    const toggle = screen.getByLabelText('Open navigation menu');
    expect(toggle.getAttribute('aria-controls')).toBe('agent-navigation');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders the open mobile navigation toggle and handles clicks', async () => {
    const onMobileNavToggle = vi.fn();

    render(() => (
      <Header showMobileNavToggle mobileNavOpen onMobileNavToggle={onMobileNavToggle} />
    ));

    const toggle = screen.getByLabelText('Close navigation menu');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    await fireEvent.click(toggle);

    expect(onMobileNavToggle).toHaveBeenCalledTimes(1);
  });
});

describe('Header - no hosted extras', () => {
  it('makes no network call on mount (no GitHub stars, no billing)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { container } = render(() => <Header />);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchSpy).not.toHaveBeenCalled();
    // The only external link is the Docs one; no stars badge or repo widget.
    const external = [...container.querySelectorAll('a[href^="http"]')].map((a) =>
      a.getAttribute('href'),
    );
    expect(external).toEqual(['https://github.com/patrickbrandao/thinker/tree/main/docs']);
  });

  it('shows no plan badge in the user menu', async () => {
    render(() => <Header />);
    await fireEvent.click(screen.getByLabelText('User menu'));
    expect(screen.queryByText('PRO')).toBeNull();
  });

  it('shows no deployment-mode badge', () => {
    const { container } = render(() => <Header />);
    expect(container.textContent).not.toContain('Self-hosted');
  });
});

describe('Header - breadcrumb', () => {
  it('logo links to /', () => {
    const { container } = render(() => <Header />);
    const logoLink = container.querySelector('.header__logo') as HTMLAnchorElement;
    expect(logoLink.getAttribute('href')).toBe('/');
  });

  it('shows only the active agent breadcrumb when agent is active', () => {
    mockAgentName = 'my-agent';
    const { container } = render(() => <Header />);
    expect(screen.queryByText('Workspace')).toBeNull();
    expect(container.querySelector('.header__breadcrumb-current')?.textContent).toContain(
      'my-agent',
    );
    expect(container.querySelectorAll('.header__separator').length).toBe(2);
  });
});

describe('Header - docs link', () => {
  const docsHref = (container: HTMLElement) =>
    container.querySelector('.header__docs-link')?.getAttribute('href');

  it('links provider pages to the provider guides in the repository', () => {
    for (const path of ['/providers/subscriptions', '/providers/byok', '/providers/local']) {
      mockPathname = path;
      const { container, unmount } = render(() => <Header />);
      expect(docsHref(container)).toBe(
        'https://github.com/patrickbrandao/thinker/tree/main/docs/providers',
      );
      unmount();
    }
  });

  it('links every other page to the repository docs', () => {
    for (const path of ['/harnesses/my-agent/routing', '/harnesses/my-agent/limits', '/messages']) {
      mockPathname = path;
      const { container, unmount } = render(() => <Header />);
      expect(docsHref(container)).toBe('https://github.com/patrickbrandao/thinker/tree/main/docs');
      unmount();
    }
  });
});

describe('Header - gear dropdown', () => {
  it('shows gear button when on an agent page', () => {
    mockAgentName = 'my-agent';
    render(() => <Header />);
    expect(screen.getByLabelText('Harness actions')).toBeDefined();
  });

  it('does not show gear button when not on an agent page', () => {
    mockAgentName = null;
    render(() => <Header />);
    expect(screen.queryByLabelText('Harness actions')).toBeNull();
  });

  it('opens dropdown with Settings and Duplicate items', async () => {
    mockAgentName = 'my-agent';
    render(() => <Header />);
    await fireEvent.click(screen.getByLabelText('Harness actions'));
    expect(screen.getByText('Settings')).toBeDefined();
    expect(screen.getByText('Duplicate harness')).toBeDefined();
  });

  it('Settings links to the agent settings page', async () => {
    mockAgentName = 'my-agent';
    const { container } = render(() => <Header />);
    await fireEvent.click(screen.getByLabelText('Harness actions'));
    const settingsLink = container.querySelector('a[href="/harnesses/my-agent/settings"]');
    expect(settingsLink).not.toBeNull();
  });

  it('closes gear dropdown when clicking outside', async () => {
    mockAgentName = 'my-agent';
    render(() => <Header />);
    await fireEvent.click(screen.getByLabelText('Harness actions'));
    expect(screen.getByText('Settings')).toBeDefined();
    await fireEvent.click(document.body);
    expect(screen.queryByText('Duplicate harness')).toBeNull();
  });
});

describe('Header - connection breadcrumb', () => {
  it('renders the connection breadcrumb (back link, provider icon, name, label) when no agent is active', () => {
    // No :agentName route param → getAgentName() is falsy, so the agent
    // breadcrumb is hidden and the connection breadcrumb takes over.
    mockAgentName = null;
    setConnectionBreadcrumb(
      'OpenAI Default',
      '/providers/usage-based',
      'Usage-based',
      'openai',
      'Default',
    );
    const { container } = render(() => <Header />);

    // Back link points at the configured route and shows the back label.
    const backLink = container.querySelector('a[href="/providers/usage-based"]');
    expect(backLink).not.toBeNull();
    expect(backLink!.textContent).toContain('Usage-based');

    // The connection name renders.
    expect(container.textContent).toContain('OpenAI Default');

    // providerId set → the provider icon (an inline SVG for 'openai') renders.
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();

    // label set → the secondary label text renders.
    expect(container.textContent).toContain('Default');

    // The crumb reuses the harness breadcrumb classes so the phone breakpoint
    // can hide the parent link and truncate the name instead of wrapping it.
    expect(backLink!.classList.contains('header__breadcrumb-link')).toBe(true);
    const current = container.querySelector('.header__breadcrumb-current');
    expect(current?.textContent).toContain('OpenAI Default');
    expect(current?.querySelector('.header__breadcrumb-label')?.textContent).toBe('Default');
  });

  it('renders the connection breadcrumb name without an icon or label when those are omitted', () => {
    // providerId + label omitted → both the icon <Show> and label <Show>
    // fall through, but the name still renders.
    mockAgentName = null;
    setConnectionBreadcrumb('Anthropic', '/providers/subscriptions', 'Subscriptions');
    const { container } = render(() => <Header />);

    const backLink = container.querySelector('a[href="/providers/subscriptions"]');
    expect(backLink).not.toBeNull();
    expect(backLink!.textContent).toContain('Subscriptions');
    expect(container.textContent).toContain('Anthropic');
  });

  it('hides the connection breadcrumb when an agent IS active', () => {
    // getAgentName() truthy → the `!getAgentName()` guard fails, so even with a
    // breadcrumb set the connection block stays hidden.
    mockAgentName = 'my-agent';
    setConnectionBreadcrumb(
      'OpenAI Default',
      '/providers/usage-based',
      'Usage-based',
      'openai',
      'Default',
    );
    const { container } = render(() => <Header />);
    expect(container.querySelector('a[href="/providers/usage-based"]')).toBeNull();
  });
});
