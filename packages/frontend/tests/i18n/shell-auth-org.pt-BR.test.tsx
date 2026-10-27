import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../src/services/auth-client.js', () => ({
  authClient: {
    useSession: () => ({
      data: { user: { name: 'Ada Lovelace', email: 'ada@example.com' } },
      isPending: false,
    }),
    signIn: { email: vi.fn().mockResolvedValue({}), social: vi.fn() },
    sendVerificationEmail: vi.fn().mockResolvedValue({}),
    signOut: vi.fn(),
  },
}));

vi.mock('../../src/services/api/console.js', () => ({
  searchConsole: () => Promise.resolve({ results: [] }),
  getAlerts: () =>
    Promise.resolve({
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
    }),
}));

vi.mock('../../src/services/setup-status.js', () => ({
  checkSocialProviders: () => Promise.resolve([]),
  checkSignupEnabled: () => Promise.resolve(true),
  checkMcpEnabled: () => Promise.resolve(true),
}));

vi.mock('../../src/components/AddAgentModal.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/DuplicateAgentModal.jsx', () => ({ default: () => null }));

vi.mock('../../src/services/api/organizations.js', async (orig) => ({
  ...(await orig<object>()),
  listOrganizations: () =>
    Promise.resolve({
      organizations: [
        { id: 'org-1', name: 'Acme', role: 'owner' },
        { id: 'org-2', name: 'Beta', role: 'viewer' },
      ],
    }),
}));

import { resetLocaleForTests } from '../../src/i18n';
import { setMe } from '../../src/services/session-store';
import Sidebar from '../../src/components/shell/Sidebar';
import Topbar from '../../src/components/shell/Topbar';
import CommandPalette from '../../src/components/shell/CommandPalette';
import AlertsMenu from '../../src/components/shell/AlertsMenu';

function inRouter(node: React.ReactNode, path = '/overview') {
  return render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);
}

describe('shell, auth and organization screens in pt-BR', () => {
  beforeEach(() => {
    resetLocaleForTests('pt-BR');
    localStorage.clear();
    setMe({
      userId: 'u-me',
      isInstanceAdmin: true,
      mustChangePassword: false,
      organization: { id: 'org-1', name: 'Acme', role: 'owner' },
    } as never);
  });

  // Login, Organization and AdminUsers are not ported to React yet; their
  // pt-BR cases come back when those pages are.
  it.todo('renders the sign-in page in Portuguese');
  it.todo('renders the Organization page in Portuguese');
  it.todo('renders the Users admin page in Portuguese');

  it('renders the sidebar in Portuguese', () => {
    inRouter(<Sidebar collapsed={false} onToggleCollapsed={() => {}} onNavigate={() => {}} />);
    expect(screen.getByRole('complementary', { name: 'Navegação' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Visão geral' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Requisições' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Topologia' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Por uso' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Assinaturas' })).toBeTruthy();
    expect(screen.getByText('PROVEDORES')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Recolher menu' })).toBeTruthy();
  });

  it('renders the user menu in Portuguese', async () => {
    inRouter(<Sidebar collapsed={false} onToggleCollapsed={() => {}} onNavigate={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Ada Lovelace/ }));
    const menu = screen.getByRole('menu', { name: 'Menu do usuário' });
    expect(menu.textContent).toContain('Organização');
    expect(menu.textContent).toContain('Seu papel: Proprietário');
    expect(menu.textContent).toContain('admin da instância');
    expect(screen.getByRole('menuitem', { name: /Organização e membros/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Sair/ })).toBeTruthy();
    expect(await screen.findByText('Trocar de organização')).toBeTruthy();
  });

  it('renders the topbar in Portuguese', () => {
    inRouter(<Topbar onOpenSearch={() => {}} onOpenMobileNav={() => {}} />);
    expect(screen.getByRole('navigation', { name: 'Trilha de navegação' }).textContent).toContain(
      'Visão geral',
    );
    expect(screen.getByRole('button', { name: 'Procurar (⌘K)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abrir menu de navegação' })).toBeTruthy();
    expect(screen.getByText('Documentação')).toBeTruthy();
  });

  it('renders the command palette in Portuguese', () => {
    inRouter(<CommandPalette open onClose={() => {}} />);
    const input = screen.getByRole('combobox');
    expect(input.getAttribute('placeholder')).toBe(
      'Procurar páginas, harnesses, provedores, modelos…',
    );
    expect(screen.getByText('Ir para')).toBeTruthy();
    expect(screen.getByText('Ações')).toBeTruthy();
    expect(screen.getByText('Alternar tema claro/escuro')).toBeTruthy();
  });

  it('renders the alerts menu in Portuguese', async () => {
    inRouter(<AlertsMenu />);
    const bell = await screen.findByRole('button', { name: 'Alertas, 1 novos' });
    fireEvent.click(bell);
    expect(await screen.findByText('Ver requisições com falha')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar todos como vistos' }));
    expect(await screen.findByText('Últimas 24 horas')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Alertas' })).toBeTruthy();
  });
});
