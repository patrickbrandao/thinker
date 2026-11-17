import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { LiveEvent, LiveEventType } from 'thinker-shared';
import {
  LiveSessionWindowsProvider,
  useLiveSessions,
} from '../../../src/components/live-session/LiveSessionWindows';
import { LIVE_WINDOWS_KEY } from '../../../src/components/live-session/live-windows-store';
import { LiveSessionFeed } from '../../../src/services/live-session-feed';

let id = 0;
const ev = (type: LiveEventType, data: Record<string, unknown>): LiveEvent => ({
  id: ++id,
  type,
  ts: 1_000 + id,
  data,
});

/** A feed with no network: events are pushed with `receive`. */
function makeFeed(sessionId: string, live: boolean) {
  const feed = new LiveSessionFeed(sessionId, {
    live,
    EventSource: undefined,
    loadPage: vi.fn(async () => ({
      session: { sessionId, agentName: null, harness: null },
      events: [],
      next_after: null,
    })),
  });
  feeds.set(sessionId, feed);
  return feed;
}
const feeds = new Map<string, LiveSessionFeed>();

function Opener() {
  const w = useLiveSessions()!;
  return (
    <>
      {['s1', 's2', 's3', 's4', 's5'].map((s) => (
        <button key={s} type="button" onClick={() => w.openLiveSession(s)}>
          open {s}
        </button>
      ))}
    </>
  );
}

const renderShell = () =>
  render(
    <MemoryRouter>
      <LiveSessionWindowsProvider createFeed={makeFeed}>
        <Opener />
      </LiveSessionWindowsProvider>
    </MemoryRouter>,
  );

describe('LiveSessionWindowsProvider', () => {
  it('opens windows, keeps at most four, persists them and restores after a reload', () => {
    localStorage.removeItem(LIVE_WINDOWS_KEY);
    const view = renderShell();
    for (const s of ['s1', 's2', 's3', 's4', 's5']) fireEvent.click(screen.getByText(`open ${s}`));
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(4);
    expect(screen.queryByRole('dialog', { name: 'Live session s1' })).toBeNull();

    // Live events render in the window (Chat tab).
    const feed = feeds.get('s2')!;
    act(() => {
      id = 0;
      const a = { requestId: 'r1', attemptId: 'r1.1' };
      for (const e of [
        ev('message.appended', { seq: 0, role: 'user', text: 'fix the bug' }),
        ev('request.started', { ...a, attempt: 1, model: 'm1', provider: 'P' }),
        ev('block.started', { ...a, index: 0, type: 'text' }),
        ev('block.delta', { ...a, index: 0, delta: 'On it.' }),
      ])
        feed.receive(e);
      feed.flush();
    });
    const s2 = screen.getByRole('dialog', { name: 'Live session s2' });
    expect(s2.textContent).toContain('fix the bug');
    expect(s2.textContent).toContain('On it.');
    expect(s2.textContent).toContain('Streaming');

    // Switch the tab and the mode: both are saved per session.
    fireEvent.click(s2.querySelector('[role="tab"]:nth-child(3)')!);
    expect(s2.textContent).toContain('Recording is off for this harness');
    fireEvent.click(screen.getAllByRole('button', { name: 'Minimize' })[0]!);

    const saved = JSON.parse(localStorage.getItem(LIVE_WINDOWS_KEY)!);
    expect(saved.open.map((e: { sessionId: string }) => e.sessionId)).toEqual([
      's2',
      's3',
      's4',
      's5',
    ]);
    expect(saved.prefs.s2.tab).toBe('inspector');
    expect(saved.prefs.s2.mode).toBe('minimized');

    view.unmount();
    expect(feed.conn).toBe('closed');

    renderShell();
    expect(screen.getAllByRole('dialog')).toHaveLength(4);
    // Closing removes the window and its entry.
    const close = screen.getAllByRole('button', { name: 'Close' })[0]!;
    fireEvent.click(close);
    expect(screen.getAllByRole('dialog')).toHaveLength(3);
    const after = JSON.parse(localStorage.getItem(LIVE_WINDOWS_KEY)!);
    expect(after.open).toHaveLength(3);
  });
});
