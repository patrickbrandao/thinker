import { describe, expect, it } from 'vitest';
import { buildTopologyGraph } from '../../src/pages/topology-adapter';
import type { Topology } from '../../src/services/api/console';

const usage = (requests = 0, errors = 0) => ({ requests, errors, costUsd: 0, tokens: 0 });

const data: Topology = {
  range: '24h',
  harnesses: [
    { id: 'harness:a', name: 'bot', displayName: null, platform: 'claude-code', ...usage(3) },
    { id: 'harness:b', name: 'idle', displayName: 'Idle bot', platform: null, ...usage() },
  ],
  hubs: [
    {
      id: 'auto:a',
      kind: 'auto',
      agentId: 'a',
      agentName: 'bot',
      name: 'auto',
      enabled: true,
      ...usage(),
    },
    {
      id: 'virtual:v',
      kind: 'virtual',
      agentId: 'a',
      agentName: 'bot',
      name: 'fast',
      enabled: true,
      ...usage(3, 2),
    },
    {
      id: 'auto:b',
      kind: 'auto',
      agentId: 'b',
      agentName: 'idle',
      name: 'auto',
      enabled: true,
      ...usage(),
    },
  ],
  providers: [
    {
      id: 'provider:openai:api_key',
      provider: 'openai',
      authType: 'api_key',
      name: 'openai',
      connections: [
        { id: 'c1', label: 'Default', active: true },
        { id: 'c2', label: 'Backup', active: true },
      ],
      models: ['gpt-4o-mini'],
      ...usage(3, 2),
    },
    {
      id: 'provider:anthropic:api_key',
      provider: 'anthropic',
      authType: 'api_key',
      name: 'anthropic',
      connections: [{ id: 'c3', label: 'Default', active: true }],
      models: [],
      ...usage(),
    },
  ],
  links: [
    { source: 'harness:a', target: 'auto:a', kind: 'entry', requests: 0, errors: 0 },
    { source: 'harness:a', target: 'virtual:v', kind: 'entry', requests: 3, errors: 2 },
    { source: 'harness:b', target: 'auto:b', kind: 'entry', requests: 0, errors: 0 },
    {
      source: 'virtual:v',
      target: 'provider:openai:api_key',
      kind: 'primary',
      requests: 3,
      errors: 2,
    },
    {
      source: 'virtual:v',
      target: 'provider:anthropic:api_key',
      kind: 'fallback',
      requests: 0,
      errors: 0,
    },
    { source: 'auto:a', target: 'provider:ghost:api_key', kind: 'usage', requests: 1, errors: 0 },
  ],
};

describe('buildTopologyGraph', () => {
  it('maps harnesses, routing points and providers to flow nodes', () => {
    const graph = buildTopologyGraph(data);
    const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
    expect(byId['harness:a'].data).toMatchObject({ kind: 'entry', href: '/harnesses/bot' });
    expect(byId['harness:b'].data.title).toBe('Idle bot');
    expect(byId['virtual:v'].data).toMatchObject({ kind: 'hub', href: '/harnesses/bot/routing' });
    // Several connections make a pool; one connection links straight to it.
    expect(byId['provider:openai:api_key'].data).toMatchObject({ kind: 'group', count: 2 });
    expect(byId['provider:anthropic:api_key'].data).toMatchObject({
      kind: 'item',
      href: '/providers/connections/c3',
    });
  });

  it('colors links by kind, animates traffic and flags mostly failing links', () => {
    const graph = buildTopologyGraph(data);
    const edge = (id: string) => graph.edges.find((e) => e.id === id)!;
    expect(edge('virtual:v>provider:openai:api_key').data).toMatchObject({
      port: 1,
      live: 3,
      label: '3',
      state: 'error',
    });
    expect(edge('virtual:v>provider:anthropic:api_key').data).toMatchObject({ port: 2, live: 0 });
    expect(edge('harness:a>virtual:v').data?.port).toBeUndefined();
    // A link to a node that is not in the payload is dropped.
    expect(graph.edges.some((e) => e.target === 'provider:ghost:api_key')).toBe(false);
  });

  it('keeps only nodes and links with traffic when asked', () => {
    const graph = buildTopologyGraph(data, { activeOnly: true });
    expect(graph.nodes.map((n) => n.id).sort()).toEqual([
      'auto:a',
      'harness:a',
      'provider:openai:api_key',
      'virtual:v',
    ]);
    expect(graph.edges.map((e) => e.id).sort()).toEqual([
      'harness:a>virtual:v',
      'virtual:v>provider:openai:api_key',
    ]);
  });
});
