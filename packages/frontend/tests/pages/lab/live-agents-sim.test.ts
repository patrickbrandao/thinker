import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Fleet, fitTurns, fleetLoadPage } from '../../../src/pages/lab/live-agents-sim';
import { SCENARIOS } from '../../../src/pages/lab/live-session-sim';
import { LiveSessionFeed } from '../../../src/services/live-session-feed';

/** Runs every timer until the fleet has no session playing. */
async function playToEnd(fleet: Fleet) {
  for (let i = 0; i < 2000 && fleet.stats().active > 0; i++) await vi.advanceTimersByTimeAsync(500);
}

const runningIds = async (fleet: Fleet) => {
  const res = await fleet.fetch('/api/v1/sessions?running=true&limit=100');
  const body = (await res.json()) as { items: { id: string; in_flight: number }[] };
  return body.items.map((s) => s.id);
};

let fleet: Fleet;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  fleet?.dispose();
  vi.useRealTimers();
});

describe('Live agents lab: fake backend', () => {
  it('lists a started session as running and drops it after it ends', async () => {
    fleet = new Fleet(
      {
        agents: 1,
        speed: 20,
        startIntervalSec: 600,
        runningWindowSec: 0,
        fallbackPct: 0,
        cutPct: 0,
      },
      { autoStart: false },
    );
    fleet.start();
    await vi.advanceTimersByTimeAsync(0);
    const [id] = [...fleet.sessions.keys()];
    expect(id).toMatch(/^ses_/);
    expect(await runningIds(fleet)).toEqual([id]);

    await playToEnd(fleet);
    expect(fleet.stats().ended).toBe(1);
    expect(await runningIds(fleet)).toEqual([]);
    // History stays available for the replay bar.
    const page = await fleetLoadPage(fleet)(id!, { after: 0 });
    expect(page.events.length).toBeGreaterThan(5);
    expect(page.events[0]!.id).toBe(1);
  });

  it('injects a 429 that falls back when asked to', async () => {
    fleet = new Fleet({ agents: 1, speed: 20, fallbackPct: 100, cutPct: 0 }, { autoStart: false });
    fleet.start();
    const s = fleet.startSession(fleet.agents[0]);
    await playToEnd(fleet);
    const failed = s.log.filter((e) => e.type === 'request.failed');
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0]!.data).toMatchObject({ status: 429, next: 'fallback' });
    const started = s.log.find((e) => e.type === 'request.started')!;
    expect(started.data.upstream).toMatch(
      /^(anthropic_messages|openai_responses|openai_chat_completions)$/,
    );
  });

  it('fits a scenario to the requested number of turns', () => {
    const steps = fitTurns(SCENARIOS[0]!.steps, 7);
    expect(steps.filter((s) => s.kind === 'request')).toHaveLength(7);
    expect(steps.at(-1)!.kind).toBe('request');
  });

  it('feeds the official client a snapshot, then live events, through the fake EventSource', async () => {
    fleet = new Fleet({ agents: 1, speed: 1, fallbackPct: 0, cutPct: 0 }, { autoStart: false });
    fleet.start();
    await vi.advanceTimersByTimeAsync(1500);
    const [id] = [...fleet.sessions.keys()];
    const feed = new LiveSessionFeed(id!, {
      live: true,
      EventSource: fleet.EventSource,
      fetch: fleet.fetch,
      loadPage: fleetLoadPage(fleet),
    });
    const receive = vi.spyOn(feed, 'receive');
    feed.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(receive.mock.calls[0]![0].type).toBe('snapshot');
    expect(feed.session).toMatchObject({ sessionId: id, harness: 'Claude Code' });
    const atSnapshot = feed.state.lastEventId;
    expect(atSnapshot).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(3000);
    expect(receive.mock.calls.length).toBeGreaterThan(1);
    expect(receive.mock.calls.slice(1).every(([ev]) => ev.type !== 'snapshot')).toBe(true);
    expect(feed.state.lastEventId).toBeGreaterThan(atSnapshot);
    expect(feed.conn).toBe('open');
    expect(fleet.stats().liveConnections).toBe(1);
    feed.dispose();
    expect(fleet.stats().liveConnections).toBe(0);
  });

  it('replays only the missed events for a lastEventId join', async () => {
    fleet = new Fleet({ agents: 1, speed: 1, fallbackPct: 0, cutPct: 0 }, { autoStart: false });
    fleet.start();
    await vi.advanceTimersByTimeAsync(3000);
    const [s] = [...fleet.sessions.values()];
    const got: number[] = [];
    const es = new fleet.EventSource(`/api/v1/sessions/${s!.id}/live?lastEventId=2`);
    es.addEventListener('message.appended', (e) =>
      got.push(JSON.parse((e as MessageEvent).data).id),
    );
    es.addEventListener('snapshot', () => got.push(-1));
    await vi.advanceTimersByTimeAsync(0);
    es.close();
    expect(got).not.toContain(-1);
    expect(got.every((id) => id > 2)).toBe(true);
  });
});

describe('Live agents lab: routing', () => {
  it('registers every lab route behind import.meta.env.DEV only', () => {
    const src = readFileSync(resolve(__dirname, '../../../src/index.tsx'), 'utf8');
    const imports = [...src.matchAll(/import\('\.\/pages\/lab\/([^']+)'\)/g)];
    expect(imports.map((m) => m[1])).toContain('LiveAgentsLab.jsx');
    for (const m of imports) {
      const before = src.slice(Math.max(0, m.index! - 120), m.index);
      expect(before).toMatch(/import\.meta\.env\.DEV\s*\?\s*lazyReload\(\(\) => $/);
    }
    expect(src).toMatch(/\{LiveAgentsLab && \(\s*<Route\s+path="lab\/live-agents"/);
    expect(imports.map((m) => m[1])).toContain('LiveAgentsWatch.jsx');
    expect(src).toMatch(
      /\{LiveAgentsWatch && \(\s*<Route\s+path="lab\/live-agents\/watch\/:sessionId"/,
    );
  });
});
