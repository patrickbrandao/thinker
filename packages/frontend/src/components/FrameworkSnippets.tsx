import { useEffect, useState } from 'react';
import CopyButton from './CopyButton.jsx';
import {
  KeyValue,
  monoIconClass,
  OnboardField,
  OnboardFields,
  RevealButton,
  SnippetBlock,
} from './setup-ui.jsx';
import { cx } from './ui.jsx';
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

export default function FrameworkSnippets({
  apiKey,
  keyPrefix,
  baseUrl,
  hideFullKey,
  defaultToolkit,
  customHeaders,
  model: fixedModel,
  modelOptions,
}: Props) {
  const [activeTab, setActiveTab] = useState<ToolkitId>(() => defaultToolkit ?? getStoredToolkit());
  const [openaiLang, setOpenaiLang] = useState<OpenAILangId>(getStoredOpenAILang);
  const [openaiApi, setOpenaiApi] = useState<OpenAIApiId>('responses');
  const [keyRevealed, setKeyRevealed] = useState(!hideFullKey);
  const [pickedModel, setPickedModel] = useState('auto');

  const modelChoices: string[] =
    fixedModel || !modelOptions?.length ? [] : ['auto', ...modelOptions];
  const model = fixedModel || (modelChoices.includes(pickedModel) ? pickedModel : 'auto');

  useEffect(() => {
    if (defaultToolkit) setActiveTab(defaultToolkit);
  }, [defaultToolkit]);

  const hasFullKey = !!apiKey;
  const maskedKey = keyPrefix ? `${keyPrefix}...` : 'thk_YOUR_KEY';
  const copyKey = apiKey ?? maskedKey;
  const displayKey = hasFullKey && keyRevealed ? apiKey : maskedKey;
  const toggleKey = () => setKeyRevealed((v) => !v);

  const handleTabChange = (id: ToolkitId) => {
    setActiveTab(id);
    storeToolkit(id);
  };

  const handleLangChange = (id: OpenAILangId) => {
    setOpenaiLang(id);
    storeOpenAILang(id);
  };

  const snippetFor = (key: string) =>
    getSnippetForToolkit(activeTab, baseUrl, key, openaiLang, customHeaders, openaiApi, model);
  const language = getLangForToolkit(activeTab, openaiLang);
  const isSdk =
    activeTab === 'openai-sdk' || activeTab === 'anthropic-sdk' || activeTab === 'vercel-ai-sdk';
  const headerEntries = customHeaders ? Object.entries(customHeaders) : [];

  return (
    <div className="framework-snippets mt-3 flex flex-col gap-3">
      <div className="setup-method-tabs flex flex-col gap-3">
        {!defaultToolkit ? (
          <div
            className="tabs mb-0!"
            role="tablist"
            aria-label={t('harnesses.snippets.toolkitTabs')}
          >
            {TOOLKIT_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={cx('tab', activeTab === tab.id && 'is-active')}
                onClick={() => handleTabChange(tab.id)}
                role="tab"
                aria-selected={activeTab === tab.id}
              >
                {tab.icon ? (
                  <img
                    src={tab.icon}
                    alt=""
                    className={cx('tab-icon', monoIconClass(tab.icon))}
                    width="16"
                    height="16"
                  />
                ) : null}
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}

        {isSdk ? (
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="segmented toolkit-lang-toggle"
              role="tablist"
              aria-label={t('harnesses.snippets.language')}
            >
              {SDK_LANG_TOGGLE.map((lang) => (
                <button
                  key={lang.id}
                  type="button"
                  className={cx(
                    'inline-flex items-center gap-1.5',
                    openaiLang === lang.id && 'is-active',
                  )}
                  onClick={() => handleLangChange(lang.id)}
                  role="tab"
                  aria-selected={openaiLang === lang.id}
                >
                  <img src={lang.icon} alt="" width="14" height="14" />
                  {lang.label}
                </button>
              ))}
            </div>

            {activeTab === 'openai-sdk' ? (
              <div
                className="segmented toolkit-api-toggle"
                role="tablist"
                aria-label={t('harnesses.snippets.openaiApi')}
              >
                {OPENAI_API_TOGGLE.map((api) => (
                  <button
                    key={api.id}
                    type="button"
                    className={cx(openaiApi === api.id && 'is-active')}
                    onClick={() => setOpenaiApi(api.id)}
                    role="tab"
                    aria-selected={openaiApi === api.id}
                  >
                    {api.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {modelChoices.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="segmented toolkit-api-toggle"
              role="radiogroup"
              aria-label={t('harnesses.snippets.model')}
            >
              {modelChoices.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={cx(
                    'font-mono',
                    model === name && 'is-active bg-elev text-ink ring-1 ring-line',
                  )}
                  onClick={() => setPickedModel(name)}
                  role="radio"
                  aria-checked={model === name}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="setup-method-tabs__content">
          <SnippetBlock
            code={snippetFor(displayKey).code}
            copyText={snippetFor(copyKey).code}
            language={language}
            reveal={
              hasFullKey ? (
                <RevealButton revealed={keyRevealed} onToggle={toggleKey} inCode />
              ) : null
            }
          />
        </div>
      </div>

      <OnboardFields label={t('harnesses.snippets.connectionDetails')}>
        <OnboardField label={t('harnesses.snippets.baseUrl')} value={baseUrl} copyable />
        <OnboardField label={t('harnesses.snippets.apiKey')}>
          <KeyValue
            shown={displayKey}
            copyText={copyKey}
            canReveal={hasFullKey}
            revealed={keyRevealed}
            onToggle={toggleKey}
          />
        </OnboardField>
        <OnboardField label={t('harnesses.snippets.model')} value={model} copyable />
        {headerEntries.map(([key, value]) => (
          <OnboardField
            key={key}
            label={
              <>
                {t('harnesses.snippets.header')} <code className="font-mono">{key}</code>
              </>
            }
          >
            <code className="break-all font-mono text-[12px] text-ink">{value}</code>
            <CopyButton text={value} />
          </OnboardField>
        ))}
      </OnboardFields>
    </div>
  );
}
