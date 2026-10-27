import { createEffect, createSignal, For, Show, type Component } from 'solid-js';
import CopyButton from './CopyButton.jsx';
import { highlight } from '../services/syntax-highlight.js';
import { t } from '../i18n/index.js';
import {
  type ToolkitId,
  type OpenAILangId,
  type OpenAIApiId,
  TOOLKIT_TABS,
  SDK_LANG_TOGGLE,
  OPENAI_API_TOGGLE,
  getStoredToolkit,
  storeToolkit,
  getStoredOpenAILang,
  storeOpenAILang,
  getSnippetForToolkit,
  getLangForToolkit,
} from '../services/framework-snippets.js';

interface Props {
  apiKey: string | null;
  keyPrefix: string | null;
  baseUrl: string;
  hideFullKey?: boolean;
  defaultToolkit?: ToolkitId;
  /**
   * Extra request headers to weave into every snippet (OpenAI's defaultHeaders,
   * Vercel AI's headers, LangChain's configuration.defaultHeaders, curl -H).
   * Used by the header-tier "How to send this" modal.
   */
  customHeaders?: Record<string, string>;
  /** Model the snippets send. Defaults to `auto`. */
  model?: string;
  /**
   * Extra model names the reader can pick from, next to `auto`: the
   * harness's active virtual models (ADR 0004). Ignored when `model` is set.
   */
  modelOptions?: readonly string[];
}

