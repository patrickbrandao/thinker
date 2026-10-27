import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

const mockGetAgents = vi.fn();
vi.mock('../../src/services/api.js', () => ({
  getAgents: () => mockGetAgents(),
}));

const mockSetAgentDisplayName = vi.fn();
vi.mock('../../src/services/agent-display-name.js', () => ({
  setAgentDisplayName: (...args: unknown[]) => mockSetAgentDisplayName(...args),
}));

const mockIsRecentlyCreated = vi.fn((_name: string) => false);
const mockClearRecentAgent = vi.fn();
vi.mock('../../src/services/recent-agents.js', () => ({
  isRecentlyCreated: (name: string) => mockIsRecentlyCreated(name),
  clearRecentAgent: (...args: unknown[]) => mockClearRecentAgent(...args),
}));

vi.mock('../../src/components/ErrorState.jsx', () => ({
  default: (props: any) => (
    <div data-testid="error-state" data-error={String(props.error ?? '')}>
      {props.title || 'Error'}
      <button data-testid="retry" onClick={() => props.onRetry?.()}>
        Retry
      </button>
    </div>
  ),
}));

import AgentGuard from '../../src/components/AgentGuard';

/**
 * AgentGuard is a route layout: it renders the nested route through <Outlet />.
 * The memory router lets a test move to another harness while the guard stays
 * mounted (the agent list is keyed on the :agentName param).
 */
function renderGuard(child = <div data-testid="child">Child content</div>) {
  const router = createMemoryRouter(
    [
      {
        path: '/harnesses/:agentName',
        element: <AgentGuard />,
        children: [{ index: true, element: child }],
      },
    ],
    { initialEntries: ['/harnesses/test-agent'] },
  );
  const result = render(<RouterProvider router={router} />);
  return { ...result, router };
}

describe('AgentGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsRecentlyCreated.mockReturnValue(false);
  });

  it('renders children when agent exists', async () => {
    mockGetAgents.mockResolvedValue({ agents: [{ agent_name: 'test-agent' }] });
    renderGuard();
    await vi.waitFor(() => {
      expect(screen.getByTestId('child')).toBeDefined();
    });
  });

  it('renders NotFound inline when agent does not exist', async () => {
    mockGetAgents.mockResolvedValue({ agents: [{ agent_name: 'other-agent' }] });
    const { container } = renderGuard();
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Page not found');
    });
    expect(container.querySelector('[data-testid="child"]')).toBeNull();
  });

  it('calls getAgents (covers the fetcher path)', async () => {
    mockGetAgents.mockResolvedValue({ agents: [] });
    renderGuard();
    await vi.waitFor(() => {
      expect(mockGetAgents).toHaveBeenCalled();
    });
  });

  it('renders children when isRecentlyCreated returns true even if agent not in list', async () => {
    mockIsRecentlyCreated.mockReturnValue(true);
    mockGetAgents.mockResolvedValue({ agents: [{ agent_name: 'other-agent' }] });
    renderGuard();
    await vi.waitFor(() => {
      expect(screen.getByTestId('child')).toBeDefined();
    });
    expect(mockIsRecentlyCreated).toHaveBeenCalledWith('test-agent');
  });

  it('calls clearRecentAgent when agent is found in the fetched list', async () => {
    mockGetAgents.mockResolvedValue({
      agents: [{ agent_name: 'test-agent', display_name: 'Test Agent' }],
    });
    renderGuard();
    await vi.waitFor(() => {
      expect(mockClearRecentAgent).toHaveBeenCalledWith('test-agent');
    });
    expect(mockSetAgentDisplayName).toHaveBeenCalledWith('Test Agent');
  });

  it('shows the error state with a retry when the list fails to load', async () => {
    mockGetAgents.mockRejectedValueOnce(new Error('boom'));
    renderGuard();
    await vi.waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeDefined();
    });
    mockGetAgents.mockResolvedValueOnce({ agents: [{ agent_name: 'test-agent' }] });
    act(() => screen.getByTestId('retry').click());
    await vi.waitFor(() => {
      expect(screen.getByTestId('child')).toBeDefined();
    });
  });

  it('refetches the agent list when the viewed agent changes', async () => {
    // First load only knows about test-agent; a second agent is created later
    // (e.g. from the sidebar while this guard stays mounted) and must trigger a
    // fresh fetch rather than reusing the stale first-mount list.
    mockGetAgents
      .mockResolvedValueOnce({ agents: [{ agent_name: 'test-agent' }] })
      .mockResolvedValueOnce({
        agents: [{ agent_name: 'test-agent' }, { agent_name: 'new-agent' }],
      });
    mockIsRecentlyCreated.mockImplementation((name: string) => name === 'new-agent');

    const { router } = renderGuard();
    await vi.waitFor(() => {
      expect(mockGetAgents).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('child')).toBeDefined();
    });

    await act(() => router.navigate('/harnesses/new-agent'));

    await vi.waitFor(() => {
      expect(mockGetAgents).toHaveBeenCalledTimes(2);
    });
    // Children stay mounted through the in-flight refetch (no blank flash) and
    // the freshly fetched list resolves the new agent.
    expect(screen.getByTestId('child')).toBeDefined();
    await vi.waitFor(() => {
      expect(mockClearRecentAgent).toHaveBeenCalledWith('new-agent');
    });
  });
});
