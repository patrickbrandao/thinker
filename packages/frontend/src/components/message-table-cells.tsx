import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import { routingTierLabel, type MessageRow, type MessageColumnKey } from './message-table-types.js';
import InfoTooltip from './InfoTooltip.js';
import {
  formatCost,
  formatNumber,
  formatDateTime,
  formatDuration,
  customProviderColor,
  usd,
} from '../services/formatters.js';
import {
  inferProviderFromModel,
  inferProviderName,
  resolveProviderId,
  stripCustomPrefix,
} from '../services/routing-utils.js';
import { PROVIDERS } from '../services/providers.js';
import { getModelDisplayName } from '../services/model-display.js';
import { providerIcon, customProviderLogo } from './ProviderIcon.js';
import { authBadgeFor, authLabel } from './AuthBadge.js';
import { platformIcon, isSuccessStatus } from 'thinker-shared';
import { tMaybe, t } from '../i18n/index.js';
import { cx } from './ui.js';
import { ThemedIcon } from './setup-ui.js';

const MONO = 'font-mono';
const MONO_XS = 'font-mono text-xs text-muted';
const DASH = '—';

export function HeartbeatIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

export function FallbackIcon() {
  return (
    <span className="fallback-icon inline-flex shrink-0 items-center">
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
  );
}

const headerLabel = (key: MessageColumnKey, tooltips?: boolean): string =>
  key === 'totalTokens' && tooltips
    ? t('messages.table.header.totalTokensLong')
    : (tMaybe(`messages.table.header.${key}`) ?? key);

const tooltipText = (key: MessageColumnKey): string | undefined =>
  tMaybe(`messages.table.tooltip.${key}`);

export function columnHeader(key: MessageColumnKey, tooltips?: boolean): ReactNode {
  const tip = tooltipText(key);
  return tip !== undefined && (tooltips || key !== 'totalTokens') ? (
    <span className="inline-flex items-center gap-1">
      {headerLabel(key, tooltips)}
      <InfoTooltip text={tip} />
    </span>
  ) : (
    headerLabel(key, tooltips)
  );
}

export function DateCell(item: MessageRow) {
  return (
    <td className={cx('w-[1%] whitespace-nowrap', MONO_XS)}>{formatDateTime(item.timestamp)}</td>
  );
}

export function ClientIpCell(item: MessageRow) {
  return <td className={cx('w-[1%] whitespace-nowrap', MONO_XS)}>{item.client_ip || '—'}</td>;
}

export function MessageCell(item: MessageRow) {
  return (
    <td className={MONO_XS}>
      {item.id.slice(0, 8)}
      {item.routing_reason === 'heartbeat' && (
        <span
          title={t('messages.table.heartbeat')}
          className="ml-1 inline-flex items-center align-middle text-faint"
        >
          <HeartbeatIcon />
        </span>
      )}
    </td>
  );
}

export function CostCell(item: MessageRow) {
  // Subscription rows with a non-zero cost are per-request subscriptions
  // like OpenCode Go (docs-attributed $/request). Flat-fee subscriptions
  // (Claude Max, ChatGPT Plus, GLM Coding, Copilot) report $0 and keep the
  // "Included in subscription" treatment.
  const isPerRequestSubscription =
    item.auth_type === 'subscription' && item.cost != null && item.cost > 0;
  if (item.auth_type === 'subscription' && !isPerRequestSubscription) {
    return (
      <td className={MONO}>
        <span className="text-muted" title={t('messages.table.includedInSubscription')}>
          {usd(0, 2)}
        </span>
      </td>
    );
  }
  const title = isPerRequestSubscription
    ? t('messages.table.perRequestCost', { amount: usd(Number(item.cost!), 6) })
    : item.cost != null && Number(item.cost) > 0 && Number(item.cost) < 0.01
      ? usd(Number(item.cost), 6)
      : undefined;
  return (
    <td className={MONO}>
      <span title={title}>{item.cost != null ? (formatCost(item.cost) ?? DASH) : DASH}</span>
    </td>
  );
}

/**
 * Resolve the provider ID for a message row. Prefers the stored `provider`
 * column (populated by the proxy from routing resolution) over inference from
 * the model name prefix, which is ambiguous for subscription providers like
 * Ollama Cloud whose catalog includes models named after other vendors
 * (e.g. `deepseek-v3.2`, `kimi-k2:1t`, `gemma4:31b`).
 */
function resolveMessageProvider(item: MessageRow): string | undefined {
  if (item.provider) {
    const resolved = resolveProviderId(item.provider);
    if (resolved) return resolved;
  }
  if (item.model) return inferProviderFromModel(item.model) ?? undefined;
  return undefined;
}

function resolveMessageProviderName(item: MessageRow): string | undefined {
  const id = resolveMessageProvider(item);
  if (!id) return undefined;
  return (
    PROVIDERS.find((p) => p.id === id)?.name ?? (item.model ? inferProviderName(item.model) : id)
  );
}

