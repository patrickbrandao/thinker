import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { resetLocaleForTests } from '../../src/i18n';

const mockNavigate = vi.fn();
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => mockNavigate,
}));

const mockSignOut = vi.fn();
vi.mock('../../src/services/auth-client.js', () => ({
  authClient: { signOut: (...a: unknown[]) => mockSignOut(...a) },
}));

const mockCreateOrganization = vi.fn();
const mockSetActiveOrganization = vi.fn();
vi.mock('../../src/services/api/organizations.js', () => ({
  createOrganization: (...a: unknown[]) => mockCreateOrganization(...a),
  setActiveOrganization: (...a: unknown[]) => mockSetActiveOrganization(...a),
}));

const mockLoadMe = vi.fn();
vi.mock('../../src/services/session-store.js', async () => {
  const { signal } = await import('../../src/lib/signal');
  return { me: signal(null), loadMe: (...a: unknown[]) => mockLoadMe(...a) };
});

import MeGate from '../../src/components/MeGate';
import { me } from '../../src/services/session-store.js';
import {
  getActiveOrganizationId,
  markPasswordChangeRequired,
} from '../../src/services/org-context';

const okMe = {
  userId: 'u1',
  isInstanceAdmin: false,
  mustChangePassword: false,
  organization: { id: 'org-1', name: 'Acme', role: 'owner' },
};

