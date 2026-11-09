import { openAiToolsNeedResponses } from './openai-models';

describe('openAiToolsNeedResponses', () => {
  const tools = [{ type: 'function', function: { name: 'f' } }];

  it('routes GPT-6 Astra / 6.1 Sol / 6.1 Terra tool calls to Responses', () => {
    for (const model of ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-astra-2026-09-03']) {
      expect(openAiToolsNeedResponses(model, { tools })).toBe(true);
    }
  });

  it('keeps GPT-6 Sol / Luna on Chat Completions only with effort none', () => {
    expect(openAiToolsNeedResponses('gpt-6-sol', { tools, reasoning_effort: 'none' })).toBe(false);
    expect(openAiToolsNeedResponses('gpt-6-luna', { tools, reasoning_effort: 'low' })).toBe(true);
    expect(openAiToolsNeedResponses('gpt-6-luna', { tools })).toBe(true);
  });

  it('ignores requests without tools and other models', () => {
    expect(openAiToolsNeedResponses('gpt-6-astra', {})).toBe(false);
    expect(openAiToolsNeedResponses('gpt-6-astra', { tools: [] })).toBe(false);
    expect(openAiToolsNeedResponses('gpt-5.5', { tools })).toBe(false);
  });
});
