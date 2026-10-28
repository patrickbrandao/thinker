import { useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, CircleX } from 'lucide-react';
import {
  getMessageDetails,
  flagMessageMiscategorized,
  clearMessageMiscategorized,
} from '../services/api.js';
import { inferProviderName } from '../services/routing-utils.js';
import { getModelDisplayName } from '../services/model-display.js';
import { thinkerErrorDocsUrl, isSuccessStatus } from 'thinker-shared';
import { formatErrorClass, formatErrorOrigin, usd } from '../services/formatters.js';
import { useResource } from '../lib/use-resource.js';
import { ModelParamsSection, RequestHeadersSection } from './MessageDetailsSections.js';
import { FallbackIcon } from './message-table-cells.js';
import { routingTierLabel } from './message-table-types.js';
import { RequestTimelineChart } from './RequestTimelineChart.js';
import { t, tMaybe } from '../i18n/index.js';
import { cx } from './ui.js';

export interface MessageDetailsProps {
  messageId: string;
}

type DetailMessage = Awaited<ReturnType<typeof getMessageDetails>>['message'] & {
  attempts?: Array<{
    provider?: string | null;
    model?: string | null;
    status: string;
    cost_usd?: number | string | null;
  }>;
};

function MetaField({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <span className="msg-detail__meta-item inline-flex min-w-0 items-baseline gap-1.5 text-xs text-ink">
      <span className="msg-detail__meta-label text-muted">{label}</span>
      <span className="break-all">{value}</span>
    </span>
  );
}

