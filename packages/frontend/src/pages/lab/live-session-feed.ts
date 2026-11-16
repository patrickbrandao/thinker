/**
 * Lab only: the browser side of the live session feed, one per window. It
 * keeps the Last-Event-ID, survives drops (replay) and closes (snapshot on the
 * next open), and batches React renders to one per animation frame.
 */
import { useSyncExternalStore } from 'react';
import {
  SimServer,
  applyEvent,
  emptyState,
  type Delivery,
  type LiveState,
  type SessionMeta,
  type WireEvent,
} from './live-session-sim.js';

export type ConnState = 'closed' | 'connecting' | 'open' | 'reconnecting';

export interface Frame {
  ev: WireEvent;
  how: Delivery;
}

export class FeedClient {
  state: LiveState = emptyState();
  session: SessionMeta;
  lastId: number | null = null;
  frames: Frame[] = [];
  conn: ConnState = 'closed';
  version = 0;
  private unsubscribe: (() => void) | null = null;
  private listeners = new Set<() => void>();
  private raf = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly server: SimServer) {
    this.session = server.scenario.session;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = () => this.version;

  private notify = () => {
    this.raf = 0;
    this.version += 1;
    for (const l of this.listeners) l();
  };

  private schedule() {
    if (!this.raf) this.raf = requestAnimationFrame(this.notify);
  }

  open() {
    if (this.unsubscribe) return;
    this.conn = this.lastId == null ? 'connecting' : 'reconnecting';
    this.unsubscribe = this.server.connect((ev, how) => {
      if (ev.type === 'snapshot') this.session = ev.data.session as SessionMeta;
      applyEvent(this.state, ev);
      this.lastId = this.state.lastEventId;
      this.frames.push({ ev, how });
      if (this.frames.length > 600) this.frames.splice(0, this.frames.length - 600);
      this.schedule();
    }, this.lastId);
    this.conn = 'open';
    this.schedule();
  }

  /** The window closed: the next open joins again with a snapshot. */
  close() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.retry) clearTimeout(this.retry);
    this.conn = 'closed';
    this.lastId = null;
    this.schedule();
  }

  /** The network dropped: reconnect after `ms` with Last-Event-ID. */
  drop(ms: number) {
    if (!this.unsubscribe) return;
    this.unsubscribe();
    this.unsubscribe = null;
    this.conn = 'reconnecting';
    this.schedule();
    this.retry = setTimeout(() => {
      if (this.conn === 'reconnecting') this.open();
    }, ms);
  }

  dispose() {
    this.close();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.listeners.clear();
  }
}

/** Re-renders the component on every batched update of the client. */
export function useFeed(client: FeedClient) {
  useSyncExternalStore(client.subscribe, client.getVersion);
  return client;
}

/** Re-renders on every change of the simulated server (lab controls). */
export function useServer(server: SimServer) {
  useSyncExternalStore(
    (fn) => server.watch(fn),
    () => `${server.progress.done}:${server.playing}`,
  );
  return server;
}
