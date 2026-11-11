import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

let mockSession: { data: { user?: { name?: string; email?: string } } | null } = {
  data: { user: { name: 'Ada Lovelace', email: 'ada@example.com' } },
};
const mockSignOut = vi.fn();
vi.mock('../../src/services/auth-client', () => ({
  authClient: {
    useSession: () => mockSession,
    signOut: (...a: unknown[]) => mockSignOut(...a),
  },
}));

const mockListOrgs = vi.fn();
const mockCreateOrg = vi.fn();
vi.mock('../../src/services/api/organizations', async (orig) => ({
  ...(await orig<object>()),
  listOrganizations: () => mockListOrgs(),
  createOrganization: (...a: unknown[]) => mockCreateOrg(...a),
}));

const mockMcp = vi.fn();
vi.mock('../../src/services/setup-status', () => ({ checkMcpEnabled: () => mockMcp() }));

const mockSwitch = vi.fn();
vi.mock('../../src/services/session-store', async (orig) => {
  const actual = await orig<typeof import('../../src/services/session-store')>();
  return { ...actual, switchOrganization: (id: string) => mockSwitch(id) };
});

import UserMenu, { signOut } from '../../src/components/shell/UserMenu';
import { setMe } from '../../src/services/session-store';
import { resetLocaleForTests } from '../../src/i18n';

type Role = 'owner' | 'admin' | 'member' | 'viewer';
const ORG = (role: Role = 'owner') => ({ id: 'o1', name: 'Acme', role });

function setProfile(role: Role | null, isInstanceAdmin = false) {
  setMe({
    userId: 'u1',
    isInstanceAdmin,
    mustChangePassword: false,
    organization: role ? ORG(role) : null,
  } as never);
}

function open() {
  render(
    <MemoryRouter>
      <UserMenu />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Ada Lovelace/ }));
  return screen.getByRole('menu', { name: 'User menu' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession = { data: { user: { name: 'Ada Lovelace', email: 'ada@example.com' } } };
  mockListOrgs.mockResolvedValue({ organizations: [ORG()] });
  mockMcp.mockResolvedValue(true);
  setProfile('owner');
});

describe('UserMenu trigger', () => {
  it('shows the user name and email, with an avatar initial', () => {
    render(
      <MemoryRouter>
        <UserMenu />
      </MemoryRouter>,
    );
    const trigger = screen.getByRole('button', { name: /Ada Lovelace/ });
    expect(trigger.getAttribute('title')).toBe('Ada Lovelace');
    expect(trigger.textContent).toContain('ada@example.com');
    expect(trigger.querySelector('.avatar')!.textContent).toBe('A');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('falls back to a generic name, and to the organization name without an email', () => {
    mockSession = { data: { user: {} } };
    render(
      <MemoryRouter>
        <UserMenu />
      </MemoryRouter>,
    );
    const trigger = screen.getByRole('button', { name: /User/ });
    expect(trigger.textContent).toContain('Acme');
  });

  it('copes with no session at all', () => {
    mockSession = { data: null };
    setProfile(null);
    render(
      <MemoryRouter>
        <UserMenu />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /User/ })).toBeTruthy();
  });
});

