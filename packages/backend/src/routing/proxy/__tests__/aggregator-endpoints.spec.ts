import { PROVIDER_ENDPOINTS, resolveEndpointKey } from '../provider-endpoints';
import { stripModelPrefix } from '../model-prefix';
import { parseUsageObject } from '../stream-writer';

/** Atlas Cloud, Eden AI and Requesty: OpenAI Chat Completions gateways. */
describe('aggregator provider endpoints', () => {
  it.each([
    ['atlascloud', 'https://api.atlascloud.ai/v1', 'deepseek-ai/deepseek-v4-pro'],
    ['edenai', 'https://api.edenai.run/v3', 'openai/gpt-4o-mini'],
    ['requesty', 'https://router.requesty.ai/v1', 'anthropic/claude-sonnet-5-5'],
  ])('%s forwards to %s/chat/completions with bearer auth', (id, base, model) => {
    const endpoint = PROVIDER_ENDPOINTS[id];
    expect(endpoint.baseUrl).toBe(base);
    expect(endpoint.format).toBe('openai');
    expect(endpoint.streamUsageReporting).toBe('openai_stream_options');
    expect(endpoint.buildPath(model)).toBe('/chat/completions');
    expect(endpoint.buildHeaders('test-key')).toEqual({
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json',
    });
    // Gateway ids are `vendor/model`; the vendor segment must reach the gateway.
    expect(stripModelPrefix(model, id)).toBe(model);
  });

  it('resolves the display-name aliases', () => {
    expect(resolveEndpointKey('Atlas Cloud')).toBe('atlascloud');
    expect(resolveEndpointKey('atlas-cloud')).toBe('atlascloud');
    expect(resolveEndpointKey('Eden AI')).toBe('edenai');
    expect(resolveEndpointKey('eden-ai')).toBe('edenai');
    expect(resolveEndpointKey('requesty')).toBe('requesty');
  });

  it('reads Requesty cache writes from prompt_tokens_details.caching_tokens', () => {
    expect(
      parseUsageObject({
        prompt_tokens: 1200,
        completion_tokens: 40,
        prompt_tokens_details: { cached_tokens: 800, caching_tokens: 300 },
        cost: 0.0042,
      }),
    ).toEqual(
      expect.objectContaining({
        prompt_tokens: 1200,
        cache_read_tokens: 800,
        cache_creation_tokens: 300,
        reported_cost_usd: 0.0042,
      }),
    );
  });
});
