import { ProviderModelFetcherService } from './provider-model-fetcher.service';

/**
 * Discovery parsers of the OpenAI-compatible aggregators Atlas Cloud, Eden AI
 * and Requesty. Fixtures are trimmed entries of each public `/models` catalog
 * (seen 2026-11-12, see docs/externos/api/api-<id>.md); no live calls.
 */
describe('ProviderModelFetcherService aggregators', () => {
  let service: ProviderModelFetcherService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new ProviderModelFetcherService();
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const respond = (body: unknown) =>
    fetchSpy.mockResolvedValue({ ok: true, json: async () => body });

  describe('atlascloud', () => {
    it('parses the {code, msg, data} catalog with per-token string prices and drops image models', async () => {
      respond({
        code: 200,
        msg: 'succeed',
        data: [
          {
            id: 'deepseek-ai/deepseek-v4-pro',
            name: 'DeepSeek V4 Pro',
            object: 'model',
            context_length: 1048576,
            max_output_length: 393216,
            input_modalities: ['text'],
            output_modalities: ['text'],
            supported_features: ['json_mode', 'tools', 'structured_outputs', 'reasoning'],
            pricing: {
              prompt: '0.00000168',
              completion: '0.00000338',
              image: '0',
              request: '0',
              input_cache_read: '0.00000013',
            },
          },
          {
            id: 'anthropic/claude-sonnet-4.5-20250929',
            name: 'Claude Sonnet 4.5 20250929',
            context_length: 200000,
            input_modalities: ['text', 'image'],
            output_modalities: ['text'],
            pricing: {
              prompt: '0.000003',
              completion: '0.000015',
              input_cache_read: '0.0000003',
              overrides: [
                {
                  prompt: '0.000006',
                  completion: '0.0000225',
                  input_cache_read: '0.0000006',
                  min_context: 200000,
                },
              ],
            },
          },
          {
            id: 'openai/gpt-image-2',
            output_modalities: ['text'],
            pricing: { prompt: '0.000005', completion: '0.00004' },
          },
          {
            id: 'google/gemini-3.1-flash-image',
            output_modalities: ['text'],
            pricing: { prompt: '0.0000005', completion: '0.000003' },
          },
          { name: 'no id' },
        ],
      });

      const result = await service.fetch('atlascloud', 'apikey-test');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.atlascloud.ai/v1/models',
        expect.objectContaining({ headers: { Authorization: 'Bearer apikey-test' } }),
      );
      expect(result.map((m) => m.id)).toEqual([
        'deepseek-ai/deepseek-v4-pro',
        'anthropic/claude-sonnet-4.5-20250929',
      ]);
      expect(result[0]).toEqual(
        expect.objectContaining({
          displayName: 'DeepSeek V4 Pro',
          provider: 'atlascloud',
          contextWindow: 1048576,
          inputPricePerToken: 0.00000168,
          outputPricePerToken: 0.00000338,
          cacheReadPricePerToken: 0.00000013,
          capabilityReasoning: true,
          capabilityCode: true,
          inputModalities: ['text'],
        }),
      );
      expect(result[0].longContextPricing).toBeUndefined();
      expect(result[1]).toEqual(
        expect.objectContaining({
          capabilityReasoning: false,
          capabilityCode: false,
          inputModalities: ['text', 'image'],
          longContextPricing: {
            thresholdTokens: 200000,
            inputPricePerToken: 0.000006,
            outputPricePerToken: 0.0000225,
            cacheReadPricePerToken: 0.0000006,
          },
        }),
      );
    });

    it('returns no models for an unexpected body', async () => {
      respond({ code: 401, msg: 'invalid token' });
      expect(await service.fetch('atlascloud', 'apikey-test')).toEqual([]);
    });
  });

  describe('edenai', () => {
    it('parses LiteLLM-style prices, cache rates, long-context tiers and capabilities', async () => {
      respond({
        object: 'list',
        data: [
          {
            id: 'openai/gpt-4o-mini',
            object: 'model',
            owned_by: 'openai',
            context_length: 128000,
            max_output_tokens: 16384,
            capabilities: {
              input_modalities: ['text', 'image', 'file'],
              output_modalities: ['text'],
              supports_reasoning: false,
              supports_function_calling: true,
              supports_prompt_caching: true,
            },
            pricing: {
              input_cost_per_token: 1.5e-7,
              output_cost_per_token: 6e-7,
              cache_read_input_token_cost: 7.5e-8,
            },
          },
          {
            id: 'xai/grok-4.7',
            context_length: 2000000,
            capabilities: {
              input_modalities: ['text'],
              output_modalities: ['text'],
              supports_reasoning: true,
              supports_function_calling: false,
            },
            pricing: {
              input_cost_per_token: 2e-6,
              output_cost_per_token: 6e-6,
              cache_read_input_token_cost: 5e-7,
              cache_creation_input_token_cost: 2.5e-6,
              search_context_cost_per_query: { search_context_size_low: 0.005 },
              provider_specific_entry: { us: 1.1 },
              input_cost_per_token_above_200k_tokens: 4e-6,
              output_cost_per_token_above_200k_tokens: 1.2e-5,
              cache_read_input_token_cost_above_200k_tokens: 1e-6,
            },
          },
          {
            id: 'google/gemini-3-pro-image',
            capabilities: { output_modalities: ['image', 'text'] },
            pricing: { input_cost_per_token: 2e-6, output_cost_per_token: 1.2e-5 },
          },
          { id: 'mystery/model', capabilities: null, pricing: null },
        ],
      });

      const result = await service.fetch('edenai', 'sk-eden-test');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.edenai.run/v3/models',
        expect.objectContaining({ headers: { Authorization: 'Bearer sk-eden-test' } }),
      );
      expect(result.map((m) => m.id)).toEqual([
        'openai/gpt-4o-mini',
        'xai/grok-4.7',
        'mystery/model',
      ]);
      expect(result[0]).toEqual(
        expect.objectContaining({
          provider: 'edenai',
          contextWindow: 128000,
          inputPricePerToken: 1.5e-7,
          outputPricePerToken: 6e-7,
          cacheReadPricePerToken: 7.5e-8,
          capabilityReasoning: false,
          capabilityCode: true,
          inputModalities: ['text', 'image'],
          capabilities: ['text', 'image', 'stream', 'tools'],
        }),
      );
      expect(result[0].cacheWritePricePerToken).toBeUndefined();
      expect(result[1]).toEqual(
        expect.objectContaining({
          cacheWritePricePerToken: 2.5e-6,
          capabilityReasoning: true,
          capabilityCode: false,
          longContextPricing: {
            thresholdTokens: 200000,
            inputPricePerToken: 4e-6,
            outputPricePerToken: 1.2e-5,
            cacheReadPricePerToken: 1e-6,
          },
        }),
      );
      // Missing capabilities and prices: unknown, never free.
      expect(result[2]).toEqual(
        expect.objectContaining({
          inputPricePerToken: null,
          outputPricePerToken: null,
          capabilityCode: false,
          contextWindowSource: 'default',
        }),
      );
    });
  });

  describe('requesty', () => {
    it('parses numeric per-token prices, cache read/write, tiers and supports_* flags', async () => {
      const now = Math.floor(Date.now() / 1000);
      respond({
        object: 'list',
        data: [
          {
            api: 'chat',
            id: 'anthropic/claude-sonnet-5-5',
            input_price: 2e-6,
            caching_price: 2.5e-6,
            cached_price: 1e-7,
            output_price: 1e-5,
            pricing: [
              {
                prompt_tokens_threshold: 0,
                input_price: 2e-6,
                caching_price: 2.5e-6,
                cached_price: 1e-7,
                output_price: 1e-5,
              },
            ],
            max_output_tokens: 128000,
            context_window: 1000000,
            supports_vision: true,
            supports_reasoning: true,
            supports_tool_calling: true,
          },
          {
            api: 'chat',
            id: 'openai/gpt-6.1-terra:flex',
            input_price: 5e-7,
            cached_price: 2.5e-8,
            caching_price: 1.25e-6,
            output_price: 2.5e-6,
            pricing: [
              {
                prompt_tokens_threshold: 272000,
                input_price: 1e-6,
                caching_price: 1.25e-6,
                cached_price: 5e-8,
                output_price: 3.75e-6,
              },
              {
                prompt_tokens_threshold: 0,
                input_price: 5e-7,
                output_price: 2.5e-6,
              },
            ],
            context_window: 1050000,
            supports_vision: false,
            supports_reasoning: true,
            supports_tool_calling: false,
            retires: now + 86400,
          },
          { api: 'chat', id: 'openai/gpt-4o-retired', input_price: 1e-6, retires: now - 60 },
          {
            api: 'chat',
            id: 'google/gemini-3.1-flash-image',
            supports_image_generation: true,
            input_price: 5e-7,
            output_price: 3e-6,
          },
          { api: 'embedding', id: 'openai/text-embedding-3-small', input_price: 2e-8 },
        ],
      });

      const result = await service.fetch('requesty', 'rq-test-key');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://router.requesty.ai/v1/models',
        expect.objectContaining({ headers: { Authorization: 'Bearer rq-test-key' } }),
      );
      expect(result.map((m) => m.id)).toEqual([
        'anthropic/claude-sonnet-5-5',
        'openai/gpt-6.1-terra:flex',
      ]);
      expect(result[0]).toEqual(
        expect.objectContaining({
          provider: 'requesty',
          contextWindow: 1000000,
          inputPricePerToken: 2e-6,
          outputPricePerToken: 1e-5,
          cacheReadPricePerToken: 1e-7,
          cacheWritePricePerToken: 2.5e-6,
          capabilityReasoning: true,
          capabilityCode: true,
          inputModalities: ['text', 'image'],
          capabilities: ['text', 'image', 'stream', 'tools'],
        }),
      );
      expect(result[0].longContextPricing).toBeUndefined();
      expect(result[1]).toEqual(
        expect.objectContaining({
          capabilityCode: false,
          inputModalities: ['text'],
          longContextPricing: {
            thresholdTokens: 272000,
            inputPricePerToken: 1e-6,
            outputPricePerToken: 3.75e-6,
            cacheReadPricePerToken: 5e-8,
            cacheWritePricePerToken: 1.25e-6,
          },
        }),
      );
    });
  });
});
