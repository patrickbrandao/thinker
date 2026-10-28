/**
 * Verifies the LIVE-UPDATE requirement: the provider pages' usage resource
 * must re-fetch when the SSE ping signals change, so a newly ingested message
 * (analyticsPing) or a provider connect/disconnect/rename (routingPing) refreshes
 * the stats. The ping mocks are real signals and the test asserts the usage
 * endpoint is re-invoked when either bumps; config (the cheap endpoint) must
 * NOT re-fetch on pings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const mocks = vi.hoisted(() => ({
  getGlobalProviders: vi.fn(),
  getProviderUsage: vi.fn(),
  getAgents: vi.fn(),
  getAgentProviders: vi.fn(),
  getCustomProviders: vi.fn(),
}));

vi.mock('../../src/services/api/providers.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/api/providers')>(
    '../../src/services/api/providers',
  );
  return {
    getProviders: (...a: unknown[]) => mocks.getGlobalProviders(...a),
    getProviderUsage: (...a: unknown[]) => mocks.getProviderUsage(...a),
    connectionUsage: () => undefined,
    mergeUsage: actual.mergeUsage,
  };
});

vi.mock('../../src/services/api.js', () => ({
  getAgents: (...a: unknown[]) => mocks.getAgents(...a),
  getProviders: (...a: unknown[]) => mocks.getAgentProviders(...a),
  getCustomProviders: (...a: unknown[]) => mocks.getCustomProviders(...a),
}));

vi.mock('../../src/services/api/routing.js', () => ({
  renameProviderKey: vi.fn(),
}));

vi.mock('../../src/services/sse.js', async () => {
  const { signal } = await import('../../src/lib/signal');
  return { analyticsPing: signal(0), routingPing: signal(0) };
});

vi.mock('../../src/components/ProviderIcon.jsx', () => ({
  providerIcon: () => null,
}));
vi.mock('../../src/components/Sparkline.jsx', () => ({ default: () => null }));

import Byok from '../../src/pages/providers/Byok';
import { analyticsPing, routingPing } from '../../src/services/sse';

describe('provider usage live updates', () => {
  beforeEach(() => {
    analyticsPing.set(0);
    routingPing.set(0);
    mocks.getGlobalProviders.mockResolvedValue({
      providers: [
        {
          provider: 'openai',
          auth_type: 'api_key',
          connection_count: 1,
          connections: [
            {
              id: 'c1',
              label: 'Default',
              key_prefix: null,
              priority: 0,
              connected_at: '2026-01-01',
              models_fetched_at: null,
              cached_model_count: 1,
              is_active: true,
            },
          ],
          total_models: 1,
        },
      ],
      model_counts: {},
    });
    mocks.getProviderUsage.mockResolvedValue({ providers: [] });
    mocks.getAgents.mockResolvedValue({ agents: [{ agent_name: 'demo' }] });
    mocks.getAgentProviders.mockResolvedValue([]);
    mocks.getCustomProviders.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('re-fetches usage on analyticsPing and routingPing, but not config', async () => {
    render(
      <MemoryRouter>
        <Byok />
      </MemoryRouter>,
    );

    await waitFor(() => expect(mocks.getProviderUsage).toHaveBeenCalledTimes(1));
    expect(mocks.getGlobalProviders).toHaveBeenCalledTimes(1);

    // Coalesced message activity bumps analyticsPing → usage refetch.
    act(() => analyticsPing.set(1));
    await waitFor(() => expect(mocks.getProviderUsage).toHaveBeenCalledTimes(2));

    // A provider change bumps routingPing → usage refetch.
    act(() => routingPing.set(1));
    await waitFor(() => expect(mocks.getProviderUsage).toHaveBeenCalledTimes(3));

    // Config is the cheap endpoint; pings must not trigger it.
    expect(mocks.getGlobalProviders).toHaveBeenCalledTimes(1);
  });
});
