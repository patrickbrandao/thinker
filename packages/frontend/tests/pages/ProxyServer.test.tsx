import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('../../src/services/toast-store.js', () => ({ toast: toastMock }));

const api = vi.hoisted(() => ({
  createProxy: vi.fn(),
  deleteProxy: vi.fn(),
  getProxy: vi.fn(),
  listProxies: vi.fn(),
  testProxy: vi.fn(),
  updateProxy: vi.fn(),
}));
vi.mock('../../src/services/api/proxies.js', async (orig) => ({
  ...(await orig<object>()),
  ...api,
}));

// Logs and Stats have their own specs.
vi.mock('../../src/components/proxy/ProxyLogsTab', () => ({
  default: ({ proxy }: { proxy: { id: string } }) => <div data-testid="logs-tab">{proxy.id}</div>,
}));
vi.mock('../../src/components/proxy/ProxyStatsTab', () => ({
  default: ({ proxyId }: { proxyId: string }) => <div data-testid="stats-tab">{proxyId}</div>,
}));

import ProxyServer from '../../src/pages/ProxyServer';
import { ApiError } from '../../src/services/api/core';
import { setMe } from '../../src/services/session-store';
import { resetLocaleForTests, t } from '../../src/i18n';
import type { OrgRole } from '../../src/services/api/organizations';
import { proxyDetail, proxyView } from '../components/proxy/fixtures';

