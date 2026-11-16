import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../src/services/toast-store.js', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const mockListMembers = vi.fn();
const mockAddMember = vi.fn();
vi.mock('../../src/services/api/organizations.js', () => ({
  listMembers: (...a: unknown[]) => mockListMembers(...a),
  addMember: (...a: unknown[]) => mockAddMember(...a),
  renameOrganization: vi.fn(),
  deleteOrganization: vi.fn(),
  removeMember: vi.fn(),
  listAdminUsers: vi.fn(),
}));

import { setMe } from '../../src/services/session-store';
import Organization from '../../src/pages/Organization';
import type { OrgRole } from '../../src/services/api/organizations';

const members = [
  {
    userId: 'u-owner',
    email: 'owner@x.io',
    name: 'Olga',
    role: 'owner',
    mustChangePassword: false,
  },
  { userId: 'u-me', email: 'me@x.io', name: 'Me', role: 'admin', mustChangePassword: false },
  { userId: 'u-view', email: 'view@x.io', name: 'Vic', role: 'viewer', mustChangePassword: true },
];

const asRole = (role: OrgRole) =>
  setMe({
    userId: 'u-me',
    isInstanceAdmin: false,
    mustChangePassword: false,
    organization: { id: 'org-1', name: 'Acme', role },
  });

describe('Organization page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListMembers.mockResolvedValue({ members });
  });

  const renderAt = (tab?: string) =>
    render(
      <MemoryRouter initialEntries={[tab ? `/organization?tab=${tab}` : '/organization']}>
        <Organization />
      </MemoryRouter>,
    );

  it('splits the sections into tabs without a Triggers section', async () => {
    asRole('owner');
    renderAt();
    const tabs = screen.getAllByRole('tab').map((el) => el.textContent);
    expect(tabs).toEqual(
      expect.arrayContaining(['General', 'Log retention', 'API keys', 'Danger zone']),
    );
    expect(tabs.some((label) => label?.startsWith('Members'))).toBe(true);
    expect(screen.queryByText('Open triggers')).toBeNull();
    // Only the General tab shows on arrival.
    expect(screen.getByLabelText('Organization name')).toBeTruthy();
    expect(screen.queryByText('Delete organization')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Danger zone' }));
    expect(screen.getByText('Delete organization')).toBeTruthy();
  });

  it('lets an admin remove non-owners only, with no role editing and no delete tab', async () => {
    asRole('admin');
    renderAt('members');
    await screen.findByText('owner@x.io');
    expect(screen.queryByRole('tab', { name: 'Danger zone' })).toBeNull();
    // Roles are read-only badges; members are only added or removed.
    expect(screen.queryAllByRole('combobox').map((el) => el.id)).toEqual(['org-add-role']);
    expect(screen.getAllByText('Remove')).toHaveLength(2);
    const options = Array.from((screen.getByLabelText('Role') as HTMLSelectElement).options).map(
      (o) => o.value,
    );
    expect(options).not.toContain('owner');
    expect(screen.getByText('Pending password change')).toBeTruthy();
  });

  it('is read-only for a viewer', async () => {
    asRole('viewer');
    renderAt('members');
    await screen.findByText('owner@x.io');
    expect(screen.queryByRole('form', { name: 'Add member' })).toBeNull();
    expect(screen.queryByText('Remove')).toBeNull();
  });

  it('adds an existing account by email, with no name field', async () => {
    asRole('owner');
    mockAddMember.mockResolvedValue({
      member: {
        userId: 'u-new',
        email: 'new@x.io',
        name: '',
        role: 'member',
        mustChangePassword: false,
      },
      temporaryPassword: null,
    });
    renderAt('members');
    await screen.findByText('owner@x.io');
    const form = screen.getByRole('form', { name: 'Add member' });
    expect(form.querySelectorAll('input')).toHaveLength(1);
    const email = form.querySelector('input[type="email"]') as HTMLInputElement;
    fireEvent.change(email, { target: { value: 'new@x.io' } });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(mockAddMember).toHaveBeenCalledWith(
        'org-1',
        { email: 'new@x.io', role: 'member' },
        { silent: true },
      ),
    );
    expect(screen.queryByTestId('temporary-password')).toBeNull();
  });
});
