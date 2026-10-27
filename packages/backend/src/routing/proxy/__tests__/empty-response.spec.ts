import {
  isEmptyResponseFallbackEnabled,
  isEmptySuccessBody,
  isEmptySuccessPayload,
} from '../empty-response';

const zeroUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

describe('isEmptySuccessBody (#129)', () => {
  it('flags an OpenAI chat body with zero tokens and no content', () => {
    expect(
      isEmptySuccessBody({
        choices: [{ index: 0, message: { role: 'assistant', content: '' } }],
        usage: zeroUsage,
      }),
    ).toBe(true);
    expect(isEmptySuccessBody({ choices: [], usage: zeroUsage })).toBe(true);
  });

  it('flags an Anthropic body with zero tokens and no content', () => {
    expect(isEmptySuccessBody({ content: [], usage: { input_tokens: 0, output_tokens: 0 } })).toBe(
      true,
    );
  });

  it('keeps a reply that has content even if usage says zero', () => {
    expect(
      isEmptySuccessBody({
        choices: [{ message: { content: 'hi' } }],
        usage: zeroUsage,
      }),
    ).toBe(false);
    expect(
      isEmptySuccessBody({
        choices: [{ message: { content: null, tool_calls: [{ id: 'x' }] } }],
        usage: zeroUsage,
      }),
    ).toBe(false);
    expect(
      isEmptySuccessBody({
        content: [{ type: 'tool_use', id: 't' }],
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    ).toBe(false);
  });

  it('keeps an empty reply that reports tokens, or one without usage', () => {
    expect(
      isEmptySuccessBody({
        choices: [{ message: { content: '' } }],
        usage: { prompt_tokens: 12, completion_tokens: 0 },
      }),
    ).toBe(false);
    expect(isEmptySuccessBody({ choices: [{ message: { content: '' } }] })).toBe(false);
  });

  it('ignores payloads that are not JSON', () => {
    expect(isEmptySuccessPayload(new TextEncoder().encode('not json').buffer)).toBe(false);
  });

  it('can be turned off', () => {
    expect(isEmptyResponseFallbackEnabled({})).toBe(true);
    expect(isEmptyResponseFallbackEnabled({ THINKER_EMPTY_RESPONSE_FALLBACK: 'false' })).toBe(
      false,
    );
  });
});