const asRole = (role: OrgRole) =>
  setMe({
    userId: 'u-me',
    isInstanceAdmin: false,
    mustChangePassword: false,
    organization: { id: 'org-1', name: 'Acme', role },
  });

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function renderPage(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/proxy-servers" element={<div data-testid="list-page" />} />
        <Route path="/proxy-servers/:proxyId" element={<ProxyServer />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const existing = (over = {}) =>
  proxyDetail({ id: 'p1', name: 'Alpha', host: 'proxy-a.example.com', port: 3128, ...over });

const nameInput = () => screen.getByLabelText('Name') as HTMLInputElement;
const submitNew = () => screen.getByRole('button', { name: 'Add proxy server' });
const saveChanges = () => screen.getByRole('button', { name: 'Save changes' });

async function openExisting(over = {}, tab = '') {
  api.getProxy.mockResolvedValue(existing(over));
  renderPage(`/proxy-servers/p1${tab}`);
  await screen.findByRole('heading', { name: 'Alpha' });
}

describe('ProxyServer page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asRole('admin');
    api.getProxy.mockResolvedValue(existing());
    api.listProxies.mockResolvedValue({ proxies: [proxyView({ id: 'p1', name: 'Alpha' }), proxyView({ id: 'p2', name: 'Beta' })], global: null });
    api.createProxy.mockImplementation(async (d: object) => existing({ id: 'new-id', ...d }));
    api.updateProxy.mockImplementation(async (_id: string, d: object) => existing(d));
    api.deleteProxy.mockResolvedValue({ deleted: true, affected: 0 });
    api.testProxy.mockResolvedValue({ ok: true, result: 'ok', status: 200, tunnel_ms: 12, total_ms: 80, error: null });
  });

  describe('access and loading', () => {
    it('is admin-only: a member gets the notice and no proxy is fetched', () => {
      asRole('member');
      renderPage('/proxy-servers/p1');
      expect(screen.getByText('Only admins and owners can see and manage proxy servers.')).toBeTruthy();
      expect(screen.getByRole('link', { name: '← Proxy configuration' }).getAttribute('href')).toBe('/proxy-servers');
      expect(api.getProxy).not.toHaveBeenCalled();
      expect(screen.queryByLabelText('Name')).toBeNull();
    });

    it('shows a skeleton while the proxy loads, then its header', async () => {
      api.getProxy.mockReturnValue(new Promise(() => {}));
      const { container } = renderPage('/proxy-servers/p1');
      expect(container.querySelector('.skel')).toBeTruthy();
      expect(screen.queryByLabelText('Name')).toBeNull();
    });

    it('shows the error with a retry link back', async () => {
      api.getProxy.mockRejectedValueOnce(new Error('proxy not found'));
      renderPage('/proxy-servers/p1');
      expect(await screen.findByText('proxy not found')).toBeTruthy();
      expect(screen.getByRole('link', { name: '← Proxy configuration' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('heading', { name: 'Alpha' })).toBeTruthy();
    });

    it('shows name, status, endpoint and the debug badge in the header', async () => {
      await openExisting({ status: 'degraded', debug_enabled: true, debug_until: null });
      expect(screen.getByText('Degraded')).toBeTruthy();
      expect(screen.getByText('http://proxy-a.example.com:3128')).toBeTruthy();
      expect(screen.getByText('Debug')).toBeTruthy();
    });
  });

  describe('creating a proxy', () => {
    it('opens a blank form with defaults and without the existing-proxy panels or tabs', () => {
      renderPage('/proxy-servers/new');
      expect(screen.getByRole('heading', { name: 'New proxy server' })).toBeTruthy();
      expect(api.getProxy).not.toHaveBeenCalled();
      expect(screen.queryByRole('tablist')).toBeNull();
      expect(nameInput().value).toBe('');
      expect((screen.getByLabelText('Scheme') as HTMLSelectElement).value).toBe('http');
      expect((screen.getByLabelText('Port') as HTMLInputElement).value).toBe('3128');
      expect((screen.getByLabelText(/Connect timeout/) as HTMLInputElement).value).toBe('10000');
      expect(screen.getByRole('switch', { name: 'Enabled' }).getAttribute('aria-checked')).toBe('true');
      expect(screen.getByRole('radio', { name: 'No authentication' }).getAttribute('aria-checked')).toBe('true');
      expect(screen.queryByLabelText('Username')).toBeNull();
      expect(screen.queryByText('Test')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Delete proxy server' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    });

    it('validates before calling the API and shows each message next to its field', async () => {
      const user = userEvent.setup();
      renderPage('/proxy-servers/new');
      fireEvent.click(submitNew());
      expect(screen.getByText('Enter a name.')).toBeTruthy();
      expect(screen.getByText('Enter the proxy host.')).toBeTruthy();
      expect(api.createProxy).not.toHaveBeenCalled();

      await user.type(nameInput(), 'Edge');
      await user.type(screen.getByLabelText('Host'), 'proxy.corp');
      fireEvent.change(screen.getByLabelText('Port'), { target: { value: '70000' } });
      fireEvent.change(screen.getByLabelText(/Connect timeout/), { target: { value: '0' } });
      fireEvent.click(submitNew());
      expect(screen.queryByText('Enter a name.')).toBeNull();
      expect(screen.getByText('Enter a port between 1 and 65535.')).toBeTruthy();
      expect(screen.getByText('Enter a positive number of milliseconds.')).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Port'), { target: { value: '1.5' } });
      fireEvent.click(submitNew());
      expect(screen.getByText('Enter a port between 1 and 65535.')).toBeTruthy();
      expect(api.createProxy).not.toHaveBeenCalled();
    });

    it('requires a username and a password when authentication is on', async () => {
      const user = userEvent.setup();
      renderPage('/proxy-servers/new');
      await user.type(nameInput(), 'Edge');
      await user.type(screen.getByLabelText('Host'), 'proxy.corp');
      fireEvent.click(screen.getByRole('radio', { name: 'Username and password' }));
      fireEvent.click(submitNew());
      expect(screen.getByText('Enter the username.')).toBeTruthy();
      expect(screen.getByText('Enter the password.')).toBeTruthy();
      expect(api.createProxy).not.toHaveBeenCalled();
    });

    it('masks the password field and does not autofill it', async () => {
      renderPage('/proxy-servers/new');
      fireEvent.click(screen.getByRole('radio', { name: 'Username and password' }));
      const pw = screen.getByLabelText('Password') as HTMLInputElement;
      expect(pw.type).toBe('password');
      expect(pw.autocomplete).toBe('new-password');
      expect(pw.value).toBe('');
    });

    it('creates a proxy with the trimmed values and goes to its page', async () => {
      const user = userEvent.setup();
      renderPage('/proxy-servers/new');
      await user.type(nameInput(), '  Edge  ');
      await user.type(screen.getByLabelText('Host'), '  proxy.corp  ');
      await user.selectOptions(screen.getByLabelText('Scheme'), 'https');
      fireEvent.change(screen.getByLabelText('Port'), { target: { value: '8443' } });
      fireEvent.click(submitNew());
      await waitFor(() => expect(api.createProxy).toHaveBeenCalledTimes(1));
      expect(api.createProxy).toHaveBeenCalledWith({
        name: 'Edge',
        scheme: 'https',
        host: 'proxy.corp',
        port: 8443,
        enabled: true,
        connect_timeout_ms: 10000,
        log_retention_days: null,
        auth: 'none',
        debug: 'off',
      });
      expect(toastMock.success).toHaveBeenCalledWith('Proxy server added');
      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/proxy-servers/new-id'));
    });

    it('sends credentials only when authentication is on, and the password is not shown again', async () => {
      const user = userEvent.setup();
      renderPage('/proxy-servers/new');
      await user.type(nameInput(), 'Edge');
      await user.type(screen.getByLabelText('Host'), 'proxy.corp');
      fireEvent.click(screen.getByRole('radio', { name: 'Username and password' }));
      await user.type(screen.getByLabelText('Username'), '  svc  ');
      await user.type(screen.getByLabelText('Password'), 's3cr3t-pw');
      fireEvent.click(submitNew());
      await waitFor(() => expect(api.createProxy).toHaveBeenCalled());
      const body = api.createProxy.mock.calls[0][0];
      expect(body.username).toBe('svc');
      expect(body.password).toBe('s3cr3t-pw');
      expect(body.auth).toBeUndefined();
      // The password never lands in the page text or in the URL after the redirect.
      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/proxy-servers/new-id'));
      expect(document.body.textContent).not.toContain('s3cr3t-pw');
    });

    it('sends the debug window and a custom retention', async () => {
      const user = userEvent.setup();
      renderPage('/proxy-servers/new');
      await user.type(nameInput(), 'Edge');
      await user.type(screen.getByLabelText('Host'), 'proxy.corp');
      fireEvent.click(screen.getByRole('switch', { name: 'Debug logging' }));
      expect((screen.getByLabelText('Debug duration') as HTMLSelectElement).value).toBe('24h');
      await user.selectOptions(screen.getByLabelText('Debug duration'), '7d');
      fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
      fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }));
      fireEvent.click(submitNew());
      await waitFor(() => expect(api.createProxy).toHaveBeenCalled());
      expect(api.createProxy.mock.calls[0][0]).toMatchObject({
        debug: '7d',
        log_retention_days: 30,
        enabled: false,
      });
    });

    it('stays on the form when the server refuses it', async () => {
      api.createProxy.mockRejectedValue(new ApiError('Host not allowed', 400));
      const user = userEvent.setup();
      renderPage('/proxy-servers/new');
      await user.type(nameInput(), 'Edge');
      await user.type(screen.getByLabelText('Host'), 'proxy.corp');
      fireEvent.click(submitNew());
      await waitFor(() => expect(api.createProxy).toHaveBeenCalled());
      await waitFor(() => expect((submitNew() as HTMLButtonElement).disabled).toBe(false));
      expect(screen.getByTestId('where').textContent).toBe('/proxy-servers/new');
      expect(toastMock.success).not.toHaveBeenCalled();
      expect(nameInput().value).toBe('Edge');
    });
  });

  describe('editing a proxy', () => {
    it('prefills the form, leaves the password blank and offers to keep it', async () => {
      await openExisting({ username: 'svc', has_password: true, connect_timeout_ms: 5000, port: 8080, scheme: 'https' });
      expect(nameInput().value).toBe('Alpha');
      expect((screen.getByLabelText('Host') as HTMLInputElement).value).toBe('proxy-a.example.com');
      expect((screen.getByLabelText('Port') as HTMLInputElement).value).toBe('8080');
      expect((screen.getByLabelText('Scheme') as HTMLSelectElement).value).toBe('https');
      expect((screen.getByLabelText(/Connect timeout/) as HTMLInputElement).value).toBe('5000');
      expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('svc');
      const pw = screen.getByLabelText('Password') as HTMLInputElement;
      expect(pw.value).toBe('');
      expect(pw.type).toBe('password');
      expect(screen.getByText('Leave blank to keep the current password.')).toBeTruthy();
      expect(document.body.innerHTML).not.toMatch(/value="[^"]*secret/i);
    });

    it('saves only through PATCH and does not touch auth or debug when they did not change', async () => {
      const user = userEvent.setup();
      await openExisting();
      await user.clear(nameInput());
      await user.type(nameInput(), 'Alpha 2');
      fireEvent.click(saveChanges());
      await waitFor(() => expect(api.updateProxy).toHaveBeenCalledTimes(1));
      expect(api.updateProxy).toHaveBeenCalledWith('p1', {
        name: 'Alpha 2',
        scheme: 'http',
        host: 'proxy-a.example.com',
        port: 3128,
        enabled: true,
        connect_timeout_ms: 10000,
        log_retention_days: null,
      });
      expect(api.createProxy).not.toHaveBeenCalled();
      expect(toastMock.success).toHaveBeenCalledWith('Proxy server saved');
    });

    it('keeps the stored password: saving without retyping it sends no password', async () => {
      await openExisting({ username: 'svc', has_password: true });
      fireEvent.click(saveChanges());
      await waitFor(() => expect(api.updateProxy).toHaveBeenCalled());
      const body = api.updateProxy.mock.calls[0][1];
      expect(body.username).toBe('svc');
      expect('password' in body).toBe(false);
      expect(screen.queryByText('Enter the password.')).toBeNull();
    });

    it('replaces the password only when a new one is typed', async () => {
      const user = userEvent.setup();
      await openExisting({ username: 'svc', has_password: true });
      await user.type(screen.getByLabelText('Password'), 'n3w-pw');
      fireEvent.click(saveChanges());
      await waitFor(() => expect(api.updateProxy).toHaveBeenCalled());
      expect(api.updateProxy.mock.calls[0][1].password).toBe('n3w-pw');
    });

    it('clears credentials when switching to no authentication', async () => {
      await openExisting({ username: 'svc', has_password: true });
      fireEvent.click(screen.getByRole('radio', { name: 'No authentication' }));
      expect(screen.queryByLabelText('Username')).toBeNull();
      fireEvent.click(saveChanges());
      await waitFor(() => expect(api.updateProxy).toHaveBeenCalled());
      const body = api.updateProxy.mock.calls[0][1];
      expect(body.auth).toBe('none');
      expect('username' in body).toBe(false);
      expect('password' in body).toBe(false);
    });

    it('adding authentication to an open proxy needs a username and a password', async () => {
      await openExisting();
      fireEvent.click(screen.getByRole('radio', { name: 'Username and password' }));
      fireEvent.click(saveChanges());
      expect(screen.getByText('Enter the username.')).toBeTruthy();
      expect(screen.getByText('Enter the password.')).toBeTruthy();
      expect(api.updateProxy).not.toHaveBeenCalled();
    });

    it('describes a running debug window and keeps it unless changed', async () => {
      await openExisting({ debug_enabled: true, debug_until: null });
      expect(screen.getByText('On, no time limit')).toBeTruthy();
      expect((screen.getByLabelText('Debug duration') as HTMLSelectElement).value).toBe('keep');
      fireEvent.click(saveChanges());
      await waitFor(() => expect(api.updateProxy).toHaveBeenCalled());
      expect('debug' in api.updateProxy.mock.calls[0][1]).toBe(false);
    });

    it('turning debug off sends debug=off', async () => {
      await openExisting({ debug_enabled: true, debug_until: null });
      fireEvent.click(screen.getByRole('switch', { name: 'Debug logging' }));
      expect(screen.queryByLabelText('Debug duration')).toBeNull();
      fireEvent.click(saveChanges());
      await waitFor(() => expect(api.updateProxy).toHaveBeenCalled());
      expect(api.updateProxy.mock.calls[0][1].debug).toBe('off');
    });

    it('shows the time left of a timed debug window, or Expired', async () => {
      const soon = new Date(Date.now() + 3 * 3_600_000 + 5 * 60_000).toISOString();
      await openExisting({ debug_enabled: true, debug_until: soon });
      expect(screen.getByText(/^On until .* \(3h \d+m left\)$/)).toBeTruthy();
    });

    it('shows Expired when the debug window already ended', async () => {
      await openExisting({ debug_enabled: true, debug_until: new Date(Date.now() - 60_000).toISOString() });
      expect(screen.getByText('Expired')).toBeTruthy();
    });

    it('Cancel throws away unsaved edits', async () => {
      const user = userEvent.setup();
      await openExisting();
      await user.type(nameInput(), ' changed');
      expect(nameInput().value).toBe('Alpha changed');
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(nameInput().value).toBe('Alpha');
      expect(api.updateProxy).not.toHaveBeenCalled();
    });

    it('shows the new values after a save without leaving the page', async () => {
      const user = userEvent.setup();
      await openExisting();
      await user.clear(nameInput());
      await user.type(nameInput(), 'Renamed');
      fireEvent.click(saveChanges());
      expect(await screen.findByRole('heading', { name: 'Renamed' })).toBeTruthy();
      expect(screen.getByTestId('where').textContent).toBe('/proxy-servers/p1');
    });
  });

  describe('tabs', () => {
    it('has Settings, Logs and Stats; the tab lives in the URL', async () => {
      await openExisting();
      const settings = screen.getByRole('tab', { name: 'Settings' });
      expect(settings.getAttribute('aria-selected')).toBe('true');
      expect(screen.queryByTestId('logs-tab')).toBeNull();
      fireEvent.click(screen.getByRole('tab', { name: 'Logs' }));
      expect((await screen.findByTestId('logs-tab')).textContent).toBe('p1');
      expect(screen.getByTestId('where').textContent).toBe('/proxy-servers/p1?tab=logs');
      fireEvent.click(screen.getByRole('tab', { name: 'Stats' }));
      expect((await screen.findByTestId('stats-tab')).textContent).toBe('p1');
      expect(screen.getByTestId('where').textContent).toBe('/proxy-servers/p1?tab=stats');
      fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
      expect(await screen.findByLabelText('Name')).toBeTruthy();
      expect(screen.getByTestId('where').textContent).toBe('/proxy-servers/p1');
    });

    it('opens straight on a tab from the URL, and ignores the tab for a new proxy', async () => {
      await openExisting({}, '?tab=stats');
      expect(await screen.findByTestId('stats-tab')).toBeTruthy();
    });

    it('a new proxy always shows the form', () => {
      renderPage('/proxy-servers/new?tab=logs');
      expect(screen.queryByTestId('logs-tab')).toBeNull();
      expect(screen.getByLabelText('Name')).toBeTruthy();
    });
  });

  describe('test panel', () => {
    it('prefills the suggested URL and runs the test with the trimmed URL', async () => {
      await openExisting({ suggested_test_url: 'https://api.openai.com/' });
      const url = screen.getByLabelText('Destination URL') as HTMLInputElement;
      expect(url.value).toBe('https://api.openai.com/');
      fireEvent.change(url, { target: { value: '  https://example.com/ping  ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Test proxy' }));
      await waitFor(() => expect(api.testProxy).toHaveBeenCalledWith('p1', 'https://example.com/ping'));
      expect(await screen.findByText('Reachable')).toBeTruthy();
      expect(screen.getByText('OK')).toBeTruthy();
      expect(screen.getByText('HTTP 200')).toBeTruthy();
      expect(screen.getByText('Tunnel 12 ms · total 80 ms')).toBeTruthy();
    });

    it('is disabled without a URL', async () => {
      await openExisting({ suggested_test_url: null });
      const run = screen.getByRole('button', { name: 'Test proxy' }) as HTMLButtonElement;
      expect(run.disabled).toBe(true);
      fireEvent.change(screen.getByLabelText('Destination URL'), { target: { value: '   ' } });
      expect(run.disabled).toBe(true);
      fireEvent.keyDown(screen.getByLabelText('Destination URL'), { key: 'Enter' });
      expect(api.testProxy).not.toHaveBeenCalled();
    });

    it('runs on Enter and shows a failure with its error', async () => {
      api.testProxy.mockResolvedValue({ ok: false, result: 'auth_407', status: 407, tunnel_ms: null, total_ms: 33, error: 'Proxy Authentication Required' });
      await openExisting({ suggested_test_url: 'https://api.openai.com/' });
      fireEvent.keyDown(screen.getByLabelText('Destination URL'), { key: 'Enter' });
      expect(await screen.findByText('Failed')).toBeTruthy();
      expect(screen.getByText('Auth required (407)')).toBeTruthy();
      expect(screen.getByText('HTTP 407')).toBeTruthy();
      expect(screen.getByText('Tunnel — ms · total 33 ms')).toBeTruthy();
      expect(screen.getByText('Proxy Authentication Required')).toBeTruthy();
    });

    it('shows no result when the request itself fails', async () => {
      api.testProxy.mockRejectedValue(new Error('network'));
      await openExisting({ suggested_test_url: 'https://api.openai.com/' });
      fireEvent.click(screen.getByRole('button', { name: 'Test proxy' }));
      await waitFor(() => expect(api.testProxy).toHaveBeenCalled());
      await waitFor(() => expect((screen.getByRole('button', { name: 'Test proxy' }) as HTMLButtonElement).disabled).toBe(false));
      expect(screen.queryByText('Reachable')).toBeNull();
      expect(screen.queryByText('Failed')).toBeNull();
    });
  });

  describe('bindings', () => {
    it('lists the outbound profiles that use the proxy', async () => {
      await openExisting({
        bindings: [
          { target_type: 'profile', target_id: 'pr1', label: 'Primary route', loses_proxy: false },
          { target_type: 'profile', target_id: 'pr2', label: 'Backup', loses_proxy: true },
        ],
      });
      const heading = screen.getByRole('heading', { name: 'Used by (2)' });
      const panel = heading.closest('section')!;
      expect(within(panel).getByText('Primary route')).toBeTruthy();
      expect(within(panel).getByText('Backup')).toBeTruthy();
      expect(within(panel).getAllByText('Profile')).toHaveLength(2);
    });

    it('says so when it is in no profile', async () => {
      await openExisting();
      expect(screen.getByText('Not in any outbound profile yet.')).toBeTruthy();
    });
  });

  describe('deleting', () => {
    const openDelete = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete proxy server' }));
      return screen.findByRole('dialog', { name: 'Delete Alpha' });
    };

    it('deletes an unused proxy after a confirmation and returns to the list', async () => {
      await openExisting();
      const dialog = await openDelete();
      expect(within(dialog).getByText('Delete the proxy server Alpha? This cannot be undone.')).toBeTruthy();
      expect(within(dialog).queryByRole('radio')).toBeNull();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(api.deleteProxy).toHaveBeenCalledWith('p1', {}, { silent: true }));
      expect(toastMock.success).toHaveBeenCalledWith('Proxy server deleted');
      await waitFor(() => expect(screen.getByTestId('list-page')).toBeTruthy());
    });

    it('Cancel closes the confirmation without deleting', async () => {
      await openExisting();
      const dialog = await openDelete();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(api.deleteProxy).not.toHaveBeenCalled();
    });

    const bound = [
      { target_type: 'profile' as const, target_id: 'pr1', label: 'Primary route', loses_proxy: true },
      { target_type: 'profile' as const, target_id: 'pr2', label: 'Backup', loses_proxy: false },
    ];

    it('lists what uses the proxy and warns about profiles left without a proxy', async () => {
      await openExisting({ bindings: bound });
      const dialog = await openDelete();
      expect(within(dialog).getByText(/in 2 outbound profile/)).toBeTruthy();
      expect(within(dialog).getByText('Remove from all profiles')).toBeTruthy();
      expect(within(dialog).getByText(/left without a proxy/).textContent).toContain('Primary route');
      expect(within(dialog).getByText(/left without a proxy/).textContent).not.toContain('Backup');
    });

    it('removes the proxy from every chain by default', async () => {
      api.deleteProxy.mockResolvedValue({ deleted: true, affected: 2 });
      await openExisting({ bindings: bound });
      const dialog = await openDelete();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(api.deleteProxy).toHaveBeenCalledWith('p1', { mode: 'remove' }, { silent: true }));
      expect(toastMock.success).toHaveBeenCalledWith('Proxy server deleted (2 chains updated)');
    });

    it('replaces it with another proxy: the submit waits for a choice and the proxy itself is not offered', async () => {
      await openExisting({ bindings: bound });
      const dialog = await openDelete();
      fireEvent.click(within(dialog).getByLabelText('Replace with another proxy'));
      const select = within(dialog).getByRole('combobox', { name: 'Replace with another proxy' }) as HTMLSelectElement;
      await waitFor(() => expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Pick a proxy…', 'Beta']));
      const submit = within(dialog).getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
      expect(submit.disabled).toBe(true);
      expect(within(dialog).queryByText(/left without a proxy/)).toBeNull();
      fireEvent.change(select, { target: { value: 'p2' } });
      expect(submit.disabled).toBe(false);
      fireEvent.click(submit);
      await waitFor(() =>
        expect(api.deleteProxy).toHaveBeenCalledWith('p1', { mode: 'replace', replaceWith: 'p2' }, { silent: true }),
      );
    });

    it('cannot pick replace when there is no other proxy', async () => {
      api.listProxies.mockResolvedValue({ proxies: [proxyView({ id: 'p1', name: 'Alpha' })], global: null });
      await openExisting({ bindings: bound });
      const dialog = await openDelete();
      await waitFor(() => expect((within(dialog).getByLabelText('Replace with another proxy') as HTMLInputElement).disabled).toBe(true));
    });

    it('on a 409 (bound meanwhile) it reloads the bindings and asks again instead of failing', async () => {
      api.deleteProxy.mockRejectedValueOnce(new ApiError('in use', 409));
      await openExisting();
      const dialog = await openDelete();
      api.getProxy.mockResolvedValue(existing({ bindings: bound }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
      expect(await within(dialog).findByText(/in 2 outbound profile/)).toBeTruthy();
      expect(toastMock.error).not.toHaveBeenCalled();
      expect(screen.queryByTestId('list-page')).toBeNull();
    });

    it('any other failure is toasted and the dialog stays', async () => {
      api.deleteProxy.mockRejectedValue(new Error('database locked'));
      await openExisting();
      const dialog = await openDelete();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('database locked'));
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(screen.queryByTestId('list-page')).toBeNull();
    });
  });

  describe('pt-BR', () => {
    it('renders the form and the panels in Portuguese', async () => {
      resetLocaleForTests('pt-BR');
      api.getProxy.mockResolvedValue(existing({ suggested_test_url: 'https://x.io/' }));
      renderPage('/proxy-servers/p1');
      await screen.findByRole('heading', { name: 'Alpha' });
      expect(screen.getByLabelText(t('proxies.form.host'))).toBeTruthy();
      expect(screen.getByRole('tab', { name: t('proxies.tabs.logs') })).toBeTruthy();
      expect(screen.getByRole('button', { name: t('proxies.test.run') })).toBeTruthy();
      expect(screen.getByRole('button', { name: t('proxies.delete.button') })).toBeTruthy();
      expect(t('proxies.delete.button')).not.toBe('Delete proxy server');
      expect(screen.queryByText('Delete proxy server')).toBeNull();
    });

    it('translates validation messages', async () => {
      resetLocaleForTests('pt-BR');
      renderPage('/proxy-servers/new');
      fireEvent.click(screen.getByRole('button', { name: t('proxies.form.createSubmit') }));
      expect(screen.getByText(t('proxies.form.errors.name'))).toBeTruthy();
      expect(t('proxies.form.errors.name')).not.toBe('Enter a name.');
    });
  });
});
