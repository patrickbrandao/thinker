import type {
  PlaygroundHistoryRunDetail,
  PlaygroundMetrics,
  PlaygroundRunResult,
  PlaygroundStreamEvent,
} from '../src/playground';
import type { ResolveResponse } from '../src/resolve-response';

// These modules are wire contracts (types only). The assertions below pin the
// shape through the compiler (ts-jest type-checks this file) and through a
// JSON round-trip, so an accidental rename or a non-serializable field fails
// here before it reaches the dashboard, CLI or MCP clients.

const metrics: PlaygroundMetrics = {
  cost: 0.0012,
  inputTokens: 10,
  outputTokens: 20,
  durationMs: 900,
  ttftMs: 120,
  tokensPerSec: 22.2,
};

function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('playground wire contract', () => {
  it('allows the optional metrics to be null or absent', () => {
    const minimal: PlaygroundMetrics = {
      cost: null,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
    };
    const nulls: PlaygroundMetrics = { ...minimal, ttftMs: null, tokensPerSec: null };
    expect(roundTrip(minimal)).toEqual(minimal);
    expect(roundTrip(nulls)).toEqual(nulls);
  });

  it('round-trips a run result', () => {
    const run: PlaygroundRunResult = {
      content: 'hello',
      metrics,
      headers: { 'x-thinker-model': 'gpt-5' },
    };
    expect(roundTrip(run)).toEqual(run);
  });

  it('discriminates stream events on type', () => {
    const events: PlaygroundStreamEvent[] = [
      { type: 'delta', text: 'he' },
      { type: 'delta', text: 'llo' },
      { type: 'done', columnId: 'col-1', content: 'hello', metrics, headers: {} },
      { type: 'error', message: 'boom' },
    ];
    const text = events
      .map((event) => {
        switch (event.type) {
          case 'delta':
            return event.text;
          case 'done':
            return `[done:${event.columnId}]`;
          case 'error':
            return `[error:${event.message}]`;
        }
      })
      .join('');
    expect(text).toBe('hello[done:col-1][error:boom]');
    expect(roundTrip(events)).toEqual(events);
  });

  it('allows a done event without a persisted column', () => {
    const done: PlaygroundStreamEvent = {
      type: 'done',
      columnId: null,
      content: '',
      metrics,
      headers: {},
    };
    expect(roundTrip(done)).toEqual(done);
  });

  it('round-trips a history run with successful and failed columns', () => {
    const detail: PlaygroundHistoryRunDetail = {
      id: 'run-1',
      prompt: 'hi',
      createdAt: '2026-01-01T00:00:00.000Z',
      modelCount: 2,
      models: ['gpt-5', 'claude'],
      starred: false,
      bestColumnId: null,
      columns: [
        {
          id: 'c1',
          model: 'gpt-5',
          provider: 'openai',
          authType: 'api_key',
          displayName: 'GPT-5',
          status: 'success',
          content: 'hello',
          headers: { a: 'b' },
          errorMessage: null,
          metrics,
          position: 0,
        },
        {
          id: 'c2',
          model: 'claude',
          provider: 'anthropic',
          authType: null,
          displayName: null,
          status: 'error',
          content: null,
          headers: null,
          errorMessage: 'rate limited',
          metrics: null,
          position: 1,
        },
      ],
    };
    expect(roundTrip(detail)).toEqual(detail);
    expect(detail.columns.map((c) => c.position)).toEqual([0, 1]);
  });
});

describe('ResolveResponse contract', () => {
  it('accepts a resolved route with fallbacks and optional fields', () => {
    const resolved: ResolveResponse = {
      tier: 'complex',
      confidence: 0.82,
      score: 0.31,
      reason: 'scored',
      route: { provider: 'anthropic', authType: 'api_key', model: 'claude-sonnet' },
      fallback_routes: [{ provider: 'openai', authType: 'subscription', model: 'gpt-5' }],
      output_modality: 'text',
      response_mode: 'stream',
      specificity_category: 'coding',
    };
    expect(roundTrip(resolved)).toEqual(resolved);
  });

  it('accepts the unresolved shape: null route and fallbacks, no optional fields', () => {
    const unresolved: ResolveResponse = {
      tier: 'simple',
      confidence: 0.4,
      score: 0,
      reason: 'ambiguous',
      route: null,
      fallback_routes: null,
    };
    const copy = roundTrip(unresolved);
    expect(copy).toEqual(unresolved);
    expect(copy.output_modality).toBeUndefined();
    expect(copy.specificity_category).toBeUndefined();
  });
});
