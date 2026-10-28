import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

function renderOverview() {
  return render(
    <MemoryRouter initialEntries={['/harnesses/test-agent']}>
      <Routes>
        <Route path="/harnesses/:agentName" element={<Overview />} />
      </Routes>
    </MemoryRouter>,
  );
}

const mockGetOverview = vi.fn();
const mockGetOverviewDetails = vi.fn();
vi.mock('../../src/services/api.js', () => ({
  getOverview: (...args: unknown[]) => mockGetOverview(...args),
  getOverviewDetails: (...args: unknown[]) => mockGetOverviewDetails(...args),
  getCustomProviders: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/services/toast-store.js', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
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

// MessageTable belongs to the Requests area and has its own suite: stub it and
// assert the rows the page hands it.
const messageTableProps = vi.hoisted(() => ({ last: null as any }));
vi.mock('../../src/components/MessageTable.jsx', () => ({
  default: (props: any) => {
    messageTableProps.last = props;
    return <div data-testid="message-table" />;
  },
}));

vi.mock('../../src/services/formatters.js', () => ({
  formatCost: (v: number) => `$${v.toFixed(2)}`,
  formatNumber: (v: number) => String(v),
  formatStatus: (s: string) => s,
  formatErrorOrigin: (o: string | null | undefined) => o ?? null,
  formatTime: (t: string) => t,
}));

vi.mock('../../src/services/routing-utils.js', () => ({
  inferProviderFromModel: () => null,
  inferProviderName: () => '',
  stripCustomPrefix: (m: string) => m,
}));

vi.mock('../../src/components/ProviderIcon.jsx', () => ({
  providerIcon: () => null,
  customProviderLogo: () => null,
}));

// The per-agent Overview now renders ProviderChartCard → MultiAgentTokenChart
// (uPlot) and fetches per-provider timeseries; stub both so jsdom doesn't load
// the real chart (which calls matchMedia).
vi.mock('../../src/services/api/analytics.js', () => ({
  RECOVERED_REQUESTS_TOOLTIP: 'Successful requests that were recovered by fallback.',
  REQUEST_SUCCESS_RATE_TOOLTIP:
    'Successful requests over all requests. Recovered requests count as successful.',
  TOTAL_ATTEMPTS_TOOLTIP:
    'Every provider call counts here, including fallback retries. One request can produce several attempts.',
  MODEL_SUCCESS_RATE_TOOLTIP: 'Successful attempts over all attempts for this model.',
  PROVIDER_SUCCESS_RATE_TOOLTIP: 'Successful attempts over all attempts for this provider.',
  CONNECTION_SUCCESS_RATE_TOOLTIP_30D:
    'Successful attempts over all attempts for this connection, over the last 30 days.',
  CONNECTION_SUCCESS_RATE_TOOLTIP:
    'Successful attempts over all attempts for this connection, on the filtered period.',
  CONNECTION_HARNESS_SUCCESS_RATE_TOOLTIP:
    'Successful attempts over all attempts for this harness on this connection.',
  HARNESS_SUCCESS_RATE_TOOLTIP: 'Successful requests over all requests for this harness.',
  HARNESS_TOTAL_REQUESTS_TOOLTIP:
    'Logical requests from this harness, one per call, whatever the number of attempts.',
  attemptSuccessRate: (row: { attempts: number; succeeded?: number }) =>
    !row.attempts || row.succeeded == null ? null : row.succeeded / row.attempts,
  getPerProviderTimeseries: () => Promise.resolve({ agents: [], timeseries: [] }),
  getPerProviderMessageTimeseries: () => Promise.resolve({ agents: [], timeseries: [] }),
  getPerProviderCostTimeseries: () => Promise.resolve({ agents: [], timeseries: [] }),
  getAttemptStats: () =>
    Promise.resolve({
      total_attempts: { value: 0, previous: 0 },
      fallbacked_attempts: { value: 0, previous: 0 },
    }),
  getAttemptTimeseries: () => Promise.resolve({ range: '7d', by: 'metric', keys: [], buckets: [] }),
  getReliabilityStats: () => Promise.resolve(null),
  getRequestStatusTimeseries: () =>
    Promise.resolve({ range: '7d', by: 'disposition', keys: [], buckets: [] }),
  getPerProviderReliability: () => Promise.resolve([]),
  getPerModelReliability: () => Promise.resolve([]),
  getErrorBreakdown: () => Promise.resolve({ by_class: {}, by_origin: {} }),
}));

vi.mock('../../src/components/MultiAgentTokenChart.jsx', () => ({
  AGENT_COLORS: ['#111111', '#222222'],
  default: () => <div data-testid="multi-agent-chart" />,
}));
vi.mock('../../src/components/SetupModal.jsx', () => ({
  default: (props: any) => (
    <div data-testid="setup-modal" data-open={props.open ? 'true' : 'false'} />
  ),
}));
vi.mock('../../src/components/InfoTooltip.jsx', () => ({
  default: () => <span data-testid="info-tooltip" />,
}));
vi.mock('../../src/components/Select.jsx', () => ({
  default: (props: any) => (
    <select
      data-testid="select"
      value={props.value}
      onChange={(e: any) => props.onChange(e.target.value)}
    >
      {props.options?.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('../../src/services/recent-agents.js', () => ({
  isRecentlyCreated: () => false,
  isSetupPending: () => false,
  clearSetupPending: vi.fn(),
}));

import Overview from '../../src/pages/Overview';

const overviewData = {
  summary: {
    tokens_today: { value: 50000, trend_pct: 12 },
    cost_today: { value: 3.5, trend_pct: -5 },
    messages: { value: 42, trend_pct: 8 },
    services_hit: { total: 3, healthy: 3, issues: 0 },
  },
  token_usage: [{ hour: '2026-02-18 10:00:00', input_tokens: 1000, output_tokens: 500 }],
  cost_usage: [{ hour: '2026-02-18 10:00:00', cost: 0.5 }],
  message_usage: [{ hour: '2026-02-18 10:00:00', count: 5 }],
  cost_by_model: [],
  recent_activity: [
    {
      id: 'msg-12345678',
      timestamp: '2026-02-18T10:00:00Z',
      agent_name: 'test-agent',
      model: 'gpt-4o',
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      cost: 0.01,
      status: 'ok',
    },
  ],
  has_data: true,
};

describe('Overview - trend badges and status display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('thinker_global_group', 'provider');
    mockGetOverviewDetails.mockResolvedValue({});
    messageTableProps.last = null;
  });

  it('does not render trend badge when trend_pct is 0', async () => {
    const zeroTrendData = {
      ...overviewData,
      summary: {
        ...overviewData.summary,
        tokens_today: { value: 50000, trend_pct: 0 },
        cost_today: { value: 3.5, trend_pct: 0 },
        messages: { value: 42, trend_pct: 0 },
      },
    };
    mockGetOverview.mockResolvedValue(zeroTrendData);
    const { container } = renderOverview();
    await vi.waitFor(() => {
      expect(container.textContent).toContain('$3.50');
    });
    const trendBadges = container.querySelectorAll('.trend');
    expect(trendBadges.length).toBe(0);
  });

  it('hands a provider rate_limited row to the table as a plain row', async () => {
    // Rendering it as a binary "Failed" pill (no limits-page link) is the
    // MessageTable suite's business; the page passes the row through as is.
    const rateLimitedData = {
      ...overviewData,
      recent_activity: [
        {
          id: 'msg-ratelimit1',
          timestamp: '2026-02-18T10:00:00Z',
          agent_name: 'test-agent',
          model: null,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: null,
          cost: null,
          status: 'rate_limited',
        },
      ],
    };
    mockGetOverview.mockResolvedValue(rateLimitedData);
    mockGetOverviewDetails.mockResolvedValue({
      recent_activity: rateLimitedData.recent_activity,
      cost_by_model: [],
    });
    const { container } = renderOverview();
    await vi.waitFor(() => {
      expect(messageTableProps.last?.items?.[0]).toMatchObject({
        id: 'msg-ratelimit1',
        status: 'rate_limited',
      });
    });
    expect(container.textContent).not.toContain('rate_limited');
  });

  it('hands the routing tier to the recent requests table', async () => {
    const routedData = {
      ...overviewData,
      recent_activity: [
        {
          ...overviewData.recent_activity[0],
          routing_tier: 'complex',
        },
      ],
    };
    mockGetOverview.mockResolvedValue(routedData);
    mockGetOverviewDetails.mockResolvedValue({
      recent_activity: routedData.recent_activity,
      cost_by_model: [],
    });
    renderOverview();
    await vi.waitFor(() => {
      expect(messageTableProps.last?.items?.[0]).toMatchObject({ routing_tier: 'complex' });
    });
  });

  it('renders the negative cost trend badge on the chart card', async () => {
    // ProviderChartCard renders neutral trend badges (no inverted up-bad /
    // down-good styling).
    mockGetOverview.mockResolvedValue(overviewData);
    const { container } = renderOverview();
    await vi.waitFor(() => {
      const badges = Array.from(container.querySelectorAll('.trend'));
      expect(badges.some((b) => b.textContent?.includes('-5%'))).toBe(true);
    });
  });

  it('renders the positive token trend badge on the chart card', async () => {
    mockGetOverview.mockResolvedValue(overviewData);
    const { container } = renderOverview();
    await vi.waitFor(() => {
      const badges = Array.from(container.querySelectorAll('.trend'));
      expect(badges.some((b) => b.textContent?.includes('+12%'))).toBe(true);
    });
  });

  it('prefers the details payload rows once they load', async () => {
    mockGetOverview.mockResolvedValue(overviewData);
    mockGetOverviewDetails.mockResolvedValue({
      recent_activity: [{ ...overviewData.recent_activity[0], id: 'msg-from-details' }],
      cost_by_model: [],
    });
    renderOverview();
    await vi.waitFor(() => {
      expect(messageTableProps.last?.items?.[0]?.id).toBe('msg-from-details');
      expect(messageTableProps.last?.items?.[0]?.status).toBe('ok');
    });
  });
});
