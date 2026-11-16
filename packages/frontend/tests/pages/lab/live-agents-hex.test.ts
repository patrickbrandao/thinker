import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyLiveState, type LiveAttempt, type LiveState } from 'thinker-shared';
import {
  AutoCloser,
  MIN_WINDOW,
  cascadePosition,
  clampSize,
  effortOf,
  finalAttempt,
  freeSlot,
  lastItemKind,
  resizeFrom,
  windowSize,
  type AutoCloseInput,
} from '../../../src/pages/lab/live-agents-hex';

describe('cascadePosition', () => {
  const o = { width: 400, height: 300, areaWidth: 1400, areaHeight: 1000, step: 28, margin: 12 };

  it('starts below a free band as tall as one window and steps +28 px', () => {
    const top = 12 + 300 + 12;
    expect(cascadePosition(0, o)).toEqual({ x: 12, y: top });
    expect(cascadePosition(1, o)).toEqual({ x: 40, y: top + 28 });
    expect(cascadePosition(2, o)).toEqual({ x: 68, y: top + 56 });
  });

  it('never places a window in the reserved band', () => {
    for (let slot = 0; slot < 60; slot++)
      expect(cascadePosition(slot, o).y).toBeGreaterThanOrEqual(324);
  });

  it('wraps back to the top of the cascade before leaving the viewport', () => {
    // (1000 - 12 - 324 - 300 - 14) / 28 = 12 steps -> 13 windows per run.
    const last = cascadePosition(12, o);
    expect(last.y + o.height).toBeLessThanOrEqual(o.areaHeight - 12);
    const wrapped = cascadePosition(13, o);
    expect(wrapped.y).toBe(324);
    expect(wrapped.x).toBeGreaterThan(cascadePosition(0, o).x);
    for (let slot = 0; slot < 80; slot++) {
      const p = cascadePosition(slot, o);
      expect(p.x + o.width).toBeLessThanOrEqual(o.areaWidth);
      expect(p.y + o.height).toBeLessThanOrEqual(o.areaHeight);
    }
  });

  it('keeps the band even when the viewport is too short (the wall scrolls)', () => {
    expect(cascadePosition(3, { ...o, areaHeight: 400 }).y).toBe(324);
  });

  it('reuses the first free slot', () => {
    expect(freeSlot([])).toBe(0);
    expect(freeSlot([0, 1, 3])).toBe(2);
  });
});

// ------------------------------------------------------------- auto-close

const attempt = (patch: Partial<LiveAttempt>): LiveAttempt => ({
  kind: 'attempt',
  requestId: 'req_1',
  attemptId: 'req_1.1',
  attempt: 1,
  model: 'gpt-5.5-mini',
  provider: 'openai',
  route: null,
  upstream: null,
  endpoint: null,
  status: 'done',
  startedTs: 0,
  blocks: [],
  ...patch,
});

const stateWith = (...items: LiveState['items']): LiveState => ({ ...emptyLiveState(), items });

describe('lastItemKind', () => {
  it('reads the last item of the conversation', () => {
    expect(lastItemKind(stateWith(attempt({ stopReason: 'end_turn' })))).toBe('answer');
    expect(lastItemKind(stateWith(attempt({ stopReason: 'tool_use' })))).toBe('tool');
    expect(
      lastItemKind(
        stateWith(attempt({ stopReason: 'tool_use' }), {
          kind: 'message',
          seq: 0,
          ts: 0,
          role: 'tool',
          text: 'ok',
        }),
      ),
    ).toBe('tool');
    expect(lastItemKind(stateWith(attempt({ status: 'streaming' })))).toBe('busy');
    expect(lastItemKind(stateWith())).toBe('busy');
  });
});

