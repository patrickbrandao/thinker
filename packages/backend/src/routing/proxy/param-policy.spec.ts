import { applyParamPolicy, parseClaudeVersion } from './param-policy';

const anthropic = (model: string) => ({ endpointKey: 'anthropic', format: 'anthropic', model });

describe('parseClaudeVersion', () => {
  it.each([
    ['claude-opus-4-7', { family: 'opus', major: 4, minor: 7 }],
    ['claude-sonnet-4-20250514', { family: 'sonnet', major: 4, minor: 0 }],
    ['anthropic.claude-fable-5-1-v1:0', { family: 'fable', major: 5, minor: 1 }],
    ['claude-3-5-sonnet-latest', { family: 'sonnet', major: 3, minor: 5 }],
    ['claude-opus-5', { family: 'opus', major: 5, minor: 0 }],
  ])('%s', (id, expected) => {
    expect(parseClaudeVersion(id)).toEqual(expected);
  });
});

describe('applyParamPolicy (anthropic)', () => {
  it('drops sampling fields on Claude 4.7+ only', () => {
    const body = { temperature: 0.2, top_p: 0.9, top_k: 5, max_tokens: 10 };
    expect(applyParamPolicy(body, anthropic('claude-opus-4-7'))).toContain(
      'anthropic-sampling-4.7+',
    );
    expect(body).toEqual({ max_tokens: 10 });

    const old = { temperature: 0.2 };
    expect(applyParamPolicy(old, anthropic('claude-sonnet-4-6'))).toEqual([]);
    expect(old).toEqual({ temperature: 0.2 });
  });

  it('downgrades forced tool_choice to auto on Fable/Opus 5.5/Sonnet 5.5', () => {
    const body = { tool_choice: { type: 'any', disable_parallel_tool_use: true } };
    applyParamPolicy(body, anthropic('claude-opus-5-5'));
    expect(body.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });

    const named = { tool_choice: { type: 'tool', name: 'x' } };
    applyParamPolicy(named, anthropic('claude-fable-5-1'));
    expect(named.tool_choice).toEqual({ type: 'auto' });

    const keep = { tool_choice: { type: 'any' } };
    applyParamPolicy(keep, anthropic('claude-opus-5'));
    expect(keep.tool_choice).toEqual({ type: 'any' });
  });

  it('leaves non-Anthropic wire formats alone', () => {
    const body = { temperature: 0.2 };
    applyParamPolicy(body, {
      endpointKey: 'openrouter',
      format: 'openai',
      model: 'claude-opus-4-7',
    });
    expect(body).toEqual({ temperature: 0.2 });
  });
});
