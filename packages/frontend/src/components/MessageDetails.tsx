import { createResource, createSignal, For, Show, type JSX } from 'solid-js';
import {
  getMessageDetails,
  flagMessageMiscategorized,
  clearMessageMiscategorized,
} from '../services/api.js';
import { inferProviderName } from '../services/routing-utils.js';
import { getModelDisplayName } from '../services/model-display.js';
import { thinkerErrorDocsUrl, isSuccessStatus } from 'thinker-shared';
import { formatErrorClass, formatErrorOrigin, usd } from '../services/formatters.js';
import { ModelParamsSection, RequestHeadersSection } from './MessageDetailsSections.jsx';
import { routingTierLabel } from './message-table-types.js';
import { t, tMaybe } from '../i18n/index.js';

export interface MessageDetailsProps {
  messageId: string;
}

function MetaField(props: { label: string; value: string | null | undefined }): JSX.Element {
  return (
    <Show when={props.value}>
      <span class="msg-detail__meta-item">
        <span class="msg-detail__meta-label">{props.label}</span>
        {props.value}
      </span>
    </Show>
  );
}

function MiscategorizeControl(props: {
  messageId: string;
  initiallyFlagged: boolean;
}): JSX.Element {
  const [flagged, setFlagged] = createSignal(props.initiallyFlagged);
  const [busy, setBusy] = createSignal(false);

  async function toggle() {
    // Belt-and-suspenders: `disabled={busy()}` on the button already rejects
    // real clicks during an in-flight request. This guard catches the narrow
    // race where Solid's event delegation could fire the handler before the
    // disabled attribute commits, and tests can't reliably reproduce it.
    /* v8 ignore next */
    if (busy()) return;
    setBusy(true);
    try {
      if (flagged()) {
        await clearMessageMiscategorized(props.messageId);
        setFlagged(false);
      } else {
        await flagMessageMiscategorized(props.messageId);
        setFlagged(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      class="msg-detail__miscat-btn"
      onClick={toggle}
      disabled={busy()}
      title={t('messages.details.miscatTitle')}
      aria-pressed={flagged()}
    >
      {flagged() ? t('messages.details.miscatFlagged') : t('messages.details.miscatAsk')}
    </button>
  );
}

export default function MessageDetails(props: MessageDetailsProps): JSX.Element {
  const [data] = createResource(() => props.messageId, getMessageDetails);

  return (
    <div class="msg-detail">
      <Show when={data.loading && !data.error}>
        <div class="msg-detail__loader">
          <div class="msg-detail__spinner" />
          <span>{t('messages.details.loading')}</span>
        </div>
      </Show>
      <Show when={data.error}>
        <div class="msg-detail__error">{t('messages.details.failed')}</div>
      </Show>
      <Show when={!data.error && data() && !data.loading}>
        {(() => {
          const d = data()!;
          const m = d.message;
          const provider = m.model ? inferProviderName(m.model) : null;
          // Normalize status for display: a superseded failure (the fallback
          // primary) still renders its real two-state outcome. isSuccessStatus
          // accepts both the legacy `ok` and the canonical `success`.
          const displayStatus = () => {
            if (m.status === 'pending' || m.status === 'cancelled') {
              return {
                label:
                  m.status === 'pending'
                    ? t('messages.details.pending')
                    : t('messages.details.cancelled'),
                cls: 'status-badge status-badge--neutral',
              };
            }
            if (isSuccessStatus(m.status))
              return { label: t('messages.details.success'), cls: 'status-badge status-badge--ok' };
            return {
              label: t('messages.details.failedStatus'),
              cls: 'status-badge status-badge--error',
            };
          };
          // The superseded primary of a fallback flow (legacy status `fallback_error`,
          // now the canonical `failed` + `superseded`).
          const isFallbackError = m.status === 'fallback_error' || m.superseded === true;
          const isFallbackTrigger = !!m.fallback_from_model && !isFallbackError;
          // The two are exclusive: a superseded attempt shows what came next,
          // the final fallback attempt shows what triggered it.
          const hasTrigger = isFallbackTrigger;
          const hasNextAction = isFallbackError;
          return (
            <>
              {/* ── Message section — always first ─────────────────── */}
              <div class="msg-detail__section">
                <div class="msg-detail__section-title">{t('messages.details.request')}</div>
                <div class="msg-detail__meta">
                  <span class="msg-detail__meta-item">
                    <span class="msg-detail__meta-label">{t('messages.details.status')}</span>
                    <span class={displayStatus().cls}>{displayStatus().label}</span>
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
                  <MetaField
                    label={t('messages.details.field.trace')}
                    value={m.trace_id?.slice(0, 16)}
                  />
                  <MetaField
                    label={t('messages.details.field.routing')}
                    value={
                      // The name itself is in "Virtual model" just below.
                      (m.virtual_model_name ? t('messages.details.routingVirtualModel') : null) ??
                      m.header_tier_name ??
                      (m.specificity_category
                        ? m.specificity_category.replace(/_/g, ' ')
                        : routingTierLabel(m.routing_tier))
                    }
                  />
                  <MetaField
                    label={t('messages.details.field.virtualModel')}
                    value={m.virtual_model_name}
                  />
                  <Show when={m.specificity_category}>
                    <MiscategorizeControl
                      messageId={m.id}
                      initiallyFlagged={m.specificity_miscategorized}
                    />
                  </Show>
                  <MetaField
                    label={t('messages.details.field.reason')}
                    value={m.routing_reason === 'direct' ? 'DIRECT' : m.routing_reason}
                  />
                  <MetaField label={t('messages.details.field.service')} value={m.service_type} />
                  <MetaField label={t('messages.details.field.session')} value={m.session_key} />
                  <MetaField
                    label={t('messages.details.field.description')}
                    value={m.description}
                  />
                  <MetaField
                    label={t('messages.details.field.app')}
                    value={m.caller_attribution?.appName}
                  />
                  <MetaField
                    label={t('messages.details.field.sdk')}
                    value={m.caller_attribution?.sdk}
                  />
                  <MetaField label={t('messages.details.field.skill')} value={m.skill_name} />
                </div>
              </div>

              {/* ── Error + trigger/action blocks ─────────────────── */}
              <Show when={m.error_message || hasTrigger}>
                {(() => {
                  /* Reusable blocks */
                  const errorBlock = (
                    <div
                      class={
                        hasNextAction || hasTrigger
                          ? 'error-recovery-row__error'
                          : 'error-recovery-row__error error-recovery-row__error--full'
                      }
                    >
                      <div class="error-recovery-row__title">{t('messages.details.error')}</div>
                      <div class="msg-detail__error-inline">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          aria-hidden="true"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <line x1="15" y1="9" x2="9" y2="15" />
                          <line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                        <span>{m.error_message}</span>
                      </div>
                      <table class="error-recovery-row__meta-table">
                        <tbody>
                          <Show when={m.error_code}>
                            <tr>
                              <td class="error-recovery-row__meta-label">
                                {t('messages.details.code')}
                              </td>
                              <td class="error-recovery-row__meta-value">
                                <a
                                  class="msg-detail__error-code"
                                  href={thinkerErrorDocsUrl(m.error_code!)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {m.error_code}
                                </a>
                                <span class="error-recovery-row__meta-hint">
                                  {t('messages.details.readDocs')}
                                </span>
                              </td>
                            </tr>
                          </Show>
                          <Show when={formatErrorOrigin(m.error_origin)}>
                            <tr>
                              <td class="error-recovery-row__meta-label">
                                {t('messages.details.origin')}
                              </td>
                              <td class="error-recovery-row__meta-value">
                                <strong>{formatErrorOrigin(m.error_origin)}</strong>
                                <span class="error-recovery-row__meta-hint">
                                  {m.error_origin
                                    ? tMaybe(`messages.details.originHint.${m.error_origin}`)
                                    : undefined}
                                </span>
                              </td>
                            </tr>
                          </Show>
                          <Show when={formatErrorClass(m.error_class)}>
                            <tr>
                              <td class="error-recovery-row__meta-label">
                                {t('messages.details.type')}
                              </td>
                              <td class="error-recovery-row__meta-value">
                                <strong>{formatErrorClass(m.error_class)}</strong>
                                <span class="error-recovery-row__meta-hint">
                                  {m.error_class
                                    ? tMaybe(`messages.details.classHint.${m.error_class}`)
                                    : undefined}
                                </span>
                              </td>
                            </tr>
                          </Show>
                        </tbody>
                      </table>
                    </div>
                  );

                  const arrowBlock = (
                    <div class="error-recovery-row__arrow">
                      <svg
                        class="error-recovery-row__arrow-right"
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path d="M6 13h6v4l6-5-6-5v4H6z" />
                      </svg>
                      <svg
                        class="error-recovery-row__arrow-down"
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path d="M13 12V6h-2v6H7l5 6 5-6z" />
                      </svg>
                    </div>
                  );

                  const fallbackTriggerCard = (
                    <div class="error-recovery-row__card error-recovery-row__card--fallback">
                      <div class="error-recovery-row__card-title">
                        <span class="fallback-icon">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="12"
                            height="12"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            <path d="m7.84 13.75 1.33-1.49-2.53-2.25h8.37c2.21 0 4 1.79 4 4s-1.79 4-4 4h-3v2h3c3.31 0 6-2.69 6-6s-2.69-6-6-6H6.63l2.53-2.25-1.33-1.49-5.34 4.75 5.34 4.75Z" />
                          </svg>
                        </span>
                        <span class="recovery-card__title">
                          {t('messages.details.fallbackBadge')}
                        </span>
                      </div>
                      <p class="error-recovery-row__card-text" style="font-size: 12px;">
                        <strong>
                          {t('messages.details.attemptN', {
                            n: ((m.fallback_index as number) ?? 0) + 1,
                          })}
                        </strong>{' '}
                        {t('messages.details.triggeredBy')}{' '}
                        <strong>
                          {m.fallback_from_model
                            ? getModelDisplayName(m.fallback_from_model)
                            : t('messages.details.unknown')}
                        </strong>
                        .
                      </p>
                    </div>
                  );

                  const fallbackNextCard = (
                    <div class="error-recovery-row__card error-recovery-row__card--fallback">
                      <div class="error-recovery-row__card-title">
                        <span class="fallback-icon">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="12"
                            height="12"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            <path d="m7.84 13.75 1.33-1.49-2.53-2.25h8.37c2.21 0 4 1.79 4 4s-1.79 4-4 4h-3v2h3c3.31 0 6-2.69 6-6s-2.69-6-6-6H6.63l2.53-2.25-1.33-1.49-5.34 4.75 5.34 4.75Z" />
                          </svg>
                        </span>
                        <span class="recovery-card__title">
                          {t('messages.details.fallbackBadge')}
                        </span>
                      </div>
                      <p class="error-recovery-row__card-text">
                        {t('messages.details.fallbackNext')}
                      </p>
                    </div>
                  );

                  /* Error + fallback (no trigger) */
                  if (m.error_message && isFallbackError) {
                    return (
                      <div class="error-recovery-row">
                        {errorBlock}
                        {arrowBlock}
                        {fallbackNextCard}
                      </div>
                    );
                  }

                  /* Trigger + error, nothing after → 50/50 */
                  if (m.error_message && hasTrigger) {
                    return (
                      <div class="error-recovery-row">
                        {fallbackTriggerCard}
                        {arrowBlock}
                        {errorBlock}
                      </div>
                    );
                  }

                  /* Error only → full width */
                  if (m.error_message) {
                    return (
                      <div class="error-recovery-row error-recovery-row--solo">{errorBlock}</div>
                    );
                  }

                  /* ── No error: the successful fallback attempt */
                  if (isFallbackTrigger && !m.error_message) {
                    return (
                      <div class="recovery-card-row">
                        <div class="recovery-card recovery-card--fallback">
                          <div class="recovery-card__branding">
                            <span class="fallback-icon">
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="12"
                                height="12"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                              >
                                <path d="m7.84 13.75 1.33-1.49-2.53-2.25h8.37c2.21 0 4 1.79 4 4s-1.79 4-4 4h-3v2h3c3.31 0 6-2.69 6-6s-2.69-6-6-6H6.63l2.53-2.25-1.33-1.49-5.34 4.75 5.34 4.75Z" />
                              </svg>
                            </span>
                            <span class="recovery-card__title">
                              {t('messages.details.fallbackBadge')}
                            </span>
                          </div>
                          <p class="recovery-card__phrase" style="font-size: 12px;">
                            <strong>
                              {t('messages.details.attemptN', {
                                n: ((m.fallback_index as number) ?? 0) + 1,
                              })}
                            </strong>{' '}
                            {t('messages.details.triggeredBy')}{' '}
                            <strong>
                              {m.fallback_from_model
                                ? getModelDisplayName(m.fallback_from_model)
                                : t('messages.details.unknown')}
                            </strong>
                            .
                          </p>
                        </div>
                      </div>
                    );
                  }

                  return null;
                })()}
              </Show>

              <Show when={(m.attempts?.length ?? 0) > 0}>
                <div class="message-details__section">
                  <h4>{t('messages.details.providerAttempts')}</h4>
                  <table class="details-table" aria-label={t('messages.details.providerAttempts')}>
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
                      <For each={m.attempts}>
                        {(attempt, index) => (
                          <tr>
                            <td>{index() + 1}</td>
                            <td>{attempt.provider ?? t('messages.details.unknownProvider')}</td>
                            <td>{attempt.model ? getModelDisplayName(attempt.model) : '—'}</td>
                            <td>{attempt.status}</td>
                            <td>
                              {attempt.cost_usd == null ? '—' : usd(Number(attempt.cost_usd), 6)}
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </Show>

              {/* Model Parameters renders above Request Headers — params
                  are user intent (what the request asked for); headers are
                  protocol noise. */}
              <Show when={m.request_params && Object.keys(m.request_params).length > 0}>
                <ModelParamsSection params={m.request_params!} />
              </Show>

              <Show when={m.request_headers && Object.keys(m.request_headers).length > 0}>
                <RequestHeadersSection headers={m.request_headers!} />
              </Show>
            </>
          );
        })()}
      </Show>
    </div>
  );
}
