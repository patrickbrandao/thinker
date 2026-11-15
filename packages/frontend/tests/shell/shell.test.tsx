import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

const mockSearch = vi.fn();
const mockAlerts = vi.fn();
const mockListOrgs = vi.fn();
const mockSwitch = vi.fn();

vi.mock('../../src/services/auth-client', () => ({
  authClient: {
    useSession: () => ({
      data: { user: { name: 'Ada Lovelace', email: 'ada@example.com' } },
      isPending: false,
    }),
    signOut: vi.fn(),
  },
}));
vi.mock('../../src/services/api/console', () => ({
  searchConsole: (q: string) => mockSearch(q),
  getAlerts: () => mockAlerts(),
}));
vi.mock('../../src/services/api/organizations', async (orig) => ({
  ...(await orig<object>()),
  listOrganizations: () => mockListOrgs(),
}));
vi.mock('../../src/services/setup-status', () => ({ checkMcpEnabled: async () => true }));
vi.mock('../../src/components/AddAgentModal', () => ({ default: () => null }));
vi.mock('../../src/components/DuplicateAgentModal', () => ({ default: () => null }));
vi.mock('../../src/components/ProviderIcon', () => ({ providerIcon: () => null }));
vi.mock('../../src/services/session-store', async (orig) => {
  const actual = await orig<typeof import('../../src/services/session-store')>();
  return { ...actual, switchOrganization: (id: string) => mockSwitch(id) };
});

import Sidebar from '../../src/components/shell/Sidebar';
import CommandPalette from '../../src/components/shell/CommandPalette';
import AlertsMenu from '../../src/components/shell/AlertsMenu';
import { setMe } from '../../src/services/session-store';

function Where() {
  const { pathname } = useLocation();
  return <div data-testid="where">{pathname}</div>;
}

const ORG = { id: 'o1', name: 'Acme', role: 'owner' as const };

beforeEach(() => {
  mockSearch.mockReset();
  mockAlerts.mockReset().mockResolvedValue({ items: [], total: 0 });
  mockListOrgs.mockReset().mockResolvedValue({
    organizations: [ORG, { id: 'o2', name: 'Beta', role: 'viewer' }],
  });
  mockSwitch.mockReset();
  setMe({
    userId: 'u1',
    isInstanceAdmin: true,
    mustChangePassword: false,
    organization: ORG,
  } as never);
  localStorage.clear();
});

describe('Sidebar', () => {
  it('shows the main menu without Organization or Integrations entries', () => {
    render(
      <MemoryRouter initialEntries={['/overview']}>
        <Sidebar collapsed={false} onToggleCollapsed={() => {}} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('link', { name: 'Topology' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /organization/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /mcp/i })).toBeNull();
  });

  it('offers the collapse toggle', () => {
    const toggle = vi.fn();
    render(
      <MemoryRouter>
        <Sidebar collapsed onToggleCollapsed={toggle} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Expand menu' }));
    expect(toggle).toHaveBeenCalled();
  });

  it('puts organization, admin, integrations and sign out in the user menu', async () => {
    render(
      <MemoryRouter>
        <Sidebar collapsed={false} onToggleCollapsed={() => {}} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Ada Lovelace/ }));
    const menu = screen.getByRole('menu');
    expect(menu.textContent).toContain('Acme');
    expect(
      screen.getByRole('menuitem', { name: /Organization and members/ }).getAttribute('href'),
    ).toBe('/organization');
    expect(screen.getByRole('menuitem', { name: /Users/ }).getAttribute('href')).toBe(
      '/admin/users',
    );
    expect(screen.getByRole('menuitem', { name: /CLI/ }).getAttribute('href')).toBe(
      '/integrations/cli',
    );
    expect(screen.getByRole('menuitem', { name: /Log out/ })).toBeTruthy();
    fireEvent.click(await screen.findByRole('menuitem', { name: /Beta/ }));
    expect(mockSwitch).toHaveBeenCalledWith('o2');
  });
});

describe('CommandPalette', () => {
  it('searches the server and opens the chosen object', async () => {
    mockSearch.mockResolvedValue({
      results: [
        {
          type: 'harness',
          id: 'h1',
          title: 'Support bot',
          subtitle: null,
          href: '/harnesses/support',
        },
      ],
    });
    render(
      <MemoryRouter initialEntries={['/overview']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <CommandPalette open onClose={() => {}} />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'supp' } });
    const option = await screen.findByRole('option', { name: /Support bot/ });
    expect(mockSearch).toHaveBeenCalledWith('supp');
    fireEvent.click(option);
    expect(screen.getByTestId('where').textContent).toContain('/harnesses/support');
  });

  it('filters pages locally and moves with the arrow keys', () => {
    render(
      <MemoryRouter initialEntries={['/overview']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <CommandPalette open onClose={() => {}} />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'topo' } });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    expect(screen.getByTestId('where').textContent).toContain('/topology');
  });
});

describe('AlertsMenu', () => {
  it('badges unseen failures and links each one to its request', async () => {
    mockAlerts.mockResolvedValue({
      total: 1,
      items: [
        {
          id: 'r1',
          timestamp: new Date().toISOString(),
          agentName: 'bot',
          model: 'gpt-x',
          status: 'error',
          errorMessage: 'upstream exploded',
          errorHttpStatus: 502,
          errorClass: null,
        },
      ],
    });
    render(
      <MemoryRouter>
        <AlertsMenu />
      </MemoryRouter>,
    );
    const bell = await screen.findByRole('button', { name: 'Alerts, 1 new' });
    fireEvent.click(bell);
    const row = await screen.findByRole('link', { name: /HTTP 502/ });
    expect(row.getAttribute('href')).toBe('/messages?request=r1');
    expect(row.textContent).toContain('upstream exploded');
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as seen' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Alerts' })).toBeTruthy());
  });
});
