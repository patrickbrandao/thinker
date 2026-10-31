import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-router', async (orig) => ({
  ...(await orig<object>()),
  useParams: () => ({ agentName: 'test-agent' }),
}));

const mockGetAgentKey = vi.fn();
vi.mock('../../src/services/api', () => ({
  getAgentKey: (...args: unknown[]) => mockGetAgentKey(...args),
}));

vi.mock('../../src/services/api/virtual-models', () => ({
  listVirtualModels: () => Promise.resolve([{ name: 'fast', enabled: true }]),
}));

vi.mock('../../src/components/SetupStepAddProvider', () => ({
  PLATFORM_TO_TOOLKIT: { 'openai-sdk': 'openai' },
  default: (props: any) => (
    <div
      data-testid="setup-add-provider"
      data-platform={props.platform ?? ''}
      data-key-prefix={props.keyPrefix ?? ''}
      data-base-url={props.baseUrl}
    />
  ),
}));

vi.mock('../../src/components/FrameworkSnippets', () => ({
  default: (props: any) => (
    <div data-testid="framework-snippets" data-models={(props.modelOptions ?? []).join(',')} />
  ),
}));

import AgentConnection from '../../src/pages/AgentConnection';
import { setAgentPlatform } from '../../src/services/agent-platform-store';

describe('AgentConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAgentPlatform('openclaw', 'personal');
    mockGetAgentKey.mockResolvedValue({ keyPrefix: 'thk_abc' });
  });

  it('shows the suggested setup for the harness type and the SDK examples', async () => {
    render(<AgentConnection />);
    const setup = await screen.findByTestId('setup-add-provider');
    expect(setup.getAttribute('data-platform')).toBe('openclaw');
    expect(setup.getAttribute('data-key-prefix')).toBe('thk_abc');
    expect(setup.getAttribute('data-base-url')).toMatch(/\/v1$/);
    expect(screen.getByText('Suggested setup')).toBeTruthy();
    expect(screen.getByText('SDK code examples')).toBeTruthy();
    await vi.waitFor(() =>
      expect(screen.getByTestId('framework-snippets').getAttribute('data-models')).toBe('fast'),
    );
  });

  it('skips the separate SDK panel when the setup already is the SDK snippets', async () => {
    setAgentPlatform('openai-sdk', 'app');
    render(<AgentConnection />);
    await screen.findByTestId('setup-add-provider');
    expect(screen.queryByText('SDK code examples')).toBeNull();
  });

  it('warns when the API key cannot load', async () => {
    mockGetAgentKey.mockRejectedValue(new Error('nope'));
    const { container } = render(<AgentConnection />);
    await vi.waitFor(() => expect(container.textContent).toContain('Could not load your API key'));
  });
});
