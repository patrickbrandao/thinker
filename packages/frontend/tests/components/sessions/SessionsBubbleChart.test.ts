import { describe, expect, it } from 'vitest';
import {
  bucketStarts,
  costBand,
  floorBucket,
  layoutDots,
} from '../../../src/components/sessions/SessionsBubbleChart';

const point = (session_id: string, bucket: string, failed: number, cost: number) => ({
  session_id,
  agent_name: 'bot',
  bucket,
  requests: 1 + failed,
  failed,
  cost,
});

describe('SessionsBubbleChart layout', () => {
  it('floors periods in UTC, weeks starting on Monday', () => {
    const ms = Date.parse('2026-11-05T13:45:00Z'); // a Thursday
    expect(new Date(floorBucket(ms, 'hour')).toISOString()).toBe('2026-11-05T13:00:00.000Z');
    expect(new Date(floorBucket(ms, 'day')).toISOString()).toBe('2026-11-05T00:00:00.000Z');
    expect(new Date(floorBucket(ms, 'week')).toISOString()).toBe('2026-11-02T00:00:00.000Z');
  });

  it('lists every period of the range, empty ones included', () => {
    const now = Date.parse('2026-11-05T12:00:00Z');
    const starts = bucketStarts('2026-10-29T12:00:00Z', 'day', now);
    expect(starts).toHaveLength(8);
    expect(new Date(starts[0]).toISOString()).toBe('2026-10-29T00:00:00.000Z');
  });

  it('stacks sessions without failures up and failing ones down, cheapest next to zero', () => {
    const starts = [Date.parse('2026-11-05T00:00:00Z'), Date.parse('2026-11-06T00:00:00Z')];
    const dots = layoutDots(
      [
        point('a', '2026-11-05T00:00:00.000Z', 0, 0.5),
        point('b', '2026-11-05T00:00:00.000Z', 0, 0.01),
        point('c', '2026-11-05T00:00:00.000Z', 2, 1),
        point('a', '2026-11-06T00:00:00.000Z', 1, 0.2),
        point('z', '2026-01-01T00:00:00.000Z', 0, 1), // outside the range
      ],
      starts,
      'day',
    );
    const at = (id: string, col: number) => dots.find((d) => d.session_id === id && d.col === col);
    expect(at('b', 0)).toMatchObject({ up: true, slot: 0 });
    expect(at('a', 0)).toMatchObject({ up: true, slot: 1 });
    expect(at('c', 0)).toMatchObject({ up: false, slot: 0 });
    expect(at('a', 1)).toMatchObject({ up: false, slot: 0 });
    expect(dots.some((d) => d.session_id === 'z')).toBe(false);
  });

  it('maps cost to bands by threshold', () => {
    expect(costBand(0)).toBe(0);
    expect(costBand(0.01)).toBe(1);
    expect(costBand(0.3)).toBe(3);
    expect(costBand(50)).toBe(5);
  });
});
