import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('../../src/services/toast-store.js', () => ({ toast: toastMock }));

const api = vi.hoisted(() => ({
  listIpPrefixLists: vi.fn(),
  getIpPrefixList: vi.fn(),
  createIpPrefixList: vi.fn(),
  updateIpPrefixList: vi.fn(),
  deleteIpPrefixList: vi.fn(),
}));
vi.mock('../../src/services/api/ip-prefix-lists.js', async (orig) => ({
  ...(await orig<object>()),
  ...api,
}));

import IpPrefixList from '../../src/pages/IpPrefixList';
import IpPrefixLists from '../../src/pages/IpPrefixLists';
import { ApiError } from '../../src/services/api/core';
import { setMe } from '../../src/services/session-store';
import type { IpPrefixListView } from '../../src/services/api/ip-prefix-lists';
import type { OrgRole } from '../../src/services/api/organizations';

const asRole = (role: OrgRole) =>
  setMe({
    userId: 'u',
    isInstanceAdmin: false,
    mustChangePassword: false,
    organization: { id: 'o', name: 'Acme', role },
  });

const office: IpPrefixListView = {
  id: 'l1',
  name: 'Office',
  description: 'HQ and VPN',
  entries: [
    { prefix: '203.0.113.0/24', label: 'HQ' },
    { prefix: '2001:db8::/48', label: null },
  ],
  harnesses: [],
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-02T00:00:00Z',
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/ip-prefix-lists" element={<IpPrefixLists />} />
        <Route path="/ip-prefix-lists/:listId" element={<IpPrefixList />} />
      </Routes>
    </MemoryRouter>,
  );

describe('IP prefix list pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asRole('admin');
    api.listIpPrefixLists.mockResolvedValue({ lists: [office] });
    api.getIpPrefixList.mockResolvedValue(office);
  });

  it('is admin-only', () => {
    asRole('member');
    renderAt('/ip-prefix-lists');
    expect(
      screen.getByText('Only admins and owners can see and manage IP prefix lists.'),
    ).toBeTruthy();
    expect(api.listIpPrefixLists).not.toHaveBeenCalled();
  });

  it('lists the lists with entry counts', async () => {
    renderAt('/ip-prefix-lists');
    const link = await screen.findByRole('link', { name: 'Office' });
    expect(link.getAttribute('href')).toBe('/ip-prefix-lists/l1');
    const cells = within(link.closest('tr')!)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(cells.slice(0, 3)).toEqual(['OfficeHQ and VPN', '2', 'None']);
  });

  it('creates a list from pasted lines and checks them first', async () => {
    api.createIpPrefixList.mockResolvedValue({ ...office, id: 'l2', name: 'Edge' });
    renderAt('/ip-prefix-lists/new');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Edge' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Text' }));
    const area = screen.getByRole('textbox', { name: 'Entries' });
    fireEvent.change(area, { target: { value: '198.51.100.7 gw\nbad-entry' } });
    expect(screen.getByText('Line 2: bad-entry is not an IP address or CIDR prefix.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create list' }));
    expect(api.createIpPrefixList).not.toHaveBeenCalled();

    fireEvent.change(area, { target: { value: '198.51.100.7 gw\n2001:db8::/48 # VPN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create list' }));
    await waitFor(() =>
      expect(api.createIpPrefixList).toHaveBeenCalledWith(
        {
          name: 'Edge',
          description: null,
          entries: [
            { prefix: '198.51.100.7', label: 'gw' },
            { prefix: '2001:db8::/48', label: 'VPN' },
          ],
        },
        { silent: true },
      ),
    );
  });

  it('shows the server message for a bad entry', async () => {
    api.updateIpPrefixList.mockRejectedValue(
      new ApiError('Entry 2 (2001:db8::/48) is not a valid prefix', 400),
    );
    renderAt('/ip-prefix-lists/l1');
    await screen.findByDisplayValue('Office');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Entry 2 (2001:db8::/48) is not a valid prefix')).toBeTruthy();
  });

  it('blocks delete while harnesses use the list and names them', async () => {
    api.getIpPrefixList.mockResolvedValue({
      ...office,
      harnesses: [{ name: 'claude-code', displayName: 'Claude Code' }],
    });
    renderAt('/ip-prefix-lists/l1');
    const link = await screen.findAllByRole('link', { name: 'Claude Code' });
    expect(link[0]!.getAttribute('href')).toBe('/harnesses/claude-code/keys');
    expect(
      (screen.getByRole('button', { name: 'Delete list' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows the harnesses after a 409 on delete', async () => {
    api.deleteIpPrefixList.mockRejectedValue(new ApiError('List in use', 409));
    renderAt('/ip-prefix-lists/l1');
    await screen.findByDisplayValue('Office');
    api.getIpPrefixList.mockResolvedValue({
      ...office,
      harnesses: [{ name: 'hermes', displayName: 'Hermes' }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete list' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Office?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('List in use')).toBeTruthy();
    expect((await screen.findAllByRole('link', { name: 'Hermes' })).length).toBeGreaterThan(0);
  });
});
