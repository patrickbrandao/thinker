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

describe('applyParamPolicy (lot F)', () => {
  const ctx = (
    endpointKey: string,
    model: string,
    format = 'openai',
    source?: Record<string, unknown>,
  ) => ({
    endpointKey,
    format,
    model,
    source,
  });

  it('drops Ollama Cloud unsupported fields and tool_choice', () => {
    const body = { user: 'u', n: 2, logprobs: true, tool_choice: 'required', model: 'm' };
    applyParamPolicy(body, ctx('ollama-cloud', 'gpt-oss:120b'));
    expect(body).toEqual({ model: 'm' });
  });

  it('drops Groq unsupported fields and message names', () => {
    const body = { logprobs: true, n: 2, messages: [{ role: 'user', name: 'bob', content: 'hi' }] };
    applyParamPolicy(body, ctx('groq', 'llama-4'));
    expect(body).toEqual({ messages: [{ role: 'user', content: 'hi' }] });
    const one = { n: 1 };
    applyParamPolicy(one, ctx('groq', 'llama-4'));
    expect(one).toEqual({ n: 1 });
  });

  it('pins Kimi K3 params and maps effort from the source', () => {
    const body: Record<string, unknown> = {
      temperature: 0.2,
      top_p: 0.5,
      thinking: { type: 'enabled' },
    };
    applyParamPolicy(
      body,
      ctx('moonshot', 'kimi-k3.1-pro', 'openai', { reasoning_effort: 'medium' }),
    );
    expect(body).toEqual({ reasoning_effort: 'high' });
  });

  it('maps effort none to thinking disabled on Kimi K2.6', () => {
    const body: Record<string, unknown> = { temperature: 0.2 };
    applyParamPolicy(body, ctx('moonshot', 'kimi-k2.6', 'openai', { reasoning_effort: 'none' }));
    expect(body).toEqual({ thinking: { type: 'disabled' } });
    const tools: Record<string, unknown> = { tools: [{}], tool_choice: 'required' };
    applyParamPolicy(tools, ctx('moonshot', 'kimi-k2.7-code'));
    expect(tools.tool_choice).toBe('auto');
  });

  it('drops Gemini 3.6+ sampling, inside the CodeAssist envelope too', () => {
    const body = { generationConfig: { temperature: 0.2, topP: 1, maxOutputTokens: 5 } };
    applyParamPolicy(body, ctx('google', 'gemini-3.6-flash', 'google'));
    expect(body.generationConfig).toEqual({ maxOutputTokens: 5 });
    const wrapped = { request: { generationConfig: { temperature: 0.2, candidateCount: 1 } } };
    applyParamPolicy(wrapped, ctx('gemini-subscription', 'gemini-3-pro', 'google'));
    expect(wrapped.request.generationConfig).toEqual({ temperature: 0.2 });
    const old = { generationConfig: { temperature: 0.2 } };
    applyParamPolicy(old, ctx('google', 'gemini-2.5-pro', 'google'));
    expect(old.generationConfig).toEqual({ temperature: 0.2 });
  });

  it('drops penalties and stop on xAI reasoning models', () => {
    const body = { stop: ['x'], presence_penalty: 1, temperature: 1 };
    applyParamPolicy(body, ctx('xai', 'grok-4.7'));
    expect(body).toEqual({ temperature: 1 });
    const nr = { stop: ['x'] };
    applyParamPolicy(nr, ctx('xai', 'grok-4.20-0309-non-reasoning'));
    expect(nr).toEqual({ stop: ['x'] });
  });

  it('never turns GLM 5.3 reasoning off', () => {
    const body: Record<string, unknown> = { thinking: { type: 'disabled' } };
    applyParamPolicy(body, ctx('zai', 'glm-5.3', 'openai', { reasoning_effort: 'none' }));
    expect(body).toEqual({ reasoning_effort: 'low' });
  });

  it('fixes GPT-6 effort and drops sampling while reasoning', () => {
    const body: Record<string, unknown> = {
      reasoning_effort: 'none',
      temperature: 0.2,
      logprobs: true,
    };
    applyParamPolicy(body, ctx('openai', 'gpt-6-astra'));
    expect(body).toEqual({ reasoning_effort: 'low' });
    const terra: Record<string, unknown> = { reasoning_effort: 'none', temperature: 0.2 };
    applyParamPolicy(terra, ctx('openai', 'gpt-6.1-terra'));
    expect(terra).toEqual({ reasoning_effort: 'none', temperature: 0.2 });
    const responses: Record<string, unknown> = { reasoning: { effort: 'minimal' }, top_p: 1 };
    applyParamPolicy(responses, ctx('openai-responses', 'gpt-6.1-sol', 'chatgpt'));
    expect(responses).toEqual({ reasoning: { effort: 'low' } });
  });
});

describe('applyParamPolicy (lot G)', () => {
  it('maps Chat effort to Claude output_config.effort on 4.6+', () => {
    const body: Record<string, unknown> = { output_config: { format: { type: 'json_schema' } } };
    applyParamPolicy(body, {
      ...anthropic('claude-sonnet-4-6'),
      source: { reasoning_effort: 'xhigh' },
    });
    expect(body.output_config).toEqual({ format: { type: 'json_schema' }, effort: 'high' });
    const opus: Record<string, unknown> = {};
    applyParamPolicy(opus, {
      ...anthropic('claude-opus-5-5'),
      source: { reasoning_effort: 'max' },
    });
    expect(opus.output_config).toEqual({ effort: 'max' });
    const old: Record<string, unknown> = {};
    applyParamPolicy(old, {
      ...anthropic('claude-sonnet-4-5'),
      source: { reasoning_effort: 'low' },
    });
    expect(old).toEqual({});
  });

  it('builds Gemini thinkingConfig per family', () => {
    const g3: Record<string, unknown> = { generationConfig: {} };
    applyParamPolicy(g3, {
      endpointKey: 'google',
      format: 'google',
      model: 'gemini-3.8-flash',
      source: { reasoning_effort: 'minimal' },
    });
    expect(g3.generationConfig).toEqual({ thinkingConfig: { thinkingLevel: 'LOW' } });
    const g25: Record<string, unknown> = {};
    applyParamPolicy(g25, {
      endpointKey: 'google',
      format: 'google',
      model: 'gemini-2.5-flash',
      source: { thinking: { type: 'disabled' } },
    });
    expect(g25.generationConfig).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
  });

  it('turns Anthropic thinking into OpenRouter reasoning', () => {
    const body: Record<string, unknown> = { thinking: { type: 'enabled', budget_tokens: 4096 } };
    applyParamPolicy(body, {
      endpointKey: 'openrouter',
      format: 'openai',
      model: 'anthropic/claude-opus-4-7',
      source: body,
    });
    expect(body).toEqual({ reasoning: { max_tokens: 4096 } });
  });
});
