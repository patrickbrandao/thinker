import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const api = vi.hoisted(() => ({ listProxyLogs: vi.fn() }));
vi.mock('../../../src/services/api/proxies.js', async (orig) => ({
  ...(await orig<object>()),
  ...api,
}));

import ProxyLogsTab from '../../../src/components/proxy/ProxyLogsTab';
import { resetLocaleForTests, t } from '../../../src/i18n';
import { proxyDetail, proxyLog } from './fixtures';

function renderTab(proxy = proxyDetail({ debug_enabled: true })) {
  return render(
    <MemoryRouter>
      <ProxyLogsTab proxy={proxy} />
    </MemoryRouter>,
  );
}

const lastCall = () => api.listProxyLogs.mock.calls.at(-1)!;
const rowOf = (text: string) => screen.getByText(text).closest('tr')!;

describe('ProxyLogsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listProxyLogs.mockResolvedValue({ logs: [proxyLog()], next_before: null });
  });

  it('loads the last 7 days of the proxy, 50 per page, without filters', async () => {
    renderTab();
    await screen.findByText('api.openai.com:443');
    expect(api.listProxyLogs).toHaveBeenCalledTimes(1);
    const [id, filters] = lastCall();
    expect(id).toBe('p1');
    expect(filters.limit).toBe(50);
    expect(filters.result).toBeUndefined();
    expect(filters.source_type).toBeUndefined();
    const ageMs = Date.now() - Date.parse(filters.from);
    expect(Math.abs(ageMs - 7 * 86_400_000)).toBeLessThan(10_000);
  });

  it('renders one row per connection with result, status, tunnel, duration and bytes', async () => {
    api.listProxyLogs.mockResolvedValue({
      logs: [
        proxyLog(),
        proxyLog({
          id: 'l2',
          result: 'auth_407',
          status_code: 407,
          tunnel_ms: null,
          duration_ms: 2500,
          destination: 'api.anthropic.com:443',
          source_type: 'trigger',
          source_label: null,
          error: 'proxy asked for credentials',
          bytes_sent: 0,
          bytes_received: 0,
        }),
      ],
      next_before: null,
    });
    renderTab();
    const ok = (await screen.findByText('api.openai.com:443')).closest('tr')!;
    expect(within(ok).getByText('Provider')).toBeTruthy();
    expect(within(ok).getByText('OpenAI')).toBeTruthy();
    expect(within(ok).getByText('OK')).toBeTruthy();
    expect(within(ok).getByText('200')).toBeTruthy();
    expect(within(ok).getByText('35 ms')).toBeTruthy();
    expect(within(ok).getByText('420ms')).toBeTruthy();
    expect(within(ok).getByText('1.0 KB / 2.0 MB')).toBeTruthy();

    const bad = rowOf('api.anthropic.com:443');
    expect(within(bad).getByText('Auth required (407)')).toBeTruthy();
    expect(within(bad).getByText('407')).toBeTruthy();
    expect(within(bad).getByText('—')).toBeTruthy();
    expect(within(bad).getByText('2.5s')).toBeTruthy();
    expect(within(bad).getByText('0 B / 0 B')).toBeTruthy();
    expect(within(bad).getByText('proxy asked for credentials').getAttribute('title')).toBe(
      'proxy asked for credentials',
    );
  });

  it('links the time to the request when the log has one (request id, else agent message id)', async () => {
    api.listProxyLogs.mockResolvedValue({
      logs: [
        proxyLog({ id: 'a', destination: 'a.example:443', request_id: 'req 1' }),
        proxyLog({ id: 'b', destination: 'b.example:443', agent_message_id: 'msg-9' }),
        proxyLog({ id: 'c', destination: 'c.example:443' }),
      ],
      next_before: null,
    });
    renderTab();
    await screen.findByText('a.example:443');
    expect(within(rowOf('a.example:443')).getByRole('link').getAttribute('href')).toBe('/requests/req%201');
    expect(within(rowOf('b.example:443')).getByRole('link').getAttribute('href')).toBe('/requests/msg-9');
    expect(within(rowOf('c.example:443')).queryByRole('link')).toBeNull();
  });

  it('tells the user only failures are logged while debug is off', async () => {
    const { unmount } = renderTab(proxyDetail({ debug_enabled: false }));
    expect(await screen.findByText('Debug is off: only failed connections are logged.')).toBeTruthy();
    unmount();
    renderTab(proxyDetail({ debug_enabled: true }));
    await screen.findByText('api.openai.com:443');
    expect(screen.queryByText('Debug is off: only failed connections are logged.')).toBeNull();
  });

  it('refetches with the chosen result, source and period', async () => {
    renderTab();
    await screen.findByText('api.openai.com:443');
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'failure' } });
    await waitFor(() => expect(lastCall()[1].result).toBe('failure'));
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'timeout' } });
    await waitFor(() => expect(lastCall()[1].result).toBe('timeout'));
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'trigger' } });
    await waitFor(() => expect(lastCall()[1].source_type).toBe('trigger'));
    expect(lastCall()[1].result).toBe('timeout');
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'all' } });
    await waitFor(() => expect(lastCall()[1].from).toBeUndefined());
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '24h' } });
    await waitFor(() => {
      const age = Date.now() - Date.parse(lastCall()[1].from);
      expect(Math.abs(age - 86_400_000)).toBeLessThan(10_000);
    });
    // Back to "all results" drops the filter instead of sending an empty string.
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: '' } });
    await waitFor(() => expect(lastCall()[1].result).toBeUndefined());
  });

  it('offers every result code and source type in the filters', async () => {
    renderTab();
    await screen.findByText('api.openai.com:443');
    const results = Array.from((screen.getByLabelText('Result') as HTMLSelectElement).options).map(
      (o) => o.textContent,
    );
    expect(results.slice(0, 3)).toEqual(['All results', 'Any failure', 'OK']);
    expect(results).toContain('Auth required (407)');
    expect(results).toContain('Provider 429');
    const sources = Array.from((screen.getByLabelText('Source') as HTMLSelectElement).options).map(
      (o) => o.textContent,
    );
    expect(sources).toEqual([
      'All sources',
      'Provider',
      'Connection',
      'Trigger',
      'Notification e-mail',
      'Test',
    ]);
  });

  it('shows an empty state with no logs, and an error with retry', async () => {
    api.listProxyLogs.mockResolvedValueOnce({ logs: [], next_before: null });
    renderTab();
    expect(await screen.findByText('No logs')).toBeTruthy();
    expect(screen.getByText('No connection matches these filters.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();

    api.listProxyLogs.mockRejectedValueOnce(new Error('log store offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('log store offline')).toBeTruthy();
    expect(screen.queryByText('No logs')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('api.openai.com:443')).toBeTruthy();
  });

  it('Refresh reloads the list', async () => {
    renderTab();
    await screen.findByText('api.openai.com:443');
    api.listProxyLogs.mockResolvedValue({ logs: [proxyLog({ destination: 'fresh.example:443' })], next_before: null });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('fresh.example:443')).toBeTruthy();
    expect(screen.queryByText('api.openai.com:443')).toBeNull();
  });

  it('pages with the cursor, appends without duplicates and hides the button at the end', async () => {
    api.listProxyLogs.mockResolvedValueOnce({
      logs: [proxyLog({ id: 'l1', destination: 'one.example:443' })],
      next_before: 'cursor-1',
    });
    renderTab();
    await screen.findByText('one.example:443');
    api.listProxyLogs.mockResolvedValueOnce({
      logs: [
        proxyLog({ id: 'l1', destination: 'one.example:443' }),
        proxyLog({ id: 'l2', destination: 'two.example:443' }),
      ],
      next_before: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('two.example:443');
    expect(lastCall()[1].before).toBe('cursor-1');
    expect(screen.getAllByText('one.example:443')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('keeps the list and the button when loading more fails', async () => {
    api.listProxyLogs.mockResolvedValueOnce({
      logs: [proxyLog({ destination: 'one.example:443' })],
      next_before: 'cursor-1',
    });
    renderTab();
    await screen.findByText('one.example:443');
    api.listProxyLogs.mockRejectedValueOnce(new Error('transient'));
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(api.listProxyLogs).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Load more' }) as HTMLButtonElement).disabled).toBe(false),
    );
    expect(screen.getByText('one.example:443')).toBeTruthy();
    expect(screen.queryByText('transient')).toBeNull();
  });

  it('drops a slow response that was superseded by a newer filter', async () => {
    let releaseSlow!: (v: unknown) => void;
    api.listProxyLogs.mockResolvedValueOnce({ logs: [], next_before: null });
    renderTab();
    await screen.findByText('No logs');
    api.listProxyLogs.mockReturnValueOnce(new Promise((r) => (releaseSlow = r)));
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'timeout' } });
    api.listProxyLogs.mockResolvedValueOnce({
      logs: [proxyLog({ destination: 'newer.example:443' })],
      next_before: null,
    });
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'dns' } });
    await screen.findByText('newer.example:443');
    releaseSlow({ logs: [proxyLog({ id: 'old', destination: 'stale.example:443' })], next_before: null });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('stale.example:443')).toBeNull();
    expect(screen.getByText('newer.example:443')).toBeTruthy();
  });

  it('renders in pt-BR', async () => {
    resetLocaleForTests('pt-BR');
    renderTab(proxyDetail({ debug_enabled: false }));
    await screen.findByText('api.openai.com:443');
    expect(screen.getByText(t('proxies.logs.failuresOnly'))).toBeTruthy();
    expect(t('proxies.logs.failuresOnly')).not.toBe('Debug is off: only failed connections are logged.');
    expect(screen.getByLabelText(t('proxies.logs.period'))).toBeTruthy();
    expect(within(rowOf('api.openai.com:443')).getByText(t('proxies.results.ok'))).toBeTruthy();
    expect(screen.getByRole('button', { name: t('common.refresh') })).toBeTruthy();
  });
});
