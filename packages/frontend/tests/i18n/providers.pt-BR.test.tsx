import { render, screen, waitFor } from '@testing-library/react';
import { Fragment, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLocaleForTests, setLocale, useLocale } from '../../src/i18n';

vi.mock('../../src/components/ProviderSelectModal.jsx', () => ({
  default: () => <div role="dialog" />,
}));

vi.mock('../../src/components/ProviderIcon.jsx', () => ({
  providerIcon: () => null,
}));

vi.mock('../../src/components/Sparkline.jsx', () => ({
  default: () => <span />,
}));

vi.mock('../../src/services/sse.js', async () => {
  const { signal } = await import('../../src/lib/signal');
  return { messagePing: signal(0), analyticsPing: signal(0), routingPing: signal(0) };
});

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

/** The app remounts its tree on a language change; mirror that here. */
function RemountOnLocale({ children }: { children: ReactNode }) {
  const locale = useLocale();
  return <Fragment key={locale}>{children}</Fragment>;
}

const renderInRouter = (node: ReactNode) =>
  render(
    <MemoryRouter>
      <RemountOnLocale>{node}</RemountOnLocale>
    </MemoryRouter>,
  );

describe('provider pages in pt-BR', () => {
  beforeEach(() => {
    resetLocaleForTests('pt-BR');
  });

  it('renders the usage-based page in Portuguese', async () => {
    renderInRouter(<Byok />);
    await waitFor(() => expect(screen.getByText('Production')).toBeTruthy());
    expect(screen.getByText('Ativa')).toBeTruthy();
    expect(screen.getByText('Ver detalhes')).toBeTruthy();
    expect(screen.getByText('Adicionar provedor')).toBeTruthy();
    expect(screen.getByText('Adicionar provedor personalizado')).toBeTruthy();
  });

  it('switches language live', async () => {
    renderInRouter(<Byok />);
    await waitFor(() => expect(screen.getByText('Adicionar provedor')).toBeTruthy());
    setLocale('en', { persist: false });
    await waitFor(() => expect(screen.getByText('Add provider')).toBeTruthy());
  });

  it('renders the custom provider form with the context window column in Portuguese', () => {
    render(<CustomProviderForm agentName="demo-agent" onCreated={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText('Adicionar provedor personalizado')).toBeTruthy();
    expect(screen.getByText('Nome do provedor')).toBeTruthy();
    expect(screen.getByText('Formato da API')).toBeTruthy();
    expect(screen.getByText('Janela de contexto')).toBeTruthy();
    expect(screen.getByLabelText('Janela de contexto do modelo 1 em tokens')).toBeTruthy();
    expect(screen.getByText('+ Adicionar modelo')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Conectar' })).toBeTruthy();
  });

  it('renders the no-connections prompt in Portuguese', async () => {
    const { default: NoConnectionsPrompt } =
      await import('../../src/components/NoConnectionsPrompt');
    renderInRouter(<NoConnectionsPrompt />);
    expect(screen.getByText('Nenhum provedor conectado')).toBeTruthy();
    expect(screen.getByText('Assinaturas')).toBeTruthy();
    expect(screen.getAllByText('Conectar provedor')).toHaveLength(3);
  });
});
