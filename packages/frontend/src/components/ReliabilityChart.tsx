import { useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import ChartHoverTooltip, {
  HIDDEN_TOOLTIP,
  formatTooltipDate,
  snapToBucket,
  type HoverTooltipState,
} from './ChartHoverTooltip.js';
import { getCssVar } from '../services/theme.js';
import { formatNumber } from '../services/formatters.js';
import {
  useChartLifecycle,
  createBaseAxes,
  parseTimestamps,
  createTimeScaleRange,
  createFormatLegendTimestamp,
  isMultiDayRange,
  fillDailyGaps,
} from '../services/chart-utils.js';
import type { StatusTimeseries } from '../services/api/analytics.js';
import { t } from '../i18n/index.js';

// ---------------------------------------------------------------------------
// Colors per series mode (chart tokens; the canvas resolves the var()s)
// ---------------------------------------------------------------------------
const OUTCOME_COLORS: Record<string, string> = {
  success: 'var(--chart-2)', // direct success
  fallback: 'var(--chart-3)', // recovered by fallback
  error: 'var(--danger)',
};

const KIND_PALETTE = [
  'var(--danger)',
  'var(--chart-3)',
  'var(--chart-1)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-2)',
  'var(--chart-6)',
];

/** uPlot paints on a canvas, which cannot read `var(--x)`: resolve it first. */
function resolveChartColor(color: string): string {
  const match = /^var\((--[\w-]+)\)$/.exec(color);
  if (!match) return color;
  return getCssVar(match[1]!) || color;
}

function colorFor(key: string, mode: string, idx: number): string {
  if (mode === 'disposition') return OUTCOME_COLORS[key] ?? 'var(--chart-other)';
  if (mode === 'http_status') {
    if (key.startsWith('2')) return 'var(--chart-2)'; // success, like every chart
    if (key.startsWith('4')) return 'var(--chart-3)';
    if (key.startsWith('5')) return 'var(--danger)';
    return 'var(--chart-other)'; // 'No response' and other non-codes
  }
  // error_kind: rotate through the palette
  if (key === 'none') return 'var(--chart-other)';
  return KIND_PALETTE[idx % KIND_PALETTE.length]!;
}

function keyLabel(key: string): string {
  if (key === 'none') return t('overview.chart.series.none');
  if (key === 'success') return t('overview.chart.series.success');
  if (key === 'error') return t('overview.chart.series.error');
  if (key === 'fallback') return t('overview.chart.series.fallback');
  return key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export interface ReliabilityChartProps {
  timeseries: StatusTimeseries;
  range: string;
  seriesMode: string;
}

/**
 * Fixed reading order for the disposition series — legend AND bar stacking
 * (bottom to top): Success, then recovered via Fallback, then Error.
 * Unknown keys keep their incoming order, after these.
 */
const SERIES_ORDER: Record<string, number> = {
  success: 0,
  fallback: 1,
  error: 2,
};

function orderTimeseries(d: StatusTimeseries | undefined): StatusTimeseries | undefined {
  if (!d) return d;
  const picked = d.keys
    .map((k, i) => ({ k, i }))
    .sort((a, b) => (SERIES_ORDER[a.k] ?? 99) - (SERIES_ORDER[b.k] ?? 99) || a.i - b.i);
  return {
    ...d,
    keys: picked.map(({ k }) => k),
    buckets: d.buckets.map((b) => ({
      bucket: b.bucket,
      counts: picked.map(({ i }) => b.counts[i] ?? 0),
    })),
  };
}

export default function ReliabilityChart(props: ReliabilityChartProps) {
  const el = useRef<HTMLDivElement>(null);
  const rawSeries = useRef<number[][]>([]);
  const latest = useRef(props);
  latest.current = props;
  const [tooltip, setTooltip] = useState<HoverTooltipState>(HIDDEN_TOOLTIP);

  const ordered = orderTimeseries(props.timeseries);

  const buildData = (): uPlot.AlignedData => {
    const { range } = latest.current;
    const d = orderTimeseries(latest.current.timeseries);
    if (!d || d.buckets.length === 0) return [new Float64Array(0)] as unknown as uPlot.AlignedData;

    const bucketKey = range === '24h' ? 'hour' : 'date';
    const mapped = d.buckets.map((b) => {
      const row: Record<string, number | string> = { [bucketKey]: b.bucket };
      d.keys.forEach((k, i) => {
        row[k] = b.counts[i] ?? 0;
      });
      return row;
    });

    const filled = fillDailyGaps(mapped, range, bucketKey, (k) => {
      const row: Record<string, number | string> = { [bucketKey]: k };
      for (const key of d.keys) row[key] = 0;
      return row;
    });

    const timestamps = parseTimestamps(filled as Array<{ hour?: string; date?: string }>);
    rawSeries.current = d.keys.map((key) => filled.map((r) => Math.max(0, Number(r[key] ?? 0))));

    // Cumulative stacking (bottom to top)
    const cumulative: number[][] = [];
    for (let i = 0; i < d.keys.length; i++) {
      const prev = i > 0 ? cumulative[i - 1]! : timestamps.map(() => 0);
      cumulative.push(rawSeries.current[i]!.map((v, j) => v + (prev[j] ?? 0)));
    }
    return [timestamps, ...[...cumulative].reverse()];
  };

  const buildChart = (): uPlot | null => {
    const node = el.current;
    const { timeseries, range, seriesMode: mode } = latest.current;
    if (!node || !timeseries || timeseries.buckets.length === 0) return null;

    const d = orderTimeseries(timeseries)!;
    const w = node.clientWidth || node.getBoundingClientRect().width;
    if (w === 0) return null;

    const axisColor = getCssVar('--text-faint');
    const gridColor = getCssVar('--border');
    const bars = uPlot.paths.bars!({ size: [1, 20], gap: 2 });
    const reversed = [...d.keys].reverse();

    const series: uPlot.Series[] = [
      { value: createFormatLegendTimestamp(range) },
      ...reversed.map((key, idx) => {
        const color = resolveChartColor(colorFor(key, mode, d.keys.length - 1 - idx));
        return {
          label: keyLabel(key),
          scale: 'y' as const,
          stroke: color,
          fill: color,
          width: 0,
          paths: bars,
          points: { show: false },
          value: (_u: uPlot, v: number) => formatNumber(v),
        };
      }),
    ];

    const multiDay = isMultiDayRange(range);
    return new uPlot(
      {
        width: w,
        height: 260,
        padding: [16, 16, 0, 16],
        legend: { show: false },
        cursor: {
          x: true,
          y: false,
          points: { show: false },
          drag: { x: false, y: false },
          move: snapToBucket,
        },
        hooks: {
          setCursor: [
            (u) => {
              const idx = u.cursor.idx;
              if (idx == null || idx < 0) {
                setTooltip((prev) => ({ ...prev, visible: false }));
                return;
              }
              // One row per series, in the fixed legend/stacking order
              // (Success, recovered via Fallback, Error) — NOT value-sorted
              // like the per-agent charts.
              const entries: HoverTooltipState['entries'] = [];
              let total = 0;
              d.keys.forEach((key, i) => {
                const v = rawSeries.current[i]?.[idx] ?? 0;
                entries.push({ label: keyLabel(key), value: v, color: colorFor(key, mode, i) });
                total += v;
              });
              const timestamp = u.data[0]?.[idx];
              const barLeft = timestamp != null ? Math.round(u.valToPos(timestamp, 'x')) : 0;
              const chartWidth = u.bbox.width / devicePixelRatio;
              setTooltip({
                visible: true,
                left: barLeft,
                top: 16,
                alignRight: barLeft > chartWidth / 2,
                date: timestamp != null ? formatTooltipDate(timestamp, multiDay) : '',
                entries,
                total,
              });
            },
          ],
        },
        axes: createBaseAxes(axisColor, gridColor, range),
        scales: {
          x: { range: createTimeScaleRange(range, true) },
          y: { range: (_u: uPlot, _min: number, max: number) => [0, max * 1.1 || 10] },
        },
        series,
      },
      buildData(),
      node,
    );
  };

  useChartLifecycle({
    el,
    data: props.timeseries?.buckets,
    buildData,
    structureKey: `${props.range}::${props.seriesMode}::${ordered?.keys.join(',')}`,
    buildChart,
  });

  const legendItems = (ordered?.keys ?? []).map((key, i) => ({
    key,
    label: keyLabel(key),
    color: colorFor(key, props.seriesMode, i),
  }));

  return (
    <>
      <div
        className="relative overflow-visible"
        onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
      >
        <div ref={el} />
        <ChartHoverTooltip
          state={tooltip}
          fmtVal={formatNumber}
          hostWidth={() => el.current?.clientWidth ?? 0}
        />
      </div>
      <div className="rel-chart__legend flex flex-wrap justify-center gap-4 pt-2 text-xs text-muted">
        {legendItems.map((item) => (
          <span key={item.key} className="rel-chart__legend-item inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
    </>
  );
}
