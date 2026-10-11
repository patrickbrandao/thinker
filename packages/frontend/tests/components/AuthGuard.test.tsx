import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@solidjs/testing-library';

const mockNavigate = vi.fn();
let mockLocation = { pathname: '/', search: '' };
let mockSessionData: any = {
  data: { user: { id: 'u1', name: 'Test' } },
  isPending: false,
};

vi.mock('@solidjs/router', () => ({
  useLocation: () => mockLocation,
  useNavigate: () => mockNavigate,
}));

vi.mock('../../src/services/auth-client.js', () => ({
  authClient: {
    useSession: () => () => mockSessionData,
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

  it('redirects to the discovery step when it is still pending for the user', async () => {
    localStorage.setItem('manifest_discovery_pending_u1', '/welcome');
    render(() => (
      <AuthGuard>
        <span>Protected content</span>
      </AuthGuard>
    ));
    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/discovery?next=%2Fwelcome', { replace: true });
    });
  });

  it('does not redirect away from the discovery page itself while pending', async () => {
    localStorage.setItem('manifest_discovery_pending_u1', '/welcome');
    mockLocation = { pathname: '/discovery', search: '?next=%2Fwelcome' };
    render(() => (
      <AuthGuard>
        <span>Protected content</span>
      </AuthGuard>
    ));
    expect(await screen.findByText('Protected content')).toBeDefined();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('lets the MCP consent page through even while onboarding is pending', async () => {
    localStorage.setItem('manifest_discovery_pending_u1', '/welcome');
    mockLocation = { pathname: '/consent', search: '?client_id=c' };
    render(() => (
      <AuthGuard>
        <span>Protected content</span>
      </AuthGuard>
    ));
    expect(await screen.findByText('Protected content')).toBeDefined();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('renders children when session exists', async () => {
    render(() => (
      <AuthGuard>
        <span>Protected content</span>
      </AuthGuard>
    ));
    expect(await screen.findByText('Protected content')).toBeDefined();
  });

  it('does not render children while redirecting to the pending discovery step', async () => {
    localStorage.setItem('manifest_discovery_pending_u1', '/welcome');
    render(() => (
      <AuthGuard>
        <span>Protected content</span>
      </AuthGuard>
    ));
    await vi.waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(screen.queryByText('Protected content')).toBeNull();
  });

  it('renders children after onboarding without any plan redirect', async () => {
    localStorage.setItem('manifest_onboarding_done_u1', '1');
    render(() => (
      <AuthGuard>
        <span>Protected content</span>
      </AuthGuard>
    ));

    expect(await screen.findByText('Protected content')).toBeDefined();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows loading state when session is pending', () => {
    mockSessionData = { data: null, isPending: true };
    const { container } = render(() => (
      <AuthGuard>
        <span>Protected content</span>
      </AuthGuard>
    ));
    expect(container.textContent).toContain('Loading...');
  });

  it('shows loading state when no session data', () => {
    mockSessionData = { data: null, isPending: false };
    const { container } = render(() => (
      <AuthGuard>
        <span>Protected content</span>
      </AuthGuard>
    ));
    expect(container.textContent).toContain('Loading...');
  });

  it('navigates to login when no session', async () => {
    mockSessionData = { data: null, isPending: false };
    render(() => (
      <AuthGuard>
        <span>Protected content</span>
      </AuthGuard>
    ));
    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login?redirect=%2F', { replace: true });
    });
  });

  it('preserves the protected path and query when redirecting to login', async () => {
    mockSessionData = { data: null, isPending: false };
    mockLocation = { pathname: '/messages', search: '?range=30d' };
    render(() => (
      <AuthGuard>
        <span>Protected content</span>
      </AuthGuard>
    ));
    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login?redirect=%2Fmessages%3Frange%3D30d', {
        replace: true,
      });
    });
  });
});
