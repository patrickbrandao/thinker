import { getClaudeAppConfigSnippet } from 'thinker-shared';
import RichText from './RichText.jsx';
import {
  CHIP,
  KeyValue,
  OnboardField,
  OnboardFields,
  SetupCard,
  SetupHint,
  SnippetBlock,
  useSetupKey,
} from './setup-ui.jsx';
import { t } from '../i18n/index.js';

interface Props {
  apiKey: string | null;
  keyPrefix: string | null;
  baseUrl: string;
  /** Active virtual models of the harness, declared after `auto`. */
  virtualModels?: readonly string[];
}

/** Claude Desktop in third-party inference (gateway) mode. */
export default function ClaudeAppSetup({ apiKey, keyPrefix, baseUrl, virtualModels = [] }: Props) {
  const key = useSetupKey(apiKey, keyPrefix);
  const origin = baseUrl.replace(/\/v1\/?$/, '');

  return (
    <SetupCard>
      <SetupHint>
        <RichText
          text={t('harnesses.guides.claudeApp')}
          // i18n-ignore: option name in Claude Desktop
          parts={{ provider: <strong className="text-ink">Gateway</strong> }}
        />
      </SetupHint>

      <OnboardFields label={t('harnesses.guides.values')}>
        {/* i18n-ignore: labels mirror the Claude Desktop fields */}
        <OnboardField label="Gateway base URL" value={origin} copyable />
        {/* i18n-ignore: labels mirror the Claude Desktop fields */}
        <OnboardField label="Gateway API key">
          <KeyValue {...key.cell} />
        </OnboardField>
        {/* i18n-ignore: labels mirror the Claude Desktop fields */}
        <OnboardField label="Gateway auth scheme" value="bearer" />
      </OnboardFields>

      <SetupHint>
        <RichText
          text={t('harnesses.guides.claudeAppModels')}
          parts={{
            auto: <code className={CHIP}>auto</code>,
            key: <code className={CHIP}>inferenceModels</code>,
            behaves: <code className={CHIP}>behavesAs</code>,
          }}
        />
      </SetupHint>
      <SnippetBlock
        code={getClaudeAppConfigSnippet(baseUrl, key.shown, virtualModels)}
        copyText={getClaudeAppConfigSnippet(baseUrl, key.copy, virtualModels)}
        language="json"
        reveal={key.reveal}
      />

      <SetupHint>
        <RichText
          text={t('harnesses.guides.claudeAppRestart')}
          parts={{
            v1: <code className={CHIP}>/v1</code>,
            path: <code className={CHIP}>/v1/messages</code>,
          }}
        />
      </SetupHint>
    </SetupCard>
  );
}
