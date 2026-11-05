import { deduplicateCallIds } from './responses-call-ids';

const call = (call_id: string, name = 'terminal', args = '{}') => ({
  type: 'function_call',
  call_id,
  name,
  arguments: args,
});
const output = (call_id: string, text = 'ok') => ({
  type: 'function_call_output',
  call_id,
  output: text,
});

describe('deduplicateCallIds', () => {
  it('returns the same array when ids are already unique', () => {
    const input = [call('a'), output('a'), call('b'), output('b')];
    expect(deduplicateCallIds(input)).toBe(input);
  });

  it('returns the same array for an empty history', () => {
    const input: unknown[] = [];
    expect(deduplicateCallIds(input)).toBe(input);
  });

  it('ignores non-record items and items without a call_id', () => {
    const input = ['text', null, 3, [], { type: 'message', role: 'user', content: 'hi' }];
    expect(deduplicateCallIds(input)).toBe(input);
  });

  it('gives repeated pairs request-unique ids', () => {
    const input = [
      call('terminal:0'),
      output('terminal:0'),
      call('terminal:0'),
      output('terminal:0'),
    ];
    const out = deduplicateCallIds(input) as Array<{ call_id: string }>;
    expect(out.map((i) => i.call_id)).toEqual([
      'terminal:0',
      'terminal:0',
      'terminal:0-thinker-2',
      'terminal:0-thinker-2',
    ]);
  });

  it('numbers every further pair and keeps the first untouched', () => {
    const input = [
      call('t:0', 'a'),
      output('t:0', 'o1'),
      call('t:0', 'b'),
      output('t:0', 'o2'),
      call('t:0', 'c'),
      output('t:0', 'o3'),
    ];
    const out = deduplicateCallIds(input) as Array<{ call_id: string }>;
    expect(out.map((i) => i.call_id)).toEqual([
      't:0',
      't:0',
      't:0-thinker-2',
      't:0-thinker-2',
      't:0-thinker-3',
      't:0-thinker-3',
    ]);
  });

  it('never changes order, names, arguments or outputs and does not mutate the input', () => {
    const input = [
      { type: 'message', role: 'user', content: 'go' },
      call('t:0', 'read', '{"p":1}'),
      output('t:0', 'first'),
      call('t:0', 'write', '{"p":2}'),
      output('t:0', 'second'),
    ];
    const snapshot = JSON.parse(JSON.stringify(input));
    const out = deduplicateCallIds(input) as Array<Record<string, unknown>>;
    expect(input).toEqual(snapshot);
    expect(out).not.toBe(input);
    expect(out[0]).toBe(input[0]);
    expect(out.map((i) => i.type)).toEqual(input.map((i) => i.type));
    expect(out[3]).toMatchObject({ name: 'write', arguments: '{"p":2}' });
    expect(out[4]).toMatchObject({ output: 'second' });
  });

  it('leaves an unmatched call alone', () => {
    const input = [call('t:0'), output('t:0'), call('t:0')];
    expect(deduplicateCallIds(input)).toBe(input);
  });

  it('leaves an output before its call alone', () => {
    const input = [output('t:0'), call('t:0'), output('t:0'), call('t:0')];
    expect(deduplicateCallIds(input)).toBe(input);
  });

  it('leaves two calls in a row alone', () => {
    const input = [call('t:0'), call('t:0'), output('t:0'), output('t:0')];
    expect(deduplicateCallIds(input)).toBe(input);
  });

  it('rewrites only the ids that alternate cleanly', () => {
    const input = [
      call('good'),
      output('good'),
      call('good'),
      output('good'),
      call('bad'),
      call('bad'),
      output('bad'),
      output('bad'),
    ];
    const out = deduplicateCallIds(input) as Array<{ call_id: string }>;
    expect(out.map((i) => i.call_id)).toEqual([
      'good',
      'good',
      'good-thinker-2',
      'good-thinker-2',
      'bad',
      'bad',
      'bad',
      'bad',
    ]);
  });

  it('extends the replacement id until it collides with no existing id', () => {
    const input = [
      call('t:0'),
      output('t:0'),
      call('t:0'),
      output('t:0'),
      call('t:0-thinker-2'),
      output('t:0-thinker-2'),
    ];
    const out = deduplicateCallIds(input) as Array<{ call_id: string }>;
    expect(out[2].call_id).toBe('t:0-thinker-2-x');
    expect(out[3].call_id).toBe('t:0-thinker-2-x');
    expect(out[4].call_id).toBe('t:0-thinker-2');
    const ids = new Set([out[0].call_id, out[2].call_id, out[4].call_id]);
    expect(ids.size).toBe(3);
  });

  it('ignores a non-string call_id', () => {
    const input = [
      { type: 'function_call', call_id: 5 },
      { type: 'function_call', call_id: 5 },
    ];
    expect(deduplicateCallIds(input)).toBe(input);
  });

  it('does not count other item types that reuse a call_id', () => {
    const input = [
      call('t:0'),
      output('t:0'),
      { type: 'custom_tool_call', call_id: 't:0' },
      { type: 'custom_tool_call_output', call_id: 't:0' },
    ];
    expect(deduplicateCallIds(input)).toBe(input);
  });
});
