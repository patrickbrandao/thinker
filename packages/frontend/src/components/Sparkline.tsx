import { useMemo, useState } from 'react';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  /** Stroke/fill color. Defaults to the accent token (via currentColor). */
  color?: string;
}

// Module-level counter for unique SVG gradient IDs across Sparkline instances
let idCounter = 0;

export default function Sparkline({ data, width = 200, height = 50, color }: SparklineProps) {
  // Lazy initial state: one id per mounted instance, stable across renders.
  const [gradId] = useState(() => `spark-grad-${idCounter++}`);
  const paint = color ?? 'currentColor';

  const pathData = useMemo(() => {
    if (!data.length) return null;

    const max = Math.max(...data, 1);
    const stepX = width / Math.max(data.length - 1, 1);
    const padding = 2;
    const usableH = height - padding * 2;

    const coords = data.map((v, i) => ({
      x: Math.round(i * stepX * 10) / 10,
      y: Math.round((padding + usableH - (v / max) * usableH) * 10) / 10,
    }));

    const line = coords.map((c, i) => (i === 0 ? `M${c.x},${c.y}` : `L${c.x},${c.y}`)).join(' ');
    const last = coords[coords.length - 1]!;
    const area = `${line} L${last.x},${height} L0,${height} Z`;

    return { line, area };
  }, [data, width, height]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block text-accent"
      aria-hidden="true"
    >
      {pathData ? (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={paint} stopOpacity="0.15" />
              <stop offset="100%" stopColor={paint} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={pathData.area} fill={`url(#${gradId})`} />
          <path
            d={pathData.line}
            fill="none"
            stroke={paint}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : null}
    </svg>
  );
}
