import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@solidjs/testing-library';
import { resetLocaleForTests } from '../../src/i18n';

// The global and per-harness Overview pages rendered in Brazilian Portuguese.
// Only the network, the router and the uPlot charts are stubbed; the catalogs,
// formatters and components are real.

vi.mock('@solidjs/router', () => ({
  useParams: () => ({ agentName: 'demo-agent' }),
  useLocation: () => ({ pathname: '/harnesses/demo-agent', state: null }),
  useNavigate: () => vi.fn(),
  A: (props: { href: string; class?: string; children: unknown }) => (
    <a href={props.href} class={props.class}>
      {props.children}
    </a>
  ),
}));

vi.mock('@solidjs/meta', () => ({
  Title: (props: { children: unknown }) => <title>{props.children}</title>,
  Meta: () => null,
}));

vi.mock('../../src/services/sse.js', () => ({
  agentPing: () => 0,
  analyticsPing: () => 0,
  messagePing: () => 0,
  routingPing: () => 0,
  pingCount: () => 0,
}));

const overview = {
  summary: {
    tokens_today: { value: 12_500, trend_pct: 10 },
    cost_today: { value: 3.5, trend_pct: -5 },
    messages: { value: 42, trend_pct: 8 },
    services_hit: { total: 1, healthy: 1, issues: 0 },
  },
  request_reliability: null,
  token_usage: [{ hour: '2026-06-04 10:00:00', input_tokens: 700, output_tokens: 500 }],
  cost_usage: [{ hour: '2026-06-04 10:00:00', cost: 0.5 }],
  message_usage: [{ hour: '2026-06-04 10:00:00', count: 42 }],
  cost_by_model: [
    { model: 'gpt-4o', tokens: 12_500, share_pct: 100, estimated_cost: 3.5, auth_type: 'api_key' },
  ],
  recent_activity: [],
  active_skills: [],
  has_data: true,
  has_providers: true,
};

vi.mock('../../src/services/api.js', async () => {
  const providers = await vi.importActual<typeof import('../../src/services/api/providers')>(
    '../../src/services/api/providers',
  );
  return {
    getOverview: () => Promise.resolve(overview),
    getOverviewDetails: () => Promise.resolve({}),
    getAgents: () =>
      Promise.resolve({
        agents: [
          {
            agent_name: 'demo-agent',
            display_name: 'Demo Agent',
            agent_category: 'personal',
            agent_platform: 'codex',
            message_count: 42,
            total_tokens: 12_500,
            sparkline: [1, 2, 3],
          },
        ],
      }),
    getGlobalProviders: () =>
      Promise.resolve({
        providers: [
          {
            provider: 'openai',
            auth_type: 'api_key',
            connection_count: 1,
            connections: [{ id: 'conn-1', label: '', is_active: false }],
            total_models: 3,
          },
        ],
      }),
    getGlobalProviderUsage: () => Promise.resolve({ providers: [] }),
    getRecentRequests: () => Promise.resolve({ items: [] }),
    getCustomProviders: () => Promise.resolve([]),
    mergeUsage: providers.mergeUsage,
  };
});

vi.mock('../../src/services/api/analytics.js', () => ({
  attemptSuccessRate: (row: { attempts: number; succeeded?: number }) =>
    !row.attempts || row.succeeded == null ? null : row.succeeded / row.attempts,
  recoveredCount: (row: { fallback_saves?: number }) => row.fallback_saves ?? 0,
  successRate: (row: { requests: number; succeeded?: number }) =>
    !row.requests || row.succeeded == null ? null : row.succeeded / row.requests,
  getOverview: () => Promise.resolve(overview),
  getModelUsage: () => Promise.resolve({ cost_by_model: [] }),
  getOverviewAgentUsage: () =>
    Promise.resolve({
      tokenUsage: { agents: [], timeseries: [] },
      messageUsage: { agents: [], timeseries: [] },
      costUsage: { agents: [], timeseries: [] },
    }),
  getOverviewProviderUsage: () =>
    Promise.resolve({
      tokenUsage: { agents: [], timeseries: [] },
      messageUsage: { agents: [], timeseries: [] },
      costUsage: { agents: [], timeseries: [] },
    }),
  getReliabilityStats: () =>
    Promise.resolve({
      success_rate: { value: 0.955, previous: 0.9 },
      fallback_saves: { value: 2, previous: 1 },
      total_requests: { value: 42, previous: 40 },
      errors_remaining: { value: 3, previous: 4 },
    }),
  getRequestStatusTimeseries: () =>
    Promise.resolve({ range: '7d', by: 'disposition', keys: [], buckets: [] }),
  getPerAgentReliability: () => Promise.resolve([]),
  getPerProviderReliability: () => Promise.resolve([]),
  getPerModelReliability: () =>
    Promise.resolve([{ model: 'gpt-4o', attempts: 40, succeeded: 38 }]),
  getPerProviderTimeseries: () => Promise.resolve({ agents: [], timeseries: [] }),
  getPerProviderMessageTimeseries: () => Promise.resolve({ agents: [], timeseries: [] }),
  getPerProviderCostTimeseries: () => Promise.resolve({ agents: [], timeseries: [] }),
  getErrorBreakdown: () => Promise.resolve({ by_class: {}, by_origin: {} }),
}));

