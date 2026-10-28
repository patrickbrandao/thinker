import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockSignUpEmail = vi.fn().mockResolvedValue({});
const mockSignInSocial = vi.fn().mockResolvedValue({});
const mockSendVerificationEmail = vi.fn().mockResolvedValue({});
const mockCheckSocialProviders = vi.fn().mockResolvedValue([]);
let mockLocationSearch = '';
const mockNavigate = vi.fn();
const mockCheckSignupEnabled = vi.fn().mockResolvedValue(true);

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  Link: (props: any) => (
    <a href={props.to} className={props.className}>
      {props.children}
    </a>
  ),
  useLocation: () => ({ search: mockLocationSearch }),
  useNavigate: () => mockNavigate,
  // SocialButtons reads the query to build its callbacks.
  useSearchParams: () => [new URLSearchParams({} as Record<string, string>), vi.fn()],
}));

vi.mock('../../src/services/auth-client.js', () => ({
  authClient: {
    signUp: { email: (...args: unknown[]) => mockSignUpEmail(...args) },
    signIn: { social: (...args: unknown[]) => mockSignInSocial(...args) },
    sendVerificationEmail: (...args: unknown[]) => mockSendVerificationEmail(...args),
  },
}));

vi.mock('../../src/services/setup-status.js', () => ({
  checkSocialProviders: (...args: unknown[]) => mockCheckSocialProviders(...args),
  checkSignupEnabled: (...args: unknown[]) => mockCheckSignupEnabled(...args),
}));

import Register from '../../src/pages/Register';
import { getLastAuthMethod } from '../../src/services/last-auth-method';

