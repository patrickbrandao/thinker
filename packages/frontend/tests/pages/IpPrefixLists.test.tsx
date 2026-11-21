import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  keys: [],
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-02T00:00:00Z',
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/ip-prefix-lists" element={<IpPrefixLists />} />
      </Routes>
    </MemoryRouter>,
  );

const usedBy = {
  harnesses: [{ name: 'claude-code', displayName: 'Claude Code' }],
  keys: [
    {
      id: 'k1',
      name: 'Primary key',
      harness: 'claude-code',
      harnessDisplayName: 'Claude Code',
      listCount: 1,
    },
  ],
};

describe('IP ACL page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asRole('admin');
    api.listIpPrefixLists.mockResolvedValue({ lists: [office] });
    api.getIpPrefixList.mockResolvedValue(office);
  });

  it('is admin-only', () => {
    asRole('member');
    renderAt('/ip-prefix-lists');
    expect(screen.getByText('Only admins and owners can see and manage IP ACLs.')).toBeTruthy();
    expect(api.listIpPrefixLists).not.toHaveBeenCalled();
  });

  it('lists the ACLs with entry counts', async () => {
    renderAt('/ip-prefix-lists');
    const name = await screen.findByRole('button', { name: 'Office' });
    const cells = Array.from(name.closest('tr')!.querySelectorAll('td')).map((c) => c.textContent);
    expect(cells.slice(0, 3)).toEqual(['OfficeHQ and VPN', '2', 'None']);
  });

  it('edits from the ... menu in a floating window', async () => {
    renderAt('/ip-prefix-lists');
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Office' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await screen.findByDisplayValue('Office')).toBeTruthy();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'General',
      'IP addresses2',
      'API keys0',
      'Delete',
    ]);
    // The addresses live in their own tab.
    expect(screen.queryByDisplayValue('203.0.113.0/24')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /IP addresses/ }));
    expect(screen.getByDisplayValue('203.0.113.0/24')).toBeTruthy();
  });

  it('removes an unused ACL from the menu', async () => {
    api.deleteIpPrefixList.mockResolvedValue({ ok: true, unlinkedKeys: 0 });
    renderAt('/ip-prefix-lists');
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Office' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.deleteIpPrefixList).toHaveBeenCalledWith('l1'));
  });

  it('cannot remove an ACL in use from the menu', async () => {
    api.listIpPrefixLists.mockResolvedValue({ lists: [{ ...office, ...usedBy }] });
    renderAt('/ip-prefix-lists');
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Office' }));
    const remove = screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
  });

  it('creates an ACL from pasted lines and checks them first', async () => {
    api.createIpPrefixList.mockResolvedValue({ ...office, id: 'l2', name: 'Edge' });
    renderAt('/ip-prefix-lists?edit=new');
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Edge' } });
    fireEvent.click(screen.getByRole('tab', { name: /IP addresses/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Text' }));
    const area = screen.getByRole('textbox', { name: 'Entries' });
    fireEvent.change(area, { target: { value: '198.51.100.7 gw\nbad-entry' } });
    expect(screen.getByText('Line 2: bad-entry is not an IP address or CIDR prefix.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create IP ACL' }));
    expect(api.createIpPrefixList).not.toHaveBeenCalled();

    fireEvent.change(area, { target: { value: '198.51.100.7 gw\n2001:db8::/48 # VPN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create IP ACL' }));
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
    renderAt('/ip-prefix-lists?edit=l1');
    await screen.findByDisplayValue('Office');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Entry 2 (2001:db8::/48) is not a valid prefix')).toBeTruthy();
  });

  it('shows the keys that use it and deletes by unlinking them', async () => {
    api.getIpPrefixList.mockResolvedValue({ ...office, ...usedBy });
    api.deleteIpPrefixList.mockResolvedValue({ ok: true, unlinkedKeys: 1 });
    renderAt('/ip-prefix-lists?edit=l1');
    await screen.findByDisplayValue('Office');
    fireEvent.click(screen.getByRole('tab', { name: /API keys/ }));
    const link = screen.getByRole('link', { name: 'Claude Code' });
    expect(link.getAttribute('href')).toBe('/harnesses/claude-code/keys');
    expect(screen.getByText('Only this one')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Delete' }));
    expect(screen.getByText(/source IP restriction is turned off/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unlink keys and delete' }));
    await waitFor(() =>
      expect(api.deleteIpPrefixList).toHaveBeenCalledWith('l1', { silent: true }, true),
    );
  });
});