vi.mock('../../src/components/MultiAgentTokenChart.jsx', () => ({
  AGENT_COLORS: ['#111111', '#222222'],
  default: () => <div data-testid="chart" />,
}));
vi.mock('../../src/components/ReliabilityChart.jsx', () => ({
  default: () => <div data-testid="chart" />,
}));
vi.mock('../../src/components/MessageTable.jsx', () => ({
  default: () => <div data-testid="message-table" />,
}));
vi.mock('../../src/components/AddAgentModal.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/SetupModal.jsx', () => ({ default: () => null }));
vi.mock('../../src/services/model-display.js', () => ({
  getModelDisplayName: (slug: string) => slug,
  preloadModelDisplayNames: () => {},
}));

import GlobalOverview from '../../src/pages/GlobalOverview';
import Overview from '../../src/pages/Overview';
import { createFormatLegendTimestamp, formatLegendTokens } from '../../src/services/chart-utils';
import { formatRate } from '../../src/services/overview-format';

describe('Overview in pt-BR', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetLocaleForTests('pt-BR');
  });

  it('renders the global overview in Portuguese', async () => {
    render(() => <GlobalOverview />);
    expect(await screen.findByText('Visão geral')).toBeDefined();
    expect(screen.getByText('Todos os seus harnesses e provedores')).toBeDefined();
    await waitFor(() => expect(screen.getByText('Requisições recentes')).toBeDefined());
    expect(screen.getByText('Conexões de provedor')).toBeDefined();
    expect(screen.getByText('Nome da conexão')).toBeDefined();
    expect(screen.getByText('Inativa')).toBeDefined();
    expect(screen.getByText('Padrão')).toBeDefined();
    expect(screen.getByText('Taxa de sucesso', { selector: '.overview-stat-card__label' })).toBeDefined();
    expect(screen.getByText('Recuperadas por fallback')).toBeDefined();
    expect(screen.getByText('Últimos 7 dias')).toBeDefined();
    // Intl percent in pt-BR: decimal comma.
    expect(screen.getByText('95,5%')).toBeDefined();
  });

  it('renders the harness overview in Portuguese', async () => {
    render(() => <Overview />);
    await waitFor(() => expect(screen.getByText('Uso por modelo')).toBeDefined());
    expect(screen.getByText('Os modelos usados e quanto custaram')).toBeDefined();
    expect(screen.getByText('% do total')).toBeDefined();
    expect(screen.getAllByText('Uso de tokens').length).toBeGreaterThan(0);
    expect(screen.getAllByText('US$ 3,50').length).toBeGreaterThan(0);
    expect(document.title || document.querySelector('title')?.textContent).toContain(
      'Visão geral de demo-agent',
    );
  });

  it('formats chart labels and rates with the pt-BR locale', () => {
    const fmt = createFormatLegendTimestamp('7d');
    const epoch = new Date(2026, 2, 5).getTime() / 1000;
    expect(fmt({} as never, epoch)).toBe('5 mar');
    expect(formatRate(0.955)).toBe('95,5%');
    expect(formatLegendTokens({} as never, 1500)).toMatch(/^1,5\smil$/);
  });
});
