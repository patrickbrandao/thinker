import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';

// Reuses the mock surface from Workspace.test.tsx. Tests here focus on
// AddAgentModal validation edges and the exact shape of the createAgent
// payload, which the happy-path tests don't strictly assert.

const mockNavigate = vi.fn();
vi.mock('react-router', async (orig) => ({
  ...(await orig<object>()),
  useNavigate: () => mockNavigate,
}));

const mockGetAgents = vi.fn();
const mockCreateAgent = vi.fn();
const mockDeleteAgent = vi.fn();
const mockGetGlobalProviders = vi.fn();
vi.mock('../../src/services/api', () => ({
  getAgents: (...args: unknown[]) => mockGetAgents(...args),
  createAgent: (...args: unknown[]) => mockCreateAgent(...args),
  deleteAgent: (...args: unknown[]) => mockDeleteAgent(...args),
  getGlobalProviders: (...args: unknown[]) => mockGetGlobalProviders(...args),
}));

vi.mock('../../src/components/DuplicateAgentModal', () => ({ default: () => null }));

vi.mock('../../src/services/toast-store', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../src/services/formatters', () => ({
  formatNumber: (v: number) => String(v),
  formatCost: (v: number) => `$${v.toFixed(2)}`,
}));

vi.mock('../../src/components/Sparkline', () => ({
  default: () => <div data-testid="sparkline" />,
}));

vi.mock('../../src/services/sse', async () => {
  const { signal } = await import('../../src/lib/signal');
  return {
    pingCount: signal(0),
    messagePing: signal(0),
    analyticsPing: signal(0),
    agentPing: signal(0),
    routingPing: signal(0),
    refreshAgents: vi.fn(),
  };
});

vi.mock('../../src/components/AgentTypeGrid', () => ({
  default: (props: any) => (
    <div
      data-testid="agent-type-picker"
      data-category={props.category ?? ''}
      data-platform={props.platform ?? ''}
      data-disabled={String(!!props.disabled)}
    >
      <button data-testid="pick-app" onClick={() => props.onCategoryChange('app')}>
        App
      </button>
      <button data-testid="pick-langchain" onClick={() => props.onPlatformChange('langchain')}>
        LC
      </button>
    </div>
  ),
}));

const mockHighlightAgent = vi.fn();
vi.mock('../../src/services/recent-agents', async (orig) => {
  const real = await orig<typeof import('../../src/services/recent-agents')>();
  return {
    ...real,
    highlightAgent: (slug: string) => {
      mockHighlightAgent(slug);
      real.highlightAgent(slug);
    },
  };
});

const { MOCK_FREE_PLAN_REQUESTS_PER_MONTH } = vi.hoisted(() => ({
  MOCK_FREE_PLAN_REQUESTS_PER_MONTH: 10_000,
}));

vi.mock('thinker-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('thinker-shared')>()),
  AGENT_CATEGORIES: ['personal', 'app', 'coding'],
  FREE_PLAN_REQUESTS_PER_MONTH: MOCK_FREE_PLAN_REQUESTS_PER_MONTH,
  PLAN_LIMITS: {
    free: { requestsPerMonth: MOCK_FREE_PLAN_REQUESTS_PER_MONTH },
    pro: { requestsPerMonth: null },
  },
  PLATFORM_ICONS: {},
  PLATFORMS_BY_CATEGORY: {
    personal: ['openclaw', 'hermes', 'other'],
    app: ['openai-sdk', 'vercel-ai-sdk', 'langchain', 'other'],
    coding: ['opencode', 'claude-code', 'other'],
  },
  platformIcon: () => undefined,
}));

import Workspace from '../../src/pages/Workspace';

let currentSearch = '';
function SearchProbe() {
  currentSearch = useLocation().search;
  return null;
}
function render(ui: () => React.ReactElement, path = '/harnesses') {
  return rtlRender(
    <MemoryRouter initialEntries={[path]}>
      {ui()}
      <SearchProbe />
    </MemoryRouter>,
  );
}

const openModal = () => {
  const result = render(() => <Workspace />);
  fireEvent.click(screen.getAllByText('Connect Harness')[0]);
  const input = document.querySelector('#agent-name-input') as HTMLInputElement;
  const createBtn = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="dialog"] .floating-window-foot button'),
  ).pop() as HTMLButtonElement;
  return { ...result, input, createBtn };
};