function renderGate() {
  return render(
    <MeGate>
      <div data-testid="app">app</div>
    </MeGate>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  markPasswordChangeRequired(false);
  (me as unknown as { set(v: unknown): void }).set(null);
  mockSetActiveOrganization.mockResolvedValue({ ok: true });
  mockLoadMe.mockResolvedValue(okMe);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MeGate', () => {
  it('shows a busy loading gate until /me resolves, then renders the app', async () => {
    let resolve!: (v: unknown) => void;
    mockLoadMe.mockReturnValue(new Promise((r) => (resolve = r)));
    const { container } = renderGate();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText('Loading...')).toBeTruthy();
    expect(screen.queryByTestId('app')).toBeNull();
    await act(async () => resolve(okMe));
    expect(screen.getByTestId('app')).toBeTruthy();
  });

  it('syncs the saved organization once per tab session', async () => {
    const first = renderGate();
    await screen.findByTestId('app');
    expect(mockSetActiveOrganization).toHaveBeenCalledWith('org-1');
    expect(sessionStorage.getItem('thinker.activeOrganizationSynced')).toBe('org-1');
    first.unmount();
    renderGate();
    await screen.findByTestId('app');
    expect(mockSetActiveOrganization).toHaveBeenCalledTimes(1);
  });

  it('re-syncs when the active organization changed', async () => {
    sessionStorage.setItem('thinker.activeOrganizationSynced', 'other-org');
    renderGate();
    await screen.findByTestId('app');
    expect(mockSetActiveOrganization).toHaveBeenCalledWith('org-1');
  });

  it('a failing sync is swallowed and the app still renders', async () => {
    mockSetActiveOrganization.mockRejectedValue(new Error('boom'));
    renderGate();
    expect(await screen.findByTestId('app')).toBeTruthy();
  });

  it('shows the error with a retry that reloads /me', async () => {
    mockLoadMe.mockRejectedValueOnce(new Error('Server exploded'));
    renderGate();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not load your account');
    expect(alert.textContent).toContain('Server exploded');
    expect(screen.queryByTestId('app')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('app')).toBeTruthy();
    expect(mockLoadMe).toHaveBeenCalledTimes(2);
  });

  it('uses a generic message when the rejection is not an Error', async () => {
    mockLoadMe.mockRejectedValueOnce('nope');
    renderGate();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Failed to load your account');
  });

  it('renders neither error nor app when the failure is the forced password change', async () => {
    mockLoadMe.mockImplementationOnce(async () => {
      markPasswordChangeRequired(true);
      throw new Error('Password change required');
    });
    renderGate();
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/change-password', { replace: true }),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('app')).toBeNull();
  });

  it('routes to /change-password when /me says the password must change', async () => {
    mockLoadMe.mockResolvedValue({ ...okMe, mustChangePassword: true });
    renderGate();
    await waitFor(() => expect(mockLoadMe).toHaveBeenCalled());
    // loadMe flags the signal in the real store; emulate it.
    act(() => markPasswordChangeRequired(true));
    expect(mockNavigate).toHaveBeenCalledWith('/change-password', { replace: true });
    // The gate never shows the app nor the no-org screen meanwhile.
    expect(screen.queryByTestId('app')).toBeNull();
    expect(mockSetActiveOrganization).not.toHaveBeenCalled();
  });

  it('routes to /change-password when any API call raises the flag later', async () => {
    renderGate();
    await screen.findByTestId('app');
    expect(mockNavigate).not.toHaveBeenCalled();
    act(() => markPasswordChangeRequired(true));
    expect(mockNavigate).toHaveBeenCalledWith('/change-password', { replace: true });
  });

  describe('no organization', () => {
    it('tells a regular user to ask an administrator, with no create form', async () => {
      mockLoadMe.mockResolvedValue({ ...okMe, organization: null });
      renderGate();
      expect(await screen.findByText('No organization')).toBeTruthy();
      expect(screen.getByText(/Ask an administrator to add you/)).toBeTruthy();
      expect(screen.queryByLabelText('Organization name')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Create organization' })).toBeNull();
      expect(screen.queryByTestId('app')).toBeNull();
    });

    it('offers an instance admin the create-organization form', async () => {
      mockLoadMe.mockResolvedValue({ ...okMe, organization: null, isInstanceAdmin: true });
      (me as unknown as { set(v: unknown): void }).set({
        ...okMe,
        organization: null,
        isInstanceAdmin: true,
      });
      renderGate();
      expect(await screen.findByLabelText('Organization name')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Create organization' })).toBeTruthy();
    });

    it('ignores a blank organization name', async () => {
      mockLoadMe.mockResolvedValue({ ...okMe, organization: null, isInstanceAdmin: true });
      (me as unknown as { set(v: unknown): void }).set({
        ...okMe,
        organization: null,
        isInstanceAdmin: true,
      });
      renderGate();
      const input = await screen.findByLabelText('Organization name');
      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.submit(input.closest('form')!);
      expect(mockCreateOrganization).not.toHaveBeenCalled();
    });

    it('creates the organization, makes it active, then reloads /me into the app', async () => {
      const noOrg = { ...okMe, organization: null, isInstanceAdmin: true };
      mockLoadMe.mockResolvedValueOnce(noOrg).mockResolvedValue({ ...okMe, isInstanceAdmin: true });
      (me as unknown as { set(v: unknown): void }).set(noOrg);
      mockCreateOrganization.mockResolvedValue({ id: 'new-org', name: 'Fresh', role: 'owner' });
      renderGate();
      const input = await screen.findByLabelText('Organization name');
      fireEvent.change(input, { target: { value: '  Fresh  ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));
      await screen.findByTestId('app');
      expect(mockCreateOrganization).toHaveBeenCalledWith('Fresh');
      expect(getActiveOrganizationId()).toBe('new-org');
      expect(mockSetActiveOrganization).toHaveBeenCalledWith('new-org');
    });

    it('stays on the form when creation fails', async () => {
      const noOrg = { ...okMe, organization: null, isInstanceAdmin: true };
      mockLoadMe.mockResolvedValue(noOrg);
      (me as unknown as { set(v: unknown): void }).set(noOrg);
      mockCreateOrganization.mockRejectedValue(new Error('taken'));
      renderGate();
      const input = await screen.findByLabelText('Organization name');
      fireEvent.change(input, { target: { value: 'Fresh' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));
      await waitFor(() => expect(mockCreateOrganization).toHaveBeenCalled());
      await waitFor(() =>
        expect(
          (screen.getByRole('button', { name: 'Create organization' }) as HTMLButtonElement)
            .disabled,
        ).toBe(false),
      );
      expect(screen.queryByTestId('app')).toBeNull();
    });

    it('lets the user sign out and returns to /login', async () => {
      mockLoadMe.mockResolvedValue({ ...okMe, organization: null });
      mockSignOut.mockResolvedValue(undefined);
      const replace = vi.fn();
      const original = window.location;
      Object.defineProperty(window, 'location', {
        value: { ...original, replace },
        configurable: true,
      });
      try {
        renderGate();
        fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
        await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
        expect(mockSignOut).toHaveBeenCalled();
      } finally {
        Object.defineProperty(window, 'location', { value: original, configurable: true });
      }
    });
  });

  it('renders the no-organization gate in pt-BR', async () => {
    resetLocaleForTests('pt-BR');
    mockLoadMe.mockResolvedValue({ ...okMe, organization: null });
    renderGate();
    expect(await screen.findByText('Nenhuma organização')).toBeTruthy();
    expect(screen.queryByText('No organization')).toBeNull();
  });
});
