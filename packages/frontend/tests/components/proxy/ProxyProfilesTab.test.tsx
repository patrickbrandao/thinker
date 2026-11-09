import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('../../../src/services/toast-store.js', () => ({ toast: toastMock }));

const api = vi.hoisted(() => ({
  listProxyProfiles: vi.fn(),
  listProxies: vi.fn(),
  createProxyProfile: vi.fn(),
  updateProxyProfile: vi.fn(),
  deleteProxyProfile: vi.fn(),
}));
vi.mock('../../../src/services/api/proxies.js', async (orig) => ({
  ...(await orig<object>()),
  ...api,
}));

import ProxyProfilesTab from '../../../src/components/proxy/ProxyProfilesTab';
import { resetLocaleForTests, t } from '../../../src/i18n';
import { profile, proxyView } from './fixtures';

const alpha = proxyView({ id: 'p1', name: 'Alpha' });
const beta = proxyView({ id: 'p2', name: 'Beta' });

function renderTab() {
  return render(
    <MemoryRouter>
      <ProxyProfilesTab />
    </MemoryRouter>,
  );
}

describe('ProxyProfilesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listProxyProfiles.mockResolvedValue({ profiles: [profile()] });
    api.listProxies.mockResolvedValue({ proxies: [alpha, beta], global: null });
    api.createProxyProfile.mockResolvedValue(profile());
    api.updateProxyProfile.mockResolvedValue(profile());
    api.deleteProxyProfile.mockResolvedValue({ deleted: true, affected: 0 });
  });

  it('lists profiles with their chain, in-use count and a disabled-proxy warning', async () => {
    api.listProxyProfiles.mockResolvedValue({
      profiles: [
        profile(),
        profile({
          id: 'pr2',
          name: 'Backup',
          chain: [{ kind: 'proxy', proxy_id: 'p2', name: 'Beta', enabled: false }],
          used_by: [
            { profile_id: 'pr2', target_type: 'trigger', target_id: 't1', label: 'ops-hook' },
            { profile_id: 'pr2', target_type: 'provider', target_id: 'x', label: 'OpenAI' },
          ],
        }),
        profile({ id: 'pr3', name: 'Empty chain', chain: [] }),
      ],
    });
    renderTab();
    const row = (await screen.findByText('Primary route')).closest('tr')!;
    expect(row.querySelector('td.text-sm')!.textContent).toBe('Alpha→Direct');
    expect(within(row).queryByText('Disabled')).toBeNull();
    const backup = screen.getByText('Backup').closest('tr')!;
    expect(within(backup).getByText('Disabled')).toBeTruthy();
    expect(within(backup).getByText('2')).toBeTruthy();
    expect(backup.querySelector('td.num')!.getAttribute('title')).toBe('ops-hook\nOpenAI');
    expect(within(screen.getByText('Empty chain').closest('tr')!).getByText('—')).toBeTruthy();
  });

  it('shows the empty state when there are no profiles', async () => {
    api.listProxyProfiles.mockResolvedValue({ profiles: [] });
    renderTab();
    expect(await screen.findByText('No outbound profiles yet')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the error with a retry that reloads', async () => {
    api.listProxyProfiles.mockRejectedValueOnce(new Error('backend down'));
    renderTab();
    expect(await screen.findByText('backend down')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Primary route')).toBeTruthy();
    expect(api.listProxyProfiles).toHaveBeenCalledTimes(2);
  });

  it('creates a profile: submit is disabled until it has a name and a valid chain, then posts the payload', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Primary route');
    fireEvent.click(screen.getByRole('button', { name: 'New profile' }));
    const dialog = await screen.findByRole('dialog', { name: 'New outbound profile' });
    const save = within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    await user.type(within(dialog).getByLabelText('Name'), '  Edge route  ');
    // Name alone is not enough: the chain is empty.
    expect(save.disabled).toBe(true);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Add line' }));
    fireEvent.change(within(dialog).getByLabelText('Proxy of line 1'), { target: { value: 'p2' } });
    fireEvent.change(within(dialog).getByLabelText('Line to add'), { target: { value: 'direct' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add line' }));
    expect(save.disabled).toBe(false);

    fireEvent.click(save);
    await waitFor(() => expect(api.createProxyProfile).toHaveBeenCalledTimes(1));
    expect(api.createProxyProfile).toHaveBeenCalledWith({
      name: 'Edge route',
      lines: [
        { mode: 'proxy', proxies: ['p2'], on_failure: 'next_member', no_session: 'request' },
        { mode: 'direct', proxies: [], on_failure: 'next_member', no_session: 'request' },
      ],
    });
    expect(api.updateProxyProfile).not.toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith('Outbound profile saved');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The list is reloaded after a save.
    await waitFor(() => expect(api.listProxyProfiles).toHaveBeenCalledTimes(2));
  });

  it('refuses a chain that starts with Direct and explains why', async () => {
    renderTab();
    await screen.findByText('Primary route');
    fireEvent.click(screen.getByRole('button', { name: 'New profile' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'x' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add line' }));
    fireEvent.change(within(dialog).getByLabelText('Line to add'), { target: { value: 'direct' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add line' }));
    const save = within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);

    // Move Direct above the proxy.
    fireEvent.click(within(dialog).getAllByLabelText('Move up')[1]!);
    expect(within(dialog).getByText('The first item must be a proxy, not Direct.')).toBeTruthy();
    expect(save.disabled).toBe(true);

    // Reordering back clears the error.
    fireEvent.click(within(dialog).getAllByLabelText('Move down')[0]!);
    expect(within(dialog).queryByText('The first item must be a proxy, not Direct.')).toBeNull();
    expect(save.disabled).toBe(false);
  });

  it('keeps the dialog open and does not reload when the save fails', async () => {
    api.createProxyProfile.mockRejectedValue(new Error('conflict'));
    renderTab();
    await screen.findByText('Primary route');
    fireEvent.click(screen.getByRole('button', { name: 'New profile' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'dup' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add line' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createProxyProfile).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(api.listProxyProfiles).toHaveBeenCalledTimes(1);
    // The button is usable again.
    await waitFor(() =>
      expect(
        (within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });

  it('edits a profile: prefilled name and chain, PATCH with the id', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Primary route' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit outbound profile' });
    const name = within(dialog).getByLabelText('Name') as HTMLInputElement;
    expect(name.value).toBe('Primary route');
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2);

    fireEvent.change(name, { target: { value: 'Renamed' } });
    fireEvent.click(within(dialog).getByLabelText('Remove line 2'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateProxyProfile).toHaveBeenCalledTimes(1));
    expect(api.updateProxyProfile).toHaveBeenCalledWith('pr1', {
      name: 'Renamed',
      lines: [{ mode: 'proxy', proxies: ['p1'], on_failure: 'next_member', no_session: 'request' }],
    });
    expect(api.createProxyProfile).not.toHaveBeenCalled();
  });

  it('creates a balanced line: session affinity over two proxies, then Direct', async () => {
    renderTab();
    await screen.findByText('Primary route');
    fireEvent.click(screen.getByRole('button', { name: 'New profile' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Balance-First' } });
    fireEvent.change(within(dialog).getByLabelText('Line to add'), {
      target: { value: 'affinity' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add line' }));
    fireEvent.change(within(dialog).getByLabelText('Add a proxy to line 1'), {
      target: { value: 'p2' },
    });
    fireEvent.change(within(dialog).getByLabelText('Without session'), {
      target: { value: 'agent' },
    });
    fireEvent.change(within(dialog).getByLabelText('Line to add'), { target: { value: 'direct' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add line' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createProxyProfile).toHaveBeenCalledTimes(1));
    expect(api.createProxyProfile).toHaveBeenCalledWith({
      name: 'Balance-First',
      lines: [
        { mode: 'affinity', proxies: ['p1', 'p2'], on_failure: 'next_member', no_session: 'agent' },
        { mode: 'direct', proxies: [], on_failure: 'next_member', no_session: 'request' },
      ],
    });
  });

  it('shows balanced lines in the list with their mode', async () => {
    api.listProxyProfiles.mockResolvedValue({
      profiles: [
        profile({
          chain: [
            {
              kind: 'proxy',
              proxy_id: 'p1',
              name: 'Alpha',
              enabled: true,
              line: 1,
              mode: 'request',
            },
            {
              kind: 'proxy',
              proxy_id: 'p2',
              name: 'Beta',
              enabled: true,
              line: 1,
              mode: 'request',
            },
            {
              kind: 'direct',
              proxy_id: null,
              name: 'Direct',
              enabled: true,
              line: 2,
              mode: 'direct',
            },
          ],
        }),
      ],
    });
    renderTab();
    const row = (await screen.findByText('Primary route')).closest('tr')!;
    expect(within(row).getByText('Alpha | Beta (per request)')).toBeTruthy();
    expect(within(row).getByTitle('Per request')).toBeTruthy();
  });

  it('cancels the dialog without saving (button and Escape)', async () => {
    renderTab();
    await screen.findByText('Primary route');
    fireEvent.click(screen.getByRole('button', { name: 'New profile' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New profile' }));
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.createProxyProfile).not.toHaveBeenCalled();
  });

  it('deletes an unused profile after a confirmation', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Primary route' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Primary route' });
    expect(within(dialog).getByText('Delete the outbound profile Primary route?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteProxyProfile).toHaveBeenCalledWith('pr1', false));
    expect(toastMock.success).toHaveBeenCalledWith('Outbound profile deleted');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.listProxyProfiles).toHaveBeenCalledTimes(2);
  });

  it('lists what uses a profile before deleting it, and deletes with remove=true', async () => {
    api.listProxyProfiles.mockResolvedValue({
      profiles: [
        profile({
          used_by: [
            { profile_id: 'pr1', target_type: 'trigger', target_id: 't1', label: 'ops-hook' },
            { profile_id: 'pr1', target_type: 'connection', target_id: 'c1', label: 'work key' },
          ],
        }),
      ],
    });
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Primary route' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/used by 2 item\(s\)/)).toBeTruthy();
    expect(within(dialog).getByText('ops-hook')).toBeTruthy();
    expect(within(dialog).getByText('Trigger')).toBeTruthy();
    expect(within(dialog).getByText('work key')).toBeTruthy();
    expect(within(dialog).getByText('Connection')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteProxyProfile).toHaveBeenCalledWith('pr1', true));
  });

  it('keeps the confirmation open when the delete fails', async () => {
    api.deleteProxyProfile.mockRejectedValue(new Error('nope'));
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Primary route' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => expect(api.deleteProxyProfile).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('renders in pt-BR', async () => {
    resetLocaleForTests('pt-BR');
    renderTab();
    expect(await screen.findByText('Primary route')).toBeTruthy();
    expect(screen.getByRole('button', { name: t('proxies.profiles.create') })).toBeTruthy();
    expect(t('proxies.profiles.create')).not.toBe('New profile');
    expect(
      screen.getByRole('button', { name: t('proxies.profiles.edit', { name: 'Primary route' }) }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit Primary route' })).toBeNull();
  });
});
