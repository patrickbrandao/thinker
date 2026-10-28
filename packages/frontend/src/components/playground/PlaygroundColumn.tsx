import { useState, type ReactNode } from 'react';
import { BadgeCheck, ChevronDown, CircleAlert, SquarePen, Star, X } from 'lucide-react';
import type { PlaygroundColumn as ColumnData } from '../../services/playground-store.js';
import { formatCost, formatDuration, formatNumber } from '../../services/formatters.js';
import { providerIcon } from '../ProviderIcon.jsx';
import { resolveProviderId } from '../../services/routing-utils.js';
import MarkdownContent from './MarkdownContent.jsx';
import { Button, cx } from '../ui.jsx';
import { t } from '../../i18n/index.js';

interface Props {
  column: ColumnData;
  isCheapest: boolean;
  isFastest: boolean;
  isBest?: boolean;
  readOnly?: boolean;
  onRemove: (id: string) => void;
  onChangeModel: (id: string) => void;
  onRetry: (id: string) => void;
  /** Toggle this column as the user's best answer. Absent ⇒ not actionable. */
  onMarkBest?: () => void;
}

const DASH = '—';

function providerIdFor(column: ColumnData): string {
  return resolveProviderId(column.provider) ?? column.provider.toLowerCase();
}

function WinBadge({ title }: { title: string }) {
  return (
    <span className="playground-column__win-badge inline-flex text-ok" title={title}>
      <BadgeCheck size={15} aria-hidden="true" />
    </span>
  );
}

function ResponseHeaders({ headers }: { headers: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="playground-column__headers border-t border-line">
      <button
        type="button"
        className="playground-column__headers-toggle flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted hover:text-ink"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>{t('playground.column.responseHeaders')}</span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={cx('transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <dl className="playground-column__headers-list grid max-h-48 grid-cols-[auto_1fr] gap-x-3 gap-y-1 overflow-auto px-3 pb-3 font-mono text-xs">
          {Object.entries(headers).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="break-all text-dim">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/** One model's answer: header (model, best star, remove), body, metrics. */
export default function PlaygroundColumn({
  column,
  isCheapest,
  isFastest,
  isBest,
  readOnly,
  onRemove,
  onChangeModel,
  onRetry,
  onMarkBest,
}: Props) {
  const name = column.displayName ?? '';
  const isSuccess = column.status === 'success';
  const titleInner = (
    <span className="playground-column__title-left flex min-w-0 items-center gap-2">
      <span className="playground-column__icon inline-flex shrink-0">
        {providerIcon(providerIdFor(column), 18)}
      </span>
      <span className="playground-column__name truncate text-sm font-medium text-ink">
        {column.displayName}
      </span>
    </span>
  );

  return (
    <section
      className="playground-column flex min-h-72 min-w-0 flex-col overflow-hidden rounded-surface border border-line bg-elev"
      role="region"
      aria-label={t('playground.column.responseFrom', { name })}
    >
      <header className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        {readOnly ? (
          <div className="playground-column__title playground-column__title--readonly flex min-w-0 flex-1 items-center px-1.5 py-1">
            {titleInner}
          </div>
        ) : (
          <button
            type="button"
            className="playground-column__title group flex min-w-0 flex-1 items-center justify-between gap-2 rounded-control px-1.5 py-1 text-left hover:bg-s2"
            onClick={() => onChangeModel(column.id)}
            title={t('playground.column.changeModel')}
          >
            {titleInner}
            <SquarePen
              size={14}
              aria-hidden="true"
              className="playground-column__edit-icon shrink-0 text-faint group-hover:text-muted"
            />
          </button>
        )}
        {isSuccess && onMarkBest ? (
          <button
            type="button"
            className={cx(
              'playground-column__best icon-btn',
              isBest && 'playground-column__best--on text-warn',
            )}
            aria-pressed={!!isBest}
            aria-label={
              isBest
                ? t('playground.column.unmarkBest', { name })
                : t('playground.column.markBestNamed', { name })
            }
            title={isBest ? t('playground.column.yourBest') : t('playground.column.markBest')}
            onClick={() => onMarkBest()}
          >
            <Star size={16} fill={isBest ? 'currentColor' : 'none'} aria-hidden="true" />
          </button>
        ) : null}
        {isSuccess && !onMarkBest && isBest ? (
          <span
            className="playground-column__best playground-column__best--on playground-column__best--static inline-flex px-1.5 text-warn"
            title={t('playground.column.yourBest')}
            aria-label={t('playground.column.wasMarkedBest', { name })}
          >
            <Star size={16} fill="currentColor" aria-hidden="true" />
          </span>
        ) : null}
        {!readOnly ? (
          <button
            type="button"
            className="playground-column__remove icon-btn"
            aria-label={t('playground.column.remove', { name })}
            onClick={() => onRemove(column.id)}
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      <div className="flex-1 overflow-auto p-3">
        {column.status === 'idle' ? (
          <p className="playground-column__placeholder text-sm text-faint">
            {t('playground.column.placeholder')}
          </p>
        ) : null}
        {column.status === 'loading' && !column.response ? (
          <div className="playground-column__skeleton flex flex-col gap-2" aria-hidden="true">
            <span className="skel" style={{ width: '90%', height: 12 }} />
            <span className="skel" style={{ width: '75%', height: 12 }} />
            <span className="skel" style={{ width: '60%', height: 12 }} />
          </div>
        ) : null}
        {isSuccess || (column.status === 'loading' && column.response) ? (
          <MarkdownContent className="playground-column__response" text={column.response ?? ''} />
        ) : null}
        {column.status === 'error' ? (
          <div
            className="playground-column__error flex flex-col items-start gap-3 rounded-control bg-danger-tint p-3 text-sm text-danger"
            role="alert"
          >
            <span className="flex items-start gap-2 break-words">
              <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              {column.error}
            </span>
            {!readOnly ? (
              <Button size="sm" onClick={() => onRetry(column.id)}>
                {t('common.retry')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <footer
        className="playground-column__metrics grid grid-cols-3 divide-x divide-line border-t border-line"
        aria-label={t('playground.column.metrics')}
      >
        <Metric label={t('playground.column.cost')}>
          <span className="playground-column__metric-value">
            {column.metrics?.cost != null ? (formatCost(column.metrics.cost) ?? DASH) : DASH}
          </span>
          {isCheapest && isSuccess ? <WinBadge title={t('playground.column.cheapest')} /> : null}
        </Metric>
        <Metric label={t('playground.column.output')}>
          <span className="playground-column__metric-value">
            {column.metrics ? formatNumber(column.metrics.outputTokens) : DASH}
          </span>
        </Metric>
        <Metric label={t('playground.column.duration')}>
          <span className="playground-column__metric-value">
            {column.metrics ? formatDuration(column.metrics.durationMs) : DASH}
          </span>
          {isFastest && isSuccess ? <WinBadge title={t('playground.column.fastest')} /> : null}
        </Metric>
      </footer>

      {column.headers && Object.keys(column.headers).length > 0 ? (
        <ResponseHeaders headers={column.headers} />
      ) : null}
    </section>
  );
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="playground-column__metric flex flex-col gap-0.5 px-3 py-2">
      <span className="playground-column__metric-label text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      <span className="flex items-center gap-1 font-mono text-xs text-ink tabular-nums">
        {children}
      </span>
    </div>
  );
}
