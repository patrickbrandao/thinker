import { Mail, Send, Server, Webhook } from 'lucide-react';
import type { TriggerType } from 'thinker-shared';
import { t } from '../../i18n/index.js';
import { formatDuration } from '../../services/formatters.js';
import type { TriggerTestResult } from '../../services/api/triggers.js';
import { Badge } from '../ui.js';
import { triggerTypeLabel } from './trigger-form.js';

const ICONS = { email: Mail, webhook: Webhook, telegram: Send, syslog: Server } as const;

export function TriggerTypeIcon({ type, className }: { type: TriggerType; className?: string }) {
  const Icon = ICONS[type] ?? Webhook;
  return <Icon className={className ?? 'size-4 text-muted'} aria-hidden="true" />;
}

/** Icon + label of a trigger type. */
export function TriggerTypeTag({ type }: { type: TriggerType }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-dim">
      <TriggerTypeIcon type={type} />
      {triggerTypeLabel(type)}
    </span>
  );
}

/** Outcome of `POST /triggers/:id/test`. */
export function TriggerTestResultView({ result }: { result: TriggerTestResult }) {
  return (
    <div className="well flex flex-col gap-2 text-sm" role="status">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={result.success ? 'ok' : 'danger'}>
          {result.success ? t('triggers.testResult.success') : t('triggers.testResult.failed')}
        </Badge>
        {result.status_code !== null ? (
          <span className="text-muted">
            {t('triggers.testResult.statusCode')}:{' '}
            <span className="font-mono text-ink">{result.status_code}</span>
          </span>
        ) : null}
        <span className="text-muted">
          {t('triggers.testResult.duration')}:{' '}
          <span className="font-mono text-ink">{formatDuration(result.duration_ms)}</span>
        </span>
      </div>
      {result.error ? (
        <div>
          <div className="label">{t('triggers.testResult.error')}</div>
          <p className="break-words text-danger">{result.error}</p>
        </div>
      ) : null}
      {result.response ? (
        <div>
          <div className="label">{t('triggers.testResult.response')}</div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-control border border-line bg-sunken p-2 font-mono text-xs text-dim">
            {result.response}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
