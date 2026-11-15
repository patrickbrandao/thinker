import { EventEmitter } from 'node:events';
import { HttpException, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { LiveSessionController } from './live-session.controller';
import { LiveSessionHubService } from './live-session-hub.service';
import type { LiveSessionHistoryService } from './live-session-history.service';

function fakeRes() {
  const res = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const chunks: string[] = [];
  Object.assign(res, {
    headers: {} as Record<string, string>,
    writableLength: 0,
    writableEnded: false,
    destroyed: false,
    headersSent: false,
    status: jest.fn(() => res),
    setHeader: jest.fn((k: string, v: string) => ((res.headers as Record<string, string>)[k] = v)),
    flushHeaders: jest.fn(() => (res.headersSent = true)),
    write: jest.fn((c: string) => chunks.push(c)),
    end: jest.fn(() => (res.writableEnded = true)),
  });
  return { res: res as unknown as Response, chunks, emitter: res };
}

describe('LiveSessionController', () => {
  let hub: LiveSessionHubService;
  let history: jest.Mocked<
    Pick<LiveSessionHistoryService, 'exists' | 'meta' | 'seedState' | 'events'>
  >;
  let controller: LiveSessionController;
  const req = { headers: {} } as Request;

  beforeEach(() => {
    hub = new LiveSessionHubService();
    // Visible only to tenant t1.
    history = {
      exists: jest.fn(async (tenantId: string) => tenantId === 't1'),
      meta: jest.fn(async (_t: string, sessionId: string) => ({
        sessionId,
        agentName: 'demo',
        harness: null,
      })),
      seedState: jest.fn(async () => null),
      events: jest.fn(async () => ({
        session: { sessionId: 's', agentName: null, harness: null },
        events: [],
        next_after: null,
      })),
    } as never;
    controller = new LiveSessionController(hub, history as unknown as LiveSessionHistoryService);
  });
  afterEach(() => hub.onModuleDestroy());

  it("answers 404 for another organization's session, live and history", async () => {
    // The hub even has an entry under t1: t2 must not reach it.
    hub.entryFor('t1', 's', { sessionId: 's', agentName: null, harness: null });
    const { res } = fakeRes();
    await expect(
      controller.live('s', {}, { tenantId: 't2', userId: 'u' }, req, res),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.events('s', {}, { tenantId: 't2', userId: 'u' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.events('s', {}, { tenantId: null, userId: 'u' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(history.events).not.toHaveBeenCalled();
  });

  it('opens with retry, then a snapshot, then live events; headers set for SSE', async () => {
    const { res, chunks, emitter } = fakeRes();
    await controller.live('s', {}, { tenantId: 't1', userId: 'u', role: 'viewer' }, req, res);
    expect((res as unknown as { headers: Record<string, string> }).headers).toMatchObject({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
    expect(chunks[0]).toBe('retry: 3000\n\n');
    expect(chunks[1]).toMatch(/^id: \d+\nevent: snapshot\ndata: /);
    const entry = hub.find('t1', 's')!;
    hub.emit(entry, 'message.appended', { role: 'user', text: 'hi' });
    expect(chunks[2]).toMatch(/event: message\.appended/);
    emitter.emit('close');
    expect(entry.subscribers.size).toBe(0);
  });

  it('resumes after Last-Event-ID (header or ?lastEventId=) without a snapshot', async () => {
    const entry = hub.entryFor('t1', 's', { sessionId: 's', agentName: null, harness: null });
    const a = hub.emit(entry, 'message.appended', { role: 'user', text: 'a' });
    hub.emit(entry, 'message.appended', { role: 'user', text: 'b' });
    const { res, chunks } = fakeRes();
    await controller.live(
      's',
      { lastEventId: String(a.id) },
      { tenantId: 't1', userId: 'u' },
      req,
      res,
    );
    expect(chunks.slice(1)).toHaveLength(1);
    expect(chunks[1]).toContain('"text":"b"');
    expect(history.seedState).not.toHaveBeenCalled();
  });

  it('refuses the 21st connection of an organization with 429', async () => {
    for (let i = 0; i < 20; i++) {
      await controller.live('s', {}, { tenantId: 't1', userId: 'u' }, req, fakeRes().res);
    }
    const err = await controller
      .live('s', {}, { tenantId: 't1', userId: 'u' }, req, fakeRes().res)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
  });

  it('closes a client whose unsent output passes 1 MB', async () => {
    const { res, emitter } = fakeRes();
    await controller.live('s', {}, { tenantId: 't1', userId: 'u' }, req, res);
    (emitter as unknown as { writableLength: number }).writableLength = 2 * 1024 * 1024;
    hub.emit(hub.find('t1', 's')!, 'message.appended', { role: 'user', text: 'x' });
    expect(res.end).toHaveBeenCalled();
  });

  it('history: bodies for every member, headers only for admins', async () => {
    await controller.events(
      's',
      { after: '5', limit: '10' },
      { tenantId: 't1', userId: 'u', role: 'member' },
    );
    expect(history.events).toHaveBeenCalledWith(
      't1',
      's',
      { bodies: true, headers: false },
      { after: 5, until: null, limit: 10 },
    );
    await controller.events('s', {}, { tenantId: 't1', userId: 'u', role: 'admin' });
    expect(history.events).toHaveBeenLastCalledWith(
      't1',
      's',
      { bodies: true, headers: true },
      { after: 0, until: null, limit: 1000 },
    );
  });
});
