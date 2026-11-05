import { messagesToChatCompletionsRequest } from './anthropic-messages-adapter';
import { fromChatCompletionResponse, toChatCompletionsRequest } from './responses-adapter';
import { responsesToolNames } from './responses-tools';

describe('Anthropic Messages to Chat (harness-anthropic-sdk G4/G5)', () => {
  it('folds a mid-conversation system message into the leading system message', () => {
    const chat = messagesToChatCompletionsRequest({
      system: 'Base rules.',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'system', content: 'Now answer in French.' },
        { role: 'user', content: 'again' },
      ],
    });
    const messages = chat.messages as Array<{ role: string; content: unknown }>;
    expect(messages[0]).toEqual({
      role: 'system',
      content: 'Base rules.\n\nNow answer in French.',
    });
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'user']);
  });

  it('converts text and PDF document blocks instead of dropping them', () => {
    const chat = messagesToChatCompletionsRequest({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', title: 'Notes', source: { type: 'text', data: 'alpha' } },
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' },
            },
            { type: 'text', text: 'Summarize' },
          ],
        },
      ],
    });
    const content = (chat.messages as Array<{ content: Array<Record<string, unknown>> }>)[0]
      .content;
    expect(content[0]).toEqual({ type: 'text', text: '\n\nNotes\nalpha\n\n' });
    expect(content[1]).toEqual({
      type: 'file',
      file: { filename: 'document.pdf', file_data: 'data:application/pdf;base64,JVBERi0=' },
    });
  });
});

describe('Responses to Chat (harness-codex G2, harness-openai-sdk G3)', () => {
  const tools = [{ type: 'custom', name: 'apply_patch', description: 'Patch files' }];

  it('sends custom tools as one-string functions and replays custom calls', () => {
    const chat = toChatCompletionsRequest({
      model: 'm',
      tools,
      reasoning: { effort: 'high' },
      text: { verbosity: 'low' },
      input: [
        { type: 'message', role: 'user', content: 'fix it' },
        { type: 'custom_tool_call', call_id: 'c1', name: 'apply_patch', input: '*** Begin' },
        { type: 'custom_tool_call_output', call_id: 'c1', output: 'done' },
      ],
    });
    expect((chat.tools as Array<{ function: { name: string } }>)[0].function.name).toBe(
      'apply_patch',
    );
    const messages = chat.messages as Array<Record<string, unknown>>;
    expect(messages[1].tool_calls).toEqual([
      {
        id: 'c1',
        type: 'function',
        function: { name: 'apply_patch', arguments: '{"input":"*** Begin"}' },
      },
    ]);
    expect(messages[2]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'done' });
    expect(chat.reasoning_effort).toBe('high');
    expect(chat.verbosity).toBe('low');
  });

  it('returns a custom tool call to the Responses client as custom_tool_call', () => {
    const response = fromChatCompletionResponse(
      {
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'c2',
                  type: 'function',
                  function: { name: 'apply_patch', arguments: '{"input":"diff"}' },
                },
              ],
            },
          },
        ],
      },
      'm',
      { toolNames: responsesToolNames(tools) },
    );
    const item = (response.output as Array<Record<string, unknown>>).find(
      (o) => o.type === 'custom_tool_call',
    );
    expect(item).toMatchObject({ call_id: 'c2', name: 'apply_patch', input: 'diff' });
  });
});
