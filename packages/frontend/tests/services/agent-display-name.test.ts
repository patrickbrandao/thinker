import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('agent-display-name', () => {
  beforeEach(() => {
    // Fresh module per test so the signal starts from its initial value.
    vi.resetModules();
  });

  it('initializes with null', async () => {
    const { agentDisplayName } = await import('../../src/services/agent-display-name.js');
    expect(agentDisplayName()).toBeNull();
  });

  it('setAgentDisplayName updates the signal', async () => {
    const { agentDisplayName, setAgentDisplayName } =
      await import('../../src/services/agent-display-name.js');

    setAgentDisplayName('Molly');
    expect(agentDisplayName()).toBe('Molly');
  });

  it('setAgentDisplayName can set back to null', async () => {
    const { agentDisplayName, setAgentDisplayName } =
      await import('../../src/services/agent-display-name.js');

    setAgentDisplayName('Molly');
    expect(agentDisplayName()).toBe('Molly');

    setAgentDisplayName(null);
    expect(agentDisplayName()).toBeNull();
  });

  it('agentDisplayName reflects latest value', async () => {
    const { agentDisplayName, setAgentDisplayName, agentDisplayNameSignal } =
      await import('../../src/services/agent-display-name.js');

    setAgentDisplayName('Alpha');
    expect(agentDisplayName()).toBe('Alpha');

    setAgentDisplayName('Beta');
    expect(agentDisplayName()).toBe('Beta');
    expect(agentDisplayNameSignal()).toBe('Beta');
  });
});
