import type { RequestTimeline, RequestTimelineEvent } from '../services/api/messages.js';
import { getModelDisplayName } from '../services/model-display.js';
import { t } from '../i18n/index.js';

const pad = (n: number, size = 2) => String(n).padStart(size, '0');

/** Local `yyyy-mm-dd hh:mm:ss.mmm`. */
export function formatPreciseTimestamp(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

export function formatSpan(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(3)} s`;
}

const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
const seriesColor = (attempt: number): string => SERIES[attempt - 1] ?? 'var(--chart-other)';

interface AttemptLane {
  attempt: number;
  label: string;
  request?: number;
  response?: number;
  error?: number;
  firstChunk?: number;
  lastChunk?: number;
  skipped?: number;
}

function attemptLanes(events: RequestTimelineEvent[]): AttemptLane[] {
  const lanes = new Map<number, AttemptLane>();
  for (const e of events) {
    if (e.attempt == null) continue;
    const lane = lanes.get(e.attempt) ?? {
      attempt: e.attempt,
      label: [e.provider, e.model ? getModelDisplayName(e.model) : null]
        .filter(Boolean)
        .join(' · '),
    };
    if (e.type === 'provider_request') lane.request = e.at;
    if (e.type === 'provider_response') lane.response = e.at;
    if (e.type === 'provider_error') lane.error = e.at;
    if (e.type === 'first_chunk') lane.firstChunk = e.at;
    if (e.type === 'last_chunk') lane.lastChunk = e.at;
    if (e.type === 'provider_skipped') lane.skipped = e.at;
    lanes.set(e.attempt, lane);
  }
  return [...lanes.values()].sort((a, b) => a.attempt - b.attempt);
}

function eventDetail(e: RequestTimelineEvent): string {
  const parts: string[] = [];
  if (e.attempt != null) parts.push(t('messages.details.timeline.attempt', { n: e.attempt }));
  if (e.provider) parts.push(e.provider);
  if (e.model) parts.push(getModelDisplayName(e.model));
  if (e.status != null) parts.push(`HTTP ${e.status}`);
  if (e.chunks != null)
    parts.push(t('messages.details.timeline.chunks', { chunks: e.chunks, bytes: e.bytes ?? 0 }));
  return parts.join(' · ');
}

const W = 800;
const LEFT = 150;
const RIGHT = 20;
const LANE_H = 30;
const TOP = 34;

/**
 * Request timeline: one lane for Thinker (received → response completed) and
 * one per provider attempt (sent → headers → first/last chunk), on a shared
 * millisecond axis that starts at the first HTTP contact. A table below lists
 * every event with its exact timestamp, offset and interval.
 */
export function RequestTimelineChart({ timeline }: { timeline: RequestTimeline }) {
  const events = timeline.events;
  if (events.length === 0) return null;
  const start = events.find((e) => e.type === 'received')?.at ?? events[0]!.at;
  const end = Math.max(...events.map((e) => e.at));
  const span = Math.max(1, end - start);
  const lastChunk = Math.max(
    start,
    ...events.filter((e) => e.type === 'last_chunk').map((e) => e.at),
  );
  const completed = events.find((e) => e.type === 'response_completed')?.at;
  const firstChunk = events.find((e) => e.type === 'first_chunk')?.at;
  const lanes = attemptLanes(events);
  const plotW = W - LEFT - RIGHT;
  const x = (ms: number) => LEFT + ((ms - start) / span) * plotW;
  const laneY = (i: number) => TOP + i * LANE_H + LANE_H / 2;
  const axisY = TOP + (lanes.length + 1) * LANE_H + 6;
  const H = axisY + 40;
  const ticks = Array.from({ length: 6 }, (_, i) => Math.round((span * i) / 5));

  const marker = (ms: number, y: number, color: string, title: string, key: string) => (
    <g key={key}>
      <circle cx={x(ms)} cy={y} r={5} fill={color} stroke="var(--surface, #fff)" strokeWidth={2}>
        <title>{title}</title>
      </circle>
      {/* Larger invisible hit target for the tooltip. */}
      <circle cx={x(ms)} cy={y} r={10} fill="transparent">
        <title>{title}</title>
      </circle>
    </g>
  );
  // Duration of one interval, written above its segment when there is room.
  const segment = (from: number, to: number, y: number, key: string) =>
    x(to) - x(from) >= 44 ? (
      <text
        key={key}
        x={(x(from) + x(to)) / 2}
        y={y - 8}
        textAnchor="middle"
        fill="var(--text-muted)"
        style={{ fontSize: 10 }}
      >
        {formatSpan(to - from)}
      </text>
    ) : null;
  const firstRequest = events.find((e) => e.type === 'provider_request')?.at;
  const at = (type: RequestTimelineEvent['type'], ms: number) =>
    `${t(`messages.details.timeline.event.${type}`)}\n${formatPreciseTimestamp(ms)}\n+${formatSpan(ms - start)}`;

  return (
    <div className="request-timeline">
      <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink">
        {lastChunk > start ? (
          <span>
            <span className="text-muted">{t('messages.details.timeline.total')}</span>{' '}
            <strong className="font-mono">{formatSpan(lastChunk - start)}</strong>
          </span>
        ) : null}
        {completed != null ? (
          <span>
            <span className="text-muted">{t('messages.details.timeline.endToEnd')}</span>{' '}
            <strong className="font-mono">{formatSpan(completed - start)}</strong>
          </span>
        ) : null}
        {firstChunk != null ? (
          <span>
            <span className="text-muted">{t('messages.details.timeline.firstChunk')}</span>{' '}
            <strong className="font-mono">{formatSpan(firstChunk - start)}</strong>
          </span>
        ) : null}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={t('messages.details.timeline.ariaLabel')}
        style={{ maxWidth: W, fontSize: 11 }}
      >
        {/* Span bracket: received → last chunk. */}
        {lastChunk > start ? (
          <g>
            <line x1={x(start)} x2={x(lastChunk)} y1={12} y2={12} stroke="var(--text-muted)" />
            <line x1={x(start)} x2={x(start)} y1={7} y2={17} stroke="var(--text-muted)" />
            <line x1={x(lastChunk)} x2={x(lastChunk)} y1={7} y2={17} stroke="var(--text-muted)" />
            <text
              x={(x(start) + x(lastChunk)) / 2}
              y={26}
              textAnchor="middle"
              fill="var(--text-muted)"
            >
              {formatSpan(lastChunk - start)}
            </text>
          </g>
        ) : null}

        {/* Thinker lane. */}
        <text x={LEFT - 8} y={laneY(0) + 4} textAnchor="end" fill="var(--text-muted)">
          Thinker
        </text>
        <line
          x1={x(start)}
          x2={x(completed ?? end)}
          y1={laneY(0)}
          y2={laneY(0)}
          stroke="var(--border-strong)"
          strokeWidth={2}
        />
        {firstRequest != null ? segment(start, firstRequest, laneY(0), 'routing') : null}
        {lastChunk > start && completed != null && completed > lastChunk
          ? segment(lastChunk, completed, laneY(0), 'flush')
          : null}
        {events
          .filter((e) => e.attempt == null)
          .map((e, i) => marker(e.at, laneY(0), 'var(--text-muted)', at(e.type, e.at), `t${i}`))}

        {lanes.map((lane, i) => {
          const y = laneY(i + 1);
          const color = seriesColor(lane.attempt);
          const label = `#${lane.attempt} ${lane.label}`;
          const waitEnd = lane.response ?? lane.error;
          return (
            <g key={lane.attempt}>
              <text x={LEFT - 8} y={y + 4} textAnchor="end" fill="var(--text-muted)">
                {label.length > 24 ? `${label.slice(0, 23)}…` : label}
                <title>{label}</title>
              </text>
              {lane.request != null && waitEnd != null ? (
                <line
                  x1={x(lane.request)}
                  x2={x(waitEnd)}
                  y1={y}
                  y2={y}
                  stroke={color}
                  strokeWidth={2}
                  strokeDasharray="4 3"
                />
              ) : null}
              {lane.request != null && waitEnd != null
                ? segment(lane.request, waitEnd, y, 'wait')
                : null}
              {lane.response != null && lane.lastChunk != null
                ? segment(lane.response, lane.lastChunk, y, 'stream')
                : null}
              {lane.response != null && lane.lastChunk != null ? (
                <rect
                  x={x(Math.min(lane.response, lane.firstChunk ?? lane.response))}
                  y={y - 4}
                  width={Math.max(
                    2,
                    x(lane.lastChunk) -
                      x(Math.min(lane.response, lane.firstChunk ?? lane.response)),
                  )}
                  height={8}
                  rx={4}
                  fill={color}
                  opacity={0.85}
                />
              ) : null}
              {lane.skipped != null
                ? marker(
                    lane.skipped,
                    y,
                    'var(--text-faint)',
                    at('provider_skipped', lane.skipped),
                    's',
                  )
                : null}
              {lane.request != null
                ? marker(lane.request, y, color, at('provider_request', lane.request), 'rq')
                : null}
              {lane.response != null
                ? marker(lane.response, y, color, at('provider_response', lane.response), 'rs')
                : null}
              {lane.error != null
                ? marker(lane.error, y, 'var(--danger)', at('provider_error', lane.error), 'er')
                : null}
              {lane.firstChunk != null
                ? marker(lane.firstChunk, y, color, at('first_chunk', lane.firstChunk), 'fc')
                : null}
              {lane.lastChunk != null
                ? marker(lane.lastChunk, y, color, at('last_chunk', lane.lastChunk), 'lc')
                : null}
            </g>
          );
        })}

        {/* Axis. */}
        <line x1={LEFT} x2={W - RIGHT} y1={axisY} y2={axisY} stroke="var(--border)" />
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={x(start + tick)}
              x2={x(start + tick)}
              y1={TOP}
              y2={axisY + 4}
              stroke="var(--border)"
              strokeDasharray="2 4"
            />
            <text x={x(start + tick)} y={axisY + 18} textAnchor="middle" fill="var(--text-muted)">
              {formatSpan(tick)}
            </text>
          </g>
        ))}
      </svg>

      <div className="table-wrap mt-2">
        <table className="data details-table" aria-label={t('messages.details.timeline.ariaLabel')}>
          <thead>
            <tr>
              <th>{t('messages.details.timeline.colTime')}</th>
              <th>{t('messages.details.timeline.colOffset')}</th>
              <th>{t('messages.details.timeline.colDelta')}</th>
              <th>{t('messages.details.timeline.colEvent')}</th>
              <th>{t('messages.details.timeline.colDetail')}</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap font-mono">{formatPreciseTimestamp(e.at)}</td>
                <td className="whitespace-nowrap font-mono">+{formatSpan(e.at - start)}</td>
                <td className="whitespace-nowrap font-mono">
                  {i === 0 ? '—' : `+${formatSpan(e.at - events[i - 1]!.at)}`}
                </td>
                <td>{t(`messages.details.timeline.event.${e.type}`)}</td>
                <td>{eventDetail(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
