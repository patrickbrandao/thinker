/**
 * Responses -> Chat Completions stream conversion for the shapes Bedrock
 * Runtime Responses emits: frames without an `event:` line, and a reasoning
 * item ahead of the function calls.
 */

import { createChatGptStreamTransformer, transformResponsesStreamChunk } from './chatgpt-adapter';

function frames(chunks: string[]): Record<string, unknown>[] {
  const transform = createChatGptStreamTransformer('global.openai.gpt-6-luna');
  const out: Record<string, unknown>[] = [];
  for (const chunk of chunks) {
    const result = transform(chunk);
    if (!result) continue;
    for (const line of result.split('\n')) {
      const data = line.replace(/^data: /, '').trim();
      if (data && data !== '[DONE]') out.push(JSON.parse(data) as Record<string, unknown>);
    }
  }
  return out;
}

function toolCalls(frame: Record<string, unknown>): Record<string, unknown>[] | undefined {
  const choices = frame.choices as { delta?: { tool_calls?: Record<string, unknown>[] } }[];
  return choices?.[0]?.delta?.tool_calls;
}

const data = (payload: Record<string, unknown>) => `data: ${JSON.stringify(payload)}`;

describe('chatgpt-adapter: Bedrock Runtime Responses SSE', () => {
  it('reads the event name from data.type when the frame has no event line', () => {
    const out = frames([
      data({ type: 'response.output_text.delta', delta: 'Hel' }),
      data({ type: 'response.output_text.delta', delta: 'lo' }),
      data({ type: 'response.completed', response: { output: [], status: 'completed' } }),
    ]);

    const text = out
      .map((f) => (f.choices as { delta?: { content?: string } }[])?.[0]?.delta?.content ?? '')
      .join('');
    expect(text).toBe('Hello');
    const last = out[out.length - 1].choices as { finish_reason?: string }[];
    expect(last[0].finish_reason).toBe('stop');
  });

  it('numbers tool calls from 0 when a reasoning item comes first', () => {
    const out = frames([
      data({
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'reasoning', id: 'rs_1' },
      }),
      data({ type: 'response.reasoning_summary_text.delta', output_index: 0, delta: 'think' }),
      data({
        type: 'response.output_item.added',
        output_index: 1,
        item: { type: 'function_call', call_id: 'call_a', name: 'get_weather' },
      }),
      data({ type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"c":1}' }),
      data({
        type: 'response.output_item.added',
        output_index: 2,
        item: { type: 'function_call', call_id: 'call_b', name: 'get_time' },
      }),
      // Second call arrives with only `.done`, no deltas.
      data({ type: 'response.function_call_arguments.done', output_index: 2, arguments: '{}' }),
      data({ type: 'response.completed', response: { output: [], status: 'completed' } }),
    ]);

    const calls = out.flatMap((f) => toolCalls(f) ?? []);
    expect(calls.map((c) => c.index)).toEqual([0, 0, 1, 1]);
    expect(calls[0]).toMatchObject({ id: 'call_a', function: { name: 'get_weather' } });
    expect(calls[1]).toMatchObject({ function: { arguments: '{"c":1}' } });
    expect(calls[2]).toMatchObject({ id: 'call_b', function: { name: 'get_time' } });
    expect(calls[3]).toMatchObject({ function: { arguments: '{}' } });
    const last = out[out.length - 1].choices as { finish_reason?: string }[];
    expect(last[0].finish_reason).toBe('tool_calls');
  });

  it('keeps the raw output_index without stream state', () => {
    const result = transformResponsesStreamChunk(
      data({
        type: 'response.output_item.added',
        output_index: 1,
        item: { type: 'function_call', call_id: 'call_a', name: 'f' },
      }),
      'm',
    );
    const frame = JSON.parse(result!.replace(/^data: /, '').split('\n\n')[0]);
    expect(toolCalls(frame)?.[0].index).toBe(1);
  });
});
