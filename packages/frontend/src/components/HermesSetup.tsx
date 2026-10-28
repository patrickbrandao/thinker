import { useState } from 'react';
import CodeBlock from './CodeBlock.jsx';
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

const yaml = (baseUrl: string, key: string) =>
  `model:\n  provider: custom\n  base_url: ${baseUrl}\n  api_key: ${key}\n  default: auto`;

export default function HermesSetup({ apiKey, keyPrefix, baseUrl }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('cli');
  const [cliKeyRevealed, setCliKeyRevealed] = useState(false);
  const [wizKeyRevealed, setWizKeyRevealed] = useState(false);

  const masked = keyPrefix ? `${keyPrefix}...` : 'thk_YOUR_KEY';
  const copyKey = apiKey ?? masked;
  const cliKey = cliKeyRevealed && apiKey ? apiKey : masked;
  const wizKey = wizKeyRevealed && apiKey ? apiKey : masked;
  const toggleCli = () => setCliKeyRevealed((v) => !v);

  return (
    <SetupCard>
      <SetupHint>{t('harnesses.guides.hermesIntro')}</SetupHint>

      <SetupSegment
        full
        label={t('harnesses.guides.configMethod')}
        value={subTab}
        onChange={setSubTab}
        items={[
          { key: 'cli', label: t('harnesses.guides.hermesFileTab') },
          // i18n-ignore: names the Hermes command
          { key: 'wizard', label: 'Hermes onboard' },
        ]}
      />

      {subTab === 'cli' ? (
        <>
          <SetupHint>{t('harnesses.guides.hermesOpen')}</SetupHint>
          <CodeBlock code="hermes config edit" language="bash" />

          <SetupHint>
            <RichText
              text={t('harnesses.guides.hermesAdd')}
              parts={{
                section: <code className={CHIP}>model:</code>,
                file: <code className={CHIP}>config.yaml</code>,
              }}
            />
          </SetupHint>
          <SnippetBlock
            code={yaml(baseUrl, cliKey)}
            copyText={yaml(baseUrl, copyKey)}
            language="yaml"
            reveal={apiKey ? <RevealButton revealed={cliKeyRevealed} onToggle={toggleCli} /> : null}
          />

          <OnboardFields label={t('harnesses.guides.configValues')}>
            {/* i18n-ignore: YAML keys of config.yaml */}
            <OnboardField label="provider" value="custom" copyable />
            <OnboardField label="base_url" value={baseUrl} copyable />
            <OnboardField label="api_key">
              <KeyValue
                shown={cliKey}
                copyText={copyKey}
                canReveal={!!apiKey}
                revealed={cliKeyRevealed}
                onToggle={toggleCli}
              />
            </OnboardField>
            {/* i18n-ignore: YAML keys of config.yaml */}
            <OnboardField label="default" value="auto" copyable />
          </OnboardFields>
        </>
      ) : (
        <>
          <SetupHint>
            <RichText
              text={t('harnesses.guides.wizard')}
              // i18n-ignore: option name in the Hermes wizard
              parts={{ option: <strong className="text-ink">Custom endpoint</strong> }}
            />
          </SetupHint>
          <CodeBlock code="hermes model" language="bash" />
          <OnboardFields label={t('harnesses.guides.configValues')}>
            {/* i18n-ignore: labels mirror the Hermes wizard prompts */}
            <OnboardField label="API base URL" value={baseUrl} copyable />
            {/* i18n-ignore: labels mirror the Hermes wizard prompts */}
            <OnboardField label="API Key">
              <KeyValue
                shown={wizKey}
                copyText={copyKey}
                canReveal={!!apiKey}
                revealed={wizKeyRevealed}
                onToggle={() => setWizKeyRevealed((v) => !v)}
              />
            </OnboardField>
            {/* i18n-ignore: labels mirror the Hermes wizard prompts */}
            <OnboardField label="Model name" value="auto" copyable />
          </OnboardFields>
        </>
      )}
    </SetupCard>
  );
}
