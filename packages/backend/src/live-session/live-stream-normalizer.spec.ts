import { LiveStreamNormalizer, type LiveBlockOp } from './live-stream-normalizer';
import type { LiveWireFormat } from 'thinker-shared';

const sse = (frames: Array<[string | null, unknown]>) =>
  frames
    .map(
      ([event, data]) =>
        `${event ? `event: ${event}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`,
    )
    .join('');

/** Feeds the text in small pieces, the way a provider stream arrives. */
function run(format: LiveWireFormat, text: string, finish = true) {
  const ops: LiveBlockOp[] = [];
  const n = new LiveStreamNormalizer(format, (op) => ops.push(op));
  for (let i = 0; i < text.length; i += 7) n.feedSse(text.slice(i, i + 7));
  n.endSse();
  if (finish) n.finish();
  return { ops, n };
}

/** Blocks rebuilt from the ops: type, text and whether they stopped. */
function blocks(ops: LiveBlockOp[]) {
  const out: Array<{
    type: string;
    text: string;
    stopped: boolean;
    name?: string;
    toolCallId?: string;
    redacted?: boolean;
  }> = [];
  for (const op of ops) {
    if (op.op === 'start') {
      out[op.index] = {
        type: op.type,
        text: '',
        stopped: false,
        ...(op.name ? { name: op.name } : {}),
        ...(op.toolCallId ? { toolCallId: op.toolCallId } : {}),
        ...(op.redacted ? { redacted: true } : {}),
      };
    } else if (op.op === 'delta') out[op.index]!.text += op.delta;
    else out[op.index]!.stopped = true;
  }
  return out;
}

describe('LiveStreamNormalizer', () => {
  it('Anthropic Messages: thinking, text, tool_use; signatures never surface', () => {
    const text = sse([
      ['message_start', { type: 'message_start', message: { usage: { input_tokens: 10 } } }],
      [
        'content_block_start',
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        },
      ],
      [
        'content_block_delta',
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'Let me ' },
        },
      ],
      [
        'content_block_delta',
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'look.' },
        },
      ],
      [
        'content_block_delta',
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature: 'SIG-SECRET' },
        },
      ],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      [
        'content_block_start',
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      ],
      [
        'content_block_delta',
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: "I'll grep." },
        },
      ],
      ['content_block_stop', { type: 'content_block_stop', index: 1 }],
      [
        'content_block_start',
        {
          type: 'content_block_start',
          index: 2,
          content_block: { type: 'tool_use', id: 'toolu_1', name: 'Grep', input: {} },
        },
      ],
      [
        'content_block_delta',
        {
          type: 'content_block_delta',
          index: 2,
          delta: { type: 'input_json_delta', partial_json: '{"pattern":' },
        },
      ],
      [
        'content_block_delta',
        {
          type: 'content_block_delta',
          index: 2,
          delta: { type: 'input_json_delta', partial_json: '"x"}' },
        },
      ],
      ['content_block_stop', { type: 'content_block_stop', index: 2 }],
      [
        'message_delta',
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 30 } },
      ],
      ['message_stop', { type: 'message_stop' }],
    ]);
    const { ops, n } = run('anthropic_messages', text);
    expect(blocks(ops)).toEqual([
      { type: 'thinking', text: 'Let me look.', stopped: true },
      { type: 'text', text: "I'll grep.", stopped: true },
      {
        type: 'tool_use',
        text: '{"pattern":"x"}',
        stopped: true,
        name: 'Grep',
        toolCallId: 'toolu_1',
      },
    ]);
    expect(JSON.stringify(ops)).not.toContain('SIG-SECRET');
    expect(n.stopReason).toBe('tool_use');
  });

  it('Anthropic redacted_thinking becomes a redacted thinking block without text', () => {
    const text = sse([
      [
        null,
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'redacted_thinking', data: 'ENCRYPTED' },
        },
      ],
      [null, { type: 'content_block_stop', index: 0 }],
    ]);
    const { ops } = run('anthropic_messages', text);
    expect(blocks(ops)).toEqual([{ type: 'thinking', text: '', stopped: true, redacted: true }]);
    expect(JSON.stringify(ops)).not.toContain('ENCRYPTED');
  });

  it('a cut stream leaves the last block without stop', () => {
    const text = sse([
      [null, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      [
        null,
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } },
      ],
    ]);
    const { ops } = run('anthropic_messages', text, false);
    expect(blocks(ops)).toEqual([{ type: 'text', text: 'partial', stopped: false }]);
  });

  it('OpenAI Responses: summary, encrypted-only reasoning, text and function calls (data.type only)', () => {
    const text = sse([
      [null, { type: 'response.created', response: { status: 'in_progress' } }],
      [
        null,
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'reasoning', id: 'rs_1' },
        },
      ],
      [
        null,
        {
          type: 'response.reasoning_summary_text.delta',
          output_index: 0,
          summary_index: 0,
          delta: 'Plan A.',
        },
      ],
      [
        null,
        {
          type: 'response.reasoning_summary_text.delta',
          output_index: 0,
          summary_index: 1,
          delta: 'Plan B.',
        },
      ],
      [
        null,
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: { type: 'reasoning', id: 'rs_1', encrypted_content: 'ENC' },
        },
      ],
      [
        null,
        {
          type: 'response.output_item.added',
          output_index: 1,
          item: { type: 'reasoning', id: 'rs_2', encrypted_content: 'ENC2' },
        },
      ],
      [
        null,
        {
          type: 'response.output_item.done',
          output_index: 1,
          item: { type: 'reasoning', id: 'rs_2', encrypted_content: 'ENC2' },
        },
      ],
      [
        null,
        {
          type: 'response.output_item.added',
          output_index: 2,
          item: { type: 'message', id: 'msg_1' },
        },
      ],
      [
        null,
        { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 2, delta: 'Hi' },
      ],
      [
        null,
        {
          type: 'response.output_item.done',
          output_index: 2,
          item: { type: 'message', id: 'msg_1' },
        },
      ],
      [
        null,
        {
          type: 'response.output_item.added',
          output_index: 3,
          item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'shell' },
        },
      ],
      [
        null,
        { type: 'response.function_call_arguments.delta', output_index: 3, delta: '{"cmd":"ls"}' },
      ],
      [
        null,
        {
          type: 'response.output_item.done',
          output_index: 3,
          item: { type: 'function_call', call_id: 'call_1', arguments: '{"cmd":"ls"}' },
        },
      ],
      [
        null,
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            usage: { output_tokens_details: { reasoning_tokens: 12 } },
          },
        },
      ],
    ]);
    const { ops, n } = run('openai_responses', text);
    expect(blocks(ops)).toEqual([
      { type: 'thinking', text: 'Plan A.\n\nPlan B.', stopped: true },
      { type: 'thinking', text: '', stopped: true, redacted: true },
      { type: 'text', text: 'Hi', stopped: true },
      {
        type: 'tool_use',
        text: '{"cmd":"ls"}',
        stopped: true,
        name: 'shell',
        toolCallId: 'call_1',
      },
    ]);
    expect(JSON.stringify(ops)).not.toContain('ENC');
    expect(n.stopReason).toBe('tool_calls');
    expect(n.reasoningTokens).toBe(12);
  });

  it('OpenAI Chat Completions: reasoning_content, content, parallel tool_calls by index', () => {
    const chunk = (delta: unknown, finish: string | null = null) =>
      [null, { choices: [{ index: 0, delta, finish_reason: finish }] }] as [null, unknown];
    const text = sse([
      chunk({ role: 'assistant', reasoning_content: 'Think ' }),
      chunk({ reasoning_content: 'hard.', content: '' }),
      chunk({ content: 'Calling tools.' }),
      chunk({
        tool_calls: [
          {
            index: 0,
            id: 'call_a',
            type: 'function',
            function: { name: 'read', arguments: '{"p":' },
          },
        ],
      }),
      chunk({
        tool_calls: [
          {
            index: 1,
            id: 'call_b',
            type: 'function',
            function: { name: 'grep', arguments: '{"q":1}' },
          },
        ],
      }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] }),
      chunk({}, 'tool_calls'),
      [
        null,
        {
          choices: [],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 9,
            completion_tokens_details: { reasoning_tokens: 4 },
          },
        },
      ],
      [null, '[DONE]'],
    ]);
    const { ops, n } = run('openai_chat_completions', text);
    expect(blocks(ops)).toEqual([
      { type: 'thinking', text: 'Think hard.', stopped: true },
      { type: 'text', text: 'Calling tools.', stopped: true },
      { type: 'tool_use', text: '{"p":"a"}', stopped: true, name: 'read', toolCallId: 'call_a' },
      { type: 'tool_use', text: '{"q":1}', stopped: true, name: 'grep', toolCallId: 'call_b' },
    ]);
    expect(n.stopReason).toBe('tool_calls');
    expect(n.reasoningTokens).toBe(4);
  });

  it('OpenAI Chat Completions: `reasoning` (OpenRouter) and encrypted reasoning_details', () => {
    const { ops } = run(
      'openai_chat_completions',
      sse([
        [
          null,
          {
            choices: [
              {
                index: 0,
                delta: { reasoning_details: [{ type: 'reasoning.encrypted', data: 'XYZ' }] },
              },
            ],
          },
        ],
        [null, { choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }],
      ]),
    );
    expect(blocks(ops)).toEqual([
      { type: 'thinking', text: '', stopped: true, redacted: true },
      { type: 'text', text: 'ok', stopped: true },
    ]);
    expect(JSON.stringify(ops)).not.toContain('XYZ');
  });

  it('Gemini: thought parts, text and a whole functionCall (Code Assist envelope)', () => {
    const wrap = (parts: unknown[], finishReason?: string) =>
      [
        null,
        {
          response: {
            candidates: [
              { content: { role: 'model', parts }, ...(finishReason ? { finishReason } : {}) },
            ],
            usageMetadata: { thoughtsTokenCount: 7 },
          },
        },
      ] as [null, unknown];
    const text = sse([
      wrap([{ text: 'Hmm', thought: true }]),
      wrap([{ text: 'Sure. ' }]),
      wrap(
        [
          { text: 'Done.' },
          { functionCall: { name: 'search', args: { q: 'x' } }, thoughtSignature: 'S' },
        ],
        'STOP',
      ),
    ]);
    const { ops, n } = run('google_code_assist', text);
    expect(blocks(ops)).toEqual([
      { type: 'thinking', text: 'Hmm', stopped: true },
      { type: 'text', text: 'Sure. Done.', stopped: true },
      { type: 'tool_use', text: '{"q":"x"}', stopped: true, name: 'search' },
    ]);
    expect(n.stopReason).toBe('tool_calls');
    expect(n.reasoningTokens).toBe(7);
  });

  it('non-stream JSON bodies emit the same blocks at once', () => {
    const cases: Array<[LiveWireFormat, unknown, string[]]> = [
      [
        'anthropic_messages',
        {
          content: [
            { type: 'thinking', thinking: 't', signature: 's' },
            { type: 'text', text: 'a' },
            { type: 'tool_use', id: 'x', name: 'n', input: { k: 1 } },
          ],
          stop_reason: 'tool_use',
        },
        ['thinking:t', 'text:a', 'tool_use:{"k":1}'],
      ],
      [
        'openai_responses',
        {
          output: [
            { type: 'reasoning', summary: [{ type: 'summary_text', text: 'r' }] },
            { type: 'message', content: [{ type: 'output_text', text: 'b' }] },
            { type: 'function_call', call_id: 'c', name: 'f', arguments: '{}' },
          ],
          status: 'completed',
        },
        ['thinking:r', 'text:b', 'tool_use:{}'],
      ],
      [
        'openai_chat_completions',
        {
          choices: [
            {
              index: 0,
              message: {
                reasoning_content: 'r',
                content: 'c',
                tool_calls: [{ id: 'i', function: { name: 'f', arguments: '{"a":2}' } }],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
        ['thinking:r', 'text:c', 'tool_use:{"a":2}'],
      ],
      [
        'google_generate_content',
        {
          candidates: [
            {
              content: { parts: [{ text: 'g', thought: true }, { text: 'h' }] },
              finishReason: 'STOP',
            },
          ],
        },
        ['thinking:g', 'text:h'],
      ],
    ];
    for (const [format, body, expected] of cases) {
      const ops: LiveBlockOp[] = [];
      const n = new LiveStreamNormalizer(format, (op) => ops.push(op));
      n.feedBody(body);
      n.finish();
      const got = blocks(ops);
      expect(got.map((b) => `${b.type}:${b.text}`)).toEqual(expected);
      expect(got.every((b) => b.stopped)).toBe(true);
    }
  });

  it('a collected SSE body (ChatGPT non-stream) goes through the stream path', () => {
    const ops: LiveBlockOp[] = [];
    const n = new LiveStreamNormalizer('openai_responses', (op) => ops.push(op));
    n.feedBody(
      sse([
        [null, { type: 'response.output_item.added', output_index: 0, item: { type: 'message' } }],
        [null, { type: 'response.output_text.delta', output_index: 0, delta: 'hey' }],
      ]),
    );
    n.finish();
    expect(blocks(ops)).toEqual([{ type: 'text', text: 'hey', stopped: true }]);
  });
});
