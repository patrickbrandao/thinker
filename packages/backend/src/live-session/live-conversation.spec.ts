import { ConversationTracker, normalizeConversation } from './live-conversation';

const anthropic = (messages: unknown[], system = 'You are Claude Code.') => ({
  model: 'claude',
  system: [
    { type: 'text', text: 'x-anthropic-billing-header: cc_version=1; cch=abc;\n' },
    { type: 'text', text: system },
  ],
  messages,
});

const user = (text: string) => ({
  role: 'user',
  content: [{ type: 'text', text, cache_control: { type: 'ephemeral' } }],
});
const assistantTool = (id: string, name: string) => ({
  role: 'assistant',
  content: [
    { type: 'thinking', thinking: 'secret thoughts', signature: 'sig' },
    { type: 'text', text: 'Looking.' },
    { type: 'tool_use', id, name, input: { pattern: 'x' } },
  ],
});
const toolResult = (id: string, text: string, isError = false) => ({
  role: 'user',
  content: [
    {
      type: 'tool_result',
      tool_use_id: id,
      content: [{ type: 'text', text }],
      ...(isError ? { is_error: true } : {}),
    },
  ],
});

const diffOf = (
  t: ConversationTracker,
  body: unknown,
  format: Parameters<typeof normalizeConversation>[1] = 'anthropic_messages',
) => t.diff(normalizeConversation(body, format));

describe('conversation reconstruction', () => {
  it('appends system and the first prompt, then only the new tail (tool results + prompt)', () => {
    const t = new ConversationTracker();
    expect(diffOf(t, anthropic([user('find listModels')]))).toEqual({
      kind: 'append',
      messages: [
        { role: 'system', text: 'You are Claude Code.' },
        { role: 'user', text: 'find listModels' },
      ],
    });
    // Next request: the history grows by the assistant turn and its tool
    // result; the cache_control move and the billing line change nothing.
    const second = anthropic([
      user('find listModels'),
      assistantTool('toolu_1', 'Grep'),
      toolResult('toolu_1', 'src/a.ts', true),
    ]);
    expect(diffOf(t, second)).toEqual({
      kind: 'append',
      messages: [
        { role: 'tool', text: 'src/a.ts', toolCallId: 'toolu_1', name: 'Grep', isError: true },
      ],
    });
    expect(diffOf(t, second)).toEqual({ kind: 'none' });
    expect(t.visibleCount).toBe(3);
  });

  it('resets when the history is rewritten (compaction, /clear, edit)', () => {
    const t = new ConversationTracker();
    diffOf(t, anthropic([user('one')]));
    diffOf(
      t,
      anthropic([user('one'), assistantTool('t1', 'Read'), toolResult('t1', 'ok'), user('two')]),
    );
    const compacted = anthropic([user('Summary of the conversation so far'), user('three')]);
    expect(diffOf(t, compacted)).toEqual({
      kind: 'reset',
      messages: [
        { role: 'system', text: 'You are Claude Code.' },
        { role: 'user', text: 'Summary of the conversation so far' },
        { role: 'user', text: 'three' },
      ],
    });
    expect(t.visibleCount).toBe(3);
  });

  it('ignores a shorter side request under another system prompt', () => {
    const t = new ConversationTracker();
    diffOf(t, anthropic([user('one'), assistantTool('t1', 'Read'), toolResult('t1', 'ok')]));
    expect(diffOf(t, anthropic([user('Write a title for this')], 'You write titles.'))).toEqual({
      kind: 'none',
    });
    // The main conversation keeps going as a prefix of what it knew.
    expect(
      diffOf(
        t,
        anthropic([user('one'), assistantTool('t1', 'Read'), toolResult('t1', 'ok'), user('next')]),
      ).kind,
    ).toBe('append');
  });

  it('joining a session under way shows the whole conversation as a reset', () => {
    const t = new ConversationTracker();
    const diff = diffOf(
      t,
      anthropic([user('one'), assistantTool('t1', 'Read'), toolResult('t1', 'ok')]),
    );
    expect(diff.kind).toBe('reset');
  });

  it('Chat Completions: tool results take the name of their call', () => {
    const t = new ConversationTracker();
    const diff = diffOf(
      t,
      {
        messages: [
          { role: 'system', content: 'sys' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'hi' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
            ],
          },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'ls', arguments: '{}' } },
            ],
          },
          { role: 'tool', tool_call_id: 'call_1', content: 'a.txt' },
        ],
      },
      'openai_chat_completions',
    );
    expect(diff).toEqual({
      kind: 'reset',
      messages: [
        { role: 'system', text: 'sys' },
        { role: 'user', text: expect.stringMatching(/^hi\n\[inline image: image\/png/) },
        { role: 'tool', text: 'a.txt', toolCallId: 'call_1', name: 'ls' },
      ],
    });
    expect(JSON.stringify(diff)).not.toContain('iVBOR');
  });

  it('Responses: instructions, function_call_output, and previous_response_id as a delta', () => {
    const t = new ConversationTracker();
    const first = {
      instructions: 'You are Codex.',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'list files' }] },
      ],
    };
    expect(diffOf(t, first, 'openai_responses')).toEqual({
      kind: 'append',
      messages: [
        { role: 'system', text: 'You are Codex.' },
        { role: 'user', text: 'list files' },
      ],
    });
    const delta = {
      previous_response_id: 'resp_1',
      input: [{ type: 'function_call_output', call_id: 'call_9', output: 'README.md' }],
    };
    expect(diffOf(t, delta, 'openai_responses')).toEqual({
      kind: 'append',
      messages: [{ role: 'tool', text: 'README.md', toolCallId: 'call_9' }],
    });
  });

  it('the same history in another wire format keeps the prefix (fallback to another protocol)', () => {
    const t = new ConversationTracker();
    diffOf(t, anthropic([user('one')], 'sys'));
    const chat = {
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'one' },
        { role: 'assistant', content: 'done' },
        { role: 'user', content: 'two' },
      ],
    };
    expect(diffOf(t, chat, 'openai_chat_completions')).toEqual({
      kind: 'append',
      messages: [{ role: 'user', text: 'two' }],
    });
  });
});
