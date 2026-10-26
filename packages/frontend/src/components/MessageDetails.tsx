import { createResource, createSignal, For, Show, type JSX } from 'solid-js';
import {
  getMessageDetails,
  flagMessageMiscategorized,
  clearMessageMiscategorized,
} from '../services/api.js';
import { inferProviderName } from '../services/routing-utils.js';
import { getModelDisplayName } from '../services/model-display.js';
import { thinkerErrorDocsUrl, isSuccessStatus } from 'thinker-shared';
import { formatErrorClass, formatErrorOrigin } from '../services/formatters.js';
import { ModelParamsSection, RequestHeadersSection } from './MessageDetailsSections.jsx';
import { routingTierLabel } from './message-table-types.js';

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
      title="Flag this message's routing category as wrong. Repeated flags reduce this category's routing score for this harness."
      aria-pressed={flagged()}
    >
      {flagged() ? 'Flagged as miscategorized (undo)' : 'Wrong category?'}
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
          <span>Loading details...</span>
        </div>
      </Show>
      <Show when={data.error}>
        <div class="msg-detail__error">Failed to load details</div>
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
                label: m.status === 'pending' ? 'Pending' : 'Cancelled',
                cls: 'status-badge status-badge--neutral',
              };
            }
            if (isSuccessStatus(m.status))
              return { label: 'Success', cls: 'status-badge status-badge--ok' };
            return { label: 'Failed', cls: 'status-badge status-badge--error' };
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
                <div class="msg-detail__section-title">Request</div>
                <div class="msg-detail__meta">
                  <span class="msg-detail__meta-item">
                    <span class="msg-detail__meta-label">Status</span>
                    <span class={displayStatus().cls}>{displayStatus().label}</span>
                  </span>
                  <MetaField label="ID" value={m.id} />
                  <MetaField label="Provider" value={provider} />
                  <MetaField label="Auth" value={m.auth_type} />
                  <MetaField label="API Key" value={m.provider_key_label ?? 'Default'} />
                  <MetaField label="Model" value={m.model ? getModelDisplayName(m.model) : null} />
                  <MetaField label="Model ID" value={m.model} />
                  <MetaField label="Trace" value={m.trace_id?.slice(0, 16)} />
                  <MetaField
                    label="Routing"
                    value={
                      m.virtual_model_name ??
                      m.header_tier_name ??
                      (m.specificity_category
                        ? m.specificity_category.replace(/_/g, ' ')
                        : routingTierLabel(m.routing_tier))
                    }
                  />
                  <MetaField label="Virtual model" value={m.virtual_model_name} />
                  <Show when={m.specificity_category}>
                    <MiscategorizeControl
                      messageId={m.id}
                      initiallyFlagged={m.specificity_miscategorized}
                    />
                  </Show>
                  <MetaField
                    label="Reason"
                    value={m.routing_reason === 'direct' ? 'DIRECT' : m.routing_reason}
                  />
                  <MetaField label="Service" value={m.service_type} />
                  <MetaField label="Session" value={m.session_key} />
                  <MetaField label="Description" value={m.description} />
                  <MetaField label="App" value={m.caller_attribution?.appName} />
                  <MetaField label="SDK" value={m.caller_attribution?.sdk} />
                  <MetaField label="Skill" value={m.skill_name} />
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
                      <div class="error-recovery-row__title">Error</div>
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
                              <td class="error-recovery-row__meta-label">Code</td>
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
                                  Read the docs for this error.
                                </span>
                              </td>
                            </tr>
                          </Show>
                          <Show when={formatErrorOrigin(m.error_origin)}>
                            <tr>
                              <td class="error-recovery-row__meta-label">Origin</td>
                              <td class="error-recovery-row__meta-value">
                                <strong>{formatErrorOrigin(m.error_origin)}</strong>
                                <span class="error-recovery-row__meta-hint">
                                  {m.error_origin === 'provider' &&
                                    'The LLM provider rejected the request.'}
                                  {m.error_origin === 'transport' &&
                                    'Network or connection failure.'}
                                  {m.error_origin === 'config' && 'Thinker configuration issue.'}
                                  {m.error_origin === 'policy' &&
                                    'A Thinker usage limit was reached.'}
                                  {m.error_origin === 'internal' && 'An unexpected Thinker error.'}
                                  {m.error_origin === 'request' &&
                                    'Your agent sent a request Thinker could not route. No provider was called.'}
                                </span>
                              </td>
                            </tr>
                          </Show>
                          <Show when={formatErrorClass(m.error_class)}>
                            <tr>
                              <td class="error-recovery-row__meta-label">Type</td>
                              <td class="error-recovery-row__meta-value">
                                <strong>{formatErrorClass(m.error_class)}</strong>
                                <span class="error-recovery-row__meta-hint">
                                  {m.error_class === 'invalid_request' &&
                                    'The request is malformed. Wrong parameter, unsupported value, or missing field.'}
                                  {m.error_class === 'rate_limit' &&
                                    'Too many requests. The provider is throttling.'}
                                  {m.error_class === 'auth' &&
                                    'Authentication failed. Invalid or expired API key.'}
                                  {m.error_class === 'billing' &&
                                    'The provider rejected the request for billing or quota reasons.'}
                                  {m.error_class === 'timeout' &&
                                    'The request timed out before the provider responded.'}
                                  {m.error_class === 'server_error' &&
                                    'The provider experienced an internal error.'}
                                  {m.error_class === 'no_provider_key' &&
                                    'No API key is configured for this provider.'}
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
                        <span class="recovery-card__title">fallback</span>
                      </div>
                      <p class="error-recovery-row__card-text" style="font-size: 12px;">
                        <strong>Attempt #{((m.fallback_index as number) ?? 0) + 1}:</strong> this
                        request was triggered by a fallback from{' '}
                        <strong>
                          {m.fallback_from_model
                            ? getModelDisplayName(m.fallback_from_model)
                            : 'unknown'}
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
                        <span class="recovery-card__title">fallback</span>
                      </div>
                      <p class="error-recovery-row__card-text">
                        A fallback was triggered after this error.
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
                            <span class="recovery-card__title">fallback</span>
                          </div>
                          <p class="recovery-card__phrase" style="font-size: 12px;">
                            <strong>Attempt #{((m.fallback_index as number) ?? 0) + 1}:</strong>{' '}
                            this request was triggered by a fallback from{' '}
                            <strong>
                              {m.fallback_from_model
                                ? getModelDisplayName(m.fallback_from_model)
                                : 'unknown'}
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
                  <h4>Provider attempts</h4>
                  <table class="details-table" aria-label="Provider attempts">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Provider</th>
                        <th>Model</th>
                        <th>Status</th>
                        <th>Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={m.attempts}>
                        {(attempt, index) => (
                          <tr>
                            <td>{index() + 1}</td>
                            <td>{attempt.provider ?? 'Unknown'}</td>
                            <td>{attempt.model ? getModelDisplayName(attempt.model) : '—'}</td>
                            <td>{attempt.status}</td>
                            <td>
                              {attempt.cost_usd == null
                                ? '—'
                                : `$${Number(attempt.cost_usd).toFixed(6)}`}
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
