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
import { formatNumber, formatCost } from '../services/formatters.js';
import {
  useChartLifecycle,
  createBaseAxes,
  parseTimestamps,
  createTimeScaleRange,
  createFormatLegendTimestamp,
  formatLegendTokens,
  isMultiDayRange,
  fillDailyGaps,
} from '../services/chart-utils.js';

/**
 * Series palette, from the chart tokens. Entries are CSS `var()` references so
 * swatches follow the theme; the canvas resolves them with `resolveChartColor`.
 */
export const AGENT_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
];

/** uPlot paints on a canvas, which cannot read `var(--x)`: resolve it first. */
export function resolveChartColor(color: string): string {
  const match = /^var\((--[\w-]+)\)$/.exec(color);
  if (!match) return color;
  return getCssVar(match[1]!) || color;
}

interface MultiAgentTokenChartProps {
  agents: string[];
  timeseries: Array<Record<string, number | string>>;
  range: string;
  colorMap?: Record<string, string>;
  onHoverValues?: (values: Record<string, number> | null) => void;
  /** When set (e.g. "Requests"), y-axis formats as plain numbers instead of token suffixes. */
  label?: string;
}

const CHART_HEIGHT = 260;

export default function MultiAgentTokenChart(props: MultiAgentTokenChartProps) {
  const el = useRef<HTMLDivElement>(null);
  const rawData = useRef<number[][]>([]);
  // uPlot hooks outlive a render: they read the newest props through this ref.
  const latest = useRef(props);
  latest.current = props;
  const [tooltip, setTooltip] = useState<HoverTooltipState>(HIDDEN_TOOLTIP);

  const isCost = props.label === 'Cost';
  const fmtVal = (v: number) => (isCost ? (formatCost(v) ?? formatCost(0)!) : formatNumber(v));

  // Per-agent fallback color, keyed on the agent's ORIGINAL index in agents
  // (not the reversed render order), so each series gets a distinct color. An
  // explicit colorMap entry still takes precedence.
  const colorFor = (agent: string) => {
    const { agents, colorMap } = latest.current;
    const i = agents.indexOf(agent);
    return colorMap?.[agent] ?? AGENT_COLORS[i % AGENT_COLORS.length]!;
  };

  const buildData = (): uPlot.AlignedData => {
    const { agents, timeseries, range } = latest.current;
    const key = range === '24h' ? 'hour' : 'date';
    const filled = fillDailyGaps(
      timeseries as Array<Record<string, number | string>>,
      range,
      key,
      (k) => {
        const row: Record<string, number | string> = { [key]: k };
        for (const agent of agents) row[agent] = 0;
        return row;
      },
    );

    const timestamps = parseTimestamps(filled as Array<{ hour?: string; date?: string }>);
    rawData.current = agents.map((agent) => filled.map((d) => Math.max(0, Number(d[agent] ?? 0))));

    const cumulative: number[][] = [];
    for (let i = 0; i < agents.length; i++) {
      const prev = i > 0 ? cumulative[i - 1]! : timestamps.map(() => 0);
      cumulative.push(rawData.current[i]!.map((v, j) => v + (prev[j] ?? 0)));
    }
    return [timestamps, ...[...cumulative].reverse()];
  };

  const buildChart = (): uPlot | null => {
    const node = el.current;
    if (!node) return null;
    const w = node.clientWidth || node.getBoundingClientRect().width;
    if (w === 0) return null;

    const { agents, range } = latest.current;
    const axisColor = getCssVar('--text-faint');
    const gridColor = getCssVar('--border');
    const bars = uPlot.paths.bars!({ size: [1, 20], gap: 2 });
    const multiDay = isMultiDayRange(range);
    const cost = latest.current.label === 'Cost';

    const series: uPlot.Series[] = [
      { value: createFormatLegendTimestamp(range) },
      ...[...agents].reverse().map((agent) => ({
        label: agent,
        scale: 'y' as const,
        stroke: resolveChartColor(colorFor(agent)),
        fill: resolveChartColor(colorFor(agent)),
        width: 0,
        paths: bars,
        points: { show: false },
        value: formatLegendTokens,
      })),
    ];

    const axes = createBaseAxes(axisColor, gridColor, range);
    axes[1] = {
      ...axes[1]!,
      values: (u: uPlot, vals: number[]) =>
        vals.map((v) =>
          // formatCost surfaces sub-cent values as "< $0.01" instead of
          // rounding them to "$0.00".
          cost ? (formatCost(v) ?? formatCost(0)!) : formatLegendTokens(u, v),
        ),
    };

    return new uPlot(
      {
        width: w,
        height: CHART_HEIGHT,
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
              const onHover = latest.current.onHoverValues;
              const idx = u.cursor.idx;
              if (idx == null || idx < 0) {
                onHover?.(null);
                setTooltip((prev) => ({ ...prev, visible: false }));
                return;
              }

              // Raw (un-stacked) values
              const current = latest.current.agents;
              const vals: Record<string, number> = {};
              const entries: HoverTooltipState['entries'] = [];
              let total = 0;
              for (let i = 0; i < current.length; i++) {
                const agentName = current[i]!;
                const v = rawData.current[i]?.[idx] ?? 0;
                vals[agentName] = v;
                entries.push({ label: agentName, value: v, color: colorFor(agentName) });
                total += v;
              }
              onHover?.(vals);
              entries.sort((a, b) => b.value - a.value);

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
        scales: {
          x: { time: !multiDay, range: createTimeScaleRange(range, true) },
          y: {
            auto: true,
            range: (_u, _min, max) => [0, max > 0 ? max * 1.1 : 100] as [number, number],
          },
        },
        axes,
        series,
      },
      buildData(),
      node,
    );
  };

  useChartLifecycle({
    el,
    data: props.timeseries,
    buildData,
    structureKey: `${props.range}::${props.agents.join(',')}`,
    buildChart,
  });

  const hideTooltip = () => {
    setTooltip((prev) => ({ ...prev, visible: false }));
    latest.current.onHoverValues?.(null);
  };

  return (
    <div className="relative overflow-visible" onMouseLeave={hideTooltip}>
      <div ref={el} className="w-full" style={{ minHeight: CHART_HEIGHT }} />
      <ChartHoverTooltip
        state={tooltip}
        fmtVal={fmtVal}
        hostWidth={() => el.current?.clientWidth ?? 0}
      />
    </div>
  );
}
