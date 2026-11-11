import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockNavigate = vi.fn();
// The page keeps its tab in ?tab=; tests start on `routeTab.current`.
const routeTab = vi.hoisted(() => ({ current: '' }));
vi.mock('react-router', async () => {
  const { useState } = await import('react');
  return {
    useNavigate: () => mockNavigate,
    useSearchParams: () => {
      const [params, setParams] = useState(
        () => new URLSearchParams(routeTab.current ? `tab=${routeTab.current}` : ''),
      );
      const update = (next: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams)) =>
        setParams((prev) => (typeof next === 'function' ? next(prev) : next));
      return [params, update] as const;
    },
  };
});

const mockListAccounts = vi.fn();
const mockChangePassword = vi.fn();

vi.mock('../../src/services/auth-client.js', () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: 'u1', name: 'Test User', email: 'test@test.com' } },
      isPending: false,
    }),
    listAccounts: (...a: unknown[]) => mockListAccounts(...a),
    changePassword: (...a: unknown[]) => mockChangePassword(...a),
  },
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('../../src/services/toast-store.js', () => ({
  toast: {
    success: (...a: unknown[]) => mockToastSuccess(...a),
    error: (...a: unknown[]) => mockToastError(...a),
    warning: vi.fn(),
  },
}));

