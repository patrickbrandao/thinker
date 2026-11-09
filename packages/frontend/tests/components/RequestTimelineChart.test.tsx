import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('../../src/services/model-display', () => ({
  getModelDisplayName: (m: string) => 'disp:' + m,
}));

import {
  RequestTimelineChart,
  formatPreciseTimestamp,
  formatSpan,
} from '../../src/components/RequestTimelineChart';
import type { RequestTimeline } from '../../src/services/api/messages';
import { resetLocaleForTests } from '../../src/i18n';

const T0 = new Date(2026, 0, 5, 13, 4, 9, 7).getTime();

describe('formatSpan', () => {
  it('uses milliseconds below one second', () => {
    expect(formatSpan(0)).toBe('0 ms');
    expect(formatSpan(999)).toBe('999 ms');
  });

  it('switches to seconds with three decimals at one second', () => {
    expect(formatSpan(1000)).toBe('1.000 s');
    expect(formatSpan(1234)).toBe('1.234 s');
    expect(formatSpan(61_500)).toBe('61.500 s');
  });
});

describe('formatPreciseTimestamp', () => {
  it('zero-pads every field including milliseconds', () => {
    expect(formatPreciseTimestamp(T0)).toBe('2026-01-05 13:04:09.007');
    expect(formatPreciseTimestamp(new Date(2026, 11, 31, 0, 0, 0, 0).getTime())).toBe(
      '2026-12-31 00:00:00.000',
    );
  });
});

const timeline: RequestTimeline = {
  version: 1,
  events: [
    { type: 'received', at: T0 },
    { type: 'provider_request', at: T0 + 5, attempt: 1, provider: 'openai', model: 'gpt-x' },
    {
      type: 'provider_error',
      at: T0 + 105,
      attempt: 1,
      provider: 'openai',
      model: 'gpt-x',
      status: 429,
    },
    {
      type: 'provider_request',
      at: T0 + 110,
      attempt: 2,
      provider: 'anthropic',
      model: 'claude-y',
    },
    {
      type: 'provider_response',
      at: T0 + 400,
      attempt: 2,
      provider: 'anthropic',
      model: 'claude-y',
      status: 200,
    },
    { type: 'first_chunk', at: T0 + 450, attempt: 2, provider: 'anthropic', model: 'claude-y' },
    {
      type: 'last_chunk',
      at: T0 + 1450,
      attempt: 2,
      provider: 'anthropic',
      model: 'claude-y',
      chunks: 12,
      bytes: 3400,
    },
    { type: 'response_completed', at: T0 + 1500 },
  ],
};

