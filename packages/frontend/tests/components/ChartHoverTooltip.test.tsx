import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import ChartHoverTooltip, {
  HIDDEN_TOOLTIP,
  formatTooltipDate,
  snapToBucket,
  type HoverTooltipState,
} from '../../src/components/ChartHoverTooltip';
import { resetLocaleForTests } from '../../src/i18n';

const state = (over: Partial<HoverTooltipState> = {}): HoverTooltipState => ({
  visible: true,
  left: 100,
  top: 40,
  alignRight: false,
  date: '5 Jan 2026',
  entries: [
    { label: 'openai', value: 3, color: 'red' },
    { label: 'anthropic', value: 7, color: 'blue' },
  ],
  total: 10,
  ...over,
});
const fmt = (v: number) => 'USD ' + v;

describe('ChartHoverTooltip', () => {
  it('renders nothing when hidden, and HIDDEN_TOOLTIP is hidden', () => {
    expect(HIDDEN_TOOLTIP.visible).toBe(false);
    const { container } = render(
      <ChartHoverTooltip state={HIDDEN_TOOLTIP} fmtVal={fmt} hostWidth={() => 500} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when visible but every series is zero', () => {
    const { container } = render(
      <ChartHoverTooltip
        state={state({ entries: [{ label: 'a', value: 0, color: 'x' }] })}
        fmtVal={fmt}
        hostWidth={() => 500}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the date, a row per non-zero series, and the formatted total', () => {
    const { container } = render(
      <ChartHoverTooltip
        state={state({
          entries: [
            { label: 'openai', value: 3, color: 'red' },
            { label: 'idle', value: 0, color: 'grey' },
            { label: 'anthropic', value: 7, color: 'blue' },
          ],
        })}
        fmtVal={fmt}
        hostWidth={() => 500}
      />,
    );
    expect(container.querySelector('.agent-chart-tooltip__date')!.textContent).toBe('5 Jan 2026');
    const rows = [...container.querySelectorAll('.agent-chart-tooltip__row')];
    expect(rows.map((r) => r.textContent)).toEqual(['openaiUSD 3', 'anthropicUSD 7']);
    const swatch = rows[0].querySelector('.agent-chart-tooltip__swatch') as HTMLElement;
    expect(swatch.style.background).toBe('red');
    expect(container.querySelector('.agent-chart-tooltip__total')!.textContent).toBe('TotalUSD 10');
  });

  it('anchors from the left of the cursor by default', () => {
    const { container } = render(
      <ChartHoverTooltip state={state()} fmtVal={fmt} hostWidth={() => 500} />,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.left).toBe('102px');
    expect(el.style.right).toBe('auto');
    expect(el.style.top).toBe('40px');
  });

  it('anchors from the right when past the midpoint', () => {
    const { container } = render(
      <ChartHoverTooltip
        state={state({ alignRight: true, left: 400 })}
        fmtVal={fmt}
        hostWidth={() => 500}
      />,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.left).toBe('auto');
    expect(el.style.right).toBe('102px');
  });

  it('splits into columns of 16 rows', () => {
    const entries = Array.from({ length: 35 }, (_, i) => ({
      label: 's' + i,
      value: i + 1,
      color: 'c',
    }));
    const { container } = render(
      <ChartHoverTooltip state={state({ entries })} fmtVal={fmt} hostWidth={() => 500} />,
    );
    const cols = [...container.querySelectorAll('.agent-chart-tooltip__list')];
    expect(cols.map((c) => c.children.length)).toEqual([16, 16, 3]);
  });
});

describe('formatTooltipDate', () => {
  it('formats a multi-day bucket as day month year', () => {
    const sec = new Date(2026, 0, 5, 13, 4).getTime() / 1000;
    expect(formatTooltipDate(sec, true)).toBe('5 Jan 2026');
  });

  it('uses the pt-BR short month', () => {
    resetLocaleForTests('pt-BR');
    const sec = new Date(2026, 1, 5, 13, 4).getTime() / 1000;
    expect(formatTooltipDate(sec, true)).toBe('5 fev 2026');
  });

  it('adds a zero-padded hh:mm for intra-day buckets', () => {
    const sec = new Date(2026, 10, 25, 3, 7).getTime() / 1000;
    expect(formatTooltipDate(sec, false)).toBe('25 Nov 2026, 03:07');
  });
});

describe('snapToBucket', () => {
  const fakePlot = (idx: number | null | undefined, xs: Array<number | null>) =>
    ({
      posToIdx: () => idx,
      data: [xs],
      valToPos: (v: number) => v * 10 + 0.4,
    }) as never;

  it('snaps the cursor to the rounded pixel position of the nearest column', () => {
    expect(snapToBucket(fakePlot(1, [1, 2, 3]), 17, 9)).toEqual([20, 9]);
  });

  it('keeps the raw position when there is no column under the cursor', () => {
    expect(snapToBucket(fakePlot(null, [1]), 17, 9)).toEqual([17, 9]);
    expect(snapToBucket(fakePlot(undefined, [1]), 17, 9)).toEqual([17, 9]);
    expect(snapToBucket(fakePlot(5, [1, 2]), 17, 9)).toEqual([17, 9]);
    expect(snapToBucket(fakePlot(0, [null]), 17, 9)).toEqual([17, 9]);
  });
});
