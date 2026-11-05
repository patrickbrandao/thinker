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
}

/** Host part of the base URL, as `LANGFLOW_SSRF_ALLOWED_HOSTS` wants it. */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return '<thinker-host>';
  }
}

/** Langflow OpenAI Compatible provider, past its SSRF guard. */
export default function LangflowSetup({ apiKey, keyPrefix, baseUrl }: Props) {
  const key = useSetupKey(apiKey, keyPrefix);
  const env = `LANGFLOW_SSRF_ALLOWED_HOSTS=${hostOf(baseUrl)}`;

  return (
    <SetupCard>
      <SetupHint>{t('harnesses.guides.langflow')}</SetupHint>
      <SnippetBlock code={env} copyText={env} language="bash" />

      <SetupHint>
        <RichText
          text={t('harnesses.guides.langflowProvider')}
          parts={{
            auto: <code className={CHIP}>auto</code>,
            docker: <code className={CHIP}>host.docker.internal</code>,
          }}
        />
      </SetupHint>
      <OnboardFields label={t('harnesses.guides.values')}>
        {/* i18n-ignore: labels mirror the Langflow provider fields */}
        <OnboardField label="Base URL" value={baseUrl} copyable />
        {/* i18n-ignore: labels mirror the Langflow provider fields */}
        <OnboardField label="API Key">
          <KeyValue {...key.cell} />
        </OnboardField>
      </OnboardFields>
    </SetupCard>
  );
}
