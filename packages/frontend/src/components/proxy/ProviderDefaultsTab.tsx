import { useState } from 'react';
import { t } from '../../i18n/index.js';
import { useResource } from '../../lib/use-resource.js';
import {
  listProxyAssignments,
  listProxyProfiles,
  setProxyAssignment,
  type ProxyAssignmentRow,
} from '../../services/api/proxies.js';
import { PROVIDERS, type ProviderDef } from '../../services/providers.js';
import { toast } from '../../services/toast-store.js';
import ErrorState from '../ErrorState.js';
import { Panel } from '../ui.js';

type Kind = 'api_key' | 'subscription';

type Row = Pick<ProviderDef, 'id' | 'name'>;

const usageBased: Row[] = PROVIDERS.filter((p) => !p.localOnly && !p.subscriptionOnly);
const subscriptions: Row[] = PROVIDERS.filter((p) => !p.localOnly && p.supportsSubscription);

/**
 * Default outbound path of each provider, kept apart for usage-based (API
 * key) and subscription connections: global proxy, direct or a profile. A
 * connection can override it in its Manage dialog.
 */
export default function ProviderDefaultsTab() {
  const assignments = useResource(async () => {
    const res = await listProxyAssignments('provider');
    return {
      map: new Map((res?.assignments ?? []).map((r) => [r.target_id, r])),
      custom: res?.custom_providers ?? [],
    };
  }, []);
  const profiles = useResource(async () => (await listProxyProfiles())?.profiles ?? [], []);
  const [saving, setSaving] = useState<string | null>(null);

  if (assignments.error) {
    return <ErrorState error={assignments.error} onRetry={() => void assignments.reload()} />;
  }

  const change = async (targetId: string, value: string) => {
    const [mode, profileId] = value.startsWith('profile:')
      ? (['profile', value.slice('profile:'.length)] as const)
      : ([value as 'global' | 'direct', null] as const);
    setSaving(targetId);
    try {
      // "global" is the default: store no row.
      const saved = await setProxyAssignment(
        'provider',
        targetId,
        mode === 'global' ? 'inherit' : mode,
        profileId,
      );
      assignments.setData((prev) => {
        if (!prev) return prev;
        const next = new Map(prev.map);
        if (saved.mode === 'inherit') next.delete(targetId);
        else
          next.set(targetId, {
            target_type: 'provider',
            target_id: targetId,
            mode: saved.mode,
            profile_id: saved.profile_id,
            profile_name: saved.effective.profile_name ?? null,
          } satisfies ProxyAssignmentRow);
        return { ...prev, map: next };
      });
      toast.success(t('proxies.binding.saved'));
    } catch {
      // toasted
    } finally {
      setSaving(null);
    }
  };

  const section = (kind: Kind, providers: Row[]) => (
    <Panel
      title={
        kind === 'api_key'
          ? t('proxies.providerDefaults.usageBased')
          : t('proxies.providerDefaults.subscriptions')
      }
    >
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{t('proxies.providerDefaults.provider')}</th>
              <th>{t('proxies.providerDefaults.outbound')}</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => {
              const targetId = `${kind}:${p.id}`;
              const row = assignments.data?.map.get(targetId);
              const value =
                row?.mode === 'profile' && row.profile_id
                  ? `profile:${row.profile_id}`
                  : (row?.mode ?? 'global');
              return (
                <tr key={targetId}>
                  <td className="row-title">{p.name}</td>
                  <td>
                    <select
                      className="field w-auto min-w-[240px]"
                      aria-label={t('proxies.providerDefaults.selectLabel', { provider: p.name })}
                      value={value}
                      disabled={!assignments.data || saving === targetId}
                      onChange={(e) => void change(targetId, e.currentTarget.value)}
                    >
                      <option value="global">{t('proxies.assignment.global')}</option>
                      <option value="direct">{t('proxies.assignment.direct')}</option>
                      {(profiles.data ?? []).map((profile) => (
                        <option key={profile.id} value={`profile:${profile.id}`}>
                          {t('proxies.assignment.profileNamed', { name: profile.name })}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 max-w-3xl text-sm text-muted">{t('proxies.providerDefaults.subtitle')}</p>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {section('api_key', [...usageBased, ...(assignments.data?.custom ?? [])])}
        {section('subscription', subscriptions)}
      </div>
    </div>
  );
}
