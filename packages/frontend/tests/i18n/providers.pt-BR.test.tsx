import { render, screen, waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLocaleForTests, setLocale } from '../../src/i18n';

vi.mock('@solidjs/router', () => ({
  useSearchParams: () => [{}, vi.fn()],
  useNavigate: () => vi.fn(),
  A: (props: { href: string; children?: unknown }) => (
    <a href={props.href}>{props.children as never}</a>
  ),
}));

vi.mock('@solidjs/meta', () => ({
  Title: (props: { children: unknown }) => <title>{props.children as string}</title>,
}));

vi.mock('../../src/components/ProviderSelectModal.jsx', () => ({
  default: () => <div role="dialog" />,
}));

vi.mock('../../src/components/ProviderIcon.jsx', () => ({
  providerIcon: () => null,
}));

vi.mock('../../src/components/Sparkline.jsx', () => ({
  default: () => <span />,
}));

vi.mock('../../src/services/sse.js', () => ({
  messagePing: () => 0,
  analyticsPing: () => 0,
  routingPing: () => 0,
}));

vi.mock('../../src/services/api/routing.js', () => ({
  renameProviderKey: vi.fn(),
}));

vi.mock('../../src/services/toast-store.js', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const connection = (id: string, label: string) => ({
  id,
  label,
  key_prefix: null,
  priority: 0,
  connected_at: '2026-01-01',
  models_fetched_at: null,
  cached_model_count: 3,
  is_active: true,
});

vi.mock('../../src/services/api/providers.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/api/providers')>(
    '../../src/services/api/providers',
  );
  return {
    getProviders: () =>
      Promise.resolve({
        providers: [
          {
            provider: 'openai',
            auth_type: 'api_key',
            connection_count: 1,
            connections: [connection('key-openai', 'Production')],
            total_models: 3,
            consumption_tokens: 42,
            consumption_messages: 2,
            consumption_cost: 1.5,
            last_used_at: null,
            sparkline_7d: [],
          },
        ],
        model_counts: {},
      }),
    getProviderUsage: () => Promise.resolve({ providers: [] }),
    mergeUsage: actual.mergeUsage,
    connectionUsage: actual.connectionUsage,
  };
});

vi.mock('../../src/services/api.js', () => ({
  getAgents: () => Promise.resolve({ agents: [{ agent_name: 'demo-agent' }] }),
  getProviders: () => Promise.resolve([]),
  getCustomProviders: () => Promise.resolve([]),
  createCustomProvider: vi.fn(),
  updateCustomProvider: vi.fn(),
  deleteCustomProvider: vi.fn(),
  probeCustomProvider: vi.fn(),
  connectProvider: vi.fn(),
  disconnectProvider: vi.fn(),
  renameProviderKey: vi.fn(),
  reorderProviderKeys: vi.fn(),
  revokeOpenaiOAuth: vi.fn(),
}));

import Byok from '../../src/pages/providers/Byok';
import CustomProviderForm from '../../src/components/CustomProviderForm';
import NoConnectionsPrompt from '../../src/components/NoConnectionsPrompt';

describe('provider pages in pt-BR', () => {
  beforeEach(() => {
    resetLocaleForTests('pt-BR');
  });

  it('renders the usage-based page in Portuguese', async () => {
    render(() => <Byok />);
    await waitFor(() => expect(screen.getByText('Production')).toBeDefined());
    expect(screen.getByText('Por uso')).toBeDefined();
    expect(screen.getByText('Minhas conexões por uso')).toBeDefined();
    expect(screen.getByText('Provedores por uso compatíveis')).toBeDefined();
    expect(screen.getByText('Custo total de API (30d)')).toBeDefined();
    expect(screen.getByText('Ativa')).toBeDefined();
    expect(screen.getByText('Ver detalhes')).toBeDefined();
    expect(screen.getByText('Adicionar provedor personalizado')).toBeDefined();
    // Currency follows the locale.
    expect(screen.getAllByText(/^US\$\s\d+,\d{2}$/).length).toBeGreaterThan(0);
  });

  it('switches language live', async () => {
    render(() => <Byok />);
    await waitFor(() => expect(screen.getByText('Minhas conexões por uso')).toBeDefined());
    setLocale('en', { persist: false });
    await waitFor(() => expect(screen.getByText('My usage-based connections')).toBeDefined());
  });

  it('renders the custom provider form with the context window column in Portuguese', () => {
    render(() => (
      <CustomProviderForm agentName="demo-agent" onCreated={vi.fn()} onBack={vi.fn()} />
    ));
    expect(screen.getByText('Adicionar provedor personalizado')).toBeDefined();
    expect(screen.getByText('Nome do provedor')).toBeDefined();
    expect(screen.getByText('Formato da API')).toBeDefined();
    expect(screen.getByText('Janela de contexto')).toBeDefined();
    expect(screen.getByLabelText('Janela de contexto do modelo 1 em tokens')).toBeDefined();
    expect(screen.getByText('+ Adicionar modelo')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Conectar' })).toBeDefined();
  });

  it('renders the no-connections prompt in Portuguese', () => {
    render(() => <NoConnectionsPrompt />);
    expect(screen.getByText('Nenhum provedor conectado')).toBeDefined();
    expect(screen.getByText('Assinaturas')).toBeDefined();
    expect(screen.getAllByText('Conectar provedor')).toHaveLength(3);
  });
});
