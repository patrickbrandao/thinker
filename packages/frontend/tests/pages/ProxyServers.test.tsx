import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('../../src/services/toast-store.js', () => ({ toast: toastMock }));

const api = vi.hoisted(() => ({
  listProxies: vi.fn(),
  updateProxy: vi.fn(),
  createProxy: vi.fn(),
}));
vi.mock('../../src/services/api/proxies.js', async (orig) => ({
  ...(await orig<object>()),
  ...api,
}));

// The other two tabs have their own specs.
vi.mock('../../src/components/proxy/ProxyProfilesTab', () => ({
  default: () => <div data-testid="profiles-tab" />,
}));
vi.mock('../../src/components/proxy/ProviderDefaultsTab', () => ({
  default: () => <div data-testid="providers-tab" />,
}));
// The new-proxy window lives in the detail page module; its chart tabs aren't needed here.
vi.mock('../../src/components/proxy/ProxyLogsTab', () => ({ default: () => null }));
vi.mock('../../src/components/proxy/ProxyStatsTab', () => ({ default: () => null }));

import ProxyServers from '../../src/pages/ProxyServers';
import { setMe } from '../../src/services/session-store';
import { resetLocaleForTests, t } from '../../src/i18n';
import type { OrgRole } from '../../src/services/api/organizations';
import { proxyView } from '../components/proxy/fixtures';

const asRole = (role: OrgRole) =>
  setMe({
    userId: 'u-me',
    isInstanceAdmin: false,
    mustChangePassword: false,
    organization: { id: 'org-1', name: 'Acme', role },
  });

const renderPage = (entry = '/proxy-servers') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <ProxyServers />
    </MemoryRouter>,
  );

const alpha = proxyView({
  id: 'p1',
  name: 'Alpha',
  host: 'proxy-a.example.com',
  binding_count: 2,
  debug_enabled: true,
  stats_7d: {
    connections: 1500,
    successes: 1490,
    failures: 10,
    avg_tunnel_ms: 41.6,
    bytes_sent: 0,
    bytes_received: 0,
  },
});
const beta = proxyView({
  id: 'p2',
  name: 'Beta',
  host: '::1',
  port: 8080,
  scheme: 'https',
  status: 'failing',
  enabled: false,
});

