import { countTokensBody, passthroughUrl, resolvePassthroughTarget } from './passthrough';

describe('passthrough routes', () => {
  it('resolves provider/model and bare model ids', () => {
    const prefixed = resolvePassthroughTarget('openai/text-embedding-3-small')!;
    expect(prefixed.provider).toBe('openai');
    expect(prefixed.model).toBe('text-embedding-3-small');
    expect(passthroughUrl(prefixed, 'embeddings')).toBe('https://api.openai.com/v1/embeddings');
    expect(passthroughUrl(prefixed, 'transcriptions')).toBe(
      'https://api.openai.com/v1/audio/transcriptions',
    );
    const claude = resolvePassthroughTarget('claude-opus-5-5')!;
    expect(claude.provider).toBe('anthropic');
    expect(passthroughUrl(claude, 'count_tokens')).toBe(
      'https://api.anthropic.com/v1/messages/count_tokens',
    );
    expect(passthroughUrl(claude, 'embeddings')).toBeNull();
  });

  it('rejects ids no provider claims', () => {
    expect(resolvePassthroughTarget('auto')).toBeNull();
    expect(resolvePassthroughTarget('')).toBeNull();
  });

  it('keeps only the fields count_tokens accepts', () => {
    expect(
      countTokensBody(
        { model: 'x', messages: [], max_tokens: 10, stream: true, system: 's' },
        'claude-opus-5-5',
      ),
    ).toEqual({ model: 'claude-opus-5-5', messages: [], system: 's' });
  });
});