function CustomProviderAvatar({ item }: { item: MessageRow }) {
  const customName = item.custom_provider_name ?? undefined;
  const logo = customProviderLogo(customName ?? '', 16, undefined, item.model ?? undefined);
  if (logo) return <>{logo}</>;
  const letter = (customName ?? stripCustomPrefix(item.model!)).charAt(0).toUpperCase();
  return (
    <span
      className="provider-card__logo-letter inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-[var(--avatar)] text-[9px] font-semibold text-on-accent"
      title={customName}
      // Per-provider identity color (data-derived, not a theme color).
      style={{ '--avatar': customProviderColor(customName ?? '') } as CSSProperties}
    >
      {letter}
    </span>
  );
}

function ModelTierBadge({ item }: { item: MessageRow }) {
  if (item.virtual_model_name) {
    return (
      <span
        className="tier-badge tier-badge--virtual badge is-accent"
        title={t('messages.table.virtualModel', { name: item.virtual_model_name })}
      >
        {item.virtual_model_name}
      </span>
    );
  }
  if (item.specificity_category) {
    return (
      <span className="tier-badge tier-badge--specificity badge is-info">
        {item.specificity_category.replace(/_/g, ' ')}
      </span>
    );
  }
  if (item.routing_tier && item.routing_tier !== 'fallback') {
    const hint =
      item.routing_tier === 'direct'
        ? t('messages.table.directTier')
        : item.routing_tier === 'default'
          ? t('messages.table.defaultTier')
          : undefined;
    return (
      <span
        className={cx(
          `tier-badge tier-badge--${item.routing_tier} badge`,
          item.routing_tier === 'direct' && 'is-outline',
        )}
        title={hint}
      >
        {routingTierLabel(item.routing_tier)}
      </span>
    );
  }
  return null;
}

export function ModelCell(item: MessageRow) {
  const provId = resolveMessageProvider(item);
  const provName = resolveMessageProviderName(item);
  // Custom providers are identified by either the literal 'custom' (from
  // inferProviderFromModel on a `custom:...` model name) or by a stored
  // provider column of the form `custom:<uuid>` (from resolveProviderId,
  // which returns custom-prefixed IDs unchanged). Their display name arrives
  // pre-resolved from the backend as `custom_provider_name` (null when the
  // provider was deleted).
  const isCustomProvider = provId === 'custom' || provId?.startsWith('custom:') === true;
  const label = `${provName ?? provId} (${authLabel(item.auth_type)})`;
  return (
    <td className={MONO_XS}>
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        {item.model && isCustomProvider ? (
          <CustomProviderAvatar item={item} />
        ) : provId ? (
          <span
            role="img"
            aria-label={label}
            title={label}
            className="relative inline-flex size-3.5 shrink-0 text-ink"
          >
            {providerIcon(provId, 14)}
            {authBadgeFor(item.auth_type, 8)}
          </span>
        ) : null}
        {item.model
          ? item.model.startsWith('custom:')
            ? stripCustomPrefix(item.model)
            : getModelDisplayName(item.model)
          : DASH}
        <ModelTierBadge item={item} />
      </span>
    </td>
  );
}

export function TokenCell(value: number | null) {
  return <td className={cx('w-[130px]', MONO)}>{value != null ? formatNumber(value) : DASH}</td>;
}

export function SmallTokenCell(value: number | null) {
  return <td className={cx('w-[102px]', MONO_XS)}>{value != null ? formatNumber(value) : DASH}</td>;
}

export function CacheCell(item: MessageRow) {
  const has = (item.cache_read_tokens ?? 0) > 0 || (item.cache_creation_tokens ?? 0) > 0;
  return (
    <td className={cx('w-[192px] whitespace-nowrap', MONO_XS)}>
      {has
        ? t('messages.table.cache', {
            read: formatNumber(item.cache_read_tokens ?? 0),
            write: formatNumber(item.cache_creation_tokens ?? 0),
          })
        : DASH}
    </td>
  );
}

export function DurationCell(item: MessageRow) {
  return (
    <td className={cx('whitespace-nowrap', MONO_XS)}>
      {item.duration_ms != null ? formatDuration(item.duration_ms) : DASH}
    </td>
  );
}

export function AgentCell(
  item: MessageRow,
  platformLookup?: (
    name: string,
  ) => { platform: string | null; category: string | null } | undefined,
) {
  const info = item.agent_name && platformLookup ? platformLookup(item.agent_name) : undefined;
  const icon = info?.platform ? platformIcon(info.platform, info.category) : undefined;
  return (
    <td className="whitespace-nowrap text-xs font-medium text-ink">
      <span className="inline-flex items-center gap-1.5">
        {icon ? <ThemedIcon src={icon} size={14} className="platform-icon shrink-0" /> : null}
        {item.agent_name ?? DASH}
      </span>
    </td>
  );
}

