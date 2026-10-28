import { useState } from 'react';
import RichText from './RichText.jsx';
import { KeyValue, OnboardField, OnboardFields, SetupCard, SetupHint } from './setup-ui.jsx';
import { t } from '../i18n/index.js';

interface Props {
  apiKey: string | null;
  keyPrefix: string | null;
  baseUrl: string;
}

export default function N8nSetup({ apiKey, keyPrefix, baseUrl }: Props) {
  const [keyRevealed, setKeyRevealed] = useState(false);

  const masked = keyPrefix ? `${keyPrefix}...` : 'thk_YOUR_KEY';
  const copyKey = apiKey ?? masked;
  const visibleKey = keyRevealed && apiKey ? apiKey : masked;

  return (
    <SetupCard>
      <SetupHint>
        <RichText text={t('harnesses.guides.n8nIntro')} parts={{ auto: <code>auto</code> }} />
      </SetupHint>

      <SetupHint>
        {t('harnesses.guides.n8nReference')}{' '}
        <a
          href="https://docs.n8n.io/integrations/builtin/credentials/openai/"
          target="_blank"
          rel="noreferrer"
        >
          {t('harnesses.guides.n8nDocs')}
        </a>
      </SetupHint>

      <OnboardFields label={t('harnesses.guides.n8nValues')}>
        {/* i18n-ignore: labels mirror the n8n credential fields */}
        <OnboardField label="Base URL" value={baseUrl} copyable />
        {/* i18n-ignore: labels mirror the n8n credential fields */}
        <OnboardField label="API Key">
          <KeyValue
            shown={visibleKey}
            copyText={copyKey}
            canReveal={!!apiKey}
            revealed={keyRevealed}
            onToggle={() => setKeyRevealed((v) => !v)}
          />
        </OnboardField>
        {/* i18n-ignore: labels mirror the n8n credential fields */}
        <OnboardField label="Model" value="auto" copyable />
      </OnboardFields>
    </SetupCard>
  );
}
