import {
  getOpenAiReasoningStreamFormat,
  supportsReasoningContent,
  type ReasoningModelCatalog,
} from '../reasoning-format';

/**
 * Stub catalog standing in for the models.dev sync cache. `undefined` means the
 * catalog has never heard of the model, which is what the family-regex fallback
 * exists for.
 */
function catalogOf(entries: Record<string, boolean>): ReasoningModelCatalog {
  return {
    isReasoningModel: (_endpointKey: string, model: string) => entries[model.toLowerCase()],
  };
}

describe('supportsReasoningContent', () => {
  describe('opencode', () => {
    it('preserves reasoning_content for a OpenCode DeepSeek slug', () => {
      expect(
        supportsReasoningContent(
          'opencode',
          'opencode/deepseek-v4-flash-free',
          catalogOf({ 'opencode/deepseek-v4-flash-free': true }),
        ),
      ).toBe(true);
    });

    it('preserves reasoning_content for a OpenCode codename the catalog marks as reasoning', () => {
      expect(
        supportsReasoningContent(
          'opencode',
          'opencode/big-pickle',
          catalogOf({ 'opencode/big-pickle': true }),
        ),
      ).toBe(true);
    });

    it('strips reasoning_content for OpenCode slugs backed by a translated dialect', () => {
      const catalog = catalogOf({
        'opencode/claude-opus-5': true,
        'opencode/gpt-5.4': true,
        'opencode/gemini-3-pro': true,
        'opencode/grok-4.5': true,
      });
      for (const model of [
        'opencode/claude-opus-5',
        'opencode/gpt-5.4',
        'opencode/gemini-3-pro',
        'opencode/grok-4.5',
      ]) {
        expect(supportsReasoningContent('opencode', model, catalog)).toBe(false);
      }
    });

    it('strips reasoning_content for models the catalog marks as non-reasoning', () => {
      expect(
        supportsReasoningContent(
          'opencode',
          'opencode/kimi-k2',
          catalogOf({ 'opencode/kimi-k2': false }),
        ),
      ).toBe(false);
    });

    it('falls back to the reasoning model families when the catalog is unavailable', () => {
      expect(supportsReasoningContent('opencode', 'opencode/deepseek-v4-flash-free')).toBe(true);
      expect(supportsReasoningContent('opencode', 'opencode/big-pickle')).toBe(false);
    });
  });

  describe('custom providers', () => {
    it('preserves reasoning_content for a Kimi slug the catalog marks as reasoning', () => {
      expect(
        supportsReasoningContent(
          'custom:5000149d-71a2-4741-bc52-6a074096e91c',
          'moonshotai/kimi-k3-free',
          catalogOf({ 'moonshotai/kimi-k3-free': true }),
        ),
      ).toBe(true);
    });

    it('falls back to the reasoning model families for unknown Kimi slugs', () => {
      expect(
        supportsReasoningContent(
          'custom:5000149d-71a2-4741-bc52-6a074096e91c',
          'moonshotai/kimi-k3-free',
        ),
      ).toBe(true);
    });
  });

  describe('existing behaviour', () => {
    it('always preserves on the native deepseek and moonshot endpoints', () => {
      expect(supportsReasoningContent('deepseek', 'deepseek-reasoner')).toBe(true);
      expect(supportsReasoningContent('moonshot', 'kimi-k2.5')).toBe(true);
    });

    it('never preserves on strict OpenAI-compatible endpoints', () => {
      expect(
        supportsReasoningContent(
          'mistral',
          'deepseek-r1-distill',
          catalogOf({ 'deepseek-r1-distill': true }),
        ),
      ).toBe(false);
    });

    it('lets the catalog strip an OpenRouter moonshotai model it marks non-reasoning', () => {
      expect(
        supportsReasoningContent(
          'openrouter',
          'moonshotai/kimi-k2',
          catalogOf({ 'moonshotai/kimi-k2': false }),
        ),
      ).toBe(false);
    });

    it('preserves OpenRouter moonshotai and deepseek slugs', () => {
      expect(supportsReasoningContent('openrouter', 'moonshotai/kimi-k2-thinking')).toBe(true);
      expect(supportsReasoningContent('openrouter', 'deepseek/deepseek-r1')).toBe(true);
    });

    it('preserves the opencode-go reasoning families', () => {
      expect(supportsReasoningContent('opencode-go', 'opencode-go/glm-5')).toBe(true);
      expect(supportsReasoningContent('opencode-go', 'opencode-go/claude-opus-5')).toBe(false);
    });
  });

  describe('stream format', () => {
    it('normalizes reasoning deltas for a OpenCode model the catalog vouches for', () => {
      expect(
        getOpenAiReasoningStreamFormat(
          'opencode',
          'opencode/big-pickle',
          catalogOf({ 'opencode/big-pickle': true }),
        ),
      ).toEqual({
        outputStreamDeltaPaths: ['reasoning_content'],
        clientStreamDeltaPath: 'reasoning_content',
      });
    });

    it('leaves uncatalogued OpenCode codenames without a reasoning stream format', () => {
      expect(getOpenAiReasoningStreamFormat('opencode', 'opencode/big-pickle')).toBeNull();
    });
  });
});
