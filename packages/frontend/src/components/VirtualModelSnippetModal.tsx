import { type Component, createResource, Show } from 'solid-js';
import FrameworkSnippets from './FrameworkSnippets.jsx';
import { getAgentKey } from '../services/api.js';
import { installOrigin } from '../services/install-endpoints.js';
import type { VirtualModel } from '../services/api/virtual-models.js';

interface Props {
  agentName: string;
  virtualModel: VirtualModel;
  onClose: () => void;
}

/**
 * Copyable example for a virtual model: the harness's base URL and key with
 * `model: "<name>"`. Reuses {@link FrameworkSnippets}, as the header-tier
 * snippet modal does, with the model swapped in.
 */
const VirtualModelSnippetModal: Component<Props> = (props) => {
  const [keyData] = createResource(
    () => props.agentName,
    (n) => getAgentKey(n),
  );

  const baseUrl = (): string => `${installOrigin()}/v1`;

  return (
    <div
      class="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onClose();
      }}
    >
      <div
        class="modal-card virtual-model-snippet-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="virtual-model-snippet-title"
      >
        <div class="virtual-model-snippet-modal__header">
          <h2 id="virtual-model-snippet-title" class="virtual-model-snippet-modal__title">
            Use “{props.virtualModel.name}”
          </h2>
          <button class="modal__close" onClick={() => props.onClose()} aria-label="Close">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="m9.17 13.41-3.54 3.54a.996.996 0 0 0 .71 1.7c.26 0 .51-.1.71-.29l2.83-2.83L12 13.41l2.83 2.83 2.12 2.12c.2.2.45.29.71.29s.51-.1.71-.29a.996.996 0 0 0 0-1.41l-3.54-3.54L13.42 12l4.95-4.95a.996.996 0 1 0-1.41-1.41l-4.95 4.95-4.95-4.95a.996.996 0 1 0-1.41 1.41L10.6 12l-1.41 1.41Z" />
            </svg>
          </button>
        </div>
        <p class="modal-card__desc virtual-model-snippet-modal__desc">
          Send <code>model: "{props.virtualModel.name}"</code> with this harness's key. No header is
          needed, and clients that pick models from <code>/v1/models</code> list it there while it
          is active.
        </p>
        <Show when={!props.virtualModel.enabled}>
          <p class="virtual-model-snippet-modal__inactive">
            This virtual model is inactive. Activate it before sending requests, or they will be
            handled as a regular model id.
          </p>
        </Show>

        <FrameworkSnippets
          apiKey={keyData()?.apiKey ?? null}
          keyPrefix={keyData()?.keyPrefix ?? null}
          baseUrl={baseUrl()}
          model={props.virtualModel.name}
        />

        <div class="virtual-model-snippet-modal__footer">
          <button class="btn btn--primary" type="button" onClick={() => props.onClose()}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default VirtualModelSnippetModal;
