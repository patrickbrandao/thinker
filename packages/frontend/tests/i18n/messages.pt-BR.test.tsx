import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { resetLocaleForTests, setLocale } from '../../src/i18n';

vi.mock('@solidjs/router', () => ({
  useParams: () => ({ agentName: 'test-agent' }),
  useSearchParams: () => [{}, vi.fn()],
  useNavigate: () => vi.fn(),
  A: (props: any) => <a href={props.href}>{props.children}</a>,
}));

vi.mock('@solidjs/meta', () => ({
  Title: (props: any) => <title>{props.children}</title>,
  Meta: (props: any) => <meta name={props.name ?? ''} content={props.content ?? ''} />,
}));

const mockGetMessages = vi.fn();
vi.mock('../../src/services/api.js', () => ({
  getMessages: (...args: unknown[]) => mockGetMessages(...args),
  getMessageCount: () => Promise.resolve(undefined),
  getMessageFilterOptions: () => Promise.resolve({ providers: [] }),
  getAgents: () => Promise.resolve({ agents: [] }),
  getSpecificityAssignments: () => Promise.resolve([]),
  getRoutingStatus: () => Promise.resolve({ enabled: false }),
}));

vi.mock('../../src/services/api/providers.js', () => ({
  getProviders: () => Promise.resolve({ providers: [], model_counts: {} }),
}));

const mockGetMessageDetails = vi.fn();
vi.mock('../../src/services/api/messages.js', () => ({
  getMessageDetails: (...args: unknown[]) => mockGetMessageDetails(...args),
}));

vi.mock('../../src/services/sse.js', () => ({
  pingCount: () => 0,
  messagePing: () => 0,
  analyticsPing: () => 0,
  agentPing: () => 0,
  routingPing: () => 0,
}));

vi.mock('../../src/services/model-display.js', () => ({
  getModelDisplayName: (slug: string) => slug,
  preloadModelDisplayNames: () => {},
}));

vi.mock('../../src/components/SetupModal.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/Select.jsx', () => ({
  default: (props: any) => (
    <select data-testid="select">
      {props.options?.map((o: any) => (
        <option value={o.value}>{o.label}</option>
      ))}
    </select>
  ),
}));
vi.mock('../../src/components/MultiSelect.jsx', () => ({
  default: (props: any) => <select aria-label={props.label} />,
}));

import MessageLog from '../../src/pages/MessageLog';
import RequestDrawer from '../../src/components/RequestDrawer';

const messagesData = {
  items: [
    {
      id: 'msg-12345678',
      timestamp: '2026-02-18T10:00:00Z',
      agent_name: 'test-agent',
      model: 'gpt-4o',
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      cost: 1.5,
      status: 'ok',
      duration_ms: 1200,
    },
  ],
  next_cursor: null,
  total_count: 1,
  providers: [],
};

describe('Request log in pt-BR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetLocaleForTests('pt-BR');
  });

  it('renders the page, filters, headers and rows in Portuguese', async () => {
    mockGetMessages.mockResolvedValue(messagesData);
    const { container } = render(() => <MessageLog />);
    expect(screen.getByRole('heading', { name: 'Requisições' })).toBeDefined();
    expect(container.textContent).toContain('Log completo das requisições do seu app');
    expect(container.textContent).toContain('Todos os status');
    expect(container.textContent).toContain('Últimos 7 dias');
    expect(container.querySelector('[aria-label="Filtro de conexão"]')).not.toBeNull();
    await vi.waitFor(() => {
      expect(container.textContent).toContain('1 no total');
      expect(container.textContent).toContain('Sucesso');
      expect(container.textContent).toContain('Tentativas');
      // Currency follows the pt-BR locale.
      expect(container.textContent).toMatch(/US\$\s?1,50/);
    });
  });

  it('switches back to English live', async () => {
    mockGetMessages.mockResolvedValue(messagesData);
    const { container } = render(() => <MessageLog />);
    expect(screen.getByRole('heading', { name: 'Requisições' })).toBeDefined();
    setLocale('en', { persist: false });
    expect(screen.getByRole('heading', { name: 'Requests' })).toBeDefined();
    await vi.waitFor(() => expect(container.textContent).toContain('1 total'));
  });

  it('renders the request drawer in Portuguese', async () => {
    mockGetMessageDetails.mockResolvedValue({
      message: {
        id: 'request-1234567890',
        status: 'failed',
        provider: 'openai',
        model: 'gpt-4o',
        auth_type: 'api_key',
        timestamp: '2026-07-15T10:11:12Z',
        error_message: 'boom',
        error_origin: 'provider',
        attempts: [
          {
            id: 'a1',
            status: 'failed',
            provider: 'openai',
            model: 'gpt-4o',
            error_message: 'boom',
            error_origin: 'provider',
          },
        ],
      },
    });
    const { container } = render(() => (
      <RequestDrawer messageId="request-1234567890" onClose={() => {}} />
    ));
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Requisição request-1234');
    });
    expect(container.textContent).toContain('Falhou');
    expect(container.textContent).toContain('Detalhes');
    expect(container.textContent).toContain('Tentativas');
    expect(container.textContent).toContain('Erro');
    expect(container.textContent).toContain('Origem');
    expect(screen.getByLabelText('Fechar')).toBeDefined();
  });
});
