import RichText from './RichText.jsx';
import {
  CHIP,
  KeyValue,
  OnboardField,
  OnboardFields,
  SetupCard,
  SetupHint,
  useSetupKey,
} from './setup-ui.jsx';
import { t } from '../i18n/index.js';

interface Props {
  apiKey: string | null;
  keyPrefix: string | null;
  baseUrl: string;
}

/** Chatwoot Captain: the endpoint is the bare origin, Chatwoot appends `/v1`. */
export default function ChatwootSetup({ apiKey, keyPrefix, baseUrl }: Props) {
  const key = useSetupKey(apiKey, keyPrefix);
  const origin = baseUrl.replace(/\/v1\/?$/, '');

  return (
    <SetupCard>
      <SetupHint>
        <RichText
          text={t('harnesses.guides.chatwoot')}
          parts={{
            v1: <code className={CHIP}>/v1</code>,
            double: <code className={CHIP}>/v1/v1</code>,
          }}
        />
      </SetupHint>

      <OnboardFields label={t('harnesses.guides.values')}>
        {/* i18n-ignore: labels mirror the Chatwoot Captain settings */}
        <OnboardField label="OpenAI API Key">
          <KeyValue {...key.cell} />
        </OnboardField>
        {/* i18n-ignore: labels mirror the Chatwoot Captain settings */}
        <OnboardField label="OpenAI API Endpoint" value={origin} copyable />
        {/* i18n-ignore: labels mirror the Chatwoot Captain settings */}
        <OnboardField label="OpenAI Model" value="auto" copyable />
      </OnboardFields>

      <SetupHint>{t('harnesses.guides.chatwootExtras')}</SetupHint>
    </SetupCard>
  );
}
