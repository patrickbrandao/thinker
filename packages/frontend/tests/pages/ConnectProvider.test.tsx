import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

const mockNavigate = vi.fn();

vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useNavigate: () => mockNavigate,
}));

const DEFAULT_SEARCH =
  '?name=Groq&baseUrl=https%3A%2F%2Fapi.groq.com%2Fv1&apiKey=sk-test&models=llama-3.1';

const renderPage = (search = DEFAULT_SEARCH) =>
  render(
    <MemoryRouter initialEntries={[`/connect-provider${search}`]}>
      <Routes>
        <Route path="/connect-provider" element={<ConnectProvider />} />
      </Routes>
    </MemoryRouter>,
  );

const mockGetAgents = vi.fn();
const mockCreateAgent = vi.fn();

vi.mock('../../src/services/api.js', () => ({
  getAgents: (...args: unknown[]) => mockGetAgents(...args),
  createAgent: (...args: unknown[]) => mockCreateAgent(...args),
}));

vi.mock('../../src/services/recent-agents.js', () => ({
  markAgentCreated: vi.fn(),
}));

import ConnectProvider from '../../src/pages/ConnectProvider';

describe('ConnectProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to routing page when exactly one agent exists', async () => {
    mockGetAgents.mockResolvedValue({ agents: [{ agent_name: 'my-agent' }] });

    renderPage();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/harnesses/my-agent/routing?'),
        { replace: true },
      );
    });

    const url = mockNavigate.mock.calls[0][0] as string;
    expect(url).toContain('provider=custom');
    expect(url).toContain('name=Groq');
    expect(url).toContain('baseUrl=');
    expect(url).toContain('apiKey=sk-test');
    expect(url).toContain('models=llama-3.1');
  });

  it('auto-creates an agent when no agents exist', async () => {
    mockGetAgents.mockResolvedValue({ agents: [] });
    mockCreateAgent.mockResolvedValue({ agent: { name: 'my-agent' } });

    renderPage();

    await waitFor(() => {
      expect(mockCreateAgent).toHaveBeenCalledWith({ name: 'my-agent' });
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/harnesses/my-agent/routing?'),
        { replace: true },
      );
    });
  });

  it('shows agent picker when multiple agents exist', async () => {
    mockGetAgents.mockResolvedValue({
      agents: [
        { agent_name: 'agent-1', display_name: 'Agent One' },
        { agent_name: 'agent-2', display_name: 'Agent Two' },
      ],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Select a harness')).toBeDefined();
    });

    expect(screen.getByText('Agent One')).toBeDefined();
    expect(screen.getByText('Agent Two')).toBeDefined();
  });

  it('navigates to selected agent routing page when clicking agent button', async () => {
    mockGetAgents.mockResolvedValue({
      agents: [
        { agent_name: 'agent-1', display_name: 'Agent One' },
        { agent_name: 'agent-2', display_name: 'Agent Two' },
      ],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Agent One')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Agent Two'));

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining('/harnesses/agent-2/routing?'),
      { replace: true },
    );
  });

  it('shows spinner while loading', () => {
    mockGetAgents.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = renderPage();
    expect(container.querySelector('.spinner')).not.toBeNull();
  });

  it('shows spinner when auto-creating agent', async () => {
    mockGetAgents.mockResolvedValue({ agents: [] });
    mockCreateAgent.mockReturnValue(new Promise(() => {})); // never resolves

    const { container } = renderPage();

    await waitFor(() => {
      expect(container.querySelector('.spinner')).not.toBeNull();
    });
  });

  it('recovers from auto-create failure by showing spinner then stopping', async () => {
    mockGetAgents.mockResolvedValue({ agents: [] });
    mockCreateAgent.mockRejectedValue(new Error('fail'));

    const { container } = renderPage();

    await waitFor(() => {
      expect(mockCreateAgent).toHaveBeenCalled();
    });
  });

  it('falls back to agent_name when display_name is missing', async () => {
    mockGetAgents.mockResolvedValue({
      agents: [{ agent_name: 'raw-name-1' }, { agent_name: 'raw-name-2' }],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('raw-name-1')).toBeDefined();
      expect(screen.getByText('raw-name-2')).toBeDefined();
    });
  });

  it('falls back to my-agent slug when createAgent returns no name', async () => {
    mockGetAgents.mockResolvedValue({ agents: [] });
    mockCreateAgent.mockResolvedValue({ agent: {} });

    renderPage();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/harnesses/my-agent/routing?'),
        { replace: true },
      );
    });
  });

  it('handles result with no agents property', async () => {
    mockGetAgents.mockResolvedValue({});
    mockCreateAgent.mockResolvedValue({ agent: { name: 'my-agent' } });

    renderPage();

    await waitFor(() => {
      expect(mockCreateAgent).toHaveBeenCalled();
    });
  });
});