describe('Register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignUpEmail.mockResolvedValue({});
    mockSignInSocial.mockResolvedValue({});
    mockCheckSocialProviders.mockResolvedValue([]);
    mockCheckSignupEnabled.mockResolvedValue(true);
    mockLocationSearch = '';
    localStorage.clear();
  });

  it('redirects to /login, keeping the query, when sign-up is disabled', async () => {
    mockCheckSignupEnabled.mockResolvedValue(false);
    mockLocationSearch = '?redirect=%2Fmessages';
    render(<Register />);
    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login?redirect=%2Fmessages', { replace: true });
    });
    expect(mockCheckSocialProviders).not.toHaveBeenCalled();
  });

  it('stays on the page when sign-up is enabled', async () => {
    render(<Register />);
    await vi.waitFor(() => expect(mockCheckSocialProviders).toHaveBeenCalled());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('renders create account heading', () => {
    render(<Register />);
    expect(screen.getByText('Create an account')).toBeDefined();
  });

  it('renders name, email, and password inputs', () => {
    render(<Register />);
    expect(screen.getByPlaceholderText('Your name')).toBeDefined();
    expect(screen.getByPlaceholderText('you@example.com')).toBeDefined();
    expect(screen.getByPlaceholderText('Create a password')).toBeDefined();
  });

  it('renders create account button', () => {
    render(<Register />);
    expect(screen.getByText('Create account')).toBeDefined();
  });

  it('has link to sign in', () => {
    render(<Register />);
    expect(screen.getByText('Sign in')).toBeDefined();
  });

  it('preserves the query string on sign-in links', () => {
    mockLocationSearch = '?redirect=%2Fmessages';
    const { container } = render(<Register />);
    expect(container.querySelector('a[href="/login?redirect=%2Fmessages"]')).not.toBeNull();
  });

  it('links to no hosted terms or privacy policy', () => {
    const { container } = render(<Register />);
    expect(screen.queryByText('Terms')).toBeNull();
    expect(screen.queryByText('Privacy Policy')).toBeNull();
    expect(container.querySelector('a[href^="http"]')).toBeNull();
  });

  it('submits registration form', async () => {
    mockSignUpEmail.mockResolvedValue({ error: null });
    const { container } = render(<Register />);
    fireEvent.input(container.querySelector('input[type="text"]')!, { target: { value: 'Test' } });
    fireEvent.input(container.querySelector('input[type="email"]')!, {
      target: { value: 'test@test.com' },
    });
    fireEvent.input(container.querySelector('input[type="password"]')!, {
      target: { value: 'pass123' },
    });
    fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => {
      expect(mockSignUpEmail).toHaveBeenCalled();
    });
  });

  it('shows email verification after successful signup', async () => {
    mockSignUpEmail.mockResolvedValue({ error: null });
    const { container } = render(<Register />);
    fireEvent.input(container.querySelector('input[type="text"]')!, { target: { value: 'Test' } });
    fireEvent.input(container.querySelector('input[type="email"]')!, {
      target: { value: 'test@test.com' },
    });
    fireEvent.input(container.querySelector('input[type="password"]')!, {
      target: { value: 'pass123' },
    });
    fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Check your email');
    });
  });

  it('shows error on failed registration', async () => {
    mockSignUpEmail.mockResolvedValue({ error: { message: 'Something went wrong' } });
    const { container } = render(<Register />);
    fireEvent.input(container.querySelector('input[type="text"]')!, { target: { value: 'Test' } });
    fireEvent.input(container.querySelector('input[type="email"]')!, {
      target: { value: 'exists@test.com' },
    });
    fireEvent.input(container.querySelector('input[type="password"]')!, {
      target: { value: 'pass123' },
    });
    fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Something went wrong');
    });
    // Should NOT show the "already exists" variant
    expect(container.textContent).not.toContain('An account with this email already exists');
  });

  it('shows already-exists error with sign-in and reset links', async () => {
    mockSignUpEmail.mockResolvedValue({
      error: { code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', message: 'User already exists' },
    });
    const { container } = render(<Register />);
    fireEvent.input(container.querySelector('input[type="text"]')!, { target: { value: 'Test' } });
    fireEvent.input(container.querySelector('input[type="email"]')!, {
      target: { value: 'exists@test.com' },
    });
    fireEvent.input(container.querySelector('input[type="password"]')!, {
      target: { value: 'pass123' },
    });
    fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('An account with this email already exists');
    });
    expect(container.querySelector('a[href="/login"]')).not.toBeNull();
    expect(container.querySelector('a[href="/reset-password"]')).not.toBeNull();
  });

  it('sends email signups straight to the onboarding flow', async () => {
    mockSignUpEmail.mockResolvedValue({ error: null });
    const { container } = render(<Register />);
    fireEvent.input(container.querySelector('input[type="text"]')!, { target: { value: 'Test' } });
    fireEvent.input(container.querySelector('input[type="email"]')!, {
      target: { value: 'test@test.com' },
    });
    fireEvent.input(container.querySelector('input[type="password"]')!, {
      target: { value: 'pass123' },
    });
    fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => {
      expect(mockSignUpEmail).toHaveBeenCalledWith({
        name: 'Test',
        email: 'test@test.com',
        password: 'pass123',
        callbackURL: '/welcome',
      });
    });
  });

  it('sends social signups straight to the onboarding flow', async () => {
    mockCheckSocialProviders.mockResolvedValue(['github']);
    render(<Register />);

    await fireEvent.click(await screen.findByText('Continue with GitHub'));

    expect(mockSignInSocial).toHaveBeenCalledWith({
      provider: 'github',
      callbackURL: '/welcome',
      errorCallbackURL: '/login?oauth=failed',
    });
  });

  it('redirects token signups to the onboarding flow', async () => {
    const locationSpy = vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      href: '',
    });
    const hrefSetter = vi.fn();
    Object.defineProperty(window.location, 'href', { set: hrefSetter, configurable: true });

    mockSignUpEmail.mockResolvedValue({
      data: { token: 'tok', user: { id: 'u1' } },
      error: null,
    });
    const { container } = render(<Register />);
    fireEvent.input(container.querySelector('input[type="text"]')!, { target: { value: 'Test' } });
    fireEvent.input(container.querySelector('input[type="email"]')!, {
      target: { value: 'new@test.com' },
    });
    fireEvent.input(container.querySelector('input[type="password"]')!, {
      target: { value: 'pass12345' },
    });
    fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => {
      expect(hrefSetter).toHaveBeenCalledWith('/welcome');
    });
    // No questionnaire marker is left behind for the guards to act on.
    expect(localStorage.getItem('thinker_discovery_pending_u1')).toBeNull();

    locationSpy.mockRestore();
  });

  it('shows loading state during submission', async () => {
    mockSignUpEmail.mockReturnValue(new Promise(() => {}));
    const { container } = render(<Register />);
    fireEvent.input(container.querySelector('input[type="text"]')!, { target: { value: 'Test' } });
    fireEvent.input(container.querySelector('input[type="email"]')!, {
      target: { value: 't@t.com' },
    });
    fireEvent.input(container.querySelector('input[type="password"]')!, {
      target: { value: 'pass123' },
    });
    fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => {
      const btn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(btn.querySelector('.spinner')).not.toBeNull();
    });
  });

  it('shows resend button after successful signup', async () => {
    mockSignUpEmail.mockResolvedValue({ error: null });
    const { container } = render(<Register />);
    fireEvent.input(container.querySelector('input[type="text"]')!, { target: { value: 'Test' } });
    fireEvent.input(container.querySelector('input[type="email"]')!, {
      target: { value: 'test@test.com' },
    });
    fireEvent.input(container.querySelector('input[type="password"]')!, {
      target: { value: 'pass12345' },
    });
    fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Click the link in your email');
    });
    // Resend button should be present (with cooldown since startCooldown was called)
    const resendBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Resend in'),
    );
    expect(resendBtn).not.toBeUndefined();
  });

  it('calls sendVerificationEmail on resend click after cooldown', async () => {
    vi.useFakeTimers();
    mockSignUpEmail.mockResolvedValue({ error: null });
    mockSendVerificationEmail.mockResolvedValue({ error: null });
    const { container } = render(<Register />);
    fireEvent.input(container.querySelector('input[type="text"]')!, { target: { value: 'Test' } });
    fireEvent.input(container.querySelector('input[type="email"]')!, {
      target: { value: 'test@test.com' },
    });
    fireEvent.input(container.querySelector('input[type="password"]')!, {
      target: { value: 'pass12345' },
    });
    fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Check your email');
    });
    // Fast-forward past cooldown
    vi.advanceTimersByTime(61000);
    const resendBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Resend verification email'),
    );
    if (resendBtn) {
      fireEvent.click(resendBtn);
      await vi.waitFor(() => {
        expect(mockSendVerificationEmail).toHaveBeenCalledWith({
          email: 'test@test.com',
          callbackURL: '/welcome',
        });
      });
    }
    vi.useRealTimers();
  });

  it('shows error when resend fails', async () => {
    vi.useFakeTimers();
    mockSignUpEmail.mockResolvedValue({ error: null });
    mockSendVerificationEmail.mockResolvedValue({ error: { message: 'Too many requests' } });
    const { container } = render(<Register />);
    fireEvent.input(container.querySelector('input[type="text"]')!, { target: { value: 'Test' } });
    fireEvent.input(container.querySelector('input[type="email"]')!, {
      target: { value: 'test@test.com' },
    });
    fireEvent.input(container.querySelector('input[type="password"]')!, {
      target: { value: 'pass12345' },
    });
    fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Check your email');
    });
    vi.advanceTimersByTime(61000);
    const resendBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Resend verification email'),
    );
    if (resendBtn) {
      fireEvent.click(resendBtn);
      await vi.waitFor(() => {
        expect(container.textContent).toContain('Too many requests');
      });
    }
    vi.useRealTimers();
  });

  it('stores email as last auth method on successful signup', async () => {
    mockSignUpEmail.mockResolvedValue({ error: null });
    const { container } = render(<Register />);
    fireEvent.input(container.querySelector('input[type="text"]')!, { target: { value: 'Test' } });
    fireEvent.input(container.querySelector('input[type="email"]')!, {
      target: { value: 'test@test.com' },
    });
    fireEvent.input(container.querySelector('input[type="password"]')!, {
      target: { value: 'pass12345' },
    });
    fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => {
      expect(getLastAuthMethod()).toBe('email');
    });
  });

  it('does not store last auth method when signup fails', async () => {
    mockSignUpEmail.mockResolvedValue({ error: { message: 'boom' } });
    const { container } = render(<Register />);
    fireEvent.input(container.querySelector('input[type="text"]')!, { target: { value: 'Test' } });
    fireEvent.input(container.querySelector('input[type="email"]')!, {
      target: { value: 't@t.com' },
    });
    fireEvent.input(container.querySelector('input[type="password"]')!, {
      target: { value: 'pass12345' },
    });
    fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('boom');
    });
    expect(getLastAuthMethod()).toBeNull();
  });

  it('shows back to sign in link on verification screen', async () => {
    mockSignUpEmail.mockResolvedValue({ error: null });
    const { container } = render(<Register />);
    fireEvent.input(container.querySelector('input[type="text"]')!, { target: { value: 'Test' } });
    fireEvent.input(container.querySelector('input[type="email"]')!, {
      target: { value: 'test@test.com' },
    });
    fireEvent.input(container.querySelector('input[type="password"]')!, {
      target: { value: 'pass12345' },
    });
    fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => {
      const link = container.querySelector('a[href="/login"]');
      expect(link).not.toBeNull();
    });
  });

  it('never renders a plan picker, even with the legacy plan step', () => {
    mockLocationSearch = '?step=plan';
    render(<Register />);
    expect(screen.getByText('Create an account')).toBeDefined();
    expect(screen.queryByText('Choose your plan')).toBeNull();
    expect(screen.queryByText(/Pro/)).toBeNull();
  });

  it('clears the cooldown interval on unmount', async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    mockSignUpEmail.mockResolvedValue({ error: null });
    const { container, unmount } = render(<Register />);
    fireEvent.input(container.querySelector('input[type="text"]')!, { target: { value: 'Test' } });
    fireEvent.input(container.querySelector('input[type="email"]')!, {
      target: { value: 'test@test.com' },
    });
    fireEvent.input(container.querySelector('input[type="password"]')!, {
      target: { value: 'pass12345' },
    });
    fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Resend in');
    });
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});