describe('ProxyServers page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asRole('admin');
    api.listProxies.mockResolvedValue({ proxies: [alpha, beta], global: null });
    api.updateProxy.mockImplementation(async (id: string, data: object) => ({
      ...(id === 'p1' ? alpha : beta),
      ...data,
    }));
  });

  it('is admin-only: a member sees the notice and nothing is fetched', () => {
    asRole('member');
    renderPage();
    expect(
      screen.getByText('Only admins and owners can see and manage proxy servers.'),
    ).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByText('Add proxy server')).toBeNull();
    expect(api.listProxies).not.toHaveBeenCalled();
  });

  it('lists proxy servers with endpoint, status, 7-day numbers and bindings', async () => {
    renderPage();
    expect(screen.getByText('Loading...')).toBeTruthy();
    const link = await screen.findByRole('link', { name: 'Alpha' });
    expect(link.getAttribute('href')).toBe('/proxy-servers/p1');
    const row = link.closest('tr')!;
    const cells = within(row)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(cells.slice(0, 7)).toEqual([
      'AlphaDebug',
      'http://proxy-a.example.com:3128',
      'Healthy',
      '1.5k',
      '10',
      '42 ms',
      '2',
    ]);
    expect(
      within(row).getByRole('switch', { name: 'Enable Alpha' }).getAttribute('aria-checked'),
    ).toBe('true');

    const second = screen.getByRole('link', { name: 'Beta' }).closest('tr')!;
    const c2 = within(second)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    // No stats yet: zeros and a dash, IPv6 host bracketed.
    expect(c2.slice(0, 7)).toEqual(['Beta', 'https://[::1]:8080', 'Failing', '0', '0', '—', '0']);
    expect(
      within(second).getByRole('switch', { name: 'Enable Beta' }).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('adds a proxy server in a floating window without leaving the list', async () => {
    api.createProxy.mockResolvedValue({ ...alpha, id: 'p-new', name: 'Gamma' });
    renderPage();
    await screen.findByText('Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Add proxy server' }));
    const dialog = screen.getByRole('dialog', { name: t('proxies.form.createTitle') });
    expect(dialog.getAttribute('aria-modal')).toBe('false');
    // The list stays on screen behind the window.
    expect(screen.getByText('Alpha')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(t('proxies.form.name')), {
      target: { value: 'Gamma' },
    });
    fireEvent.change(within(dialog).getByLabelText(t('proxies.form.host')), {
      target: { value: 'gamma.local' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: t('proxies.form.createSubmit') }));
    await waitFor(() => expect(api.createProxy).toHaveBeenCalledTimes(1));
    expect(api.createProxy.mock.calls[0][0]).toMatchObject({ name: 'Gamma', host: 'gamma.local' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.listProxies.mock.calls.length).toBeGreaterThan(1);
  });

  it('shows the global proxy from the environment and its bypass list', async () => {
    api.listProxies.mockResolvedValue({
      proxies: [alpha],
      global: { url: 'http://corp-proxy:3128', no_proxy: ['localhost', '10.0.0.0/8'] },
    });
    renderPage();
    await screen.findByText('Alpha');
    expect(screen.getByText('http://corp-proxy:3128')).toBeTruthy();
    expect(screen.getByText('localhost, 10.0.0.0/8')).toBeTruthy();
  });

  it('shows an empty state when no proxy server exists', async () => {
    api.listProxies.mockResolvedValue({ proxies: [], global: null });
    renderPage();
    expect(await screen.findByText('No proxy servers yet')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the error and retries', async () => {
    api.listProxies.mockRejectedValueOnce(new Error('cannot reach backend'));
    renderPage();
    expect(await screen.findByText('cannot reach backend')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Alpha')).toBeTruthy();
  });

  it('toggles a proxy with a PATCH and updates the row from the response', async () => {
    renderPage();
    const sw = await screen.findByRole('switch', { name: 'Enable Alpha' });
    fireEvent.click(sw);
    await waitFor(() => expect(api.updateProxy).toHaveBeenCalledWith('p1', { enabled: false }));
    expect(toastMock.success).toHaveBeenCalledWith('Proxy server disabled');
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: 'Enable Alpha' }).getAttribute('aria-checked'),
      ).toBe('false'),
    );
    // The other row is untouched.
    expect(api.updateProxy).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('switch', { name: 'Enable Beta' }));
    await waitFor(() => expect(api.updateProxy).toHaveBeenCalledWith('p2', { enabled: true }));
    expect(toastMock.success).toHaveBeenCalledWith('Proxy server enabled');
  });

  it('disables the switch while saving and keeps the old value when it fails', async () => {
    let reject!: (e: Error) => void;
    api.updateProxy.mockReturnValue(new Promise((_, r) => (reject = r)));
    renderPage();
    const sw = await screen.findByRole('switch', { name: 'Enable Alpha' });
    fireEvent.click(sw);
    await waitFor(() => expect((sw as HTMLButtonElement).disabled).toBe(true));
    reject(new Error('denied'));
    await waitFor(() => expect((sw as HTMLButtonElement).disabled).toBe(false));
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('switches between the three tabs by URL and marks the active one', async () => {
    const { unmount } = renderPage('/proxy-servers?tab=profiles');
    expect(await screen.findByTestId('profiles-tab')).toBeTruthy();
    expect(
      screen.getByRole('tab', { name: 'Outbound profiles' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(screen.getByRole('tab', { name: 'Outbound profiles' }).getAttribute('href')).toBe(
      '/proxy-servers?tab=profiles',
    );
    expect(screen.getByRole('tab', { name: 'Provider defaults' }).getAttribute('href')).toBe(
      '/proxy-servers?tab=providers',
    );
    expect(screen.getByRole('tab', { name: 'Proxy servers' }).getAttribute('href')).toBe(
      '/proxy-servers',
    );
    expect(api.listProxies).not.toHaveBeenCalled();
    unmount();

    const providers = renderPage('/proxy-servers?tab=providers');
    expect(await screen.findByTestId('providers-tab')).toBeTruthy();
    expect(
      screen.getByRole('tab', { name: 'Provider defaults' }).getAttribute('aria-selected'),
    ).toBe('true');
    providers.unmount();

    renderPage('/proxy-servers?tab=nonsense');
    expect(await screen.findByText('Alpha')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Proxy servers' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('renders in pt-BR', async () => {
    resetLocaleForTests('pt-BR');
    renderPage();
    await screen.findByText('Alpha');
    expect(screen.getByRole('tab', { name: t('proxies.tabs.profiles') })).toBeTruthy();
    expect(t('proxies.tabs.profiles')).not.toBe('Outbound profiles');
    expect(screen.getByRole('button', { name: t('proxies.create') })).toBeTruthy();
    expect(
      screen.getByRole('switch', { name: t('proxies.list.toggle', { name: 'Alpha' }) }),
    ).toBeTruthy();
    expect(screen.getByText(t('proxies.status.ok'))).toBeTruthy();
    expect(screen.queryByText('Healthy')).toBeNull();
  });

  it('shows the admin notice in pt-BR for a viewer', () => {
    resetLocaleForTests('pt-BR');
    asRole('viewer');
    renderPage();
    expect(screen.getByText(t('proxies.adminOnly'))).toBeTruthy();
  });
});
