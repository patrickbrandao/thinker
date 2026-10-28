import FrameworkSnippets from './FrameworkSnippets.jsx';
import { getAgentKey } from '../services/api.js';
import { installOrigin } from '../services/install-endpoints.js';
import type { HeaderTier } from '../services/api/header-tiers.js';
import type { CustomProviderData } from '../services/api.js';
import { customProviderAliases, publicModelId } from '../services/public-model-id.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';
import { Button, Modal } from './ui.js';

interface Props {
  agentName: string;
  tier: HeaderTier;
  /** For the public `<alias>/<model>` id of a custom provider's model. */
  customProviders?: CustomProviderData[];
  onClose: () => void;
}

/**
 * Modal that shows SDK-specific code snippets for sending the tier's matching
 * header. Reuses {@link FrameworkSnippets} (the same tabbed UI used in the
 * onboarding wizard) with `customHeaders` filled from the tier's rule.
 */
export default function HeaderTierSnippetModal(props: Props) {
  const { data: keyData } = useResource(() => getAgentKey(props.agentName), [props.agentName]);

  const baseUrl = `${installOrigin()}/v1`;

  const customHeaders: Record<string, string> = {
    [props.tier.header_key]: props.tier.header_value,
  };

  // A custom provider's model shows its public id (`<alias>/<model>` when the
  // provider has an alias), not the internal `custom:<uuid>/<model>` key.
  const modelText = (): string => {
    const route = props.tier.override_route;
    if (!route) return t('routing.snippet.noModel');
    if (!route.provider?.startsWith('custom:')) return route.model;
    return publicModelId(route, customProviderAliases(props.customProviders));
  };

  const title = t('routing.snippet.title', { name: props.tier.name });

  return (
    <Modal
      open
      wide
      onClose={props.onClose}
      label={title}
      title={<span id="header-tier-snippet-title">{title}</span>}
    >
      <p className="header-tier-snippet__desc mb-4 text-sm text-dim">
        {t('routing.snippet.descBefore')} <code className="font-mono text-ink">{modelText()}</code>
        {t('routing.snippet.descAfter')}
      </p>

      <FrameworkSnippets
        apiKey={keyData?.apiKey ?? null}
        keyPrefix={keyData?.keyPrefix ?? null}
        baseUrl={baseUrl}
        customHeaders={customHeaders}
      />

      <div className="actions">
        <Button onClick={() => props.onClose()}>{t('common.done')}</Button>
      </div>
    </Modal>
  );
}