const EyeOpen: Component = () => (
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
    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeClosed: Component = () => (
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
    <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
    <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
    <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
    <path d="m2 2 20 20" />
  </svg>
);

const FrameworkSnippets: Component<Props> = (props) => {
  const [activeTab, setActiveTab] = createSignal<ToolkitId>(
    props.defaultToolkit ?? getStoredToolkit(),
  );
  const [openaiLang, setOpenaiLang] = createSignal<OpenAILangId>(getStoredOpenAILang());
  const [openaiApi, setOpenaiApi] = createSignal<OpenAIApiId>('responses');
  const [keyRevealed, setKeyRevealed] = createSignal(!props.hideFullKey);
  const [pickedModel, setPickedModel] = createSignal('auto');
  const modelChoices = (): string[] =>
    props.model || !props.modelOptions?.length ? [] : ['auto', ...props.modelOptions];
  const model = (): string => {
    if (props.model) return props.model;
    return modelChoices().includes(pickedModel()) ? pickedModel() : 'auto';
  };

  createEffect(() => {
    if (props.defaultToolkit) setActiveTab(props.defaultToolkit);
  });

  const hasFullKey = () => !!props.apiKey;
  const maskedKey = () => (props.keyPrefix ? `${props.keyPrefix}...` : 'thk_YOUR_KEY');
  const copyKey = () => props.apiKey ?? maskedKey();
  const displayKey = () => {
    if (!hasFullKey()) return maskedKey();
    return keyRevealed() ? props.apiKey! : maskedKey();
  };

  const handleTabChange = (id: ToolkitId) => {
    setActiveTab(id);
    storeToolkit(id);
  };

  const handleLangChange = (id: OpenAILangId) => {
    setOpenaiLang(id);
    storeOpenAILang(id);
  };

  const snippet = () =>
    getSnippetForToolkit(
      activeTab(),
      props.baseUrl,
      displayKey(),
      openaiLang(),
      props.customHeaders,
      openaiApi(),
      model(),
    );
  const snippetForCopy = () =>
    getSnippetForToolkit(
      activeTab(),
      props.baseUrl,
      copyKey(),
      openaiLang(),
      props.customHeaders,
      openaiApi(),
      model(),
    );
  const language = () => getLangForToolkit(activeTab(), openaiLang());

  const headerEntries = (): [string, string][] =>
    props.customHeaders ? Object.entries(props.customHeaders) : [];

  return (
    <div class="framework-snippets">
      <div class="setup-method-tabs">
        <Show when={!props.defaultToolkit}>
          <div class="panel__tabs" role="tablist" aria-label={t('harnesses.snippets.toolkitTabs')}>
            <For each={TOOLKIT_TABS}>
              {(tab) => (
                <button
                  class="panel__tab"
                  classList={{ 'panel__tab--active': activeTab() === tab.id }}
                  onClick={() => handleTabChange(tab.id)}
                  role="tab"
                  aria-selected={activeTab() === tab.id}
                >
                  <Show when={tab.icon}>
                    <img src={tab.icon} alt="" class="panel__tab-icon" width="16" height="16" />
                  </Show>
                  {tab.label}
                </button>
              )}
            </For>
          </div>
        </Show>

        <Show
          when={
            activeTab() === 'openai-sdk' ||
            activeTab() === 'anthropic-sdk' ||
            activeTab() === 'vercel-ai-sdk'
          }
        >
          <div class="framework-snippets__toggle-row">
            <div
              class="toolkit-lang-toggle"
              role="tablist"
              aria-label={t('harnesses.snippets.language')}
            >
              <For each={SDK_LANG_TOGGLE}>
                {(lang) => (
                  <button
                    class="toolkit-lang-toggle__btn"
                    classList={{ 'toolkit-lang-toggle__btn--active': openaiLang() === lang.id }}
                    onClick={() => handleLangChange(lang.id)}
                    role="tab"
                    aria-selected={openaiLang() === lang.id}
                  >
                    <img src={lang.icon} alt="" width="14" height="14" />
                    {lang.label}
                  </button>
                )}
              </For>
            </div>

            <Show when={activeTab() === 'openai-sdk'}>
              <div
                class="toolkit-api-toggle"
                role="tablist"
                aria-label={t('harnesses.snippets.openaiApi')}
              >
                <For each={OPENAI_API_TOGGLE}>
                  {(api) => (
                    <button
                      class="toolkit-api-toggle__btn"
                      classList={{ 'toolkit-api-toggle__btn--active': openaiApi() === api.id }}
                      onClick={() => setOpenaiApi(api.id)}
                      role="tab"
                      aria-selected={openaiApi() === api.id}
                    >
                      {api.label}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={modelChoices().length > 0}>
          <div class="framework-snippets__toggle-row">
            <div
              class="toolkit-api-toggle"
              role="radiogroup"
              aria-label={t('harnesses.snippets.model')}
            >
              <For each={modelChoices()}>
                {(name) => (
                  <button
                    type="button"
                    class="toolkit-api-toggle__btn"
                    classList={{ 'toolkit-api-toggle__btn--active': model() === name }}
                    onClick={() => setPickedModel(name)}
                    role="radio"
                    aria-checked={model() === name}
                  >
                    {name}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

        <div class="setup-method-tabs__content">
          <div class="setup-cli-block">
            <div class="setup-cli-block__actions">
              <Show when={hasFullKey()}>
                <button
                  class="modal-terminal__copy"
                  onClick={() => setKeyRevealed(!keyRevealed())}
                  aria-label={
                    keyRevealed()
                      ? t('harnesses.key.hideInCodeAria')
                      : t('harnesses.key.revealInCodeAria')
                  }
                  title={keyRevealed() ? t('harnesses.key.hide') : t('harnesses.key.reveal')}
                >
                  {keyRevealed() ? <EyeClosed /> : <EyeOpen />}
                </button>
              </Show>
              <CopyButton text={snippetForCopy().code} />
            </div>
            <div class="setup-method__code">
              <pre style="margin: 0; white-space: pre-wrap; word-break: break-all;">
                <code
                  class={`hljs language-${language()}`}
                  innerHTML={highlight(snippet().code, language())}
                />
              </pre>
            </div>
          </div>
        </div>
      </div>

      <div
        class="setup-onboard-fields"
        role="list"
        aria-label={t('harnesses.snippets.connectionDetails')}
      >
        <div class="setup-onboard-fields__row" role="listitem">
          <span class="setup-onboard-fields__label">{t('harnesses.snippets.baseUrl')}</span>
          <span class="setup-onboard-fields__value">
            <code>{props.baseUrl}</code>
            <CopyButton text={props.baseUrl} />
          </span>
        </div>
        <div class="setup-onboard-fields__row" role="listitem">
          <span class="setup-onboard-fields__label">{t('harnesses.snippets.apiKey')}</span>
          <span class="setup-onboard-fields__value">
            <code>{displayKey()}</code>
            <Show when={hasFullKey()}>
              <button
                class="setup-onboard-fields__eye"
                onClick={() => setKeyRevealed(!keyRevealed())}
                aria-label={
                  keyRevealed() ? t('harnesses.key.hideAria') : t('harnesses.key.revealAria')
                }
                title={keyRevealed() ? t('harnesses.key.hide') : t('harnesses.key.reveal')}
              >
                {keyRevealed() ? <EyeClosed /> : <EyeOpen />}
              </button>
            </Show>
            <CopyButton text={copyKey()} />
          </span>
        </div>
        <div class="setup-onboard-fields__row" role="listitem">
          <span class="setup-onboard-fields__label">{t('harnesses.snippets.model')}</span>
          <span class="setup-onboard-fields__value">
            <code>{model()}</code>
            <CopyButton text={model()} />
          </span>
        </div>
        <For each={headerEntries()}>
          {([key, value]) => (
            <div class="setup-onboard-fields__row" role="listitem">
              <span class="setup-onboard-fields__label">
                {t('harnesses.snippets.header')} <code>{key}</code>
              </span>
              <span class="setup-onboard-fields__value">
                <code>{value}</code>
                <CopyButton text={value} />
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

export default FrameworkSnippets;
