import { formatErrorClass, formatNumber } from '../services/formatters.js';
import { messagePing } from '../services/sse.js';
import { getErrorBreakdown } from '../services/api/analytics.js';
import { useSignal } from '../lib/signal.js';
import { useResource } from '../lib/use-resource.js';
import { locale, t } from '../i18n/index.js';
import { Panel } from './ui.js';

function label(key: string): string {
  // Other languages use the translated error-class labels; English keeps the
  // raw class name, humanized.
  const translated = locale() === 'en' ? null : formatErrorClass(key);
  return translated ?? key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export interface ErrorClassCardProps {
  range: string;
  agentName?: string;
}

/**
 * "Error classes by frequency". Not mounted on any dashboard until the backend
 * aggregates real error_class data (see its preservation spec).
 */
export default function ErrorClassCard({ range, agentName }: ErrorClassCardProps) {
  const ping = useSignal(messagePing);
  const { data } = useResource(() => getErrorBreakdown(range, agentName), [range, agentName, ping]);

  const sorted = data
    ? Object.entries(data.by_class)
        .filter(([, count]) => count > 0)
        .sort(([, a], [, b]) => b - a)
    : [];
  const maxCount = sorted.length > 0 ? sorted[0]![1] : 1;

  return (
    <Panel title={t('overview.errorClasses.title')}>
      {sorted.length > 0 ? (
        <div className="flex flex-col gap-2">
          {sorted.map(([key, count]) => (
            <div key={key} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3">
              <span className="error-class-card__label truncate text-sm text-dim">
                {label(key)}
              </span>
              <div className="h-1.5 overflow-hidden rounded-full bg-s3">
                <div
                  className="h-full rounded-full bg-danger"
                  style={{ width: `${(count / maxCount) * 100}%` }}
                />
              </div>
              <span className="font-mono text-xs tabular-nums text-muted">
                {formatNumber(count)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">{t('overview.errorClasses.empty')}</p>
      )}
    </Panel>
  );
}
