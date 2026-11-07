import 'reflect-metadata';
import { EventEmitter } from 'events';

const seenScopes: unknown[] = [];
const seenSignals: Array<AbortSignal | undefined> = [];

jest.mock('../../../common/outbound/outbound-proxy', () => {
  const actual = jest.requireActual('../../../common/outbound/outbound-proxy');
  return {
    ...actual,
    outboundFetch: jest.fn(async (_url: string, init: RequestInit) => {
      seenScopes.push(actual.currentOutboundScope());
      seenSignals.push(init.signal ?? undefined);
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  };
});

import { ProxyController } from '../proxy.controller';

function fakeRes() {
  const res = new EventEmitter() as EventEmitter & Record<string, unknown>;
  res.headersSent = false;
  res.writableEnded = false;
  res.writableFinished = false;
  res.status = jest.fn(() => res);
  res.type = jest.fn(() => res);
  res.send = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function build() {
  const egressScope = { tenantId: 't1', sourceType: 'provider', chain: [], hops: [] };
  const rateLimiter = {
    checkLimit: jest.fn(),
    checkIpLimit: jest.fn(),
    acquireSlot: jest.fn(),
    releaseSlot: jest.fn(),
  };
  const proxyService = {
    resolvePassthroughCredentials: jest
      .fn()
      .mockResolvedValue({ apiKey: 'sk-test', authType: 'api_key', egressScope }),
  };
  const controller = Object.create(ProxyController.prototype) as ProxyController;
  Object.assign(controller, {
    proxyService,
    rateLimiter,
    logger: { warn: jest.fn(), log: jest.fn(), debug: jest.fn() },
  });
  const req = {
    body: { model: 'openai/text-embedding-3-small', input: 'hi' },
    ip: '10.0.0.1',
    ingestionContext: { agentId: 'a1', tenantId: 't1' },
  };
  return { controller, rateLimiter, egressScope, req };
}

describe('ProxyController passthrough routes', () => {
  beforeEach(() => {
    seenScopes.length = 0;
    seenSignals.length = 0;
  });

  it('embeddings leave through the connection egress scope, under the rate limits, with an abort signal', async () => {
    const { controller, rateLimiter, egressScope, req } = build();
    const res = fakeRes();
    await controller.embeddings(req as never, res as never);
    expect(seenScopes).toEqual([egressScope]);
    expect(seenSignals[0]).toBeInstanceOf(AbortSignal);
    expect(rateLimiter.checkLimit).toHaveBeenCalledWith('t1');
    expect(rateLimiter.checkIpLimit).toHaveBeenCalledWith('10.0.0.1');
    expect(rateLimiter.acquireSlot).toHaveBeenCalledWith('t1');
    expect(rateLimiter.releaseSlot).toHaveBeenCalledWith('t1');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('count_tokens to Anthropic also uses the egress scope', async () => {
    const { controller, egressScope, req } = build();
    req.body = { model: 'anthropic/claude-sonnet-4-5', messages: [] } as never;
    const res = fakeRes();
    await controller.countTokens(req as never, res as never);
    expect(seenScopes).toEqual([egressScope]);
    expect(seenSignals[0]).toBeInstanceOf(AbortSignal);
  });
});