describe('Workspace AddAgentModal - name validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgents.mockResolvedValue({ agents: [] });
    mockCreateAgent.mockResolvedValue({ agent: { name: 'stub' }, apiKey: 'k' });
    mockGetGlobalProviders.mockResolvedValue({ providers: [{ provider: 'openai' }] });
  });

  it('keeps Create disabled while the name is the empty string', () => {
    const { input, createBtn } = openModal();
    expect(input.value).toBe('');
    expect(createBtn.disabled).toBe(true);
  });

  it('keeps Create disabled when the name is only spaces', () => {
    const { input, createBtn } = openModal();
    fireEvent.change(input, { target: { value: '     ' } });
    expect(createBtn.disabled).toBe(true);
  });

  it('keeps Create disabled when the name is only tabs and newlines', () => {
    const { input, createBtn } = openModal();
    fireEvent.change(input, { target: { value: '\t\n\t  ' } });
    expect(createBtn.disabled).toBe(true);
  });

  it('does not call createAgent when the user clicks Create with whitespace only', () => {
    const { input, createBtn } = openModal();
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(createBtn);
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });

  it('does not call createAgent when Enter is pressed with whitespace only', () => {
    const { input } = openModal();
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });

  it('enables Create as soon as a single non-space character is typed', () => {
    const { input, createBtn } = openModal();
    fireEvent.change(input, { target: { value: 'a' } });
    expect(createBtn.disabled).toBe(false);
  });

  it('turns typed text into a DNS name (a-z, 0-9, -)', () => {
    const { input } = openModal();
    fireEvent.change(input, { target: { value: 'My Bot_🚀 1' } });
    expect(input.value).toBe('my-bot-1');
  });

  it('keeps create disabled while the name ends with a hyphen', () => {
    const { input, createBtn } = openModal();
    fireEvent.change(input, { target: { value: 'spaced-out ' } });
    expect(input.value).toBe('spaced-out-');
    expect(createBtn.disabled).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('caps the name at 63 characters, the DNS label limit', async () => {
    const { input, createBtn } = openModal();
    fireEvent.change(input, { target: { value: 'a'.repeat(256) } });
    expect(input.value).toBe('a'.repeat(63));
    fireEvent.click(createBtn);
    await vi.waitFor(() => {
      expect(mockCreateAgent).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'a'.repeat(63) }),
      );
    });
  });
});

describe('Workspace AddAgentModal - exact createAgent payload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgents.mockResolvedValue({ agents: [] });
    mockCreateAgent.mockResolvedValue({ agent: { name: 'demo' }, apiKey: 'k' });
    mockGetGlobalProviders.mockResolvedValue({ providers: [{ provider: 'openai' }] });
  });

  it('submits the default category and platform when the user only types a name', async () => {
    const { input, createBtn } = openModal();
    fireEvent.change(input, { target: { value: 'Demo Agent' } });
    fireEvent.click(createBtn);
    await vi.waitFor(() => {
      expect(mockCreateAgent).toHaveBeenCalledWith({
        name: 'demo-agent',
        agent_category: 'coding',
        agent_platform: 'opencode',
        record_messages: true,
        log_retention_days: null,
      });
    });
    // Strict: nothing else was sneaked in (e.g. recordMessages, displayName).
    const call = mockCreateAgent.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(call).sort()).toEqual([
      'agent_category',
      'agent_platform',
      'log_retention_days',
      'name',
      'record_messages',
    ]);
  });

  it('includes the user-selected category and platform in the payload', async () => {
    const { input, createBtn } = openModal();
    fireEvent.click(document.querySelector('[data-testid="pick-app"]')!);
    fireEvent.click(document.querySelector('[data-testid="pick-langchain"]')!);
    fireEvent.change(input, { target: { value: 'my-langchain-agent' } });
    fireEvent.click(createBtn);
    await vi.waitFor(() => {
      expect(mockCreateAgent).toHaveBeenCalledWith({
        name: 'my-langchain-agent',
        agent_category: 'app',
        agent_platform: 'langchain',
        record_messages: true,
        log_retention_days: null,
      });
    });
  });

  it('rings the slug returned by the server, not the typed name, and stays on the list', async () => {
    mockCreateAgent.mockResolvedValue({ agent: { name: 'demo-agent-1' }, apiKey: 'key-xyz' });
    const { input, createBtn } = openModal();
    fireEvent.change(input, { target: { value: 'Demo Agent' } });
    fireEvent.click(createBtn);
    await vi.waitFor(() => expect(mockHighlightAgent).toHaveBeenCalledWith('demo-agent-1'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('falls back to the typed name when the server omits the slug', async () => {
    mockCreateAgent.mockResolvedValue({ apiKey: 'k' });
    const { input, createBtn } = openModal();
    fireEvent.change(input, { target: { value: 'Fallback Agent' } });
    fireEvent.click(createBtn);
    await vi.waitFor(() => expect(mockHighlightAgent).toHaveBeenCalledWith('fallback-agent'));
  });

  it('does not highlight or navigate when createAgent rejects', async () => {
    mockCreateAgent.mockRejectedValue(new Error('boom'));
    const { input, createBtn } = openModal();
    fireEvent.change(input, { target: { value: 'Demo Agent' } });
    fireEvent.click(createBtn);
    await vi.waitFor(() => {
      expect(mockCreateAgent).toHaveBeenCalled();
    });
    expect(mockHighlightAgent).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
