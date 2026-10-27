import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen } from '@solidjs/testing-library';
import { resetLocaleForTests } from '../../src/i18n';

vi.mock('../../src/services/api.js', () => ({
  getTierAssignments: () => Promise.resolve([]),
  getAvailableModels: () => Promise.resolve([]),
  getProviders: () =>
    Promise.resolve([
      {
        id: 'p1',
        provider: 'openai',
        auth_type: 'api_key',
        is_active: true,
        has_api_key: true,
        connected_at: '2025-01-01',
      },
    ]),
  getCustomProviders: () => Promise.resolve([]),
  getEnabledProviders: () => Promise.resolve({ enabled: ['p1'] }),
  getSpecificityAssignments: () => Promise.resolve([]),
  getComplexityStatus: () => Promise.resolve({ enabled: false }),
  getPricingHealth: () => Promise.resolve({ model_count: 100 }),
  listModelParams: () => Promise.resolve([]),
  modelParamsKey: (s: string, p: string, a: string, m: string) => `${s}::${p}::${m}::${a}`,
}));
vi.mock('../../src/services/api/header-tiers.js', () => ({
  listHeaderTiers: () => Promise.resolve([]),
}));
vi.mock('../../src/services/api/virtual-models.js', () => ({
  listVirtualModels: () => Promise.resolve([]),
}));
vi.mock('../../src/services/toast-store.js', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock('../../src/services/agent-display-name.js', () => ({ agentDisplayName: () => 'Demo' }));
vi.mock('../../src/services/recent-agents.js', () => ({
  isRecentlyCreated: () => false,
  isSetupPending: () => false,
  clearSetupPending: vi.fn(),
}));
vi.mock('../../src/services/agent-platform-store.js', () => ({
  agentPlatform: () => 'openclaw',
  agentCategory: () => 'coding',
}));
vi.mock('../../src/components/SetupModal.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/RoutingModals.js', () => ({ default: () => null }));
vi.mock('../../src/services/routing-params.js', () => ({
  parseCustomProviderParams: () => null,
  parseProviderDeepLink: () => null,
}));
vi.mock('@solidjs/meta', () => ({
  Title: (props: { children: unknown }) => <div data-testid="title">{props.children as string}</div>,
  Meta: () => null,
}));
vi.mock('@solidjs/router', () => ({
  useParams: () => ({ agentName: 'demo' }),
  useLocation: () => ({ state: undefined }),
  useSearchParams: () => [{}, vi.fn()],
  A: (props: { children: unknown }) => props.children,
}));

import Routing from '../../src/pages/Routing';
import RoutingTabs from '../../src/components/RoutingTabs';
import { pricePerM } from '../../src/services/routing-utils';
import { streamWarmupError } from '../../src/services/stream-warmup';

beforeEach(() => {
  resetLocaleForTests('pt-BR');
});

describe('Routing in pt-BR', () => {
  it('renders the default routing view in Portuguese', async () => {
    render(() => <Routing />);
    await waitFor(() => {
      expect(screen.getByText('Atualizar modelos')).toBeDefined();
    });
    expect(screen.getByTestId('title').textContent).toBe('Roteamento de Demo - Thinker');
    expect(screen.getByText('Modo de resposta: Buffered')).toBeDefined();
    expect(
      screen.getByText('Escolha um modelo e até 5 fallbacks como seu roteamento padrão.'),
    ).toBeDefined();
    expect(screen.getAllByText('Criar nível personalizado').length).toBeGreaterThan(0);
    expect(screen.getByText('Padrão')).toBeDefined();
    expect(screen.getByText('+ Adicionar modelo')).toBeDefined();
    expect(screen.getByText('1 conexão')).toBeDefined();
    expect(screen.getByText('Instruções de configuração')).toBeDefined();
  });

  it('renders the routing tabs in Portuguese', () => {
    render(() => (
      <RoutingTabs specificityEnabled={() => false} customEnabled={() => false}>
        {{ default: <div />, specificity: <div />, custom: <div /> }}
      </RoutingTabs>
    ));
    expect(screen.getByRole('tablist', { name: 'Camadas de roteamento' })).toBeDefined();
    expect(screen.getByRole('tab', { name: /Por tarefa/ })).toBeDefined();
    expect(screen.getByRole('tab', { name: /Personalizado/ })).toBeDefined();
  });

  it('formats prices and warm-up errors for pt-BR', () => {
    expect(pricePerM(0)).toBe('Grátis');
    expect(pricePerM(0.0000025)).toMatch(/^US\$\s2,50$/);
    expect(streamWarmupError()).toBe(
      'Informe um valor entre 1 e 600 segundos ou deixe em branco.',
    );
  });
});
