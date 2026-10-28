import type { RoutingProvider } from '../services/api.js';
import { t } from '../i18n/index.js';
import { Modal } from './ui.js';

export interface KeyPickerModalProps {
  /** Display name of the provider (e.g. "Google"). */
  providerName: string;
  /** Display name of the model the user just picked (e.g. "Gemini 2.5 Pro"). */
  modelName: string;
  /** Active api_key chain for the provider, sorted by priority ASC. */
  keys: RoutingProvider[];
  /**
   * Called when the user picks a key. Pass `null` to leave the tier on Auto
   * (proxy resolves to the priority-0 / Primary key at request time).
   */
  onPick: (label: string | null) => void;
  onClose: () => void;
}

/** Asks which API key of a multi-key provider a route should pin. Mounted = open. */
export default function KeyPickerModal(props: KeyPickerModalProps) {
  return (
    <Modal
      open
      title={t('routing.keyPicker.title', { provider: props.providerName })}
      onClose={props.onClose}
    >
      <p className="mb-3 text-sm text-muted">
        {t('routing.keyPicker.pickingFor')} <strong className="text-ink">{props.modelName}</strong>
      </p>
      <ul
        role="list"
        aria-label={t('routing.keyPicker.choose', { provider: props.providerName })}
        className="flex flex-col gap-1.5"
      >
        {props.keys.map((k) => (
          <li key={k.id}>
            <button
              type="button"
              className="key-picker-modal__option w-full cursor-pointer rounded-control border border-line bg-elev px-3 py-2.5 text-left hover:border-line-strong hover:bg-s2"
              onClick={() => props.onPick(k.label)}
            >
              <div className="font-medium text-ink">{k.label}</div>
              <div className="font-mono text-xs text-muted">
                {k.key_prefix ? `${k.key_prefix}${'•'.repeat(8)}` : '••••••••••••'}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
