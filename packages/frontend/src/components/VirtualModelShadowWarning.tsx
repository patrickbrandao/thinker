import { TriangleAlert } from 'lucide-react';
import { t } from '../i18n/index.js';

interface Props {
  /** Real model ids the virtual model's name matches, ignoring case. */
  shadows: readonly string[];
  /** Whether the virtual model is (or will be) enabled. */
  enabled: boolean;
  /** Set while previewing a name that is not saved yet. */
  preview?: boolean;
}

/**
 * Warning shown when a virtual model's name matches a real model id (ADR 0004,
 * section 6). While the virtual model is enabled, requests for those ids route
 * through it, and the real id disappears from `/v1/models`.
 */
export default function VirtualModelShadowWarning(props: Props) {
  const n = props.shadows.length;
  if (n === 0) return null;
  return (
    <div className="virtual-model-shadow notice is-warn flex items-start gap-2" role="note">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <span className="font-semibold">
          {props.preview
            ? n === 1
              ? t('models.shadow.matchesOne')
              : t('models.shadow.matchesMany', { n })
            : n === 1
              ? t('models.shadow.shadowsOne')
              : t('models.shadow.shadowsMany', { n })}
        </span>
        <span className="flex flex-wrap gap-1">
          {props.shadows.map((id) => (
            <code key={id} className="font-mono text-xs">
              {id}
            </code>
          ))}
        </span>
        <span>
          {props.enabled ? t('models.shadow.activeDesc') : t('models.shadow.inactiveDesc')}
        </span>
      </div>
    </div>
  );
}
