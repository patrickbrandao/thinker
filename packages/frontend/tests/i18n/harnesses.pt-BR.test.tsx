import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { resetLocaleForTests } from '../../src/i18n';

vi.mock('react-router', async (orig) => ({
  ...(await orig<object>()),
  useNavigate: () => vi.fn(),
  useParams: () => ({ agentName: 'test-agent' }),
  useLocation: () => ({ pathname: '/harnesses/test-agent/settings', state: null, search: '' }),
}));

const mockGetAgents = vi.fn();
vi.mock('../../src/services/api', () => ({
  getAgents: (...args: unknown[]) => mockGetAgents(...args),
  createAgent: vi.fn(),
  deleteAgent: vi.fn(),
  getGlobalProviders: vi.fn(),
  getAgentKey: () => Promise.resolve({ keyPrefix: 'thk_abc' }),
  getAgentInfo: () =>
    Promise.resolve({
      agent_name: 'test-agent',
      agent_category: 'personal',
      agent_platform: 'other',
    }),
  renameAgent: vi.fn(),
  rotateAgentKey: vi.fn(),
  updateAgent: vi.fn(),
  getRecording: () => Promise.resolve({ enabled: false }),
  updateRecording: vi.fn(),
  getModelListing: () => Promise.resolve({ mode: 'open' }),
  updateModelListing: vi.fn(),
}));

vi.mock('../../src/services/api/virtual-models', () => ({
  listVirtualModels: () => Promise.resolve([]),
}));

vi.mock('../../src/services/toast-store', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../src/components/SetupStepAddProvider', () => ({
  default: () => <div data-testid="setup-add-provider" />,
}));

// Other areas, not under test here.
vi.mock('../../src/components/SetupModal', () => ({ default: () => null }));

vi.mock('../../src/services/sse', async () => {
  const { signal } = await import('../../src/lib/signal');
  return { agentPing: signal(0), analyticsPing: signal(0), refreshAgents: vi.fn() };
});

import Workspace from '../../src/pages/Workspace';
import Settings from '../../src/pages/Settings';

const render = (ui: () => React.ReactElement) =>
  rtlRender(<MemoryRouter initialEntries={['/harnesses']}>{ui()}</MemoryRouter>);

describe('harness screens in pt-BR', () => {
  beforeEach(() => {
    resetLocaleForTests('pt-BR');
    mockGetAgents.mockReset();
  });

  it('renders the empty harness list in Portuguese', async () => {
    mockGetAgents.mockResolvedValue({ agents: [] });
    render(() => <Workspace />);
    expect(await screen.findByText('Nenhum harness ainda')).toBeDefined();
    expect(screen.getByText('Conectar seu primeiro harness')).toBeDefined();
  });

  it('renders the harness table headers in Portuguese', async () => {
    localStorage.setItem('thinker_harness_view', 'table');
    mockGetAgents.mockResolvedValue({
      agents: [
        {
          agent_name: 'bot',
          message_count: 3,
          last_active: '',
          total_cost: 0,
          total_tokens: 10,
          sparkline: [],
        },
      ],
    });
    render(() => <Workspace />);
    expect(await screen.findByText('Requisições')).toBeDefined();
    expect(screen.getByText('Última atividade')).toBeDefined();
    localStorage.removeItem('thinker_harness_view');
  });

  it('renders harness settings in Portuguese', async () => {
    const { container } = render(() => <Settings />);
    expect(screen.getByText('Nome do harness')).toBeDefined();
    expect(screen.getByText('Tipo de harness')).toBeDefined();
    expect(screen.getByText('Zona de perigo')).toBeDefined();
    expect(screen.getByText('Ativar logs')).toBeDefined();
    await vi.waitFor(() => {
      // "Other" platform and the category label are translated too.
      expect(container.textContent).toContain('Outro');
      expect(container.textContent).toContain('Agente de IA');
    });
  });
});
