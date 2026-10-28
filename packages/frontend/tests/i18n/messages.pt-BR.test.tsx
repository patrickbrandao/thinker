import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { resetLocaleForTests, setLocale, useLocale } from '../../src/i18n';

vi.mock('react-router', () => ({
  useParams: () => ({ agentName: 'test-agent' }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useNavigate: () => vi.fn(),
  Link: (props: any) => <a href={props.to}>{props.children}</a>,
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

vi.mock('../../src/services/sse.js', async () => {
  const { signal } = await import('../../src/lib/signal');
  return {
    pingCount: signal(0),
    messagePing: signal(0),
    analyticsPing: signal(0),
    agentPing: signal(0),
    routingPing: signal(0),
  };
});

vi.mock('../../src/services/model-display.js', () => ({
  getModelDisplayName: (slug: string) => slug,
  preloadModelDisplayNames: () => {},
}));

vi.mock('../../src/components/SetupModal.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/Select.jsx', () => ({
  default: (props: any) => (
    <select data-testid="select">
      {props.options?.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('../../src/components/MultiSelect.jsx', () => ({
  default: (props: any) => <select aria-label={props.label} />,
}));

import MessageLog from '../../src/pages/MessageLog';
import RequestDrawer from '../../src/components/RequestDrawer';

/** The app remounts its routes on a language change (keyed router); mirror that. */
function KeyedMessageLog() {
  const locale = useLocale();
  return <MessageLog key={locale} />;
}

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
    const { container } = render(<MessageLog />);
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
    const { container } = render(<KeyedMessageLog />);
    expect(container.textContent).toContain('Todos os status');
    act(() => setLocale('en', { persist: false }));
    expect(container.textContent).toContain('All statuses');
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
    const { container } = render(
      <RequestDrawer messageId="request-1234567890" onClose={() => {}} />,
    );
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
