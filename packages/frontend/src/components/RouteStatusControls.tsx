import { useState } from 'react';
import {
  CircleOff,
  FaceSlightlyFrowning,
  Lightbulb,
  LightbulbOff,
  type LucideIcon,
} from 'lucide-react';
import type { RouteChainKind, RouteStatus, RouteStatusInfo } from 'thinker-shared';
import { setRouteDisabled } from '../services/api/route-status.js';
import { t } from '../i18n/index.js';

/** Badge for a route that is not plainly active; nothing for an active one. */
export function RouteStatusBadge(props: { info: RouteStatusInfo | null | undefined }) {
  const info = props.info;
  if (!info || info.status === 'active') return null;
  const oosTitle =
    info.reason === 'provider_unavailable'
      ? t('routing.routeStatus.providerUnavailableTitle')
      : t('routing.routeStatus.modelMissingTitle');
  const [label, title, tone] =
    info.status === 'active_oos'
      ? [t('routing.routeStatus.outOfService'), oosTitle, 'is-warn']
      : info.status === 'disabled'
        ? [t('routing.routeStatus.disabled'), t('routing.routeStatus.disabledTitle'), '']
        : [
            t('routing.routeStatus.disabledOutOfService'),
            `${t('routing.routeStatus.disabledTitle')} ${oosTitle}`,
            '',
          ];
  return (
    <span
      className={`route-status-badge route-status-badge--${info.status} badge ${tone}`}
      title={title}
      aria-label={`${label}: ${title}`}
    >
      {label}
    </span>
  );
}

export interface RouteToggleTarget {
  agentName: string;
  chain: RouteChainKind;
  /** Virtual model id, tier slot or category. */
  chainKey: string;
}

/** Icon and color of the toggle for each status. */
const TOGGLE_LOOK: Record<RouteStatus, { Icon: LucideIcon; tone: string }> = {
  active: { Icon: Lightbulb, tone: 'text-ok' },
  disabled: { Icon: LightbulbOff, tone: 'text-danger' },
  active_oos: { Icon: FaceSlightlyFrowning, tone: 'text-attention' },
  disabled_oos: { Icon: CircleOff, tone: 'text-muted' },
};

/** Icon button that disables or re-enables one stored route. */
export function RouteStatusToggle(
  props: RouteToggleTarget & {
    position: 'primary' | number;
    info: RouteStatusInfo | null | undefined;
  },
) {
  const [busy, setBusy] = useState(false);
  if (!props.info) return null;
  const disabled = props.info.status === 'disabled' || props.info.status === 'disabled_oos';
  const label = disabled ? t('routing.routeStatus.enable') : t('routing.routeStatus.disable');
  // The icon shows the current status; clicking flips the administrator's choice.
  const { Icon, tone } = TOGGLE_LOOK[props.info.status];
  return (
    <button
      type="button"
      className={`route-status-toggle route-status-toggle--${props.info.status} icon-btn size-6 shrink-0 ${tone}`}
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try {
          await setRouteDisabled(props.agentName, {
            chain: props.chain,
            key: props.chainKey,
            position: props.position,
            disabled: !disabled,
          });
        } catch {
          // fetchMutate already showed the error.
        } finally {
          setBusy(false);
        }
      }}
    >
      <Icon aria-hidden="true" className="size-3.5" />
    </button>
  );
}

/** True when the route is stored as disabled by an administrator. */
export function isDisabledStatus(info: RouteStatusInfo | null | undefined): boolean {
  return info?.status === 'disabled' || info?.status === 'disabled_oos';
}
