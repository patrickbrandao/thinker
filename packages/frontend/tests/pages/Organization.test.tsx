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
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
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

  it('lets an admin manage non-owners only, without rename or delete', async () => {
    asRole('admin');
    render(
      <MemoryRouter>
        <Organization />
      </MemoryRouter>,
    );
    await screen.findByText('owner@x.io');
    expect(screen.queryByLabelText('Role of owner@x.io')).toBeNull();
    expect(screen.getByLabelText('Role of view@x.io')).toBeTruthy();
    const options = Array.from(
      (screen.getByLabelText('Role of view@x.io') as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(options).not.toContain('owner');
    expect(screen.queryByText('Delete organization')).toBeNull();
    expect(screen.getByLabelText('Organization name').hasAttribute('readonly')).toBe(true);
    expect(screen.getByText('Pending password change')).toBeTruthy();
  });

  it('is read-only for a viewer', async () => {
    asRole('viewer');
    render(
      <MemoryRouter>
        <Organization />
      </MemoryRouter>,
    );
    await screen.findByText('owner@x.io');
    expect(screen.queryByRole('form', { name: 'Add member' })).toBeNull();
    expect(screen.queryByText('Remove')).toBeNull();
  });

  it('shows the temporary password once after adding a member', async () => {
    asRole('owner');
    mockAddMember.mockResolvedValue({
      member: {
        userId: 'u-new',
        email: 'new@x.io',
        name: '',
        role: 'member',
        mustChangePassword: true,
      },
      temporaryPassword: 'Temp-Pass-123',
    });
    render(
      <MemoryRouter>
        <Organization />
      </MemoryRouter>,
    );
    await screen.findByText('owner@x.io');
    expect(screen.getByText('Delete organization')).toBeTruthy();
    const form = screen.getByRole('form', { name: 'Add member' });
    const email = form.querySelector('input[type="email"]') as HTMLInputElement;
    fireEvent.change(email, { target: { value: 'new@x.io' } });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(mockAddMember).toHaveBeenCalledWith('org-1', { email: 'new@x.io', role: 'member' }),
    );
    const box = await screen.findByTestId('temporary-password');
    expect(box.textContent).toBe('Temp-Pass-123');
    expect(box.closest('.well')?.querySelector('.copy-btn')).toBeTruthy();
    fireEvent.click(screen.getByText('I saved it'));
    expect(screen.queryByTestId('temporary-password')).toBeNull();
  });
});
