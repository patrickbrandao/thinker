import { reduceLiveEvents, type LiveEvent } from 'thinker-shared';
import type { Logger } from '@nestjs/common';
import {
  LIVE_BUFFER_MAX_EVENTS,
  LiveSessionHubService,
  type LiveSubscriber,
} from './live-session-hub.service';
import type { ProviderAttemptRef } from '../routing/proxy/proxy-types';

const meta = { sessionId: 's1', agentName: 'demo', harness: null };

function collect(
  hub: LiveSessionHubService,
  tenant: string,
  session: string,
  access = { bodies: true, headers: true },
) {
  const frames: string[] = [];
  const sub: LiveSubscriber = { access, send: (c) => frames.push(c), close: jest.fn() };
  const entry = hub.entryFor(tenant, session, meta);
  hub.subscribe(entry, sub);
  const events = () => frames.map((f) => JSON.parse(/^data: (.*)$/m.exec(f)![1]!) as LiveEvent);
  return { frames, events, sub };
}

const ref = (n: number): ProviderAttemptRef => ({
  id: `att-${n}`,
  attemptNumber: n,
  startedAtMs: Date.now(),
  startedAt: new Date().toISOString(),
  pendingWrite: Promise.resolve(true),
});

describe('LiveSessionHubService', () => {
  let hub: LiveSessionHubService;
  beforeEach(() => {
    hub = new LiveSessionHubService();
  });
  afterEach(() => hub.onModuleDestroy());

  it('numbers events per session without gaps and keys entries by tenant', () => {
    const a = hub.entryFor('t1', 'same', meta);
    const b = hub.entryFor('t2', 'same', meta);
    expect(a).not.toBe(b);
    const e1 = hub.emit(a, 'message.appended', { role: 'user', text: 'a' });
    const e2 = hub.emit(a, 'message.appended', { role: 'user', text: 'b' });
    expect(e2.id).toBe(e1.id + 1);
    expect(b.events).toHaveLength(0);
    expect(a.lastId).toBe(e2.id);
  });

  it('glance summarizes what each session of the tenant ends with', () => {
    const a = hub.entryFor('t1', 's1', meta);
    hub.entryFor('t1', 's2', meta);
    hub.emit(hub.entryFor('t2', 's3', meta), 'message.appended', { role: 'user', text: 'x' });
    hub.emit(a, 'message.appended', { role: 'user', text: 'hi' });
    hub.entryFor('t1', 's2', meta).parentId = 's1';
    expect(hub.glance('t1').map(({ idleMs, ...g }) => ({ ...g, idle: idleMs >= 0 }))).toEqual([
      { id: 's1', parentId: null, agentName: 'demo', last: 'user', streaming: false, idle: true },
      { id: 's2', parentId: 's1', agentName: 'demo', last: 'idle', streaming: false, idle: true },
    ]);
    hub.emit(a, 'message.appended', { role: 'tool', text: 'ok' });
    expect(hub.glance('t1')[0]).toMatchObject({ id: 's1', last: 'tool_result' });
  });

  it('caps the buffer, replays after Last-Event-ID, and asks for a snapshot past the buffer', () => {
    const entry = hub.entryFor('t1', 's1', meta);
    const first = hub.emit(entry, 'message.appended', { role: 'user', text: 'x' }).id;
    for (let i = 1; i < LIVE_BUFFER_MAX_EVENTS + 10; i++) {
      hub.emit(entry, 'message.appended', { role: 'user', text: String(i) });
    }
    expect(entry.events).toHaveLength(LIVE_BUFFER_MAX_EVENTS);
    expect(entry.dropped).toBe(true);
    expect(hub.eventsAfter(entry, first)).toBeNull(); // fell out of the buffer
    expect(hub.eventsAfter(entry, null)).toBeNull();
    expect(hub.eventsAfter(entry, entry.lastId + 5)).toBeNull(); // another lifetime
    const tail = hub.eventsAfter(entry, entry.lastId - 3)!;
    expect(tail.map((e) => e.event.id)).toEqual([entry.lastId - 2, entry.lastId - 1, entry.lastId]);
  });

  it('snapshot state equals the reducer over the events, minus what the viewer may not see', () => {
    const entry = hub.entryFor('t1', 's1', meta);
    const events = [
      hub.emit(entry, 'request.started', {
        requestId: 'r',
        attemptId: 'r.1',
        attempt: 1,
        model: 'm',
        provider: 'p',
        headers: { authorization: 'Bearer ••' },
        body: { a: 1 },
      }),
      hub.emit(entry, 'block.started', { attemptId: 'r.1', index: 0, type: 'text' }),
      hub.emit(entry, 'block.delta', { attemptId: 'r.1', index: 0, delta: 'Hel' }),
    ];
    const full = hub.snapshotState(entry, { bodies: true, headers: true });
    expect(full).toEqual(reduceLiveEvents(events));
    const viewer = hub.snapshotState(entry, { bodies: true, headers: false });
    const attempt = viewer.items[0] as { headers?: unknown; body?: unknown };
    expect(attempt.headers).toBeUndefined();
    expect(attempt.body).toEqual({ a: 1 });

    // Live frames follow the same rule.
    const { events: got } = collect(hub, 't1', 's1', { bodies: true, headers: false });
    hub.emit(entry, 'request.started', {
      requestId: 'r2',
      attemptId: 'r2.1',
      attempt: 1,
      model: 'm',
      provider: 'p',
      headers: { x: '1' },
      body: {},
    });
    expect(got()[0]!.data.headers).toBeUndefined();
    expect(got()[0]!.data.body).toEqual({});
  });

  it('a request without a harness session produces nothing', () => {
    expect(
      hub.openRequest({
        tenantId: 't1',
        agentName: 'a',
        headers: {},
        requestId: 'r',
        apiMode: 'messages',
        body: {},
        recording: false,
      }),
    ).toBeNull();
  });

  it('limits live connections per tenant', () => {
    for (let i = 0; i < 20; i++) expect(hub.acquireConnection('t1')).toBe(true);
    expect(hub.acquireConnection('t1')).toBe(false);
    expect(hub.acquireConnection('t2')).toBe(true);
    hub.releaseConnection('t1');
    expect(hub.acquireConnection('t1')).toBe(true);
  });

  it('drops idle unwatched entries after 10 minutes', () => {
    const entry = hub.entryFor('t1', 'idle', meta);
    hub.sweep(entry.lastActivityMs + 11 * 60 * 1000);
    expect(hub.find('t1', 'idle')).toBeUndefined();
  });
});

