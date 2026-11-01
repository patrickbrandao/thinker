import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Network } from 'lucide-react';
import { t } from '../../i18n/index.js';
import { useResource } from '../../lib/use-resource.js';
import {
  getProxyAssignment,
  listProxyProfiles,
  setProxyAssignment,
  type AssignmentMode,
  type ChainItem,
  type ProxyAssignment,
  type ProxyMode,
  type ProxyTargetType,
} from '../../services/api/proxies.js';
import { toast } from '../../services/toast-store.js';
import { Badge, Button, Panel } from '../ui.js';

export function chainText(chain: ChainItem[]): string {
  return chain
    .map((item) => (item.kind === 'direct' ? t('proxies.egress.direct') : item.name))
    .join(' → ');
}

/** Label of a mode: "Global proxy", "Direct" or "Profile X". */
export function modeLabel(mode: ProxyMode, profileName?: string | null): string {
  if (mode === 'direct') return t('proxies.assignment.direct');
  if (mode === 'profile') return t('proxies.assignment.profileNamed', { name: profileName ?? '?' });
  return t('proxies.assignment.global');
}

/** "Effective: Profile X (A → B)" / "Global proxy" / "Direct". */
export function EffectiveProxyBadge({ assignment }: { assignment: ProxyAssignment }) {
  const { mode, chain, profile_name, global } = assignment.effective;
  const label =
    mode === 'profile'
      ? `${modeLabel(mode, profile_name)}${chain.length ? ` (${chainText(chain)})` : ''}`
      : mode === 'global' && !global
        ? t('proxies.assignment.globalNone')
        : modeLabel(mode);
  const tone = mode === 'direct' ? 'neutral' : mode === 'global' ? 'info' : 'accent';
  return (
    <Badge tone={tone} title={global ?? undefined}>
      {label}
    </Badge>
  );
}

/** Select value: a mode, or `profile:<id>`. */
function encode(mode: AssignmentMode, profileId: string | null): string {
  return mode === 'profile' && profileId ? `profile:${profileId}` : mode;
}

/**
 * How a connection or a trigger leaves Thinker: inherit (connections: the
 * provider default; triggers: the global proxy), global proxy, direct or an
 * outbound profile.
 */
export default function OutboundProxyPanel({
  targetType,
  targetId,
  title,
  description,
  canManage,
  bare,
}: {
  targetType: ProxyTargetType;
  targetId: string;
  title?: string;
  description?: string;
  canManage: boolean;
  /** Render without the panel frame (inside a dialog). */
  bare?: boolean;
}) {
  const assignment = useResource(async () => {
    const res = await getProxyAssignment(targetType, targetId);
    // Anything but an assignment (older backend, unexpected payload) hides the section.
    if (!res || !res.effective) throw new Error('bad assignment');
    return res;
  }, [targetType, targetId]);
  const profiles = useResource(async () => (await listProxyProfiles())?.profiles ?? [], []);
  const [value, setValue] = useState('inherit');
  const [saving, setSaving] = useState(false);
  const isConnection = targetType === 'connection';

  useEffect(() => {
    if (assignment.data) setValue(encode(assignment.data.mode, assignment.data.profile_id));
  }, [assignment.data]);

  if (assignment.error) return null;

  const saved = assignment.data ? encode(assignment.data.mode, assignment.data.profile_id) : '';
  const dirty = !!assignment.data && value !== saved;
  const inherited = assignment.data?.inherited;

  const save = async () => {
    const [mode, profileId] = value.startsWith('profile:')
      ? (['profile', value.slice('profile:'.length)] as const)
      : ([value as AssignmentMode, null] as const);
    setSaving(true);
    try {
      assignment.setData(await setProxyAssignment(targetType, targetId, mode, profileId));
      toast.success(t('proxies.binding.saved'));
    } catch {
      // toasted
    } finally {
      setSaving(false);
    }
  };

  const body = (
    <div className="flex flex-col gap-3">
      {description ? <p className="m-0 text-sm text-muted">{description}</p> : null}
      {assignment.data ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">{t('proxies.binding.effectiveLabel')}</span>
          <EffectiveProxyBadge assignment={assignment.data} />
        </div>
      ) : (
        <p className="m-0 text-sm text-muted">{t('common.loading')}</p>
      )}
      {assignment.data ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="field w-auto min-w-[260px]"
            aria-label={t('proxies.binding.mode')}
            value={value}
            disabled={!canManage}
            onChange={(e) => setValue(e.currentTarget.value)}
          >
            <option value="inherit">
              {isConnection && inherited
                ? t('proxies.assignment.inheritProvider', {
                    mode: modeLabel(inherited.mode, inherited.profile_name),
                  })
                : t('proxies.assignment.inheritGlobal')}
            </option>
            {isConnection ? <option value="global">{t('proxies.assignment.global')}</option> : null}
            <option value="direct">{t('proxies.assignment.direct')}</option>
            {(profiles.data ?? []).map((p) => (
              <option key={p.id} value={`profile:${p.id}`}>
                {t('proxies.assignment.profileNamed', { name: p.name })}
              </option>
            ))}
          </select>
          {canManage ? (
            <>
              <Button size="sm" busy={saving} disabled={!dirty} onClick={() => void save()}>
                {t('common.save')}
              </Button>
              {dirty ? (
                <Button variant="ghost" size="sm" onClick={() => setValue(saved)}>
                  {t('common.cancel')}
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
      {canManage && profiles.data && profiles.data.length === 0 ? (
        <p className="hint m-0">
          {t('proxies.assignment.noProfiles')}{' '}
          <Link to="/proxy-servers?tab=profiles" className="link-action">
            {t('proxies.assignment.manageProfiles')}
          </Link>
        </p>
      ) : null}
    </div>
  );

  if (bare) {
    return (
      <div>
        <span className="label">{title ?? t('proxies.binding.title')}</span>
        {body}
      </div>
    );
  }
  return (
    <Panel title={title ?? t('proxies.binding.title')} icon={<Network aria-hidden="true" />}>
      {body}
    </Panel>
  );
}
