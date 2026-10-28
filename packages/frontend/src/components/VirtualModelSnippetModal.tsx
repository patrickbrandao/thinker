import FrameworkSnippets from './FrameworkSnippets.jsx';
import { getAgentKey } from '../services/api.js';
import { installOrigin } from '../services/install-endpoints.js';
import type { VirtualModel } from '../services/api/virtual-models.js';
import RichText from './RichText.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';
import { Button, Modal } from './ui.js';

interface Props {
  agentName: string;
  /** `auto` passes `{ name: 'auto', enabled: true }`. */
  virtualModel: Pick<VirtualModel, 'name' | 'enabled'>;
  onClose: () => void;
}

/**
 * Copyable example for a virtual model: the harness's base URL and key with
 * `model: "<name>"`. Reuses {@link FrameworkSnippets} with the model swapped in.
 */
export default function VirtualModelSnippetModal(props: Props) {
  const { data: keyData } = useResource(() => getAgentKey(props.agentName), [props.agentName]);

  const baseUrl = `${installOrigin()}/v1`;
  const title = t('models.snippet.title', { name: props.virtualModel.name });

  return (
    <Modal
      open
      wide
      onClose={props.onClose}
      label={title}
      title={<span id="virtual-model-snippet-title">{title}</span>}
    >
      <p className="virtual-model-snippet-modal__desc mb-4 text-sm text-dim">
        <RichText
          text={t('models.snippet.desc')}
          parts={{
            model: (
              <code className="font-mono text-ink">
                {/* i18n-ignore */}
                model: &quot;{props.virtualModel.name}&quot;
              </code>
            ),
            endpoint: <code className="font-mono text-ink">/v1/models</code>,
          }}
        />
      </p>
      {!props.virtualModel.enabled ? (
        <p className="virtual-model-snippet-modal__inactive notice is-warn mb-4">
          {t('models.snippet.inactive')}
        </p>
      ) : null}

      <FrameworkSnippets
        apiKey={keyData?.apiKey ?? null}
        keyPrefix={keyData?.keyPrefix ?? null}
        baseUrl={baseUrl}
        model={props.virtualModel.name}
      />

      <div className="actions">
        <Button onClick={() => props.onClose()}>{t('models.snippet.done')}</Button>
      </div>
    </Modal>
  );
}