describe('UserMenu content by role', () => {
  it('owner: shows identity, role, member management, proxy configuration and account links', async () => {
    const menu = open();
    expect(menu.textContent).toContain('ada@example.com');
    expect(menu.textContent).toContain('Acme');
    expect(menu.textContent).toContain('Your role: Owner');
    expect(
      screen.getByRole('menuitem', { name: 'Organization and members' }).getAttribute('href'),
    ).toBe('/organization');
    expect(screen.getByRole('menuitem', { name: 'Triggers' }).getAttribute('href')).toBe(
      '/triggers',
    );
    expect(screen.getByRole('menuitem', { name: 'Proxy configuration' }).getAttribute('href')).toBe(
      '/proxy-servers',
    );
    expect(screen.getByRole('menuitem', { name: 'CLI' }).getAttribute('href')).toBe(
      '/integrations/cli',
    );
    expect(
      screen.getByRole('menuitem', { name: /Account Preferences/i }).getAttribute('href'),
    ).toBe('/account');
    expect(await screen.findByRole('menuitem', { name: 'MCP server' })).toBeTruthy();
  });

  it('viewer: only views the organization, and cannot see proxy configuration', () => {
    setProfile('viewer');
    const menu = open();
    expect(menu.textContent).toContain('Your role: Viewer');
    expect(screen.getByRole('menuitem', { name: 'Organization details' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Organization and members' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Proxy configuration' })).toBeNull();
  });

  it('member: cannot manage members or proxies', () => {
    setProfile('member');
    open();
    expect(screen.getByRole('menuitem', { name: 'Organization details' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Proxy configuration' })).toBeNull();
  });

  it('admin: manages members and proxies', () => {
    setProfile('admin');
    open();
    expect(screen.getByRole('menuitem', { name: 'Organization and members' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Proxy configuration' })).toBeTruthy();
  });

  it('hides the administration entries and "New organization" from non-instance-admins', () => {
    const menu = open();
    expect(menu.textContent).not.toContain('Administration');
    expect(screen.queryByRole('menuitem', { name: 'Users' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'New organization' })).toBeNull();
    expect(menu.textContent).not.toContain('superuser');
  });

  it('instance admin: sees Users, New organization and the instance-admin tag', () => {
    setProfile('owner', true);
    const menu = open();
    expect(menu.textContent).toContain('superuser');
    expect(screen.getByRole('menuitem', { name: 'Users' }).getAttribute('href')).toBe(
      '/admin/users',
    );
    expect(screen.getByRole('menuitem', { name: 'New organization' })).toBeTruthy();
  });

  it('hides the MCP entry while MCP is disabled', async () => {
    mockMcp.mockResolvedValue(false);
    open();
    await waitFor(() => expect(mockMcp).toHaveBeenCalled());
    expect(screen.queryByRole('menuitem', { name: 'MCP server' })).toBeNull();
  });

  it('no organization: renders the menu without the organization card', () => {
    setProfile(null);
    const menu = open();
    expect(menu.textContent).not.toContain('Your role');
    expect(screen.getByRole('menuitem', { name: /Log out/ })).toBeTruthy();
  });
});

describe('UserMenu organization switching', () => {
  it('hides the switcher with a single organization', async () => {
    const menu = open();
    await waitFor(() => expect(mockListOrgs).toHaveBeenCalled());
    expect(menu.textContent).not.toContain('Switch organization');
  });

  it('lists every organization with its role, marking the current one active', async () => {
    mockListOrgs.mockResolvedValue({
      organizations: [ORG(), { id: 'o2', name: 'Beta', role: 'viewer' }],
    });
    open();
    const beta = await screen.findByRole('menuitem', { name: /Beta/ });
    expect(beta.textContent).toContain('Viewer');
    expect(screen.getByText('Switch organization')).toBeTruthy();
    const current = screen.getAllByRole('menuitem').find((i) => i.className.includes('is-active'));
    expect(current!.textContent).toContain('Acme');
  });

  it('switches to the chosen organization', async () => {
    mockListOrgs.mockResolvedValue({
      organizations: [ORG(), { id: 'o2', name: 'Beta', role: 'viewer' }],
    });
    open();
    fireEvent.click(await screen.findByRole('menuitem', { name: /Beta/ }));
    expect(mockSwitch).toHaveBeenCalledWith('o2');
  });

  it('does nothing when the current organization is chosen again', async () => {
    mockListOrgs.mockResolvedValue({
      organizations: [ORG(), { id: 'o2', name: 'Beta', role: 'viewer' }],
    });
    open();
    await screen.findByRole('menuitem', { name: /Beta/ });
    const acme = screen.getAllByRole('menuitem').find((i) => i.className.includes('is-active'))!;
    fireEvent.click(acme);
    expect(mockSwitch).not.toHaveBeenCalled();
  });

  it('includes the active organization even when the list has not returned it', async () => {
    mockListOrgs.mockResolvedValue({ organizations: [{ id: 'o2', name: 'Beta', role: 'member' }] });
    open();
    await screen.findByRole('menuitem', { name: /Beta/ });
    expect(screen.getAllByRole('menuitem', { name: /Acme/ }).length).toBeGreaterThan(0);
    expect(screen.getByText('Switch organization')).toBeTruthy();
  });

  it('still opens when the organization list fails to load', async () => {
    mockListOrgs.mockRejectedValue(new Error('boom'));
    const menu = open();
    await waitFor(() => expect(mockListOrgs).toHaveBeenCalled());
    expect(menu.textContent).not.toContain('Switch organization');
    expect(screen.getByRole('menuitem', { name: 'Triggers' })).toBeTruthy();
  });
});

describe('UserMenu creating an organization', () => {
  beforeEach(() => setProfile('owner', true));

  function openModal() {
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'New organization' }));
    return screen.getByRole('dialog', { name: 'New organization' });
  }

  it('opens a dialog and closes the menu', () => {
    const dialog = openModal();
    expect(dialog).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByLabelText('Organization name')).toBeTruthy();
  });

  it('creates the organization with a trimmed name, then switches to it', async () => {
    mockCreateOrg.mockResolvedValue({ id: 'o9', name: 'Gamma', role: 'owner' });
    openModal();
    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: '  Gamma ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    await waitFor(() => expect(mockSwitch).toHaveBeenCalledWith('o9'));
    expect(mockCreateOrg).toHaveBeenCalledWith('Gamma');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ignores a blank name', () => {
    openModal();
    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: '   ' } });
    fireEvent.submit(screen.getByLabelText('Organization name').closest('form')!);
    expect(mockCreateOrg).not.toHaveBeenCalled();
  });

  it('stays open and does not switch when creation fails', async () => {
    mockCreateOrg.mockRejectedValue(new Error('taken'));
    openModal();
    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'Gamma' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    await waitFor(() => expect(mockCreateOrg).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Create organization' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(mockSwitch).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'New organization' })).toBeTruthy();
  });

  it('Cancel closes the dialog without creating', () => {
    openModal();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockCreateOrg).not.toHaveBeenCalled();
  });
});

