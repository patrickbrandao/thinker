import { describe, expect, it } from 'vitest';
import {
  buildTopologyGraph,
  expandIpv6,
  ipLines,
  linkWidths,
} from '../../src/pages/topology-adapter';
import type { Topology } from '../../src/services/api/console';

const usage = (requests = 0, errors = 0, recent = 0) => ({
  requests,
  errors,
  costUsd: 0,
  tokens: 0,
  recent,
});

const data: Topology = {
  range: '24h',
  clients: [{ id: 'client:10.0.0.5', ip: '10.0.0.5', requests: 3, errors: 2, recent: 2 }],
  harnesses: [
    { id: 'harness:a', name: 'bot', displayName: null, platform: 'claude-code', ...usage(3) },
    { id: 'harness:b', name: 'idle', displayName: 'Idle bot', platform: null, ...usage() },
  ],
  providers: [
    {
      id: 'connection:c1',
      connectionId: 'c1',
      provider: 'openai',
      authType: 'api_key',
      name: 'openai',
      label: 'Default',
      active: true,
      ...usage(3, 2),
    },
    {
      id: 'connection:c2',
      connectionId: 'c2',
      provider: 'anthropic',
      authType: 'api_key',
      name: 'anthropic',
      label: 'Work',
      active: true,
      ...usage(),
    },
  ],
  proxies: [{ id: 'proxy:p1', profileId: 'p1', name: 'Office', ...usage(3, 2) }],
  egress: [{ id: 'internet', ...usage(3, 2) }],
  links: [
    {
      source: 'client:10.0.0.5',
      target: 'harness:a',
      kind: 'client',
      requests: 3,
      errors: 2,
      costUsd: 0,
      recent: 2,
    },
    {
      source: 'harness:a',
      target: 'connection:c1',
      kind: 'primary',
      requests: 3,
      errors: 2,
      costUsd: 0,
      recent: 0,
      models: [{ via: 'fast', model: 'gpt-4o-mini', kind: 'primary', requests: 3 }],
    },
    {
      source: 'harness:a',
      target: 'connection:c2',
      kind: 'fallback',
      requests: 0,
      errors: 0,
      costUsd: 0,
      recent: 0,
      models: [{ via: 'fast', model: 'claude-haiku', kind: 'fallback', requests: 0 }],
    },
    {
      source: 'connection:c1',
      target: 'proxy:p1',
      kind: 'egress',
      requests: 3,
      errors: 2,
      costUsd: 0,
      recent: 0,
    },
    {
      source: 'connection:c2',
      target: 'internet',
      kind: 'egress',
      requests: 0,
      errors: 0,
      costUsd: 0,
      recent: 0,
    },
    {
      source: 'proxy:p1',
      target: 'internet',
      kind: 'egress',
      requests: 3,
      errors: 2,
      costUsd: 0,
      recent: 1,
    },
  ],
  positions: { 'harness:b': { x: 500, y: 600 } },
};

