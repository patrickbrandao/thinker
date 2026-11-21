import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-router', async (orig) => ({
  ...(await orig<object>()),
  useParams: () => ({ agentName: 'test-agent' }),
}));
vi.mock('../../src/components/AgentKeysPanel', () => ({
  default: (props: { agentName: string }) => (
    <div data-testid="agent-keys" data-agent={props.agentName} />
  ),
}));

import AgentApiKeys from '../../src/pages/AgentApiKeys';

describe('AgentApiKeys', () => {
  it('shows only the key table of the harness', () => {
    const { container } = render(<AgentApiKeys />);
    expect(screen.getByTestId('agent-keys').getAttribute('data-agent')).toBe('test-agent');
    expect(container.querySelectorAll('.panel')).toHaveLength(0);
  });
});
