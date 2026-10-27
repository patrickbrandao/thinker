import { createResource, Show, type Component } from 'solid-js';
import { getAgentKey } from '../services/api.js';
import { installOrigin } from '../services/install-endpoints.js';
import { platformIcon } from 'thinker-shared';
import ErrorState from './ErrorState.jsx';
import SetupStepAddProvider from './SetupStepAddProvider.jsx';
import { createActiveVirtualModelNames } from './VirtualModelsHint.jsx';
import RichText from './RichText.jsx';
import { t } from '../i18n/index.js';

const SetupModal: Component<{
  open: boolean;
  agentName: string;
  apiKey?: string | null;
  agentPlatform?: string | null;
  agentCategory?: string | null;
  onClose: () => void;
  onDone?: () => void;
  onGoToRouting?: () => void;
}> = (props) => {
  const [apiKeyData, { refetch: refetchKey }] = createResource(
    () => (props.open ? props.agentName : null),
    (n) => (n ? getAgentKey(n) : null),
  );

  const virtualModels = createActiveVirtualModelNames(() => (props.open ? props.agentName : null));

  const baseUrl = () => {
    return `${installOrigin()}/v1`;
  };

  const handleGoToRouting = () => {
    props.onDone?.();
    props.onClose();
    props.onGoToRouting?.();
  };

  return (
    <Show when={props.open}>
      <div
        class="modal-overlay setup-modal__overlay"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onClose();
        }}
      >
        <div
          class="modal-card setup-modal"
          style="max-width: 600px;"
          role="dialog"
          aria-modal="true"
          aria-labelledby="setup-modal-title"
        >
          <div class="setup-modal__header">
            <div class="modal-card__title" id="setup-modal-title">
              <Show when={platformIcon(props.agentPlatform, props.agentCategory)}>
                <img
                  src={platformIcon(props.agentPlatform, props.agentCategory)}
                  alt=""
                  width="28"
                  height="28"
                  class="platform-icon setup-modal__platform-icon"
                />
              </Show>
              <span class="setup-modal__title-text">
                <RichText
                  text={t('harnesses.setupModal.title')}
                  parts={{ name: <em>{props.agentName}</em> }}
                />
              </span>
            </div>
            <button
              class="modal__close"
              onClick={() => props.onClose()}
              aria-label={t('common.close')}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
          <p class="modal-card__desc">{t('harnesses.setupModal.desc')}</p>

          <Show
            when={!apiKeyData.error || !!props.apiKey}
            fallback={
              <ErrorState
                error={apiKeyData.error}
                title={t('harnesses.setupModal.keyErrorTitle')}
                message={t('harnesses.setupModal.keyErrorMessage')}
                onRetry={refetchKey}
              />
            }
          >
            <SetupStepAddProvider
              apiKey={props.apiKey ?? apiKeyData()?.apiKey ?? null}
              keyPrefix={apiKeyData()?.keyPrefix ?? null}
              baseUrl={baseUrl()}
              platform={props.agentPlatform}
              virtualModels={virtualModels()}
            />
          </Show>

          <div class="setup-modal__nav">
            <button class="setup-modal__next" onClick={handleGoToRouting}>
              {t('common.done')}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default SetupModal;
