import { useState } from 'react';
import CodeBlock from './CodeBlock.jsx';
import { getOpenClawSnippet, getOpenClawWizardSnippet } from '../services/framework-snippets.js';
import RichText from './RichText.jsx';
import {
  CHIP,
  KeyValue,
  OnboardField,
  OnboardFields,
  RevealButton,
  SetupCard,
  SetupHint,
  SetupSegment,
  SnippetBlock,
} from './setup-ui.jsx';
import { t } from '../i18n/index.js';

type SubTab = 'cli' | 'wizard';

interface Props {
  apiKey: string | null;
  keyPrefix: string | null;
  baseUrl: string;
}

export default function OpenClawSetup({ apiKey, keyPrefix, baseUrl }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('cli');
  const [cliKeyRevealed, setCliKeyRevealed] = useState(false);
  const [wizKeyRevealed, setWizKeyRevealed] = useState(false);

  const masked = keyPrefix ? `${keyPrefix}...` : 'thk_YOUR_KEY';
  const copyKey = apiKey ?? masked;
  const cliKey = cliKeyRevealed && apiKey ? apiKey : masked;
  const wizKey = wizKeyRevealed && apiKey ? apiKey : masked;

  return (
    <SetupCard>
      <SetupHint>
        <RichText
          text={t('harnesses.guides.openClawIntro')}
          parts={{ model: <code className={CHIP}>thinker/auto</code> }}
        />
      </SetupHint>

      <SetupSegment
        full
        label={t('harnesses.guides.configMethod')}
        value={subTab}
        onChange={setSubTab}
        items={[
          { key: 'cli', label: t('harnesses.guides.openClawCliTab') },
          // i18n-ignore: names the openclaw command
          { key: 'wizard', label: 'openclaw onboard' },
        ]}
      />

      {subTab === 'cli' ? (
        <>
          <SetupHint>{t('harnesses.guides.openClawCli')}</SetupHint>
          <SnippetBlock
            code={getOpenClawSnippet(baseUrl, cliKey)}
            copyText={getOpenClawSnippet(baseUrl, copyKey)}
            language="bash"
            reveal={
              apiKey ? (
                <RevealButton
                  revealed={cliKeyRevealed}
                  onToggle={() => setCliKeyRevealed((v) => !v)}
                />
              ) : null
            }
          />
        </>
      ) : (
        <>
          <SetupHint>
            <RichText
              text={t('harnesses.guides.wizard')}
              // i18n-ignore: option name in the openclaw wizard
              parts={{ option: <strong className="text-ink">Custom Provider</strong> }}
            />
          </SetupHint>
          <CodeBlock code={getOpenClawWizardSnippet()} language="bash" />
          <OnboardFields label={t('harnesses.guides.configValues')}>
            {/* i18n-ignore: labels mirror the openclaw onboard prompts */}
            <OnboardField label="API Base URL" value={baseUrl} copyable />
            {/* i18n-ignore: labels mirror the openclaw onboard prompts */}
            <OnboardField label="API Key">
              <KeyValue
                shown={wizKey}
                copyText={copyKey}
                canReveal={!!apiKey}
                revealed={wizKeyRevealed}
                onToggle={() => setWizKeyRevealed((v) => !v)}
              />
            </OnboardField>
            <OnboardField
              // i18n-ignore: labels mirror the openclaw onboard prompts
              label="Endpoint compatibility"
              value="OpenAI Chat Completions-compatible"
            />
            {/* i18n-ignore: labels mirror the openclaw onboard prompts */}
            <OnboardField label="Model ID" value="auto" copyable />
            {/* i18n-ignore: labels mirror the openclaw onboard prompts */}
            <OnboardField label="Endpoint ID" value="thinker" copyable />
          </OnboardFields>
        </>
      )}
    </SetupCard>
  );
}