describe('RequestTimelineChart', () => {
  it('renders nothing for an empty timeline', () => {
    const { container } = render(<RequestTimelineChart timeline={{ version: 1, events: [] }} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the headline durations', () => {
    const { container } = render(<RequestTimelineChart timeline={timeline} />);
    const head = container.querySelector('.request-timeline > div')!.textContent!;
    expect(head).toContain('Received → last chunk');
    expect(head).toContain('1.450 s');
    expect(head).toContain('Received → response sent');
    expect(head).toContain('1.500 s');
    expect(head).toContain('Time to first chunk');
    expect(head).toContain('450 ms');
  });

  it('exposes the chart as a labelled image and the events as a labelled table', () => {
    render(<RequestTimelineChart timeline={timeline} />);
    expect(screen.getByRole('img', { name: 'Request timeline' })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Request timeline' })).toBeTruthy();
  });

  it('lists every event with timestamp, offset from start, interval and detail', () => {
    render(<RequestTimelineChart timeline={timeline} />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(timeline.events.length);
    const cell = (r: number) =>
      within(rows[r])
        .getAllByRole('cell')
        .map((c) => c.textContent);

    expect(cell(0)).toEqual(['2026-01-05 13:04:09.007', '+0 ms', '—', 'Request received', '']);
    expect(cell(1)).toEqual([
      '2026-01-05 13:04:09.012',
      '+5 ms',
      '+5 ms',
      'Sent to provider',
      'attempt 1 · openai · disp:gpt-x',
    ]);
    expect(cell(2)[4]).toBe('attempt 1 · openai · disp:gpt-x · HTTP 429');
    expect(cell(2)[2]).toBe('+100 ms');
    expect(cell(6)[4]).toBe('attempt 2 · anthropic · disp:claude-y · 12 chunks, 3400 bytes');
    expect(cell(6)[2]).toBe('+1.000 s');
    expect(cell(7)[3]).toBe('Response completed to harness');
  });

  it('defaults bytes to 0 when only a chunk count is recorded', () => {
    render(
      <RequestTimelineChart
        timeline={{
          version: 1,
          events: [
            { type: 'received', at: T0 },
            { type: 'last_chunk', at: T0 + 10, attempt: 1, chunks: 3 },
          ],
        }}
      />,
    );
    expect(screen.getAllByRole('row')[2].textContent).toContain('3 chunks, 0 bytes');
  });

  it('draws one lane per attempt, ordered by attempt number, with truncated long labels', () => {
    const { container } = render(
      <RequestTimelineChart
        timeline={{
          version: 1,
          events: [
            { type: 'received', at: T0 },
            { type: 'provider_request', at: T0 + 10, attempt: 2, provider: 'second' },
            {
              type: 'provider_request',
              at: T0 + 5,
              attempt: 1,
              provider: 'a-very-long-provider-name',
              model: 'model-with-long-name',
            },
          ],
        }}
      />,
    );
    const labels = [...container.querySelectorAll('svg text')]
      .map((n) => n.textContent ?? '')
      .filter((x) => x.startsWith('#'));
    expect(labels[0].startsWith('#1 ')).toBe(true);
    expect(labels[0]).toContain('…');
    expect(labels[1].startsWith('#2 second')).toBe(true);
  });

  it('adds tooltips (titles) with the exact timestamp on each marker', () => {
    const { container } = render(<RequestTimelineChart timeline={timeline} />);
    const titles = [...container.querySelectorAll('svg title')].map((n) => n.textContent);
    expect(titles).toContain('Request received\n2026-01-05 13:04:09.007\n+0 ms');
    expect(titles).toContain('Provider call failed\n2026-01-05 13:04:09.112\n+105 ms');
  });

  it('draws six axis ticks from 0 to the full span', () => {
    const { container } = render(<RequestTimelineChart timeline={timeline} />);
    const texts = [...container.querySelectorAll('svg text')].map((n) => n.textContent);
    for (const label of ['0 ms', '300 ms', '600 ms', '900 ms', '1.200 s', '1.500 s']) {
      expect(texts).toContain(label);
    }
  });

  it('a single event does not divide by zero and omits the headline durations', () => {
    const { container } = render(
      <RequestTimelineChart timeline={{ version: 1, events: [{ type: 'received', at: T0 }] }} />,
    );
    expect(container.innerHTML).not.toContain('NaN');
    expect(container.innerHTML).not.toContain('Infinity');
    expect(container.querySelector('.request-timeline > div')!.textContent).toBe('');
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('starts the axis at the first event when there is no "received" event', () => {
    render(
      <RequestTimelineChart
        timeline={{
          version: 1,
          events: [
            { type: 'provider_request', at: T0, attempt: 1, provider: 'p' },
            { type: 'provider_response', at: T0 + 20, attempt: 1, provider: 'p' },
          ],
        }}
      />,
    );
    const rows = screen.getAllByRole('row');
    expect(within(rows[2]).getAllByRole('cell')[1].textContent).toBe('+20 ms');
  });

  it('localizes the headings in pt-BR', () => {
    resetLocaleForTests('pt-BR');
    render(<RequestTimelineChart timeline={timeline} />);
    expect(screen.queryByRole('img', { name: 'Request timeline' })).toBeNull();
    expect(screen.getByRole('img')).toBeTruthy();
    expect(screen.queryByText('Request received')).toBeNull();
  });
});
