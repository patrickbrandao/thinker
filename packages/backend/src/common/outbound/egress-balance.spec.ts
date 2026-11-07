import {
  QUARANTINE_MS,
  isQuarantined,
  planGroup,
  quarantineProxy,
  rendezvousOrder,
  resetBalanceStateForTests,
  type EgressGroup,
} from './egress-balance';
import type { OutboundProxy } from './outbound-proxy';

function px(id: string, enabled = true): OutboundProxy {
  return {
    id,
    name: id,
    scheme: 'http',
    host: '127.0.0.1',
    port: 1,
    username: null,
    password: null,
    enabled,
    connectTimeoutMs: 1000,
    debug: false,
    version: 'v1',
  };
}

function group(extra: Partial<EgressGroup> = {}): EgressGroup {
  return {
    kind: 'group',
    key: 't:p:1',
    mode: 'affinity',
    members: [px('a'), px('b'), px('c')],
    onFailure: 'next_member',
    noSession: 'request',
    ...extra,
  };
}

const ids = (list: OutboundProxy[]) => list.map((p) => p.id);

afterEach(() => resetBalanceStateForTests());

describe('rendezvousOrder', () => {
  it('is stable per key and spreads keys over every member', () => {
    const members = [px('a'), px('b'), px('c')];
    expect(ids(rendezvousOrder('s1', members))).toEqual(ids(rendezvousOrder('s1', members)));
    const firsts = new Set<string>();
    for (let i = 0; i < 200; i++) firsts.add(rendezvousOrder(`s${i}`, members)[0]!.id);
    expect(firsts).toEqual(new Set(['a', 'b', 'c']));
  });

  it('adding a member moves only the sessions that now hash to it', () => {
    const before = [px('a'), px('b'), px('c')];
    const after = [...before, px('d')];
    let moved = 0;
    for (let i = 0; i < 1000; i++) {
      const was = rendezvousOrder(`s${i}`, before)[0]!.id;
      const now = rendezvousOrder(`s${i}`, after)[0]!.id;
      if (was !== now) {
        expect(now).toBe('d');
        moved++;
      }
    }
    expect(moved).toBeGreaterThan(150);
    expect(moved).toBeLessThan(350);
  });
});

describe('planGroup', () => {
  it('session affinity: same session, same proxy; the rest in hash order', () => {
    const one = planGroup(group(), false, { sessionKey: 'sess-1' });
    const two = planGroup(group(), false, { sessionKey: 'sess-1' });
    expect(one.strategy).toBe('affinity');
    expect(ids(one.order)).toEqual(ids(two.order));
    expect(one.order).toHaveLength(3);
  });

  it('a quarantined proxy is skipped and the session comes back after it', () => {
    const now = 1_000_000;
    const own = planGroup(group(), false, { sessionKey: 'sess-9' }, { now }).order[0]!.id;
    quarantineProxy(own, now);
    const during = planGroup(group(), false, { sessionKey: 'sess-9' }, { now: now + 1 });
    expect(ids(during.order)).not.toContain(own);
    expect(isQuarantined(own, now + QUARANTINE_MS + 1)).toBe(false);
    const later = planGroup(
      group(),
      false,
      { sessionKey: 'sess-9' },
      { now: now + QUARANTINE_MS + 1 },
    );
    expect(later.order[0]!.id).toBe(own);
  });

  it('without a session: per request (default), agent key or first proxy', () => {
    const rr = [0, 1, 2, 3].map(() => planGroup(group(), false, null).order[0]!.id);
    expect(rr).toEqual(['a', 'b', 'c', 'a']);
    const agent = planGroup(group({ noSession: 'agent' }), false, { agentKey: 'ag-1' });
    expect(agent.strategy).toBe('affinity');
    expect(ids(agent.order)).toEqual(ids(rendezvousOrder('agent:ag-1', group().members)));
    const noAgent = planGroup(group({ noSession: 'agent' }), false, {});
    expect(noAgent.strategy).toBe('request');
    const first = planGroup(group({ noSession: 'first' }), false, null);
    expect(first.strategy).toBe('first');
    expect(ids(first.order)).toEqual(['a', 'b', 'c']);
  });

  it('per request: round-robin start, the others drawn after it', () => {
    const g = group({ mode: 'request', key: 'rr' });
    const plans = [0, 1, 2].map(() =>
      planGroup(g, false, { sessionKey: 'ignored' }, { random: () => 0 }),
    );
    expect(plans.map((p) => p.order[0]!.id)).toEqual(['a', 'b', 'c']);
    expect(plans.every((p) => p.strategy === 'request' && p.order.length === 3)).toBe(true);
  });

  it('"skip to next line" keeps a single try', () => {
    expect(
      planGroup(group({ onFailure: 'next_line' }), false, { sessionKey: 's' }).order,
    ).toHaveLength(1);
  });

  it('disabled members never take part', () => {
    const g = group({ members: [px('a', false), px('b')] });
    expect(ids(planGroup(g, false, { sessionKey: 's' }).order)).toEqual(['b']);
    const none = planGroup(group({ members: [px('a', false)] }), false, null);
    expect(none.order).toEqual([]);
    expect(none.skipped.map((s) => s.result)).toEqual(['skipped_disabled']);
  });

  it('a fully quarantined line is skipped, unless it is the last line', () => {
    for (const id of ['a', 'b', 'c']) quarantineProxy(id);
    const skipped = planGroup(group(), false, { sessionKey: 's' });
    expect(skipped.order).toEqual([]);
    expect(skipped.skipped.map((s) => s.result)).toEqual([
      'skipped_quarantine',
      'skipped_quarantine',
      'skipped_quarantine',
    ]);
    expect(planGroup(group(), true, { sessionKey: 's' }).order).toHaveLength(3);
  });
});
