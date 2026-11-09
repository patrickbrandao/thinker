import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../i18n/index.js';
import type { SessionsTimeline, TimelinePoint } from '../../services/api/sessions.js';
import { formatNumber } from '../../services/formatters.js';
import { costLabel, shortId } from '../../pages/sessions/session-format.js';

/**
 * Diverging dot columns: one column per period (hour, day or week), one dot
 * per session active in it. Sessions without failures in the period stack up
 * from zero, sessions with failures stack down; cheaper sessions sit next to
 * the zero line. Color is the cost of the session in the period, on a
 * single-hue ramp of the theme's first chart color. Hovering a dot darkens the
 * same session in every column; a click opens the session.
 */

/** Upper bounds (USD) of the cost bands; the last band is open-ended. */
export const COST_BANDS = [0.01, 0.05, 0.25, 1, 5] as const;
const BAND_MIX = [34, 48, 62, 75, 88, 100];

export function costBand(cost: number): number {
  const i = COST_BANDS.findIndex((limit) => cost < limit);
  return i === -1 ? COST_BANDS.length : i;
}

const bandColor = (band: number) =>
  `color-mix(in oklab, var(--chart-1) ${BAND_MIX[band]}%, var(--bg-elev))`;

const STEP_MS = { hour: 3_600_000, day: 86_400_000, week: 7 * 86_400_000 } as const;

/** Start of the UTC period that contains `ms` (weeks start on Monday). */
export function floorBucket(ms: number, bucket: SessionsTimeline['bucket']): number {
  const d = new Date(ms);
  if (bucket === 'hour')
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours());
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (bucket === 'day') return day;
  return day - ((d.getUTCDay() + 6) % 7) * STEP_MS.day;
}

/** Every period from the start of the range to now, oldest first. */
export function bucketStarts(
  from: string,
  bucket: SessionsTimeline['bucket'],
  now = Date.now(),
): number[] {
  const out: number[] = [];
  for (
    let b = floorBucket(Date.parse(from), bucket);
    b <= now && out.length < 400;
    b += STEP_MS[bucket]
  ) {
    out.push(b);
  }
  return out;
}

interface Dot extends TimelinePoint {
  col: number;
  /** Position from the zero line: 0, 1, 2… above (ok) or below (failed). */
  slot: number;
  up: boolean;
}

export function layoutDots(
  points: TimelinePoint[],
  starts: number[],
  bucket: SessionsTimeline['bucket'],
): Dot[] {
  const index = new Map(starts.map((s, i) => [s, i]));
  const cols = new Map<number, { up: TimelinePoint[]; down: TimelinePoint[] }>();
  for (const p of points) {
    const col = index.get(floorBucket(Date.parse(p.bucket), bucket));
    if (col === undefined) continue;
    const entry = cols.get(col) ?? { up: [], down: [] };
    (p.failed > 0 ? entry.down : entry.up).push(p);
    cols.set(col, entry);
  }
  const dots: Dot[] = [];
  const byCost = (a: TimelinePoint, b: TimelinePoint) =>
    a.cost - b.cost || a.session_id.localeCompare(b.session_id);
  for (const [col, { up, down }] of cols) {
    up.sort(byCost).forEach((p, slot) => dots.push({ ...p, col, slot, up: true }));
    down.sort(byCost).forEach((p, slot) => dots.push({ ...p, col, slot, up: false }));
  }
  return dots;
}

