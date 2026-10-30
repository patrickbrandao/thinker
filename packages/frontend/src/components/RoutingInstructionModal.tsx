import { useState } from 'react';
import CopyButton from './CopyButton.jsx';
import ModelSelectDropdown from './ModelSelectDropdown.jsx';
import SetupStepAddProvider from './SetupStepAddProvider.jsx';
import { getAgentKey } from '../services/api.js';
import { listVirtualModels } from '../services/api/virtual-models.js';
import { installOrigin } from '../services/install-endpoints.js';
import { agentPlatformSignal } from '../services/agent-platform-store.js';
import { useSignal } from '../lib/signal.js';
import { useResource } from '../lib/use-resource.js';
import { platformIcon } from 'thinker-shared';
import { Button, Modal } from './ui.js';
import { t } from '../i18n/index.js';
import { ThemedIcon } from './setup-ui.js';

interface Props {
  open: boolean;
  mode: 'enable' | 'disable';
  agentName: string;
  connectedProvider?: string | null;
  onClose: () => void;
}

const DISABLE_LINES = (model: string) => [
  'openclaw config unset models.providers.thinker',
  'openclaw config unset agents.defaults.models.thinker/auto',
  `openclaw config set agents.defaults.model.primary ${model}`,
  'openclaw gateway restart',
];

export default function RoutingInstructionModal(props: Props) {
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const { platform, category } = useSignal(agentPlatformSignal);
  const isEnable = props.mode === 'enable';
  const loadEnable = props.open && isEnable;
  const modelOrPlaceholder = selectedModel ?? '<provider/model>';

  const apiKeyData = useResource(() => getAgentKey(props.agentName), [props.agentName], {
    enabled: loadEnable,
  });
  // Active virtual model names (ADR 0004), loaded quietly: setup still works
  // without them.
  const virtualModels = useResource(
    async () => {
      try {
        const list = await listVirtualModels(props.agentName);
        return list.filter((v) => v.enabled).map((v) => v.name);
      } catch {
        return [];
      }
    },
    [props.agentName],
    { enabled: loadEnable },
  );

  const baseUrl = `${installOrigin()}/v1`;
  const disableLines = DISABLE_LINES(modelOrPlaceholder);
  const icon = isEnable ? platformIcon(platform, category) : undefined;

  const title = isEnable ? (
    <span className="inline-flex items-center gap-2">
      {icon ? <ThemedIcon src={icon} size={24} className="platform-icon" /> : null}
      <span>
        {t('routing.instructions.setUpHarness')} <em>{props.agentName}</em>
      </span>
    </span>
  ) : (
    t('routing.instructions.deactivate')
  );

  return (
    <Modal
      open={props.open}
      wide
      title={title}
      label={isEnable ? undefined : t('routing.instructions.deactivate')}
      onClose={props.onClose}
    >
      <div className="flex flex-col gap-3">
        {isEnable ? (
          <>
            <p className="text-sm text-dim">{t('routing.instructions.connectDesc')}</p>
            <SetupStepAddProvider
              apiKey={apiKeyData.data?.apiKey ?? null}
              keyPrefix={apiKeyData.data?.keyPrefix ?? null}
              baseUrl={baseUrl}
              platform={platform}
              virtualModels={virtualModels.data ?? []}
            />
          </>
        ) : (
          <>
            <p className="text-sm text-dim">{t('routing.instructions.disableDesc')}</p>
            <p className="text-sm text-dim">{t('routing.instructions.pickModel')}</p>
            <div className="routing-modal__inline-picker">
              <ModelSelectDropdown
                selectedValue={selectedModel}
                onSelect={(cliValue) => setSelectedModel(cliValue)}
              />
            </div>
            <p className="text-sm text-dim">{t('routing.instructions.runCommands')}</p>
            <div className="modal-terminal overflow-hidden rounded-control border border-line bg-sunken">
              <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
                <span className="text-xs text-muted">{t('routing.instructions.terminal')}</span>
                <CopyButton text={disableLines.join('\n')} />
              </div>
              <div className="flex flex-col gap-2 overflow-x-auto px-3 py-2.5 font-mono text-xs text-dim">
                {disableLines.map((line) => (
                  <div key={line} className="whitespace-nowrap">
                    <span className="mr-2 select-none text-faint">$</span>
                    {/* i18n-ignore */}
                    <span className="text-ink">{line}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
        <div className="actions">
          <Button size="sm" onClick={() => props.onClose()}>
            {t('common.done')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
