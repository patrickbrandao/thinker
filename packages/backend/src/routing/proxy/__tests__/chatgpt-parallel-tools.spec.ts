import {
  collectChatGptSseResponse,
  createChatGptStreamTransformer,
  fromResponsesResponse,
} from '../chatgpt-adapter';

const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

const added = (index: number, id: string, name: string) =>
  ev('response.output_item.added', {
    output_index: index,
    item: { type: 'function_call', call_id: id, name },
  });

function frames(out: string): Array<Record<string, any>> {
  return out
    .split('\n\n')
    .map((b) => b.trim())
    .filter((b) => b.startsWith('data: {'))
    .map((b) => JSON.parse(b.slice(6)));
}

describe('ChatGPT adapter – parallel tool call arguments', () => {
  it('streams the full arguments from .done when no delta arrived', () => {
    const t = createChatGptStreamTransformer('gpt-5');
    const out = [
      added(0, 'call_a', 'read'),
      added(1, 'call_b', 'ls'),
      ev('response.function_call_arguments.done', { output_index: 0, arguments: '{"p":"a"}' }),
      ev('response.function_call_arguments.done', { output_index: 1, arguments: '{"p":"b"}' }),
    ]
      .map((c) => t(c) ?? '')
      .join('');
    const args = frames(out)
      .flatMap((f) => f.choices[0].delta.tool_calls ?? [])
      .filter((tc: any) => tc.function?.arguments)
      .map((tc: any) => [tc.index, tc.function.arguments]);
    expect(args).toEqual([
      [0, '{"p":"a"}'],
      [1, '{"p":"b"}'],
    ]);
  });

  it('does not repeat arguments on .done when deltas already streamed them', () => {
    const t = createChatGptStreamTransformer('gpt-5');
    t(added(0, 'call_a', 'read'));
    t(ev('response.function_call_arguments.delta', { output_index: 0, delta: '{"p":"a"}' }));
    expect(
      t(ev('response.function_call_arguments.done', { output_index: 0, arguments: '{"p":"a"}' })),
    ).toBeNull();
  });

  it('fills empty arguments from .done in the collected (non-stream) response', () => {
    const sse =
      added(0, 'call_a', 'read') +
      ev('response.function_call_arguments.done', { output_index: 0, arguments: '{"p":"a"}' }) +
      ev('response.completed', { response: { output: [{ type: 'function_call' }] } });
    const res = collectChatGptSseResponse(sse, 'gpt-5') as any;
    expect(res.choices[0].message.tool_calls[0].function.arguments).toBe('{"p":"a"}');
  });
});

describe('ChatGPT adapter – reasoning tokens in usage', () => {
  const usage = {
    input_tokens: 10,
    output_tokens: 20,
    total_tokens: 30,
    output_tokens_details: { reasoning_tokens: 12 },
  };

  it('maps output_tokens_details.reasoning_tokens on non-stream responses', () => {
    const res = fromResponsesResponse({ output: [], usage }, 'gpt-5') as any;
    expect(res.usage.completion_tokens_details).toEqual({ reasoning_tokens: 12 });
  });

  it('maps reasoning tokens on the terminal stream chunk', () => {
    const t = createChatGptStreamTransformer('gpt-5');
    const out = t(ev('response.completed', { response: { output: [], usage } }))!;
    const last = frames(out).pop()!;
    expect(last.usage.completion_tokens_details).toEqual({ reasoning_tokens: 12 });
  });
});