/** `attempts / recovery attempts`, e.g. `3 / 2` when two fallbacks ran. */
export function AttemptsCell(item: MessageRow) {
  const attempts = item.attempt_count ?? 1;
  const recovery = item.recovery_count ?? (item.fallback_from_model ? 1 : 0);
  return (
    <td
      className={cx('whitespace-nowrap', MONO_XS)}
      title={t('messages.table.attemptsTitle', { attempts, recovery })}
    >
      {attempts} / {recovery}
    </td>
  );
}

/**
 * Compact origin descriptor appended to "Failed" (e.g. "Failed: Provider").
 */
function statusErrorDescriptor(item: MessageRow): string | null {
  return item.error_origin
    ? (tMaybe(`messages.table.errorDescriptor.${item.error_origin}`) ?? null)
    : null;
}

export type StatusShape = 'success' | 'fallback' | 'failed' | 'limit' | 'pending' | 'cancelled';

/**
 * The outcome as one shape, so the column reads at a glance: green circle
 * (success), amber triangle (succeeded through a fallback), red square
 * (failed), red octagon (a Thinker limit stopped it), hollow blue circle
 * (pending), gray diamond (cancelled by the caller). The label rides as the
 * tooltip and the accessible name.
 */
export function statusShape(item: MessageRow): StatusShape {
  if (isSuccessStatus(item.status)) return item.fallback_from_model ? 'fallback' : 'success';
  if (item.status === 'pending') return 'pending';
  if (item.status === 'cancelled') return 'cancelled';
  return item.error_origin === 'policy' ? 'limit' : 'failed';
}

function statusLabel(shape: StatusShape, item: MessageRow): string {
  switch (shape) {
    case 'success':
      return t('messages.table.success');
    case 'fallback':
      return t('messages.table.successFallback');
    case 'pending':
      return t('messages.table.pending');
    case 'cancelled':
      return t('messages.table.cancelled');
    case 'limit':
      return t('messages.table.limitReached');
    case 'failed': {
      const origin = statusErrorDescriptor(item);
      return origin ? `${t('messages.table.failed')}: ${origin}` : t('messages.table.failed');
    }
  }
}

export function StatusShapeIcon({ shape }: { shape: StatusShape }) {
  const common = { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true } as const;
  switch (shape) {
    case 'success':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="5" fill="var(--ok)" />
        </svg>
      );
    case 'fallback':
      return (
        <svg {...common}>
          <path d="M6 0.8 11.4 11H0.6Z" fill="var(--warn)" />
        </svg>
      );
    case 'failed':
      return (
        <svg {...common}>
          <rect x="1" y="1" width="10" height="10" rx="1" fill="var(--danger)" />
        </svg>
      );
    case 'limit':
      return (
        <svg {...common}>
          <path d="M3.9 0.5h4.2l3.4 3.4v4.2l-3.4 3.4H3.9L0.5 8.1V3.9Z" fill="var(--danger)" />
        </svg>
      );
    case 'pending':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4.2" fill="none" stroke="var(--info)" strokeWidth="1.8" />
        </svg>
      );
    case 'cancelled':
      return (
        <svg {...common}>
          <path d="M6 0.6 11.4 6 6 11.4 0.6 6Z" fill="var(--text-faint)" />
        </svg>
      );
  }
}

export function StatusCell(item: MessageRow, _agentName: string | undefined) {
  const shape = statusShape(item);
  const label = statusLabel(shape, item);
  const icon = (
    <span className="status-shape" role="img" aria-label={label} title={label}>
      <StatusShapeIcon shape={shape} />
    </span>
  );

  // A Thinker software limit links to its agent's limits page.
  if (shape === 'limit' && item.agent_name) {
    return (
      <td className="w-[1%]">
        <Link to={`/harnesses/${encodeURIComponent(item.agent_name)}/limits`}>{icon}</Link>
      </td>
    );
  }
  return <td className="w-[1%]">{icon}</td>;
}

export interface CellRenderContext {
  agentName?: string;
  customProviderName: (model: string) => string | undefined;
  agentPlatformLookup?: (
    name: string,
  ) => { platform: string | null; category: string | null } | undefined;
  onFallbackErrorClick?: (model: string) => void;
  onTriggerClick?: (id: string) => void;
}

export function renderCell(key: MessageColumnKey, item: MessageRow, ctx: CellRenderContext) {
  switch (key) {
    case 'date':
      return DateCell(item);
    case 'message':
      return MessageCell(item);
    case 'cost':
      return CostCell(item);
    case 'totalTokens':
      return TokenCell(item.total_tokens);
    case 'input':
      return SmallTokenCell(item.input_tokens);
    case 'output':
      return SmallTokenCell(item.output_tokens);
    case 'model':
      return ModelCell(item);
    case 'cache':
      return CacheCell(item);
    case 'duration':
      return DurationCell(item);
    case 'status':
      return StatusCell(item, ctx.agentName);
    case 'attempts':
      return AttemptsCell(item);
    case 'agent':
      return AgentCell(item, ctx.agentPlatformLookup);
    case 'clientIp':
      return ClientIpCell(item);
  }
}
