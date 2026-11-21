import type { Request } from 'express';
import { ResolveController } from '../resolve.controller';
import type { ResolveService } from '../resolve.service';
import type { IngestionContext } from '../../../otlp/interfaces/ingestion-context.interface';
import type { ResolveRequestDto } from '../../dto/resolve-request.dto';
import type { ResolveResponse } from '../../dto/resolve-response';

type ReqWithCtx = Request & { ingestionContext: IngestionContext };

const ingestionContext: IngestionContext = {
  tenantId: 'tenant-1',
  agentId: 'agent-1',
  agentName: 'test-agent',
  userId: 'user-1',
};

function mockReq(overrides: Partial<IngestionContext> = {}): ReqWithCtx {
  return {
    ingestionContext: { ...ingestionContext, ...overrides },
  } as unknown as ReqWithCtx;
}

const baseResponse: ResolveResponse = {
  tier: 'standard',
  confidence: 0.9,
  score: 5,
  reason: 'scored',
  route: { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
  fallback_routes: null,
};

describe('ResolveController', () => {
  let controller: ResolveController;
  let resolveService: jest.Mocked<Pick<ResolveService, 'resolve'>>;

  beforeEach(() => {
    jest.clearAllMocks();
    resolveService = {
      resolve: jest.fn().mockResolvedValue(baseResponse),
    };
    controller = new ResolveController(resolveService as unknown as ResolveService);
  });

  describe('resolve', () => {
    it('delegates to ResolveService and returns the response', async () => {
      const body: ResolveRequestDto = {
        messages: [{ role: 'user', content: 'hello' }],
      };

      const result = await controller.resolve(body, mockReq());

      expect(result).toBe(baseResponse);
      expect(resolveService.resolve).toHaveBeenCalledTimes(1);
    });

    it('passes agentId from ingestionContext and all body params through', async () => {
      const body: ResolveRequestDto = {
        messages: [{ role: 'user', content: 'route me' }],
        tools: [{ type: 'function', function: { name: 'search' } }],
        tool_choice: 'auto',
        max_tokens: 1024,
        recentTiers: ['simple', 'standard'],
        specificity: 'coding',
      };

      await controller.resolve(body, mockReq());

      expect(resolveService.resolve).toHaveBeenCalledWith(
        'agent-1',
        'tenant-1',
        body.messages,
        body.tools,
        body.tool_choice,
        body.max_tokens,
        body.recentTiers,
        body.specificity,
      );
    });

    it('forwards undefined optional fields when omitted', async () => {
      const body: ResolveRequestDto = {
        messages: [{ role: 'user', content: 'minimal' }],
      };

      await controller.resolve(body, mockReq());

      expect(resolveService.resolve).toHaveBeenCalledWith(
        'agent-1',
        'tenant-1',
        body.messages,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });

    it('uses the agentId from ingestionContext, not the body', async () => {
      const body: ResolveRequestDto = {
        messages: [{ role: 'user', content: 'cross-tenant attempt' }],
      };
      // Even if body somehow carried an agent reference, only ingestionContext
      // wins — the guard is the only authority on tenancy. This pins that
      // contract so a regression that reads agent from the body fails loudly.
      const req = mockReq({ agentId: 'agent-from-context' });

      await controller.resolve(body, req);

      expect(resolveService.resolve).toHaveBeenCalledWith(
        'agent-from-context',
        'tenant-1',
        body.messages,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });

    it('propagates errors thrown by ResolveService', async () => {
      resolveService.resolve.mockRejectedValueOnce(new Error('boom'));
      const body: ResolveRequestDto = {
        messages: [{ role: 'user', content: 'fail' }],
      };
      await expect(controller.resolve(body, mockReq())).rejects.toThrow('boom');
    });
  });

  it('exposes no endpoint that writes connections with a harness key', () => {
    // A harness key (thk_) authenticates this controller. It used to accept
    // POST subscription-providers, which overwrote the organization's
    // subscription token and re-enabled connections an admin had turned off.
    const routes = Object.getOwnPropertyNames(ResolveController.prototype).filter(
      (name) => name !== 'constructor',
    );
    expect(routes).toEqual(['resolve']);
  });
});