describe('AutoCloser', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const timeouts = { answerMs: 10_000, toolMs: 60_000 };
  const base: AutoCloseInput = {
    kind: 'answer',
    activity: 1,
    pinned: false,
    ended: false,
    paused: false,
  };

  it('closes 10 s after an assistant answer', () => {
    const onClose = vi.fn();
    const c = new AutoCloser(onClose);
    expect(c.update(base, timeouts)).toMatchObject({ totalMs: 10_000, paused: false });
    vi.advanceTimersByTime(9_999);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes 60 s after a tool call', () => {
    const onClose = vi.fn();
    const c = new AutoCloser(onClose);
    c.update({ ...base, kind: 'tool' }, timeouts);
    vi.advanceTimersByTime(59_000);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('new activity resets the timer and keeps the window', () => {
    const onClose = vi.fn();
    const c = new AutoCloser(onClose);
    c.update(base, timeouts);
    vi.advanceTimersByTime(8_000);
    // The session started streaming again: no countdown while busy.
    expect(c.update({ ...base, kind: 'busy', activity: 2 }, timeouts)).toBeNull();
    vi.advanceTimersByTime(120_000);
    expect(onClose).not.toHaveBeenCalled();
    // A new answer starts a fresh 10 s.
    c.update({ ...base, activity: 3 }, timeouts);
    vi.advanceTimersByTime(9_000);
    c.update({ ...base, activity: 4 }, timeouts);
    vi.advanceTimersByTime(9_000);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('never closes a pinned window', () => {
    const onClose = vi.fn();
    const c = new AutoCloser(onClose);
    expect(c.update({ ...base, pinned: true }, timeouts)).toBeNull();
    vi.advanceTimersByTime(600_000);
    expect(onClose).not.toHaveBeenCalled();
    // Unpinned: the countdown starts from that moment.
    c.update(base, timeouts);
    vi.advanceTimersByTime(10_000);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('hovering pauses the countdown and leaving resumes it', () => {
    const onClose = vi.fn();
    const c = new AutoCloser(onClose);
    c.update(base, timeouts);
    vi.advanceTimersByTime(6_000);
    expect(c.update({ ...base, paused: true }, timeouts)).toMatchObject({
      remainingMs: 4_000,
      paused: true,
    });
    vi.advanceTimersByTime(60_000);
    expect(onClose).not.toHaveBeenCalled();
    c.update(base, timeouts);
    vi.advanceTimersByTime(3_999);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('an ended session that was not answered uses the tool-call timeout', () => {
    const onClose = vi.fn();
    const c = new AutoCloser(onClose);
    expect(c.update({ ...base, kind: 'busy', ended: true }, timeouts)?.totalMs).toBe(60_000);
  });

  it('stops after dispose', () => {
    const onClose = vi.fn();
    const c = new AutoCloser(onClose);
    c.update(base, timeouts);
    c.dispose();
    vi.advanceTimersByTime(20_000);
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------- footer

describe('effortOf', () => {
  it('reads OpenAI Chat and Responses bodies', () => {
    expect(effortOf({ model: 'x', reasoning_effort: 'low' })).toBe('Low');
    expect(effortOf({ reasoning: { effort: 'high', summary: 'auto' } })).toBe('High');
    expect(effortOf({ reasoning: { effort: 'xhigh' } })).toBe('Extra high');
  });

  it('maps the Anthropic thinking budget to a level', () => {
    expect(effortOf({ thinking: { type: 'enabled', budget_tokens: 2_048 } })).toBe('Low');
    expect(effortOf({ thinking: { type: 'enabled', budget_tokens: 8_000 } })).toBe('Medium');
    expect(effortOf({ thinking: { type: 'enabled', budget_tokens: 16_000 } })).toBe('High');
    expect(effortOf({ thinking: { type: 'disabled' } })).toBe('Off');
    expect(effortOf({ output_config: { effort: 'medium' } })).toBe('Medium');
  });

  it('reads Gemini thinkingConfig', () => {
    expect(effortOf({ generationConfig: { thinkingConfig: { thinkingLevel: 'low' } } })).toBe(
      'Low',
    );
    expect(effortOf({ generationConfig: { thinkingConfig: { thinkingBudget: 0 } } })).toBe('Off');
  });

  it('is null when the body says nothing or is not recorded', () => {
    expect(effortOf(undefined)).toBeNull();
    expect(effortOf('[…]')).toBeNull();
    expect(effortOf({ model: 'x', messages: [] })).toBeNull();
  });
});

describe('finalAttempt', () => {
  it('is the attempt that answered after a fallback', () => {
    const failed = attempt({ attemptId: 'a1', status: 'failed', model: 'claude-opus-5.5' });
    const ok = attempt({ attemptId: 'a2', attempt: 2, status: 'done', model: 'gpt-5.5-mini' });
    expect(finalAttempt(stateWith(failed, ok))?.model).toBe('gpt-5.5-mini');
  });

  it('falls back to the latest attempt when none answered', () => {
    const a = attempt({ status: 'waiting', model: 'm1' });
    expect(finalAttempt(stateWith(a))?.model).toBe('m1');
    expect(finalAttempt(stateWith())).toBeNull();
  });
});

// ------------------------------------------------------------------ resize

describe('window resize', () => {
  const viewport = { w: 1200, h: 800 };

  it('clamps to the minimum and to the viewport', () => {
    expect(clampSize({ w: 100, h: 50 }, viewport)).toEqual(MIN_WINDOW);
    expect(clampSize({ w: 5000, h: 5000 }, viewport)).toEqual(viewport);
    expect(clampSize({ w: 640.4, h: 480.6 }, viewport)).toEqual({ w: 640, h: 481 });
    // A viewport smaller than the minimum wins.
    expect(clampSize({ w: 400, h: 400 }, { w: 280, h: 200 })).toEqual({ w: 280, h: 200 });
  });

  it('moves only the dragged edges', () => {
    const start = { w: 420, h: 360 };
    expect(resizeFrom(start, 'se', 50, 40, viewport)).toEqual({ w: 470, h: 400 });
    expect(resizeFrom(start, 'e', 50, 40, viewport)).toEqual({ w: 470, h: 360 });
    expect(resizeFrom(start, 's', 50, 40, viewport)).toEqual({ w: 420, h: 400 });
    expect(resizeFrom(start, 'se', -400, -400, viewport)).toEqual(MIN_WINDOW);
  });

  it('keeps a window its own size; others use the layout size', () => {
    const layout = { w: 420, h: 360 };
    expect(windowSize({}, layout, viewport)).toEqual(layout);
    expect(windowSize({ w: 700, h: 500 }, layout, viewport)).toEqual({ w: 700, h: 500 });
    // A saved size larger than a smaller viewport now is shown clamped.
    expect(windowSize({ w: 700, h: 500 }, layout, { w: 600, h: 400 })).toEqual({ w: 600, h: 400 });
    expect(windowSize({}, { w: 900, h: 360 }, { w: 600, h: 400 })).toEqual({ w: 600, h: 360 });
  });
});