describe('LiveRequestCapture (proxy tap)', () => {
  let hub: LiveSessionHubService;
  const logger = { warn: jest.fn() } as unknown as Logger;
  beforeEach(() => {
    jest.useFakeTimers();
    hub = new LiveSessionHubService();
    (hub as unknown as { logger: Logger }).logger = logger;
  });
  afterEach(() => {
    hub.onModuleDestroy();
    jest.useRealTimers();
  });

  const open = (recording = false) =>
    hub.openRequest({
      tenantId: 't1',
      agentName: 'demo',
      headers: { 'x-session-key': 'sess-1' },
      requestId: 'req',
      apiMode: 'chat_completions',
      body: { messages: [{ role: 'user', content: 'hello' }] },
      recording,
    })!;

  const chunk = (delta: unknown, finish: string | null = null) =>
    `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

  it('streams a fallback, a reasoning + text + tool call answer and completes, in order', async () => {
    const { events } = collect(hub, 't1', 'sess-1');
    const live = open(true);
    // Attempt 1 fails before streaming; attempt 2 answers.
    const r1 = ref(1);
    live.attemptStarted(r1, { provider: 'anthropic', model: 'claude-x' });
    live.attemptRequest(r1, {
      requestBody: { model: 'claude-x' },
      wireFormat: 'anthropic_messages',
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'x-api-key': 'sk-ant-secret', 'anthropic-version': '2023-06-01' },
    });
    r1.timing = { status: 429, chunks: 0, bytes: 0 };
    live.attemptResponse(r1, { type: 'json', body: { error: { message: 'rate limited' } } });
    const r2 = ref(2);
    live.attemptStarted(r2, {
      provider: 'deepseek',
      model: 'deepseek-chat',
      routeLabel: 'tier: complex',
    });
    live.attemptRequest(r2, {
      requestBody: { model: 'deepseek-chat', messages: [] },
      wireFormat: 'openai_chat_completions',
      url: 'https://api.deepseek.com/chat/completions?key=abc',
    });
    const capture = live.responseCapture(r2, undefined)!;
    capture.appendRaw(chunk({ reasoning_content: 'Think' }));
    capture.appendRaw(chunk({ reasoning_content: ' more' }));
    jest.advanceTimersByTime(0);
    capture.appendRaw(chunk({ content: 'Hi' }));
    capture.appendRaw(
      chunk({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'ls', arguments: '{}' } }] }),
    );
    capture.appendRaw(chunk({}, 'tool_calls'));
    live.completed(
      r2,
      { prompt_tokens: 10, completion_tokens: 5, cache_read_tokens: 2 },
      Promise.resolve(0.0012),
    );
    live.close();
    for (let i = 0; i < 10; i++) await Promise.resolve();

    const got = events();
    expect(got.map((e) => e.type)).toEqual([
      'message.appended',
      'request.started',
      'request.failed',
      'request.started',
      'block.started',
      'block.delta',
      'block.delta',
      'block.stopped',
      'block.started',
      'block.delta',
      'block.stopped',
      'block.started',
      'block.delta',
      'block.stopped',
      'request.completed',
    ]);
    expect(got.map((e) => e.id)).toEqual(got.map((_, i) => got[0]!.id + i));
    const [, started1, failed, started2] = got;
    expect(started1!.data).toMatchObject({
      attemptId: 'req.1',
      attempt: 1,
      provider: 'Anthropic',
      upstream: 'anthropic_messages',
    });
    expect(started1!.data.headers).toEqual({
      'x-api-key': '••••••••',
      'anthropic-version': '2023-06-01',
    });
    expect(failed!.data).toMatchObject({
      status: 429,
      message: 'rate limited',
      errorClass: 'rate_limit',
      next: 'fallback',
      interrupted: false,
    });
    expect(started2!.data).toMatchObject({
      attemptId: 'req.2',
      attempt: 2,
      route: 'tier: complex · fallback #1',
      endpoint: 'https://api.deepseek.com/chat/completions?key=***',
    });
    // Deltas of one block within a window are coalesced; the text is whole.
    const state = reduceLiveEvents(got);
    const attempt = state.items.find((i) => i.kind === 'attempt' && i.attemptId === 'req.2') as {
      blocks: Array<{ type: string; text: string }>;
      stopReason: string;
      usage: unknown;
      costUsd: number;
    };
    expect(attempt.blocks.map((b) => [b.type, b.text])).toEqual([
      ['thinking', 'Think more'],
      ['text', 'Hi'],
      ['tool_use', '{}'],
    ]);
    expect(attempt.stopReason).toBe('tool_calls');
    expect(attempt.usage).toEqual({
      input: 10,
      output: 5,
      cacheRead: 2,
      cacheWrite: 0,
      reasoning: 0,
    });
    expect(attempt.costUsd).toBe(0.0012);
    expect(JSON.stringify(got)).not.toContain('sk-ant-secret');
  });

  it('a cancelled stream keeps the partial text and the last block open', () => {
    const { events } = collect(hub, 't1', 'sess-1');
    const live = open();
    const r = ref(1);
    live.attemptStarted(r, { provider: 'openai', model: 'gpt' });
    live.attemptRequest(r, { requestBody: {}, wireFormat: 'openai_chat_completions' });
    live.responseCapture(r, undefined)!.appendRaw(chunk({ content: 'par' }));
    live.cancelled(r, { prompt_tokens: 3, completion_tokens: 1 });
    live.close();
    const got = events();
    expect(got.map((e) => e.type)).toEqual([
      'message.appended',
      'request.started',
      'block.started',
      'block.delta',
      'request.cancelled',
    ]);
    expect(got.at(-1)!.data).toMatchObject({
      reason: 'client_closed',
      usage: { input: 3, output: 1 },
    });
  });

  it('never throws into the proxy: a failure turns the capture off with a warning', () => {
    const live = open();
    const r = ref(1);
    live.attemptStarted(r, { provider: 'openai', model: 'gpt' });
    const entry = hub.find('t1', 'sess-1')!;
    jest.spyOn(hub, 'emit').mockImplementation(() => {
      throw new Error('boom');
    });
    const capture = live.responseCapture(r, undefined)!;
    expect(() => {
      capture.appendRaw(chunk({ content: 'x' }));
      jest.advanceTimersByTime(0);
      live.completed(r, null, null);
      live.close();
    }).not.toThrow();
    expect(logger.warn).toHaveBeenCalled();
    expect(entry.inFlight).toBe(0);
  });

  it('keeps the recording capture working through the composite', () => {
    const live = open(true);
    const r = ref(1);
    live.attemptStarted(r, { provider: 'openai', model: 'gpt' });
    const recording = {
      appendRaw: jest.fn(),
      setJson: jest.fn(),
      setRaw: jest.fn(),
      buildResponseBody: jest.fn(),
      buildRecording: jest.fn(),
    };
    const capture = live.responseCapture(r, recording)!;
    capture.appendRaw('data: {}\n\n');
    capture.setJson({ ok: 1 });
    expect(recording.appendRaw).toHaveBeenCalledWith('data: {}\n\n');
    expect(recording.setJson).toHaveBeenCalledWith({ ok: 1 });
    live.close();
  });
});