vi.stubGlobal('navigator', {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

// Stub window.matchMedia for jsdom
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

import Account from '../../src/pages/Account';
import { setThemePreference, themePreference } from '../../src/lib/theme';

const pressed = (label: string) =>
  screen.getByRole('button', { name: label }).getAttribute('aria-pressed');

describe('Account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    routeTab.current = '';
    setThemePreference('system');
    mockListAccounts.mockResolvedValue({ data: [{ providerId: 'credential' }], error: null });
    mockChangePassword.mockResolvedValue({ data: {}, error: null });
  });

  it('renders the profile panel', () => {
    render(<Account />);
    expect(screen.getByRole('tab', { name: 'Profile information' })).toBeDefined();
  });

  it('shows display name input with user name', () => {
    render(<Account />);
    const input = screen.getByLabelText('Display name') as HTMLInputElement;
    expect(input.value).toBe('Test User');
  });

  it('shows email input', () => {
    render(<Account />);
    const input = screen.getByLabelText('Email') as HTMLInputElement;
    expect(input.value).toBe('test@test.com');
  });

  it('shows theme options', () => {
    routeTab.current = 'appearance';
    render(<Account />);
    expect(screen.getByText('Light')).toBeDefined();
    expect(screen.getByText('Dark')).toBeDefined();
    expect(screen.getByText('System')).toBeDefined();
  });

  it('shows workspace section', () => {
    routeTab.current = 'workspace';
    render(<Account />);
    expect(screen.getByRole('tab', { name: 'Workspace' })).toBeDefined();
  });

  it('shows Back button', () => {
    render(<Account />);
    fireEvent.click(screen.getByText('Back'));
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it('shows profile information section', () => {
    render(<Account />);
    expect(screen.getByRole('tab', { name: 'Profile information' })).toBeDefined();
  });

  it('shows Security section for a credential account', async () => {
    mockListAccounts.mockResolvedValue({ data: [{ providerId: 'credential' }], error: null });
    routeTab.current = 'security';
    render(<Account />);
    expect(await screen.findByRole('tab', { name: 'Security' })).toBeDefined();
    expect(screen.getByLabelText('Current password')).toBeDefined();
    expect(screen.getByLabelText('New password')).toBeDefined();
    expect(screen.getByLabelText('Confirm new password')).toBeDefined();
  });

  it('hides Security section for an OAuth-only account', async () => {
    mockListAccounts.mockResolvedValue({ data: [{ providerId: 'google' }], error: null });
    render(<Account />);
    await screen.findByRole('tab', { name: 'Profile information' });
    await waitFor(() => expect(mockListAccounts).toHaveBeenCalled());
    expect(screen.queryByText('Security')).toBeNull();
  });

  it('hides Security section when listAccounts returns no data', async () => {
    mockListAccounts.mockResolvedValue({ data: null, error: { message: 'boom' } });
    render(<Account />);
    await screen.findByRole('tab', { name: 'Profile information' });
    await waitFor(() => expect(mockListAccounts).toHaveBeenCalled());
    expect(screen.queryByText('Security')).toBeNull();
  });

  const fillPw = (current: string, next: string, confirm: string) => {
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: confirm },
    });
  };

  it('rejects when new and confirm do not match', async () => {
    routeTab.current = 'security';
    render(<Account />);
    await screen.findByRole('tab', { name: 'Security' });
    fillPw('oldpass1', 'newpass12', 'different12');
    fireEvent.click(screen.getByText('Change password'));
    expect(await screen.findByText('New passwords do not match')).toBeDefined();
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it('rejects a new password shorter than 8 characters', async () => {
    routeTab.current = 'security';
    render(<Account />);
    await screen.findByRole('tab', { name: 'Security' });
    fillPw('oldpass1', 'short', 'short');
    fireEvent.click(screen.getByText('Change password'));
    expect(await screen.findByText('New password must be at least 8 characters')).toBeDefined();
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it('rejects when the new password equals the current password', async () => {
    routeTab.current = 'security';
    render(<Account />);
    await screen.findByRole('tab', { name: 'Security' });
    fillPw('samepass1', 'samepass1', 'samepass1');
    fireEvent.click(screen.getByText('Change password'));
    expect(
      await screen.findByText('New password must differ from the current password'),
    ).toBeDefined();
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it('changes the password and revokes other sessions on success', async () => {
    routeTab.current = 'security';
    render(<Account />);
    await screen.findByRole('tab', { name: 'Security' });
    fillPw('oldpass1', 'newpass12', 'newpass12');
    fireEvent.click(screen.getByText('Change password'));
    await waitFor(() =>
      expect(mockChangePassword).toHaveBeenCalledWith({
        currentPassword: 'oldpass1',
        newPassword: 'newpass12',
        revokeOtherSessions: true,
      }),
    );
    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith(
        'Password changed. Other devices have been signed out.',
      ),
    );
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Confirm new password') as HTMLInputElement).value).toBe('');
  });

  it('shows an inline error when changePassword fails', async () => {
    mockChangePassword.mockResolvedValue({ data: null, error: { message: 'Invalid password' } });
    routeTab.current = 'security';
    render(<Account />);
    await screen.findByRole('tab', { name: 'Security' });
    fillPw('wrongpass1', 'newpass12', 'newpass12');
    fireEvent.click(screen.getByText('Change password'));
    expect(await screen.findByText('Invalid password')).toBeDefined();
    expect(mockToastSuccess).not.toHaveBeenCalledWith(
      'Password changed. Other devices have been signed out.',
    );
  });

  it('falls back to a generic error message when changePassword error has no message', async () => {
    mockChangePassword.mockResolvedValue({ data: null, error: {} });
    routeTab.current = 'security';
    render(<Account />);
    await screen.findByRole('tab', { name: 'Security' });
    fillPw('wrongpass1', 'newpass12', 'newpass12');
    fireEvent.click(screen.getByText('Change password'));
    expect(await screen.findByText('Failed to change password')).toBeDefined();
  });

  it('recovers and re-enables the button when changePassword rejects', async () => {
    mockChangePassword.mockRejectedValue(new Error('network down'));
    routeTab.current = 'security';
    render(<Account />);
    await screen.findByRole('tab', { name: 'Security' });
    fillPw('oldpass1', 'newpass12', 'newpass12');
    const button = screen.getByText('Change password').closest('button') as HTMLButtonElement;
    fireEvent.click(button);
    expect(await screen.findByText('Failed to change password')).toBeDefined();
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it('shows appearance section', () => {
    routeTab.current = 'appearance';
    render(<Account />);
    expect(screen.getByRole('tab', { name: 'Appearance' })).toBeDefined();
  });

  it('shows workspace ID', () => {
    routeTab.current = 'workspace';
    const { container } = render(<Account />);
    expect(container.textContent).toContain('u1');
  });

  it('applies light theme when Light clicked', () => {
    routeTab.current = 'appearance';
    render(<Account />);
    fireEvent.click(screen.getByText('Light'));
    expect(localStorage.getItem('theme')).toBe('light');
    expect(pressed('Light')).toBe('true');
  });

  it('applies dark theme when Dark clicked', () => {
    routeTab.current = 'appearance';
    render(<Account />);
    fireEvent.click(screen.getByText('Dark'));
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes theme from storage when System clicked', () => {
    setThemePreference('dark');
    routeTab.current = 'appearance';
    render(<Account />);
    fireEvent.click(screen.getByText('System'));
    expect(localStorage.getItem('theme')).toBeNull();
    expect(themePreference()).toBe('system');
  });

  it('copies user ID to clipboard when copy button clicked', async () => {
    routeTab.current = 'workspace';
    const { container } = render(<Account />);
    const copyBtn = container.querySelector('.copy-btn') as HTMLElement;
    await act(async () => {
      copyBtn.click();
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('u1');
  });

  it('reads stored theme on mount', () => {
    setThemePreference('dark');
    routeTab.current = 'appearance';
    render(<Account />);
    expect(pressed('Dark')).toBe('true');
    expect(pressed('System')).toBe('false');
  });

  it('follows a theme change made elsewhere, like the topbar toggle', () => {
    routeTab.current = 'appearance';
    render(<Account />);
    expect(pressed('System')).toBe('true');
    act(() => setThemePreference('light'));
    expect(pressed('Light')).toBe('true');
    expect(pressed('System')).toBe('false');
  });

  it('shows one section per tab, starting on Profile', async () => {
    render(<Account />);
    expect(screen.getByLabelText('Display name')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Dark' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Appearance' }));
    expect(screen.getByRole('button', { name: 'Dark' })).toBeDefined();
    expect(screen.queryByLabelText('Display name')).toBeNull();
    expect(await screen.findByRole('tab', { name: 'Security' })).toBeDefined();
  });

  it('shows no billing, plan or usage-email sections', async () => {
    const { container } = render(<Account />);
    await waitFor(() => expect(mockListAccounts).toHaveBeenCalled());
    expect(screen.queryByText('Billing')).toBeNull();
    expect(screen.queryByText('Email preferences')).toBeNull();
    expect(container.querySelector('#billing')).toBeNull();
    expect(container.textContent).not.toContain('Upgrade to Pro');
  });
});
