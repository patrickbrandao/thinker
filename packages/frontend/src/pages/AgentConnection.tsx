import { useParams } from 'react-router';
import FrameworkSnippets from '../components/FrameworkSnippets.js';
import RichText from '../components/RichText.js';
import SetupStepAddProvider, { PLATFORM_TO_TOOLKIT } from '../components/SetupStepAddProvider.js';
import { Panel, Skel } from '../components/ui.js';
import { getAgentKey } from '../services/api.js';
import { listVirtualModels } from '../services/api/virtual-models.js';
import { installOrigin } from '../services/install-endpoints.js';
import { agentDisplayName } from '../services/agent-display-name.js';
import { agentPlatformSignal } from '../services/agent-platform-store.js';
import { useSignal } from '../lib/signal.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';

/**
 * Connection tab of a harness: the suggested setup for its type and the SDK
 * code examples, both fixed here instead of popping up after edits.
 */
export default function AgentConnection() {
  const params = useParams<{ agentName: string }>();
  const agentName = decodeURIComponent(params.agentName ?? '');
  const name = agentDisplayName() ?? agentName;
  const { platform } = useSignal(agentPlatformSignal);

  const apiKeyData = useResource(() => getAgentKey(agentName), [agentName]);
  const virtualModelList = useResource(
    () =>
      listVirtualModels(agentName).catch(() => [] as Awaited<ReturnType<typeof listVirtualModels>>),
    [agentName],
  );
  const virtualModels = (virtualModelList.data ?? []).filter((v) => v.enabled).map((v) => v.name);

  const keyData = apiKeyData.error ? undefined : apiKeyData.data;
  const apiKey = keyData?.apiKey ?? null;
  const keyPrefix = keyData?.keyPrefix ?? null;
  const baseUrl = `${installOrigin()}/v1`;
  const loading = apiKeyData.loading && !apiKeyData.data && !apiKeyData.error;
  // SDK-type harnesses already get the SDK snippets as their suggested setup.
  const setupIsSdk = !platform || platform === 'other' || !!PLATFORM_TO_TOOLKIT[platform];

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <title>
        {t('common.pageTitle', { page: t('harnesses.connection.pageTitle', { name }) })}
      </title>
      <p className="text-sm text-muted">{t('harnesses.connection.intro')}</p>

      {apiKeyData.error ? (
        <div className="notice is-warn" role="alert">
          <span>
            <RichText
              text={t('harnesses.settings.keyLoadError')}
              parts={{ rotate: <strong>{t('harnesses.settings.rotate')}</strong> }}
            />
          </span>
        </div>
      ) : null}

      <Panel title={t('harnesses.connection.setupTitle')}>
        {loading ? (
          <Skel width="100%" height={200} />
        ) : (
          <SetupStepAddProvider
            apiKey={apiKey}
            keyPrefix={keyPrefix}
            baseUrl={baseUrl}
            hideFullKey
            platform={platform}
            virtualModels={virtualModels}
          />
        )}
      </Panel>

      {setupIsSdk ? null : (
        <Panel title={t('harnesses.connection.sdkTitle')}>
          <p className="mb-3 text-sm text-dim">{t('harnesses.connection.sdkDesc')}</p>
          {loading ? (
            <Skel width="100%" height={200} />
          ) : (
            <FrameworkSnippets
              apiKey={apiKey}
              keyPrefix={keyPrefix}
              baseUrl={baseUrl}
              hideFullKey
              modelOptions={virtualModels}
            />
          )}
        </Panel>
      )}
    </div>
  );
}
