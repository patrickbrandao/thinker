import { ConfigService } from '@nestjs/config';
import { Response as ExpressResponse } from 'express';
import {
  buildFriendlyResponse,
  getDashboardUrl,
  sendFriendlyResponse,
} from '../proxy-friendly-response';

describe('proxy-friendly-response', () => {
  describe('getDashboardUrl', () => {
    const prodConfig = {
      get: jest.fn((key: string) => {
        if (key === 'app.betterAuthUrl') return 'https://app.thinker.example.com';
        return undefined;
      }),
    } as unknown as ConfigService;

    it('returns agent Overview URL when agentName provided without section', () => {
      expect(getDashboardUrl(prodConfig, 'my-agent')).toBe(
        'https://app.thinker.example.com/harnesses/my-agent',
      );
    });

    it('returns agent Routing URL when section is "routing"', () => {
      expect(getDashboardUrl(prodConfig, 'my-agent', 'routing')).toBe(
        'https://app.thinker.example.com/harnesses/my-agent/routing',
      );
    });

    it('returns agent Limits URL when section is "limits"', () => {
      expect(getDashboardUrl(prodConfig, 'my-agent', 'guardrails')).toBe(
        'https://app.thinker.example.com/harnesses/my-agent/guardrails',
      );
    });

    it('returns bare base URL (Workspace) when no agentName', () => {
      expect(getDashboardUrl(prodConfig)).toBe('https://app.thinker.example.com');
    });

    it('ignores section when no agentName is supplied', () => {
      expect(getDashboardUrl(prodConfig, undefined, 'routing')).toBe(
        'https://app.thinker.example.com',
      );
    });

    it('falls back to localhost when no betterAuthUrl configured', () => {
      const config = {
        get: jest.fn((key: string, fallback?: unknown) => {
          if (key === 'app.betterAuthUrl') return undefined;
          if (key === 'app.port') return 4000;
          return fallback;
        }),
      } as unknown as ConfigService;

      expect(getDashboardUrl(config, 'demo', 'routing')).toBe(
        'http://localhost:4000/harnesses/demo/routing',
      );
    });

    it('encodes special characters in agent name', () => {
      const config = {
        get: jest.fn((key: string) => {
          if (key === 'app.betterAuthUrl') return 'http://localhost:2099';
          return undefined;
        }),
      } as unknown as ConfigService;

      expect(getDashboardUrl(config, 'my agent', 'guardrails')).toBe(
        'http://localhost:2099/harnesses/my%20agent/guardrails',
      );
    });
  });

  describe('buildFriendlyResponse', () => {
    it('returns non-streaming chat completion', async () => {
      const result = buildFriendlyResponse('Hello world', false);

      expect(result.forward.response.status).toBe(200);
      expect(result.forward.isGoogle).toBe(false);
      expect(result.forward.isAnthropic).toBe(false);
      expect(result.forward.isChatGpt).toBe(false);
      expect(result.meta.model).toBe('thinker');
      expect(result.meta.provider).toBe('thinker');
      expect(result.meta.confidence).toBe(1);
      expect(result.meta.reason).toBe('thinker_internal_error');
      // The rendered text rides on meta so the recorder can persist it verbatim
      // instead of a generic stand-in.
      expect(result.meta.thinker_error_message).toBe('Hello world');
      expect(result.meta.thinker_error_code).toBeUndefined();

      const json = (await result.forward.response.json()) as Record<string, unknown>;
      expect(json.object).toBe('chat.completion');
      expect((json.id as string).startsWith('chatcmpl-thinker-')).toBe(true);

      const choices = json.choices as { message: { role: string; content: string } }[];
      expect(choices[0].message.role).toBe('assistant');
      expect(choices[0].message.content).toBe('Hello world');
    });

    it('carries the Thinker error code through meta when one is supplied', () => {
      const result = buildFriendlyResponse(
        '[🦚 Thinker M100] No anthropic API key yet.',
        false,
        'no_provider_key',
        'M100',
      );

      expect(result.meta.reason).toBe('no_provider_key');
      expect(result.meta.thinker_error_code).toBe('M100');
      expect(result.meta.thinker_error_message).toBe('[🦚 Thinker M100] No anthropic API key yet.');
    });

    it('returns streaming SSE response', async () => {
      const result = buildFriendlyResponse('Stream test', true);

      expect(result.forward.response.status).toBe(200);
      expect(result.forward.response.headers.get('Content-Type')).toBe('text/event-stream');

      const text = await result.forward.response.text();
      expect(text).toContain('data: {');
      expect(text).toContain('"Stream test"');
      expect(text).toContain('chat.completion.chunk');
      expect(text).toContain('data: [DONE]');
    });

    it('uses custom reason when provided', () => {
      const result = buildFriendlyResponse('test', false, 'no_provider');
      expect(result.meta.reason).toBe('no_provider');
    });
  });

  describe('sendFriendlyResponse', () => {
    let res: jest.Mocked<ExpressResponse>;

    beforeEach(() => {
      res = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        send: jest.fn(),
      } as unknown as jest.Mocked<ExpressResponse>;
    });

    it('escapes HTML metacharacters in the SSE body and sets nosniff', () => {
      sendFriendlyResponse(res, '<script>alert(1)</script> & more', true);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
      const body = res.send.mock.calls[0][0] as string;
      expect(body).not.toMatch(/[<>&]/);
      const frame = body.split('\n\n')[0].replace(/^data: /, '');
      expect(JSON.parse(frame).choices[0].delta.content).toBe('<script>alert(1)</script> & more');
      expect(body.endsWith('data: [DONE]\n\n')).toBe(true);
    });

    it('sets nosniff on the JSON response', () => {
      sendFriendlyResponse(res, 'x', false);
      expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    });

    it('sends non-streaming JSON response', () => {
      sendFriendlyResponse(res, 'Test message', false);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          object: 'chat.completion',
          choices: expect.arrayContaining([
            expect.objectContaining({
              message: { role: 'assistant', content: 'Test message' },
            }),
          ]),
        }),
      );
    });

    it('sends streaming SSE response', () => {
      sendFriendlyResponse(res, 'Stream msg', true);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
      expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
      expect(res.status).toHaveBeenCalledWith(200);

      const payload = res.send.mock.calls[0][0] as string;
      expect(payload).toContain('Stream msg');
      expect(payload).toContain('data: [DONE]');
    });
  });
});
