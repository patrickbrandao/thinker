import { For, Show, type Component } from 'solid-js';
import { t } from '../i18n/index.js';

interface Props {
  /** Real model ids the virtual model's name matches, ignoring case. */
  shadows: readonly string[];
  /** Whether the virtual model is (or will be) enabled. */
  enabled: boolean;
  /** Set while previewing a name that is not saved yet. */
  preview?: boolean;
}

/**
 * Warning shown when a virtual model's name matches a real model id (ADR 0004,
 * section 6). While the virtual model is enabled, requests for those ids route
 * through it, and the real id disappears from `/v1/models`.
 */
const VirtualModelShadowWarning: Component<Props> = (props) => (
  <Show when={props.shadows.length > 0}>
    <div class="virtual-model-shadow" role="note">
      <svg
        class="virtual-model-shadow__icon"
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        fill="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M11 9h2v5h-2zm0 6h2v2h-2z" />
        <path d="M12.87 2.51c-.35-.63-1.4-.63-1.75 0l-9.99 18c-.17.31-.17.69.01.99.18.31.51.49.86.49h20c.35 0 .68-.19.86-.49a1 1 0 0 0 .01-.99zM3.7 20 12 5.06 20.3 20z" />
      </svg>
      <div>
        <span class="virtual-model-shadow__title">
          {props.preview
            ? props.shadows.length === 1
              ? t('models.shadow.matchesOne')
              : t('models.shadow.matchesMany', { n: props.shadows.length })
            : props.shadows.length === 1
              ? t('models.shadow.shadowsOne')
              : t('models.shadow.shadowsMany', { n: props.shadows.length })}
        </span>
        <span class="virtual-model-shadow__list">
          <For each={props.shadows}>{(id) => <code>{id}</code>}</For>
        </span>
        <span class="virtual-model-shadow__desc">
          {props.enabled ? t('models.shadow.activeDesc') : t('models.shadow.inactiveDesc')}
        </span>
      </div>
    </div>
  </Show>
);

export default VirtualModelShadowWarning;