describe('UserMenu sign out', () => {
  it('signs out through the auth client and returns to /login', async () => {
    mockSignOut.mockResolvedValue(undefined);
    const replace = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...original, replace },
      configurable: true,
    });
    try {
      open();
      fireEvent.click(screen.getByRole('menuitem', { name: /Log out/ }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
      expect(mockSignOut).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', { value: original, configurable: true });
    }
  });

  it('the exported signOut waits for the client before redirecting', async () => {
    let finish!: () => void;
    mockSignOut.mockReturnValue(new Promise<void>((r) => (finish = r)));
    const replace = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...original, replace },
      configurable: true,
    });
    try {
      const pending = signOut();
      await Promise.resolve();
      expect(replace).not.toHaveBeenCalled();
      finish();
      await pending;
      expect(replace).toHaveBeenCalledWith('/login');
    } finally {
      Object.defineProperty(window, 'location', { value: original, configurable: true });
    }
  });
});

describe('UserMenu in pt-BR', () => {
  it('translates the headings, role and entries', () => {
    resetLocaleForTests('pt-BR');
    setProfile('owner', true);
    render(
      <MemoryRouter>
        <UserMenu />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Ada Lovelace/ }));
    const menu = screen.getByRole('menu');
    expect(menu.textContent).toContain('Organização');
    expect(menu.textContent).toContain('Seu papel:');
    expect(menu.textContent).toContain('super usuário');
    expect(screen.getByRole('menuitem', { name: 'Nova organização' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'New organization' })).toBeNull();
  });
});