function MiscategorizeControl({
  messageId,
  initiallyFlagged,
}: {
  messageId: string;
  initiallyFlagged: boolean;
}) {
  const [flagged, setFlagged] = useState(initiallyFlagged);
  const [busy, setBusy] = useState(false);
  // The ref rejects a second click before the disabled attribute commits.
  const busyRef = useRef(false);

  async function toggle() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (flagged) {
        await clearMessageMiscategorized(messageId);
        setFlagged(false);
      } else {
        await flagMessageMiscategorized(messageId);
        setFlagged(true);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="msg-detail__miscat-btn btn btn-ghost btn-sm"
      onClick={toggle}
      disabled={busy}
      title={t('messages.details.miscatTitle')}
      aria-pressed={flagged}
    >
      {flagged ? t('messages.details.miscatFlagged') : t('messages.details.miscatAsk')}
    </button>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="msg-detail__section-title eyebrow mb-2">{children}</div>;
}

function FallbackTitle() {
  return (
    <div className="error-recovery-row__card-title mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-info">
      <FallbackIcon />
      <span className="recovery-card__title">{t('messages.details.fallbackBadge')}</span>
    </div>
  );
}

/** "Attempt #N triggered by <model>." */
function TriggerPhrase({ m }: { m: DetailMessage }) {
  return (
    <>
      <strong>{t('messages.details.attemptN', { n: (m.fallback_index ?? 0) + 1 })}</strong>{' '}
      {t('messages.details.triggeredBy')}{' '}
      <strong>
        {m.fallback_from_model
          ? getModelDisplayName(m.fallback_from_model)
          : t('messages.details.unknown')}
      </strong>
      .
    </>
  );
}

function ErrorRecovery({ m }: { m: DetailMessage }) {
  // The superseded primary of a fallback flow (legacy status `fallback_error`,
  // now the canonical `failed` + `superseded`).
  const isFallbackError = m.status === 'fallback_error' || m.superseded === true;
  const isFallbackTrigger = !!m.fallback_from_model && !isFallbackError;
  // The two are exclusive: a superseded attempt shows what came next,
  // the final fallback attempt shows what triggered it.
  const hasTrigger = isFallbackTrigger;
  const hasNextAction = isFallbackError;
  if (!m.error_message && !hasTrigger) return null;

  const origin = formatErrorOrigin(m.error_origin);
  const errorClass = formatErrorClass(m.error_class);
  const metaRow = (label: string, value: ReactNode, hint: ReactNode) => (
    <tr>
      <td className="error-recovery-row__meta-label whitespace-nowrap py-1 pr-3 align-top text-muted">
        {label}
      </td>
      <td className="error-recovery-row__meta-value py-1 align-top">
        {value}
        {hint ? (
          <span className="error-recovery-row__meta-hint ml-2 text-faint">{hint}</span>
        ) : null}
      </td>
    </tr>
  );

  const errorBlock = (
    <div
      className={cx(
        'error-recovery-row__error min-w-0 flex-1 rounded-control border border-line bg-danger-tint p-3',
        !(hasNextAction || hasTrigger) && 'error-recovery-row__error--full',
      )}
    >
      <div className="error-recovery-row__title eyebrow mb-1.5">{t('messages.details.error')}</div>
      <div className="msg-detail__error-inline flex items-start gap-1.5 break-words font-mono text-xs text-danger">
        <CircleX aria-hidden="true" className="mt-px size-3.5 shrink-0" />
        <span>{m.error_message}</span>
      </div>
      <table className="error-recovery-row__meta-table mt-2 text-xs text-ink">
        <tbody>
          {m.error_code
            ? metaRow(
                t('messages.details.code'),
                <a
                  className="msg-detail__error-code font-mono text-accent"
                  href={thinkerErrorDocsUrl(m.error_code)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {m.error_code}
                </a>,
                t('messages.details.readDocs'),
              )
            : null}
          {origin
            ? metaRow(
                t('messages.details.origin'),
                <strong>{origin}</strong>,
                m.error_origin ? tMaybe(`messages.details.originHint.${m.error_origin}`) : null,
              )
            : null}
          {errorClass
            ? metaRow(
                t('messages.details.type'),
                <strong>{errorClass}</strong>,
                m.error_class ? tMaybe(`messages.details.classHint.${m.error_class}`) : null,
              )
            : null}
        </tbody>
      </table>
    </div>
  );

  const arrowBlock = (
    <div className="error-recovery-row__arrow flex items-center justify-center text-faint">
      <ArrowRight
        aria-hidden="true"
        className="error-recovery-row__arrow-right hidden size-5 sm:block"
      />
      <ArrowDown aria-hidden="true" className="error-recovery-row__arrow-down size-5 sm:hidden" />
    </div>
  );

  const card = (body: ReactNode) => (
    <div className="error-recovery-row__card error-recovery-row__card--fallback min-w-0 flex-1 rounded-control border border-line bg-info-tint p-3">
      <FallbackTitle />
      <p className="error-recovery-row__card-text text-xs text-ink">{body}</p>
    </div>
  );
  const rowClass = 'error-recovery-row mt-4 flex flex-col gap-2 sm:flex-row sm:items-stretch';

  /* Error + fallback (no trigger) */
  if (m.error_message && isFallbackError) {
    return (
      <div className={rowClass}>
        {errorBlock}
        {arrowBlock}
        {card(t('messages.details.fallbackNext'))}
      </div>
    );
  }

  /* Trigger + error, nothing after → 50/50 */
  if (m.error_message && hasTrigger) {
    return (
      <div className={rowClass}>
        {card(<TriggerPhrase m={m} />)}
        {arrowBlock}
        {errorBlock}
      </div>
    );
  }

  /* Error only → full width */
  if (m.error_message) {
    return <div className={cx(rowClass, 'error-recovery-row--solo')}>{errorBlock}</div>;
  }

  /* No error: the successful fallback attempt */
  return (
    <div className="recovery-card-row mt-4">
      <div className="recovery-card recovery-card--fallback rounded-control border border-line bg-info-tint p-3">
        <div className="recovery-card__branding">
          <FallbackTitle />
        </div>
        <p className="recovery-card__phrase text-xs text-ink">
          <TriggerPhrase m={m} />
        </p>
      </div>
    </div>
  );
}

function formatPeer(ip: string | undefined, port: number | undefined): string | null {
  if (!ip) return null;
  if (port == null) return ip;
  return ip.includes(':') ? `[${ip}]:${port}` : `${ip}:${port}`;
}

function DetailsBody({ m }: { m: DetailMessage }) {
  const provider = m.model ? inferProviderName(m.model) : null;
  // Normalize status for display: a superseded failure (the fallback
  // primary) still renders its real two-state outcome. isSuccessStatus
  // accepts both the legacy `ok` and the canonical `success`.
  const displayStatus =
    m.status === 'pending' || m.status === 'cancelled'
      ? {
          label:
            m.status === 'pending'
              ? t('messages.details.pending')
              : t('messages.details.cancelled'),
          cls: 'status-badge status-badge--neutral badge',
        }
      : isSuccessStatus(m.status)
        ? { label: t('messages.details.success'), cls: 'status-badge status-badge--ok badge is-ok' }
        : {
            label: t('messages.details.failedStatus'),
            cls: 'status-badge status-badge--error badge is-danger',
          };
  const attempts = m.attempts ?? [];

  return (
    <>
      {/* Request section — always first */}
      <div className="msg-detail__section">
        <SectionTitle>{t('messages.details.request')}</SectionTitle>
        <div className="msg-detail__meta flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="msg-detail__meta-item inline-flex items-center gap-1.5 text-xs">
            <span className="msg-detail__meta-label text-muted">
              {t('messages.details.status')}
            </span>
            <span className={displayStatus.cls}>{displayStatus.label}</span>
          </span>
          <MetaField label={t('messages.details.field.id')} value={m.id} />
          <MetaField label={t('messages.details.field.provider')} value={provider} />
          <MetaField label={t('messages.details.field.auth')} value={m.auth_type} />
          <MetaField
            label={t('messages.details.field.apiKey')}
            value={m.provider_key_label ?? t('messages.details.defaultKey')}
          />
          <MetaField
            label={t('messages.details.field.model')}
            value={m.model ? getModelDisplayName(m.model) : null}
          />
          <MetaField label={t('messages.details.field.modelId')} value={m.model} />
          <MetaField label={t('messages.details.field.trace')} value={m.trace_id?.slice(0, 16)} />
          <MetaField
            label={t('messages.details.field.routing')}
            value={
              // The name itself is in "Virtual model" just below.
              (m.virtual_model_name ? t('messages.details.routingVirtualModel') : null) ??
              (m.specificity_category
                ? m.specificity_category.replace(/_/g, ' ')
                : routingTierLabel(m.routing_tier))
            }
          />
          <MetaField
            label={t('messages.details.field.virtualModel')}
            value={m.virtual_model_name}
          />
          {m.specificity_category ? (
            <MiscategorizeControl
              messageId={m.id}
              initiallyFlagged={m.specificity_miscategorized}
            />
          ) : null}
          <MetaField
            label={t('messages.details.field.reason')}
            value={m.routing_reason === 'direct' ? 'DIRECT' : m.routing_reason}
          />
          <MetaField label={t('messages.details.field.service')} value={m.service_type} />
          <MetaField label={t('messages.details.field.session')} value={m.session_key} />
          <MetaField label={t('messages.details.field.description')} value={m.description} />
          <MetaField
            label={t('messages.details.field.app')}
            value={m.caller_attribution?.appName}
          />
          <MetaField label={t('messages.details.field.sdk')} value={m.caller_attribution?.sdk} />
          <MetaField label={t('messages.details.field.skill')} value={m.skill_name} />
        </div>
      </div>

      {m.caller_attribution?.clientIp || m.caller_attribution?.peerIp ? (
        <div className="msg-detail__section mt-4">
          <SectionTitle>{t('messages.details.origin')}</SectionTitle>
          <div className="msg-detail__meta flex flex-wrap items-center gap-x-5 gap-y-2">
            <MetaField
              label={t('messages.details.field.clientIp')}
              value={m.caller_attribution.clientIp}
            />
            <MetaField
              label={t('messages.details.field.clientIpSource')}
              value={m.caller_attribution.clientIpSource}
            />
            <MetaField
              label={t('messages.details.field.peer')}
              value={formatPeer(m.caller_attribution.peerIp, m.caller_attribution.peerPort)}
            />
          </div>
        </div>
      ) : null}

      {m.timeline && m.timeline.events.length > 0 ? (
        <div className="msg-detail__section mt-4">
          <SectionTitle>{t('messages.details.timeline.title')}</SectionTitle>
          <RequestTimelineChart timeline={m.timeline} />
        </div>
      ) : null}

      <ErrorRecovery m={m} />

      {attempts.length > 0 ? (
        <div className="message-details__section mt-4">
          <h4 className="eyebrow mb-2">{t('messages.details.providerAttempts')}</h4>
          <div className="table-wrap">
            <table
              className="data details-table"
              aria-label={t('messages.details.providerAttempts')}
            >
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('common.provider')}</th>
                  <th>{t('common.model')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('common.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((attempt, index) => (
                  <tr key={index}>
                    <td>{index + 1}</td>
                    <td>{attempt.provider ?? t('messages.details.unknownProvider')}</td>
                    <td>{attempt.model ? getModelDisplayName(attempt.model) : '—'}</td>
                    <td>{attempt.status}</td>
                    <td className="font-mono">
                      {attempt.cost_usd == null ? '—' : usd(Number(attempt.cost_usd), 6)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Model Parameters renders above Request Headers — params are user
          intent (what the request asked for); headers are protocol noise. */}
      {m.request_params && Object.keys(m.request_params).length > 0 ? (
        <ModelParamsSection params={m.request_params} />
      ) : null}

      {m.request_headers && Object.keys(m.request_headers).length > 0 ? (
        <RequestHeadersSection headers={m.request_headers} />
      ) : null}
    </>
  );
}

export default function MessageDetails({ messageId }: MessageDetailsProps) {
  const { data, error, loading } = useResource(() => getMessageDetails(messageId), [messageId]);

  return (
    <div className="msg-detail px-1 py-3">
      {loading && !error ? (
        <div className="msg-detail__loader flex items-center gap-2 text-xs text-muted">
          <span className="spinner msg-detail__spinner" aria-hidden="true" />
          <span>{t('messages.details.loading')}</span>
        </div>
      ) : null}
      {error ? (
        <div className="msg-detail__error text-xs text-danger">{t('messages.details.failed')}</div>
      ) : null}
      {!error && data && !loading ? <DetailsBody m={data.message as DetailMessage} /> : null}
    </div>
  );
}
