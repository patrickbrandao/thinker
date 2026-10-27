import { createSignal, Show, type Component } from 'solid-js';
import CopyButton from './CopyButton.jsx';
import RichText from './RichText.jsx';
import { t } from '../i18n/index.js';

interface Props {
  apiKey: string | null;
  keyPrefix: string | null;
  baseUrl: string;
}

const EyeIcon: Component<{ open: boolean }> = (props) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <Show
      when={props.open}
      fallback={
        <>
          <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
          <circle cx="12" cy="12" r="3" />
        </>
      }
    >
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </Show>
  </svg>
);

const SetupField: Component<{ label: string; value: string; copyable?: boolean }> = (props) => (
  <div class="setup-onboard-fields__row" role="listitem">
    <span class="setup-onboard-fields__label">{props.label}</span>
    <span class="setup-onboard-fields__value">
      <code>{props.value}</code>
      <Show when={props.copyable}>
        <CopyButton text={props.value} />
      </Show>
    </span>
  </div>
);

const N8nSetup: Component<Props> = (props) => {
  const [keyRevealed, setKeyRevealed] = createSignal(false);

  const hasFullKey = () => !!props.apiKey;
  const masked = () => (props.keyPrefix ? `${props.keyPrefix}...` : 'thk_YOUR_KEY');
  const copyKey = () => props.apiKey ?? masked();
  const visibleKey = () => (keyRevealed() && props.apiKey ? props.apiKey : masked());

  return (
    <div class="setup-agents-card">
      <p class="setup-step__desc">
        <RichText text={t('harnesses.guides.n8nIntro')} parts={{ auto: <code>auto</code> }} />
      </p>

      <p class="setup-method__hint">
        {t('harnesses.guides.n8nReference')}{' '}
        <a
          href="https://docs.n8n.io/integrations/builtin/credentials/openai/"
          target="_blank"
          rel="noreferrer"
        >
          {t('harnesses.guides.n8nDocs')}
        </a>
      </p>

      <div class="setup-onboard-fields" role="list" aria-label={t('harnesses.guides.n8nValues')}>
        {/* i18n-ignore: labels mirror the n8n credential fields */}
        <SetupField label="Base URL" value={props.baseUrl} copyable />
        <div class="setup-onboard-fields__row" role="listitem">
          {/* i18n-ignore: labels mirror the n8n credential fields */}
          <span class="setup-onboard-fields__label">API Key</span>
          <span class="setup-onboard-fields__value">
            <code>{visibleKey()}</code>
            <Show when={hasFullKey()}>
              <button
                class="setup-onboard-fields__eye"
                onClick={() => setKeyRevealed(!keyRevealed())}
                aria-label={
                  keyRevealed() ? t('harnesses.key.hideAria') : t('harnesses.key.revealAria')
                }
                title={keyRevealed() ? t('harnesses.key.hide') : t('harnesses.key.reveal')}
              >
                <EyeIcon open={keyRevealed()} />
              </button>
            </Show>
            <CopyButton text={copyKey()} />
          </span>
        </div>
        {/* i18n-ignore: labels mirror the n8n credential fields */}
        <SetupField label="Model" value="auto" copyable />
      </div>
    </div>
  );
};

export default N8nSetup;
