import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { platformIcon } from 'thinker-shared';
import { getAgentKey } from '../services/api.js';
import { installOrigin } from '../services/install-endpoints.js';
import { useFocusTrap } from '../services/use-focus-trap.js';
import { useResource } from '../lib/use-resource.js';
import ErrorState from './ErrorState.jsx';
import SetupStepAddProvider from './SetupStepAddProvider.jsx';
import { useActiveVirtualModelNames } from './VirtualModelsHint.jsx';
import RichText from './RichText.jsx';
import { ThemedIcon } from './setup-ui.jsx';
import { Button, cx, IconButton } from './ui.jsx';
import { t } from '../i18n/index.js';

interface Props {
  open: boolean;
  agentName: string;
  apiKey?: string | null;
  agentPlatform?: string | null;
  agentCategory?: string | null;
  onClose: () => void;
  onDone?: () => void;
  onGoToRouting?: () => void;
}

export default function SetupModal({
  open,
  agentName,
  apiKey,
  agentPlatform,
  agentCategory,
  onClose,
  onDone,
  onGoToRouting,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(open, ref);
  const keyData = useResource(() => getAgentKey(agentName), [agentName], { enabled: open });
  const virtualModels = useActiveVirtualModelNames(open ? agentName : null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const icon = platformIcon(agentPlatform, agentCategory);
  const baseUrl = `${installOrigin()}/v1`;

  const handleGoToRouting = () => {
    onDone?.();
    onClose();
    onGoToRouting?.();
  };

  return createPortal(
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className="modal wide max-w-[600px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-modal-title"
        tabIndex={-1}
      >
        <div className="modal-head">
          <h2 id="setup-modal-title" className="flex min-w-0 items-center gap-2">
            {icon ? <ThemedIcon src={icon} size={24} className="shrink-0" /> : null}
            <span className="truncate">
              <RichText
                text={t('harnesses.setupModal.title')}
                parts={{ name: <em className="not-italic text-accent">{agentName}</em> }}
              />
            </span>
          </h2>
          <IconButton label={t('common.close')} onClick={onClose}>
            <X />
          </IconButton>
        </div>
        <div className="modal-body flex flex-col gap-4">
          <p className="text-sm text-dim">{t('harnesses.setupModal.desc')}</p>

          {keyData.error && !apiKey ? (
            <ErrorState
              error={keyData.error}
              title={t('harnesses.setupModal.keyErrorTitle')}
              message={t('harnesses.setupModal.keyErrorMessage')}
              onRetry={() => void keyData.reload()}
            />
          ) : (
            <SetupStepAddProvider
              apiKey={apiKey ?? keyData.data?.apiKey ?? null}
              keyPrefix={keyData.data?.keyPrefix ?? null}
              baseUrl={baseUrl}
              platform={agentPlatform}
              virtualModels={virtualModels}
            />
          )}

          <div className="actions flex justify-end">
            <Button className="setup-modal__next" onClick={handleGoToRouting}>
              {t('common.done')}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