describe('ConnectProvider with provider deep-link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves provider param in redirect URL', async () => {
    mockGetAgents.mockResolvedValue({ agents: [{ agent_name: 'my-agent' }] });

    renderPage('?provider=anthropic');

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/harnesses/my-agent/routing?'),
        { replace: true },
      );
    });

    const url = mockNavigate.mock.calls[0][0] as string;
    expect(url).toContain('provider=anthropic');
    expect(url).not.toContain('provider=custom');
  });
});

describe('ConnectProvider agent name URL encoding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('URL-encodes unsafe characters in agent name for single-agent redirect', async () => {
    const unsafeName = 'test/agent?id=1&x=2#frag';
    mockGetAgents.mockResolvedValue({ agents: [{ agent_name: unsafeName }] });

    renderPage();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });

    const url = mockNavigate.mock.calls[0][0] as string;
    // Verify each unsafe character is percent-encoded in the path segment
    expect(url).toContain('/harnesses/test%2Fagent%3Fid%3D1%26x%3D2%23frag/routing?');
    // Raw unsafe characters must NOT appear in the path segment
    expect(url).not.toContain('/harnesses/test/agent');
    expect(url).not.toMatch(/\/harnesses\/[^/?]*\?id=1/);
    expect(url).not.toMatch(/\/harnesses\/[^/?]*#frag/);
  });

  it('URL-encodes unsafe characters in agent name when clicking picker button', async () => {
    const unsafeName = 'test/agent?id=1';
    mockGetAgents.mockResolvedValue({
      agents: [
        { agent_name: 'agent-1', display_name: 'Agent One' },
        { agent_name: unsafeName, display_name: 'Tricky' },
      ],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Tricky')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Tricky'));

    const url = mockNavigate.mock.calls[0][0] as string;
    expect(url).toContain('/harnesses/test%2Fagent%3Fid%3D1/routing?');
    expect(url).not.toContain('/harnesses/test/agent');
  });

  it('URL-encodes unicode (emoji + non-Latin) agent names', async () => {
    const unicodeName = 'test-🤖-агент';
    mockGetAgents.mockResolvedValue({ agents: [{ agent_name: unicodeName }] });

    renderPage();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });

    const url = mockNavigate.mock.calls[0][0] as string;
    // encodeURIComponent of '🤖' is '%F0%9F%A4%96', cyrillic 'а' is '%D0%B0'
    expect(url).toContain('/harnesses/test-%F0%9F%A4%96-%D0%B0%D0%B3%D0%B5%D0%BD%D1%82/routing?');
    // Raw unicode should not appear in the encoded URL
    expect(url).not.toContain('🤖');
    expect(url).not.toContain('агент');
  });

  it('produces a parseable URL pathname when agent name has unsafe characters', async () => {
    const unsafeName = 'a/b?c=d&e=f#g';
    mockGetAgents.mockResolvedValue({ agents: [{ agent_name: unsafeName }] });

    renderPage();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });

    const url = mockNavigate.mock.calls[0][0] as string;
    // Parsing must recover the original agent name from the path segment
    const parsed = new URL(url, 'http://example.com');
    const match = parsed.pathname.match(/^\/harnesses\/([^/]+)\/routing$/);
    expect(match).not.toBeNull();
    expect(decodeURIComponent(match![1])).toBe(unsafeName);
  });
});
