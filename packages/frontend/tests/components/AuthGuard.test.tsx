import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockNavigate = vi.fn();
let mockLocation = { pathname: '/', search: '' };
let mockSessionData: any = {
  data: { user: { id: 'u1', name: 'Test' } },
  isPending: false,
};

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useLocation: () => mockLocation,
  useNavigate: () => mockNavigate,
}));

vi.mock('../../src/services/auth-client.js', () => ({
  authClient: {
    useSession: () => mockSessionData,
  },
}));

import AuthGuard from '../../src/components/AuthGuard';

describe('AuthGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockSessionData = {
      data: { user: { id: 'u1', name: 'Test' } },
      isPending: false,
    };
    mockLocation = { pathname: '/', search: '' };
  });

  it('ignores a leftover discovery marker and renders the app (no post-signup detour)', async () => {
    // Builds before #13 stored this marker after signup/setup to force a
    // questionnaire. It must no longer route anyone anywhere.
    localStorage.setItem('thinker_discovery_pending_u1', '/welcome');
    render(
      <AuthGuard>
        <span>Protected content</span>
      </AuthGuard>,
    );
    expect(await screen.findByText('Protected content')).toBeDefined();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('lets the MCP consent page through with an authenticated session', async () => {
    mockLocation = { pathname: '/consent', search: '?client_id=c' };
    render(
      <AuthGuard>
        <span>Protected content</span>
      </AuthGuard>,
    );
    expect(await screen.findByText('Protected content')).toBeDefined();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('renders children when session exists', async () => {
    render(
      <AuthGuard>
        <span>Protected content</span>
      </AuthGuard>,
    );
    expect(await screen.findByText('Protected content')).toBeDefined();
  });

  it('does not render children while redirecting to login', async () => {
    mockSessionData = { data: null, isPending: false };
    render(
      <AuthGuard>
        <span>Protected content</span>
      </AuthGuard>,
    );
    await vi.waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(screen.queryByText('Protected content')).toBeNull();
  });

  it('renders children after onboarding without any plan redirect', async () => {
    localStorage.setItem('thinker_onboarding_done_u1', '1');
    render(
      <AuthGuard>
        <span>Protected content</span>
      </AuthGuard>,
    );

    expect(await screen.findByText('Protected content')).toBeDefined();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows loading state when session is pending', () => {
    mockSessionData = { data: null, isPending: true };
    const { container } = render(
      <AuthGuard>
        <span>Protected content</span>
      </AuthGuard>,
    );
    expect(container.textContent).toContain('Loading...');
  });

  it('shows loading state when no session data', () => {
    mockSessionData = { data: null, isPending: false };
    const { container } = render(
      <AuthGuard>
        <span>Protected content</span>
      </AuthGuard>,
    );
    expect(container.textContent).toContain('Loading...');
  });

  it('navigates to login when no session', async () => {
    mockSessionData = { data: null, isPending: false };
    render(
      <AuthGuard>
        <span>Protected content</span>
      </AuthGuard>,
    );
    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login?redirect=%2F', { replace: true });
    });
  });

  it('sends an unauthenticated CLI login to /login with its PKCE query intact', async () => {
    // Contract with the CLI login: the approval page keeps port, state and the
    // PKCE challenge through sign-in, or the CLI never receives its code.
    mockSessionData = { data: null, isPending: false };
    const search = '?port=53682&state=st4te&code_challenge=abc123&code_challenge_method=S256';
    mockLocation = { pathname: '/cli/auth', search };
    render(
      <AuthGuard>
        <span>CLI consent</span>
      </AuthGuard>,
    );
    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        `/login?redirect=${encodeURIComponent(`/cli/auth${search}`)}`,
        { replace: true },
      );
    });
    expect(screen.queryByText('CLI consent')).toBeNull();
  });

  it('renders the CLI consent page for an authenticated session', async () => {
    mockLocation = { pathname: '/cli/auth', search: '?port=53682&state=st4te' };
    render(
      <AuthGuard>
        <span>CLI consent</span>
      </AuthGuard>,
    );
    expect(await screen.findByText('CLI consent')).toBeDefined();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('preserves the protected path and query when redirecting to login', async () => {
    mockSessionData = { data: null, isPending: false };
    mockLocation = { pathname: '/messages', search: '?range=30d' };
    render(
      <AuthGuard>
        <span>Protected content</span>
      </AuthGuard>,
    );
    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login?redirect=%2Fmessages%3Frange%3D30d', {
        replace: true,
      });
    });
  });
});
