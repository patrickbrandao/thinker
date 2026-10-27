import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const mockNavigate = vi.fn();
const mockCheckNeedsSetup = vi.fn();
const mockLocationAssign = vi.fn();
let mockSessionData: any = { data: null, isPending: false };
let mockSearchParams = new URLSearchParams();
let mockLocation = { pathname: '/login', search: '' };

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
  useSearchParams: () => [mockSearchParams, vi.fn()],
}));

vi.mock('../../src/services/auth-client.js', () => ({
  authClient: {
    useSession: () => mockSessionData,
  },
}));

vi.mock('../../src/services/setup-status.js', () => ({
  checkNeedsSetup: (...args: unknown[]) => mockCheckNeedsSetup(...args),
}));

import GuestGuard from '../../src/components/GuestGuard';

/** Builds search params (repeated keys allowed) the way the router would. */
function params(entries: Record<string, string | string[]>): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    for (const v of Array.isArray(value) ? value : [value]) sp.append(key, v);
  }
  return sp;
}

describe('GuestGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockSessionData = { data: null, isPending: false };
    mockSearchParams = new URLSearchParams();
    mockLocation = { pathname: '/login', search: '' };
    mockCheckNeedsSetup.mockResolvedValue(false);
  });

  it('renders children when no session and setup is complete', async () => {
    render(
      <GuestGuard>
        <span>Guest content</span>
      </GuestGuard>,
    );
    await vi.waitFor(() => {
      expect(screen.getByText('Guest content')).not.toBeNull();
    });
  });

  it('ignores a leftover discovery marker and sends the user home', async () => {
    localStorage.setItem('thinker_discovery_pending_u1', '/welcome');
    mockSessionData = {
      data: { user: { id: 'u1', name: 'Test' } },
      isPending: false,
    };
    render(
      <GuestGuard>
        <span>Guest content</span>
      </GuestGuard>,
    );
    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    });
    for (const [path] of mockNavigate.mock.calls) {
      expect(path).not.toContain('/discovery');
    }
  });

  it('redirects to home when session exists', async () => {
    mockSessionData = {
      data: { user: { id: 'u1', name: 'Test' } },
      isPending: false,
    };
    render(
      <GuestGuard>
        <span>Guest content</span>
      </GuestGuard>,
    );
    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  it('redirects authenticated guests to a safe return path first', async () => {
    mockSessionData = {
      data: { user: { id: 'u1', name: 'Test' } },
      isPending: false,
    };
    mockSearchParams = params({ redirect: '/messages?range=30d' });
    render(
      <GuestGuard>
        <span>Guest content</span>
      </GuestGuard>,
    );
    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/messages?range=30d', {
        replace: true,
      });
    });
  });

  it('preserves signed MCP authorization during the authenticated redirect', async () => {
    vi.stubGlobal('location', { assign: mockLocationAssign });
    mockSessionData = {
      data: { user: { id: 'u1', name: 'Test' } },
      isPending: false,
    };
    mockSearchParams = params({
      client_id: 'client',
      redirect_uri: 'http://127.0.0.1/callback',
      ba_param: ['client_id', 'redirect_uri'],
      sig: 'abc',
    });
    mockLocation = {
      pathname: '/login',
      search:
        '?client_id=client&redirect_uri=http%3A%2F%2F127.0.0.1%2Fcallback&ba_param=client_id&ba_param=redirect_uri&sig=abc',
    };
    render(
      <GuestGuard>
        <span>Guest content</span>
      </GuestGuard>,
    );
    await vi.waitFor(() => {
      expect(mockLocationAssign).toHaveBeenCalledWith(
        '/api/auth/oauth2/authorize?client_id=client&redirect_uri=http%3A%2F%2F127.0.0.1%2Fcallback&ba_param=client_id&ba_param=redirect_uri&sig=abc',
      );
    });
    expect(mockNavigate).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('redirects authenticated users home even with the legacy plan step', async () => {
    mockSessionData = {
      data: { user: { id: 'u1', name: 'Test' } },
      isPending: false,
    };
    mockSearchParams = params({ step: ['plan'] });
    render(
      <GuestGuard>
        <span>Guest content</span>
      </GuestGuard>,
    );

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    });
    expect(screen.queryByText('Guest content')).toBeNull();
  });

  it('redirects to /setup when setup is incomplete', async () => {
    mockCheckNeedsSetup.mockResolvedValue(true);
    render(
      <GuestGuard>
        <span>Guest content</span>
      </GuestGuard>,
    );
    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/setup', { replace: true });
    });
  });

  it('does not render children while setup check is pending', () => {
    // checkNeedsSetup hangs — we should see no content rendered yet
    mockCheckNeedsSetup.mockReturnValue(new Promise(() => undefined));
    const { container } = render(
      <GuestGuard>
        <span>Guest content</span>
      </GuestGuard>,
    );
    expect(container.textContent).not.toContain('Guest content');
  });

  it('keeps children mounted when session briefly goes pending after initial render', async () => {
    const tree = (
      <GuestGuard>
        <span>Guest content</span>
      </GuestGuard>
    );
    const { rerender } = render(tree);

    // Wait for children to appear (setup check resolves, session not pending)
    await vi.waitFor(() => {
      expect(screen.getByText('Guest content')).not.toBeNull();
    });

    // Simulate Better Auth triggering a session refetch (isPending goes true)
    mockSessionData = { data: null, isPending: true };
    act(() => rerender(tree));
    // Children should still be mounted
    expect(screen.getByText('Guest content')).not.toBeNull();

    // Session refetch completes with no data
    mockSessionData = { data: null, isPending: false };
    act(() => rerender(tree));
    // Children should still be mounted
    expect(screen.getByText('Guest content')).not.toBeNull();
  });
});