describe('buildTopologyGraph', () => {
  it('lays out one column per kind, left to right', () => {
    const graph = buildTopologyGraph(data);
    const x = (id: string) => graph.nodes.find((n) => n.id === id)!.position.x;
    expect(x('client:10.0.0.5')).toBeLessThan(x('harness:a'));
    expect(x('harness:a')).toBeLessThan(x('connection:c1'));
    expect(x('connection:c1')).toBeLessThan(x('proxy:p1'));
    expect(x('proxy:p1')).toBeLessThan(x('internet'));
  });

  it('keeps saved positions', () => {
    const graph = buildTopologyGraph(data);
    expect(graph.nodes.find((n) => n.id === 'harness:b')!.position).toEqual({ x: 500, y: 600 });
  });

  it('draws the client inside the node and the others with the name below', () => {
    const graph = buildTopologyGraph(data);
    const client = graph.nodes.find((n) => n.id === 'client:10.0.0.5')!;
    expect(client.type).toBe('source');
    expect(client.data.lines).toEqual(['10.0.0.5']);
    expect(client.data.state).toBe('error');
    const proxy = graph.nodes.find((n) => n.id === 'proxy:p1')!;
    expect(proxy.data.subtitle).toBe('Office');
    const conn = graph.nodes.find((n) => n.id === 'connection:c1')!;
    expect(conn.data.subtitle).toBe('Default');
    expect(conn.data.href).toBe('/providers/connections/c1');
  });

  it('dashes fallbacks and lists the models in the edge tooltip', () => {
    const graph = buildTopologyGraph(data);
    const fallback = graph.edges.find((e) => e.id === 'harness:a>connection:c2')!;
    expect(fallback.data?.dashed).toBe(true);
    expect(fallback.data?.tooltip).toContain('fast → claude-haiku');
    const primary = graph.edges.find((e) => e.id === 'harness:a>connection:c1')!;
    expect(primary.data?.label).toBe('3');
    expect(primary.data?.state).toBe('error');
  });

  it('colors borders by traffic and errors', () => {
    const graph = buildTopologyGraph({
      ...data,
      harnesses: [{ ...data.harnesses[0]!, ...usage(3, 0) }, data.harnesses[1]!],
    });
    const state = (id: string) => graph.nodes.find((n) => n.id === id)!.data.state;
    expect(state('harness:a')).toBe('active');
    expect(state('harness:b')).toBe('idle');
    expect(state('connection:c1')).toBe('error');
  });

  it('draws an arrow only into the harness and sizes lines by the last minute', () => {
    const graph = buildTopologyGraph(data);
    const edge = (id: string) => graph.edges.find((e) => e.id === id)!.data!;
    expect(edge('client:10.0.0.5>harness:a').arrow).toBe(true);
    expect(edge('harness:a>connection:c1').arrow).toBe(false);
    expect(edge('client:10.0.0.5>harness:a').width).toBeCloseTo(6.4);
    expect(edge('proxy:p1>internet').width).toBeCloseTo(4);
    expect(edge('harness:a>connection:c1').width).toBeCloseTo(1.6);
  });

  it('leaves out what carried no traffic with activeOnly', () => {
    const ids = buildTopologyGraph(data, { activeOnly: true }).nodes.map((n) => n.id);
    expect(ids).toContain('proxy:p1');
    expect(ids).not.toContain('harness:b');
    expect(ids).not.toContain('connection:c2');
  });
});

describe('linkWidths', () => {
  it('keeps the base width when every link carries the same', () => {
    expect(linkWidths([0, 0])(0)).toBe(1.6);
    expect(linkWidths([5, 5])(5)).toBe(1.6);
    expect(linkWidths([2, 10])(10)).toBeCloseTo(6.4);
  });
});

describe('ip lines', () => {
  it('expands IPv6 without compression and keeps leading zeros', () => {
    expect(expandIpv6('2804:14::1')).toEqual([
      '2804',
      '0014',
      '0000',
      '0000',
      '0000',
      '0000',
      '0000',
      '0001',
    ]);
    expect(expandIpv6('::ffff:1.2.3.4')).toEqual([
      '0000',
      '0000',
      '0000',
      '0000',
      '0000',
      'ffff',
      '0102',
      '0304',
    ]);
    expect(expandIpv6('1::2::3')).toBeNull();
  });

  it('splits IPv6 in two lines of four groups and shows mapped IPv4 plainly', () => {
    expect(ipLines('2804:14:abcd:1::1')).toEqual(['2804:0014:abcd:0001', '0000:0000:0000:0001']);
    expect(ipLines('::ffff:203.0.113.7')).toEqual(['203.0.113.7']);
    expect(ipLines('fe80::1%en0')).toHaveLength(2);
    expect(ipLines('10.0.0.5')).toEqual(['10.0.0.5']);
  });
});
