import type { ModelRoute } from 'thinker-shared';
import {
  estimateRequestTokens,
  exceedsContextWindow,
  mayExceedContextWindows,
  planContextFit,
} from './context-window-fit';

const route = (model: string): ModelRoute => ({ provider: 'openai', authType: 'api_key', model });

describe('estimateRequestTokens', () => {
  it('counts prompt text at four characters per token plus the output budget', () => {
    const body = {
      messages: [
        { role: 'system', content: 'a'.repeat(400) },
        { role: 'user', content: [{ type: 'text', text: 'b'.repeat(400) }] },
      ],
      max_tokens: 1000,
    };
    // 800 prompt chars plus the role/type strings ("system", "user", "text").
    expect(estimateRequestTokens(body)).toBe(Math.ceil((800 + 6 + 4 + 4) / 4) + 1000);
  });

  it('reads the Messages system field and the Responses input/max_output_tokens', () => {
    expect(estimateRequestTokens({ system: 'x'.repeat(40), messages: [] })).toBe(10);
    expect(estimateRequestTokens({ input: 'y'.repeat(80), max_output_tokens: 5 })).toBe(25);
  });

  it('prefers max_completion_tokens over max_tokens', () => {
    expect(estimateRequestTokens({ max_completion_tokens: 7, max_tokens: 100 })).toBe(7);
  });

  it('adds the serialized tool definitions', () => {
    const tools = [{ type: 'function', function: { name: 'f', parameters: {} } }];
    expect(estimateRequestTokens({ tools })).toBe(Math.ceil(JSON.stringify(tools).length / 4));
  });

  it('leaves inline images and file payloads out', () => {
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${'A'.repeat(10_000)}` },
            },
            { type: 'image', source: { type: 'base64', data: 'B'.repeat(10_000) } },
          ],
        },
      ],
    };
    expect(estimateRequestTokens(body)).toBeLessThan(20);
  });

  it('is zero for an empty body', () => {
    expect(estimateRequestTokens({})).toBe(0);
  });
});

describe('exceedsContextWindow', () => {
  it('trips only above 95% of a known window', () => {
    expect(exceedsContextWindow(95_000, 100_000)).toBe(false);
    expect(exceedsContextWindow(95_001, 100_000)).toBe(true);
  });

  it('never trips on an unknown window', () => {
    expect(exceedsContextWindow(10_000_000, null)).toBe(false);
    expect(exceedsContextWindow(10_000_000, undefined)).toBe(false);
    expect(exceedsContextWindow(10_000_000, 0)).toBe(false);
    expect(exceedsContextWindow(10_000_000, Number.NaN)).toBe(false);
  });
});

describe('mayExceedContextWindows', () => {
  it('lets small requests skip the catalog lookup', () => {
    expect(mayExceedContextWindows(3_000)).toBe(false);
    expect(mayExceedContextWindows(4_000)).toBe(true);
  });
});

describe('planContextFit', () => {
  const windows: Record<string, number | null> = { small: 8_000, mid: 128_000, big: 1_000_000 };
  const windowOf = (r: ModelRoute) => windows[r.model] ?? null;

  it('keeps the chain when everything fits', () => {
    const chain = [route('small'), route('big')];
    expect(planContextFit(chain, 1_000, windowOf)).toEqual({ routes: chain, skipped: [] });
  });

  it('skips a primary that cannot fit and promotes the next one that does', () => {
    const plan = planContextFit([route('small'), route('mid'), route('big')], 200_000, windowOf);
    expect(plan.routes.map((r) => r.model)).toEqual(['big']);
    expect(plan.skipped.map((r) => r.model)).toEqual(['small', 'mid']);
  });

  it('skips fallbacks that cannot fit and keeps routes with an unknown window', () => {
    const plan = planContextFit([route('big'), route('small'), route('unknown')], 50_000, windowOf);
    expect(plan.routes.map((r) => r.model)).toEqual(['big', 'unknown']);
    expect(plan.skipped.map((r) => r.model)).toEqual(['small']);
  });

  it('leaves the chain untouched when no route fits', () => {
    const chain = [route('small'), route('mid')];
    expect(planContextFit(chain, 500_000, windowOf)).toEqual({ routes: chain, skipped: [] });
  });
});
