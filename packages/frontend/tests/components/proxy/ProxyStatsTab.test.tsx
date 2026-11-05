import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const api = vi.hoisted(() => ({ getProxyStats: vi.fn() }));
vi.mock('../../../src/services/api/proxies.js', async (orig) => ({
  ...(await orig<object>()),
  ...api,
}));

// uPlot needs a real canvas; the chart is covered elsewhere.
vi.mock('../../../src/components/ReliabilityChart', () => ({
  default: ({ timeseries }: { timeseries: unknown }) => (
    <div data-testid="chart">{JSON.stringify(timeseries)}</div>
  ),
}));

import ProxyStatsTab from '../../../src/components/proxy/ProxyStatsTab';
import { resetLocaleForTests, t } from '../../../src/i18n';
import { proxyStats } from './fixtures';

const tile = (label: string) => {
  const el = Array.from(document.querySelectorAll('.stat-tile')).find(
    (n) => n.querySelector('.stat-label')?.textContent === label,
  );
  if (!el) throw new Error(`no tile ${label}`);
  return el.querySelector('.stat-value')!.textContent;
};

describe('ProxyStatsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getProxyStats.mockResolvedValue(proxyStats());
  });

  it('asks for 30 days of the proxy and shows a skeleton until it arrives', async () => {
    render(<ProxyStatsTab proxyId="p1" />);
    expect(screen.queryByTestId('chart')).toBeNull();
    expect(document.querySelector('.stat-tile')).toBeNull();
    await screen.findByTestId('chart');
    expect(api.getProxyStats).toHaveBeenCalledWith('p1', 30);
  });

  it('totals the daily rows into tiles, weighting the average tunnel by successes', async () => {
    render(<ProxyStatsTab proxyId="p1" />);
    await screen.findByTestId('chart');
    expect(tile('Connections')).toBe('15');
    expect(tile('Successes')).toBe('13');
    expect(tile('Failures')).toBe('2');
    // (40 * 8 + 20 * 5) / 13 = 32.3
    expect(tile('Avg tunnel')).toBe('32 ms');
    expect(tile('Max tunnel')).toBe('90 ms');
    expect(tile('Sent / received')).toBe('3.0 KB / 5.0 KB');
    expect(tile('Used as fallback')).toBe('1');
  });

  it('shows dashes for tunnel timings when there were no successes', async () => {
    api.getProxyStats.mockResolvedValue(
      proxyStats({
        daily: [
          { day: '2026-10-01', connections: 2, successes: 0, failures: 2, avg_tunnel_ms: null, max_tunnel_ms: null, bytes_sent: 0, bytes_received: 0, fallback_uses: 0 },
        ],
      }),
    );
    render(<ProxyStatsTab proxyId="p1" />);
    await screen.findByTestId('chart');
    expect(tile('Avg tunnel')).toBe('—');
    expect(tile('Max tunnel')).toBe('—');
  });

  it('feeds the chart one success/error bucket per day', async () => {
    render(<ProxyStatsTab proxyId="p1" />);
    const chart = JSON.parse((await screen.findByTestId('chart')).textContent!);
    expect(chart.keys).toEqual(['success', 'error']);
    expect(chart.buckets).toEqual([
      { bucket: '2026-10-01', counts: [8, 2] },
      { bucket: '2026-10-02', counts: [5, 0] },
    ]);
    expect(chart.range).toBe('30d');
  });

  it('switches the period with the radio group and refetches', async () => {
    render(<ProxyStatsTab proxyId="p1" />);
    await screen.findByTestId('chart');
    const group = screen.getByRole('radiogroup', { name: 'Period' });
    expect(within(group).getByRole('radio', { name: '30 days' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(group).getByRole('radio', { name: '7 days' }));
    await waitFor(() => expect(api.getProxyStats).toHaveBeenLastCalledWith('p1', 7));
    expect(within(group).getByRole('radio', { name: '7 days' }).getAttribute('aria-checked')).toBe('true');
    expect(within(group).getByRole('radio', { name: '30 days' }).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(within(group).getByRole('radio', { name: '90 days' }));
    await waitFor(() => expect(api.getProxyStats).toHaveBeenLastCalledWith('p1', 90));
  });

  it('lists failures by code, most frequent first, with readable labels', async () => {
    render(<ProxyStatsTab proxyId="p1" />);
    await screen.findByTestId('chart');
    const panel = screen.getByRole('heading', { name: 'Failures by code' }).closest('section')!;
    const rows = within(panel).getAllByRole('row').map((r) => r.textContent);
    expect(rows).toEqual(['Auth required (407)3', 'Timeout1']);
  });

  it('breaks traffic down by source, falling back to the id and then a dash for the label', async () => {
    api.getProxyStats.mockResolvedValue(
      proxyStats({
        by_source: [
          { source_type: 'provider', source_id: 'api_key:openai', label: 'OpenAI', connections: 12, successes: 10, failures: 2, bytes_sent: 1024, bytes_received: 2048, fallback_uses: 1 },
          { source_type: 'connection', source_id: 'c-9', label: null, connections: 3, successes: 3, failures: 0, bytes_sent: 0, bytes_received: 0, fallback_uses: 0 },
          { source_type: 'trigger', source_id: null, label: null, connections: 1, successes: 1, failures: 0, bytes_sent: 0, bytes_received: 0, fallback_uses: 0 },
        ],
      }),
    );
    render(<ProxyStatsTab proxyId="p1" />);
    await screen.findByTestId('chart');
    const panel = screen.getByRole('heading', { name: 'By source' }).closest('section')!;
    const cells = (row: HTMLElement) =>
      within(row).getAllByRole('cell').map((c) => c.textContent);
    const body = within(panel).getAllByRole('row').slice(1);
    expect(cells(body[0]!)).toEqual(['ProviderOpenAI', '12', '2', '1', '1.0 KB / 2.0 KB']);
    expect(cells(body[1]!)).toEqual(['Connectionc-9', '3', '0', '0', '0 B / 0 B']);
    expect(cells(body[2]!)).toEqual(['Trigger—', '1', '0', '0', '0 B / 0 B']);
  });

  it('shows the empty messages when the period had no traffic', async () => {
    api.getProxyStats.mockResolvedValue(proxyStats({ daily: [], by_source: [], failures_by_code: {} }));
    render(<ProxyStatsTab proxyId="p1" />);
    expect(await screen.findByText('No failures in this period.')).toBeTruthy();
    expect(screen.queryByTestId('chart')).toBeNull();
    expect(screen.getAllByText('No connections in this period.')).toHaveLength(2);
    expect(tile('Connections')).toBe('0');
    expect(tile('Sent / received')).toBe('0 B / 0 B');
  });

  it('shows the error with retry', async () => {
    api.getProxyStats.mockRejectedValueOnce(new Error('stats unavailable'));
    render(<ProxyStatsTab proxyId="p1" />);
    expect(await screen.findByText('stats unavailable')).toBeTruthy();
    expect(document.querySelector('.stat-tile')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('chart')).toBeTruthy();
    expect(api.getProxyStats).toHaveBeenCalledTimes(2);
  });

  it('refetches when the proxy changes', async () => {
    const { rerender } = render(<ProxyStatsTab proxyId="p1" />);
    await screen.findByTestId('chart');
    rerender(<ProxyStatsTab proxyId="p2" />);
    await waitFor(() => expect(api.getProxyStats).toHaveBeenLastCalledWith('p2', 30));
  });

  it('renders in pt-BR', async () => {
    resetLocaleForTests('pt-BR');
    render(<ProxyStatsTab proxyId="p1" />);
    await screen.findByTestId('chart');
    expect(tile(t('proxies.stats.connections'))).toBeTruthy();
    expect(t('proxies.stats.connections')).not.toBe('Connections');
    expect(screen.getByRole('radiogroup', { name: t('proxies.stats.period') })).toBeTruthy();
    expect(screen.getByRole('heading', { name: t('proxies.stats.failuresByCode') })).toBeTruthy();
    expect(screen.getByText(t('proxies.results.auth_407'))).toBeTruthy();
  });
});