function bucketLabel(ms: number, bucket: SessionsTimeline['bucket']): string {
  const d = new Date(ms);
  if (bucket === 'hour')
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

const MARGIN = { top: 16, right: 12, bottom: 28, left: 32 };

export default function SessionsBubbleChart({
  data,
  onOpen,
}: {
  data: SessionsTimeline;
  onOpen: (sessionId: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [hover, setHover] = useState<{ dot: Dot; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) =>
      setWidth(Math.max(320, entries[0]?.contentRect.width ?? 900)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const starts = useMemo(
    () => bucketStarts(data.from ?? new Date().toISOString(), data.bucket),
    [data],
  );
  const dots = useMemo(() => layoutDots(data.points, starts, data.bucket), [data, starts]);

  const maxUp = Math.max(5, ...dots.filter((d) => d.up).map((d) => d.slot + 1));
  const maxDown = Math.max(5, ...dots.filter((d) => !d.up).map((d) => d.slot + 1));
  const plotW = width - MARGIN.left - MARGIN.right;
  const colW = plotW / Math.max(starts.length, 1);
  const step = Math.max(3, Math.min(14, colW * 0.9, 440 / (maxUp + maxDown)));
  const r = Math.max(1.5, step / 2 - 1);
  const zeroY = MARGIN.top + maxUp * step + step / 2;
  const height = zeroY + maxDown * step + step / 2 + MARGIN.bottom;
  const cx = (col: number) => MARGIN.left + colW * col + colW / 2;
  const cy = (dot: Dot) =>
    dot.up ? zeroY - (dot.slot + 0.5) * step - 1 : zeroY + (dot.slot + 0.5) * step + 1;

  const labelEvery = Math.max(1, Math.ceil(starts.length / Math.max(2, Math.floor(plotW / 70))));
  const tickStep = maxUp + maxDown > 20 ? 10 : 5;
  const ticks: number[] = [];
  for (let v = tickStep; v <= maxUp; v += tickStep) ticks.push(v);
  for (let v = tickStep; v <= maxDown; v += tickStep) ticks.push(-v);
  const hoverKey = hover ? `${hover.dot.agent_name}|${hover.dot.session_id}` : null;

  return (
    <div className="sessions-bubbles">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-xs text-muted">
          {data.total_sessions > data.shown_sessions
            ? t('sessions.chart.showing', {
                shown: formatNumber(data.shown_sessions),
                total: formatNumber(data.total_sessions),
              })
            : t('sessions.chart.hint')}
        </p>
        <div
          className="flex items-center gap-2 text-xs text-muted"
          aria-label={t('sessions.chart.legend')}
        >
          <span>{t('sessions.chart.cost')}</span>
          <div className="flex">
            {BAND_MIX.map((_, band) => (
              <span key={band} className="flex flex-col items-center gap-0.5">
                <span className="block h-3 w-16" style={{ background: bandColor(band) }} />
                <span className="whitespace-nowrap text-[10px] tabular-nums">
                  {band === 0
                    ? `<${costLabel(COST_BANDS[0])}`
                    : `${band === COST_BANDS.length ? '≥' : ''}${costLabel(COST_BANDS[band - 1] ?? 0)}`}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div ref={wrapRef} className="relative w-full" onMouseLeave={() => setHover(null)}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={t('sessions.chart.aria', { count: data.shown_sessions })}
          className="block"
        >
          <text x={MARGIN.left + 4} y={MARGIN.top + 8} className="fill-muted text-[10px]">
            ↑ {t('sessions.chart.ok')}
          </text>
          <text
            x={MARGIN.left + 4}
            y={height - MARGIN.bottom - 4}
            className="fill-muted text-[10px]"
          >
            ↓ {t('sessions.chart.failed')}
          </text>
          {ticks.map((v) => {
            const y = v > 0 ? zeroY - v * step : zeroY - v * step;
            return (
              <g key={v}>
                <line
                  x1={MARGIN.left}
                  x2={width - MARGIN.right}
                  y1={y}
                  y2={y}
                  stroke="var(--border)"
                  strokeDasharray="2 4"
                />
                <text
                  x={MARGIN.left - 6}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-muted text-[10px] tabular-nums"
                >
                  {Math.abs(v)}
                </text>
              </g>
            );
          })}
          <line
            x1={MARGIN.left}
            x2={width - MARGIN.right}
            y1={zeroY}
            y2={zeroY}
            stroke="var(--text-muted)"
          />
          <text
            x={MARGIN.left - 6}
            y={zeroY + 3}
            textAnchor="end"
            className="fill-muted text-[10px]"
          >
            0
          </text>
          {starts.map((s, i) =>
            i % labelEvery === 0 ? (
              <text
                key={s}
                x={cx(i)}
                y={height - 8}
                textAnchor="middle"
                className="fill-muted text-[10px]"
              >
                {bucketLabel(s, data.bucket)}
              </text>
            ) : null,
          )}
          {dots.map((dot) => {
            const key = `${dot.agent_name}|${dot.session_id}`;
            const lit = hoverKey === key;
            return (
              <circle
                key={`${key}@${dot.col}`}
                data-session={dot.session_id}
                cx={cx(dot.col)}
                cy={cy(dot)}
                r={lit ? r + 0.5 : r}
                fill={lit ? 'var(--text)' : bandColor(costBand(dot.cost))}
                stroke={lit ? 'var(--bg-elev)' : 'none'}
                className="cursor-pointer"
                onMouseEnter={() => setHover({ dot, x: cx(dot.col), y: cy(dot) })}
                onClick={() => onOpen(dot.session_id)}
              />
            );
          })}
        </svg>
        {hover ? (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 min-w-[200px] rounded-control border border-line bg-elev px-3 py-2 text-xs"
            style={{
              boxShadow: 'var(--shadow-float)',
              left: Math.min(hover.x + 12, width - 220),
              top: Math.max(0, hover.y - 12),
            }}
          >
            <div className="mono mb-1 font-semibold text-ink" title={hover.dot.session_id}>
              {shortId(hover.dot.session_id)}
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted">
              <span>{t('sessions.col.harness')}</span>
              <span className="text-ink">{hover.dot.agent_name ?? '—'}</span>
              <span>{t('sessions.col.requests')}</span>
              <span className="tabular-nums text-ink">{formatNumber(hover.dot.requests)}</span>
              <span>{t('sessions.chart.failures')}</span>
              <span className="tabular-nums text-ink">{formatNumber(hover.dot.failed)}</span>
              <span>{t('sessions.col.cost')}</span>
              <span className="tabular-nums text-ink">{costLabel(hover.dot.cost)}</span>
              <span>{t('sessions.chart.period')}</span>
              <span className="text-ink">
                {bucketLabel(Date.parse(hover.dot.bucket), data.bucket)}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
