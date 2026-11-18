import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../src/services/toast-store.js', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
const api = vi.hoisted(() => ({
  getIpRestriction: vi.fn(),
  updateIpRestriction: vi.fn(),
  listIpPrefixLists: vi.fn(),
}));
vi.mock('../../src/services/api/ip-prefix-lists.js', async (orig) => ({
  ...(await orig<object>()),
  ...api,
}));

import SettingsIpRestrictionSection from '../../src/pages/SettingsIpRestrictionSection';
import { setMe } from '../../src/services/session-store';
import type { OrgRole } from '../../src/services/api/organizations';

const asRole = (role: OrgRole) =>
  setMe({
    userId: 'u',
    isInstanceAdmin: false,
    mustChangePassword: false,
    organization: { id: 'o', name: 'Acme', role },
  });

const list = (id: string, name: string) => ({
  id,
  name,
  description: null,
  entries: [{ prefix: '203.0.113.0/24', label: null }],
  harnesses: [],
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
});

const renderSection = () =>
  render(
    <MemoryRouter>
      <SettingsIpRestrictionSection agentName="demo" />
    </MemoryRouter>,
  );

describe('SettingsIpRestrictionSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asRole('owner');
    api.getIpRestriction.mockResolvedValue({ enabled: false, listIds: [] });
    api.listIpPrefixLists.mockResolvedValue({
      lists: [list('l1', 'Office'), list('l2', 'VPN')],
    });
    api.updateIpRestriction.mockImplementation(async (_a: string, body: object) => body);
  });

  it('is hidden for members', () => {
    asRole('member');
    const { container } = renderSection();
    expect(container.textContent).toBe('');
    expect(api.getIpRestriction).not.toHaveBeenCalled();
  });

  it('needs a list before turning on, then saves enabled + lists', async () => {
    renderSection();
    const toggle = screen.getByRole('switch', { name: 'Restrict source IP' });
    await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false));
    expect(screen.getByText(/get 403 \(M008\)/)).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.getByText('Pick at least one list to turn the restriction on.')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.click(await screen.findByLabelText('VPN'));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.updateIpRestriction).toHaveBeenCalledWith('demo', {
        enabled: true,
        listIds: ['l2'],
      }),
    );
  });
});
