import {
  getOpenAiReasoningStreamFormat,
  normalizeOpenAiReasoningDelta,
  normalizeOpenAiReasoningMessage,
} from './reasoning-format';

describe('provider reasoning normalization', () => {
  it('lifts Cerebras reasoning into reasoning_content', () => {
    const format = getOpenAiReasoningStreamFormat('cerebras', 'gpt-oss-120b')!;
    const message: Record<string, unknown> = { content: 'hi', reasoning: 'because' };
    normalizeOpenAiReasoningMessage(message, format);
    expect(message.reasoning_content).toBe('because');
    const delta: Record<string, unknown> = { reasoning: 'step' };
    expect(normalizeOpenAiReasoningDelta(delta, format)).toEqual({
      text: 'step',
      normalized: true,
    });
    expect(delta.reasoning_content).toBe('step');
  });

  it('splits Mistral thinking chunks out of content', () => {
    const format = getOpenAiReasoningStreamFormat('mistral', 'magistral-medium')!;
    const message: Record<string, unknown> = {
      content: [
        { type: 'thinking', thinking: [{ type: 'text', text: 'plan' }] },
        { type: 'text', text: 'answer' },
      ],
    };
    normalizeOpenAiReasoningMessage(message, format);
    expect(message).toEqual({ content: 'answer', reasoning_content: 'plan' });
    const delta: Record<string, unknown> = { content: [{ type: 'thinking', thinking: 'x' }] };
    normalizeOpenAiReasoningDelta(delta, format);
    expect(delta).toEqual({ content: '', reasoning_content: 'x' });
  });
});
