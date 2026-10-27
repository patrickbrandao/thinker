import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@solidjs/testing-library';

vi.mock('@solidjs/router', () => ({
  A: (props: any) => (
    <a href={props.href} class={props.class}>
      {props.children}
    </a>
  ),
  useLocation: () => ({ pathname: '/overview', search: '' }),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [{}],
}));

vi.mock('@solidjs/meta', () => ({
  Title: (props: any) => <title>{props.children}</title>,
  Meta: () => null,
}));

vi.mock('../../src/services/auth-client.js', () => ({
  authClient: {
    signIn: { email: vi.fn().mockResolvedValue({}), social: vi.fn() },
    sendVerificationEmail: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../src/services/toast-store.js', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../src/services/setup-status.js', () => ({
  checkSocialProviders: () => Promise.resolve([]),
  checkSignupEnabled: () => Promise.resolve(true),
  checkMcpEnabled: () => Promise.resolve(true),
}));

vi.mock('../../src/components/AddAgentModal.jsx', () => ({ default: () => null }));

vi.mock('../../src/services/api/organizations.js', () => ({
  listMembers: () =>
    Promise.resolve({
      members: [
        { userId: 'u-me', email: 'me@x.io', name: 'Me', role: 'owner', mustChangePassword: false },
        { userId: 'u-v', email: 'v@x.io', name: 'Vic', role: 'viewer', mustChangePassword: true },
      ],
    }),
  listOrganizations: () => Promise.resolve({ organizations: [{ id: 'org-1', name: 'Acme' }] }),
  listAdminUsers: () =>
    Promise.resolve({
      users: [
        {
          id: 'u-me',
          email: 'me@x.io',
          name: 'Me',
          isInstanceAdmin: true,
          mustChangePassword: false,
          createdAt: new Date().toISOString(),
          organizations: [{ id: 'org-1', name: 'Acme', role: 'owner' }],
        },
      ],
    }),
  addMember: vi.fn(),
  renameOrganization: vi.fn(),
  deleteOrganization: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
  createOrganization: vi.fn(),
  createAdminUser: vi.fn(),
  resetUserPassword: vi.fn(),
  setInstanceAdmin: vi.fn(),
  setActiveOrganization: vi.fn(),
}));

import { resetLocaleForTests } from '../../src/i18n';
import { setMe } from '../../src/services/session-store';
import Login from '../../src/pages/Login';
import Sidebar from '../../src/components/Sidebar';
import Organization from '../../src/pages/Organization';
import AdminUsers from '../../src/pages/AdminUsers';

describe('shell, auth and organization screens in pt-BR', () => {
  beforeEach(() => {
    resetLocaleForTests('pt-BR');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    setMe({
      userId: 'u-me',
      isInstanceAdmin: true,
      mustChangePassword: false,
      organization: { id: 'org-1', name: 'Acme', role: 'owner' },
    });
  });

  it('renders the sign-in page in Portuguese', () => {
    render(() => <Login />);
    expect(screen.getByText('Que bom ver você de novo')).toBeTruthy();
    expect(screen.getByPlaceholderText('Digite sua senha')).toBeTruthy();
    expect(screen.getByText('Esqueceu a senha?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeTruthy();
  });

  it('renders the sidebar in Portuguese', () => {
    render(() => <Sidebar />);
    expect(screen.getByText('Visão geral')).toBeTruthy();
    expect(screen.getByText('Requisições')).toBeTruthy();
    expect(screen.getByText('Por uso')).toBeTruthy();
    expect(screen.getByText('Membros e configurações')).toBeTruthy();
    expect(screen.getByText('Seu papel: Proprietário')).toBeTruthy();
  });

  it('renders the Organization page in Portuguese', async () => {
    render(() => <Organization />);
    await screen.findByText('v@x.io');
    expect(screen.getByText('Membros')).toBeTruthy();
    expect(screen.getByText('Troca de senha pendente')).toBeTruthy();
    expect(screen.getByLabelText('Papel de v@x.io')).toBeTruthy();
    expect(screen.getByText('Zona de perigo')).toBeTruthy();
  });

  it('renders the Users admin page in Portuguese', async () => {
    render(() => <AdminUsers />);
    await screen.findByText('Acme · Proprietário');
    expect(screen.getByText('Todos os usuários')).toBeTruthy();
    expect(screen.getAllByText('Criar usuário').length).toBeGreaterThan(0);
    expect(screen.getByText('Redefinir senha')).toBeTruthy();
  });
});
