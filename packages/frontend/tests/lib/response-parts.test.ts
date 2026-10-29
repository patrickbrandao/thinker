import { describe, expect, it } from 'vitest';
import { parseResponse } from '../../src/lib/response-parts';
import { toolParams } from '../../src/components/RequestAttemptViews';

const sse = (events: unknown[]) =>
  events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');

describe('parseResponse', () => {
  it('merges streamed reasoning, text and tool-call fragments in order', () => {
    const parsed = parseResponse({
      type: 'stream',
      raw_sse: sse([
        { model: 'm1', choices: [{ delta: { reasoning_content: 'Let me ' } }] },
        { choices: [{ delta: { reasoning_content: 'think' } }] },
        { choices: [{ delta: { content: 'Hello' } }] },
        { choices: [{ delta: { content: ' world' } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'c1', function: { name: 'websearch', arguments: '{"q' } },
                ],
              },
            },
          ],
        },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '":"x"}' } }] } }] },
        { choices: [{ finish_reason: 'tool_calls', delta: {} }], usage: { total_tokens: 9 } },
        '[DONE]',
      ]),
    });
    expect(parsed.mode).toBe('stream');
    expect(parsed.events).toHaveLength(8);
    expect(parsed.parts).toEqual([
      { kind: 'thinking', text: 'Let me think' },
      { kind: 'text', text: 'Hello world' },
      { kind: 'tool_call', id: 'c1', name: 'websearch', arguments: '{"q":"x"}' },
    ]);
    expect(parsed.meta).toMatchObject({ model: 'm1', finish_reason: 'tool_calls' });
  });

  it('reads Anthropic thinking, text and tool_use from a whole response', () => {
    const parsed = parseResponse({
      type: 'json',
      body: {
        type: 'message',
        model: 'claude',
        stop_reason: 'tool_use',
        content: [
          { type: 'thinking', thinking: 'plan' },
          { type: 'text', text: 'ok' },
          { type: 'tool_use', id: 't1', name: 'read', input: { path: 'a' } },
        ],
      },
    });
    expect(parsed.mode).toBe('json');
    expect(parsed.parts).toEqual([
      { kind: 'thinking', text: 'plan' },
      { kind: 'text', text: 'ok' },
      { kind: 'tool_call', id: 't1', name: 'read', arguments: '{"path":"a"}' },
    ]);
    expect(parsed.meta.stop_reason).toBe('tool_use');
  });

  it('reads Anthropic streamed thinking and tool input deltas', () => {
    const parsed = parseResponse({
      type: 'stream',
      raw_sse: [
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'hm' },
        },
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'x', name: 'ls', input: {} },
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"d":1}' },
        },
      ]
        .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
        .join(''),
    });
    expect(parsed.events[0]!.name).toBe('content_block_start');
    expect(parsed.parts).toEqual([
      { kind: 'thinking', text: 'hm' },
      { kind: 'tool_call', id: 'x', name: 'ls', arguments: '{"d":1}' },
    ]);
  });

  it('reports no response while nothing was recorded', () => {
    expect(parseResponse(null).mode).toBe('none');
  });
});

describe('toolParams', () => {
  it('lists parameters with type and required flag', () => {
    expect(
      toolParams({
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'What to search' },
          limit: { type: 'integer' },
          tags: { type: 'array', items: { type: 'string' } },
          mode: { enum: ['a', 'b'] },
        },
      }),
    ).toEqual([
      { name: 'query', type: 'string', required: true, description: 'What to search' },
      { name: 'limit', type: 'integer', required: false, description: undefined },
      { name: 'tags', type: 'string[]', required: false, description: undefined },
      { name: 'mode', type: '"a" | "b"', required: false, description: undefined },
    ]);
  });
});
