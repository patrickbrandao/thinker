import {
  applyLiveEvent,
  emptyLiveState,
  liveProviderFrames,
  liveSessionStatus,
  reduceLiveEvents,
  type LiveAttempt,
  type LiveEvent,
  type LiveEventType,
} from '../src/live-session';

let nextId = 1;
const ev = (type: LiveEventType, data: Record<string, unknown>, ts = 1000 + nextId): LiveEvent => ({ id: nextId++, type, ts, data });

function toolLoop(): LiveEvent[] {
  nextId = 1;
  const a = { requestId: 'r1', attemptId: 'r1.1' };
  return [
    ev('message.appended', { seq: 0, role: 'system', text: 'sys' }),
    ev('message.appended', { seq: 1, role: 'user', text: 'fix it' }),
    ev('request.started', { ...a, attempt: 1, model: 'm', provider: 'P', upstream: 'anthropic_messages' }),
    ev('block.started', { ...a, index: 0, type: 'thinking' }),
    ev('block.delta', { ...a, index: 0, delta: 'let me ' }),
    ev('block.delta', { ...a, index: 0, delta: 'look' }),
    ev('block.stopped', { ...a, index: 0 }),
    ev('block.started', { ...a, index: 1, type: 'tool_use', name: 'Grep', toolCallId: 't1' }),
    ev('block.delta', { ...a, index: 1, delta: '{"pattern":' }),
    ev('block.delta', { ...a, index: 1, delta: '"x"}' }),
    ev('block.stopped', { ...a, index: 1 }),
    ev('request.completed', { ...a, stopReason: 'tool_use', usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, costUsd: 0.5, ttftMs: 100, latencyMs: 400 }),
    ev('message.appended', { seq: 2, role: 'tool', toolCallId: 't1', name: 'Grep', text: 'found' }),
  ];
}

describe('live session reducer', () => {
  it('rebuilds a tool loop', () => {
    const s = reduceLiveEvents(toolLoop());
    expect(s.items).toHaveLength(4);
    const a = s.items[2] as LiveAttempt;
    expect(a.status).toBe('done');
    expect(a.blocks.map((b) => [b.type, b.text, b.done])).toEqual([
      ['thinking', 'let me look', true],
      ['tool_use', '{"pattern":"x"}', true],
    ]);
    expect(a.blocks[0]!.chunks).toEqual(['let me ', 'look']);
    expect(s.totals).toEqual({ requests: 1, input: 10, output: 5, costUsd: 0.5 });
    expect(s.lastEventId).toBe(13);
    expect(liveSessionStatus(s)).toBe('tools');
  });

  it('a snapshot mid-stream equals applying the same events, and later events continue it', () => {
    const events = toolLoop();
    const head = events.slice(0, 9);
    const server = reduceLiveEvents(head);
    const client = emptyLiveState();
    applyLiveEvent(client, { id: 9, type: 'snapshot', ts: 2000, data: { session: { sessionId: 's', agentName: null, harness: null }, state: server } });
    expect(client).toEqual({ ...server, lastEventId: 9 });
    // The snapshot is a copy: changing the server state does not leak.
    (server.items[0] as { text: string }).text = 'changed';
    expect((client.items[0] as { text: string }).text).toBe('sys');
    for (const e of events.slice(9)) applyLiveEvent(client, e);
    expect(client.items).toEqual(reduceLiveEvents(events).items);
  });

  it('marks a mid-stream failure as interrupted and keeps the partial text', () => {
    nextId = 1;
    const a = { requestId: 'r1', attemptId: 'r1.1' };
    const s = reduceLiveEvents([
      ev('request.started', { ...a, attempt: 1, model: 'm', provider: 'P' }),
      ev('block.started', { ...a, index: 0, type: 'text' }),
      ev('block.delta', { ...a, index: 0, delta: 'half' }),
      ev('request.failed', { ...a, status: 502, message: 'cut', interrupted: true, next: 'fallback' }),
      ev('request.started', { requestId: 'r1', attemptId: 'r1.2', attempt: 2, model: 'm2', provider: 'Q' }),
    ]);
    const first = s.items[0] as LiveAttempt;
    expect(first.status).toBe('failed');
    expect(first.error).toMatchObject({ status: 502, interrupted: true, next: 'fallback' });
    expect(first.blocks[0]).toMatchObject({ text: 'half', done: false });
    expect(first.blocks[0]!.endedTs).toBeDefined();
    expect(s.totals.requests).toBe(1);
    expect(liveSessionStatus(s)).toBe('retrying');
  });

  it('records a cancel with its partial usage', () => {
    nextId = 1;
    const a = { requestId: 'r1', attemptId: 'r1.1' };
    const s = reduceLiveEvents([
      ev('request.started', { ...a, attempt: 1, model: 'm', provider: 'P' }),
      ev('request.cancelled', { ...a, reason: 'client_closed', latencyMs: 900, usage: { input: 7, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 } }),
    ]);
    expect((s.items[0] as LiveAttempt).status).toBe('cancelled');
    expect(s.totals.input).toBe(7);
    expect(liveSessionStatus(s)).toBe('cancelled');
  });

  it('conversation.reset replaces the messages and keeps the attempts', () => {
    const events = toolLoop();
    events.push(ev('conversation.reset', { messages: [{ role: 'user', text: 'summary of before' }] }));
    const s = reduceLiveEvents(events);
    expect(s.items.map((i) => (i.kind === 'message' ? `${i.role}:${i.text}` : `attempt:${i.attemptId}`))).toEqual(['attempt:r1.1', 'user:summary of before']);
  });

  it('ignores events of unknown attempts', () => {
    nextId = 1;
    const s = reduceLiveEvents([ev('block.delta', { attemptId: 'nope', index: 0, delta: 'x' }), ev('request.completed', { attemptId: 'nope' })]);
    expect(s.items).toEqual([]);
    expect(s.lastEventId).toBe(2);
  });

  it('rebuilds provider frames in the upstream format', () => {
    const s = reduceLiveEvents(toolLoop());
    const frames = liveProviderFrames(s.items[2] as LiveAttempt);
    expect(frames[0]).toContain('event: message_start');
    expect(frames.some((f) => f.includes('"thinking_delta"'))).toBe(true);
    expect(frames.some((f) => f.includes('"input_json_delta"'))).toBe(true);
    expect(frames.at(-1)).toContain('message_stop');
  });
});
