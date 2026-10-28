import { useState } from 'react';
import { useParams } from 'react-router';
import {
  disableProviderForAgent,
  enableProviderForAgent,
  getEnabledProviders,
  getAgentProviderDisableImpact,
  getCustomProviders,
  type AgentProviderDisableImpact,
} from '../services/api.js';
import { getProviders as getGlobalProviders } from '../services/api/providers.js';
import { PROVIDERS } from '../services/providers.js';
import { toast } from '../services/toast-store.js';
import { t, tMaybe } from '../i18n/index.js';
import ReadOnlyRegion from '../components/ReadOnlyRegion.jsx';
import { me, roleCan } from '../services/session-store.js';
import { providerIcon } from '../components/ProviderIcon.jsx';
import NoConnectionsPrompt from '../components/NoConnectionsPrompt.jsx';
import { Switch, cx } from '../components/ui.js';
import { useResource } from '../lib/use-resource.js';
import { useSignal } from '../lib/signal.js';

interface AgentProviderConnection {
  userProviderId: string;
  provider: string;
  authType: string;
  label: string;
  models: number;
}

export default function AgentProviders() {
  useSignal(me);
  const params = useParams<{ agentName: string }>();
  const agentName = decodeURIComponent(params.agentName ?? '');

  const providers = useResource(async () => {
    try {
      return (await getGlobalProviders()).providers;
    } catch {
      return [];
    }
  }, []);

  const access = useResource(async () => {
    try {
      return new Set((await getEnabledProviders(agentName)).enabled);
    } catch {
      return new Set<string>();
    }
  }, [agentName]);

  const customProviders = useResource(
    () => getCustomProviders(agentName).catch(() => []),
    [agentName],
  );

  const connections: AgentProviderConnection[] = [];
  for (const provider of providers.data ?? []) {
    for (const connection of provider.connections) {
      if (!connection.is_active) continue;
      connections.push({
        userProviderId: connection.id,
        provider: provider.provider,
        authType: provider.auth_type,
        label: connection.label,
        models: connection.cached_model_count || provider.total_models,
      });
    }
  }

  const [busy, setBusy] = useState<string | null>(null);

  const isEnabled = (userProviderId: string) => access.data?.has(userProviderId) ?? false;

  const providerName = (providerId: string) => {
    const known = PROVIDERS.find((provider) => provider.id === providerId);
    if (known) return known.name;
    if (providerId.startsWith('custom:')) {
      const customId = providerId.slice('custom:'.length);
      const custom = (customProviders.data ?? []).find((provider) => provider.id === customId);
      if (custom) return custom.name;
    }
    return providerId;
  };

  const enableConnection = async (userProviderId: string) => {
    setBusy(userProviderId);
    try {
      await enableProviderForAgent(agentName, userProviderId);
      await access.reload();
    } catch {
      // fetchMutate already surfaces the toast.
    } finally {
      setBusy(null);
    }
  };

  const handleToggle = async (connection: AgentProviderConnection) => {
    if (!isEnabled(connection.userProviderId)) {
      await enableConnection(connection.userProviderId);
      return;
    }

    setBusy(connection.userProviderId);

    // A provider whose models are wired into this harness's routing can't be
    // disabled — that would silently strip live tier assignments. Block it with
    // an error and tell the user to update routing first, rather than removing
    // the assignments for them.
    let impact: AgentProviderDisableImpact;
    try {
      impact = await getAgentProviderDisableImpact(agentName, connection.userProviderId);
    } catch {
      setBusy(null);
      toast.error(t('providers.agentAccess.impactCheckFailed'));
      return;
    }

    const affectedVirtuals = impact.affected_virtual_models ?? [];
    if (impact.affected_tiers.length > 0 || affectedVirtuals.length > 0) {
      setBusy(null);
      const virtualNames = [...new Set(affectedVirtuals.map((v) => `"${v.name}"`))];
      const usedBy =
        virtualNames.length > 0
          ? t('providers.agentAccess.usedByVirtual', virtualNames.join(', '), virtualNames.length)
          : '';
      toast.error(
        t('providers.agentAccess.cantDisable', {
          provider: providerName(connection.provider),
          usedBy,
        }),
      );
      return;
    }

    try {
      await disableProviderForAgent(agentName, connection.userProviderId);
      await access.reload();
    } catch {
      // fetchMutate already surfaces the toast.
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <p className="mb-4 text-sm text-muted">{t('providers.agentAccess.intro')}</p>

      <ReadOnlyRegion
        readOnly={!roleCan.manageProviders()}
        notice={t('providers.agentAccess.readOnly')}
      >
        {connections.length > 0 ? (
          <div className="table-wrap">
            <table className="data min-w-[600px] table-fixed">
              <colgroup>
                <col className="w-[220px]" />
                <col className="w-[120px]" />
                <col />
                <col className="w-[72px]" />
                <col className="w-[64px]" />
              </colgroup>
              <thead>
                <tr>
                  <th>{t('providers.agentAccess.colProvider')}</th>
                  <th>{t('providers.agentAccess.colType')}</th>
                  <th>{t('providers.agentAccess.colConnection')}</th>
                  <th>{t('providers.agentAccess.colModels')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {connections.map((connection) => {
                  const enabled = isEnabled(connection.userProviderId);
                  const name = providerName(connection.provider);
                  const icon = providerIcon(connection.provider, 20);
                  return (
                    <tr key={connection.userProviderId} className={cx(!enabled && 'opacity-55')}>
                      <td>
                        <span className="flex items-center gap-2.5">
                          {icon ? (
                            <span className="flex size-5 shrink-0 items-center">{icon}</span>
                          ) : (
                            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] bg-accent-tint text-[11px] font-semibold text-accent">
                              {name.charAt(0).toUpperCase()}
                            </span>
                          )}
                          <span className="row-title truncate">{name}</span>
                        </span>
                      </td>
                      <td>
                        <span className="text-xs text-muted">
                          {tMaybe(`providers.authBadge.${connection.authType}`) ??
                            connection.authType}
                        </span>
                      </td>
                      <td>
                        <span title={connection.label} className="block truncate text-muted">
                          {connection.label}
                        </span>
                      </td>
                      <td className="num">{connection.models || '-'}</td>
                      <td className="row-actions">
                        <Switch
                          checked={enabled}
                          disabled={busy === connection.userProviderId}
                          label={t(
                            enabled
                              ? 'providers.agentAccess.disableAria'
                              : 'providers.agentAccess.enableAria',
                            {
                              name,
                              label: connection.label,
                            },
                          )}
                          onChange={() => void handleToggle(connection)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <NoConnectionsPrompt />
        )}
      </ReadOnlyRegion>
    </div>
  );
}
