import { useState } from 'react';
import { t } from '../../i18n/index.js';
import { useResource } from '../../lib/use-resource.js';
import {
  listProxyAssignments,
  listProxyProfiles,
  setProxyAssignment,
  type ProxyAssignmentRow,
} from '../../services/api/proxies.js';
import { PROVIDERS } from '../../services/providers.js';
import { LOCAL_SERVER_TYPE_NAMES } from '../LocalServerForm.js';
import { toast } from '../../services/toast-store.js';
import ErrorState from '../ErrorState.js';
import { providerIcon } from '../ProviderIcon.js';
import { Panel } from '../ui.js';
import OutboundSelect, { baseOutboundOptions } from './OutboundSelect.js';

type Kind = 'local' | 'api_key' | 'subscription';

interface Row {
  id: string;
  name: string;
  /** Icon key for `providerIcon` (local servers use their type). */
  icon: string;
}

/** Local server types: every server of a type inherits its default. */
const localTypes: Row[] = Object.entries(LOCAL_SERVER_TYPE_NAMES).map(([id, name]) => ({
  id,
  name,
  icon: id,
}));
const usageBased: Row[] = PROVIDERS.filter((p) => !p.localOnly && !p.subscriptionOnly).map((p) => ({
  id: p.id,
  name: p.name,
  icon: p.id,
}));
const subscriptions: Row[] = PROVIDERS.filter((p) => !p.localOnly && p.supportsSubscription).map(
  (p) => ({ id: p.id, name: p.name, icon: p.id }),
);

function ProviderMark({ row }: { row: Row }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center">
      {providerIcon(row.icon, 32) ?? (
        <span className="flex size-8 items-center justify-center rounded-full bg-s3 text-sm font-semibold text-muted">
          {row.name.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

/**
 * Default outbound path of each provider, kept apart for local server types,
 * usage-based (API key) and subscription connections: the global default,
 * direct or a profile. A connection can override it in its Manage dialog.
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

  const custom = assignments.data?.custom ?? [];
  const usage: Row[] = [
    ...usageBased,
    ...custom.filter((c) => !c.local_type).map((c) => ({ id: c.id, name: c.name, icon: c.id })),
  ];
  const options = baseOutboundOptions(profiles.data ?? []);

  const change = async (targetId: string, value: string) => {
    const [mode, profileId] = value.startsWith('profile:')
      ? (['profile', value.slice('profile:'.length)] as const)
      : ([value as 'global' | 'direct', null] as const);
    setSaving(targetId);
    try {
      // The global default stores no row.
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

  const section = (kind: Kind, title: string, rows: Row[]) => (
    <Panel title={title}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => {
          const targetId = `${kind}:${row.id}`;
          const current = assignments.data?.map.get(targetId);
          const value =
            current?.mode === 'profile' && current.profile_id
              ? `profile:${current.profile_id}`
              : (current?.mode ?? 'global');
          return (
            <div
              key={targetId}
              className="flex flex-col gap-3 rounded-control border border-line bg-s2 p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <ProviderMark row={row} />
                <span className="truncate text-[18px] font-medium text-ink">{row.name}</span>
              </div>
              <OutboundSelect
                label={t('proxies.providerDefaults.selectLabel', { provider: row.name })}
                value={value}
                options={options}
                disabled={!assignments.data || saving === targetId}
                onChange={(next) => void change(targetId, next)}
              />
            </div>
          );
        })}
      </div>
    </Panel>
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 max-w-3xl text-sm text-muted">{t('proxies.providerDefaults.subtitle')}</p>
      {section('local', t('proxies.providerDefaults.locals'), localTypes)}
      {section('api_key', t('proxies.providerDefaults.usageBased'), usage)}
      {section('subscription', t('proxies.providerDefaults.subscriptions'), subscriptions)}
    </div>
  );
}
