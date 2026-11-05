import { ZAPIER_REQUEST_BODY } from 'thinker-shared';
import CopyButton from './CopyButton.jsx';
import RichText from './RichText.jsx';
import {
  CHIP,
  OnboardField,
  OnboardFields,
  RevealButton,
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

/** Webhooks by Zapier > Custom Request, the one Zapier path to a custom endpoint. */
export default function ZapierSetup({ apiKey, keyPrefix, baseUrl }: Props) {
  const key = useSetupKey(apiKey, keyPrefix);
  const url = `${baseUrl}/chat/completions`;

  return (
    <SetupCard>
      <SetupHint>
        <RichText
          text={t('harnesses.guides.zapier')}
          parts={{ localhost: <code className={CHIP}>localhost</code> }}
        />
      </SetupHint>

      <OnboardFields label={t('harnesses.guides.values')}>
        {/* i18n-ignore: labels mirror the Zapier Custom Request fields */}
        <OnboardField label="Method" value="POST" />
        {/* i18n-ignore: labels mirror the Zapier Custom Request fields */}
        <OnboardField label="URL" value={url} copyable />
        {/* i18n-ignore: header name */}
        <OnboardField label="Authorization">
          <code className="break-all font-mono text-[12px] text-ink">Bearer {key.shown}</code>
          {key.cell.canReveal ? (
            <RevealButton revealed={key.cell.revealed} onToggle={key.cell.onToggle} />
          ) : null}
          <CopyButton text={`Bearer ${key.copy}`} />
        </OnboardField>
        {/* i18n-ignore: header name */}
        <OnboardField label="Content-Type" value="application/json" copyable />
      </OnboardFields>

      <SetupHint>
        <RichText
          text={t('harnesses.guides.zapierBody')}
          parts={{
            stream: <code className={CHIP}>stream</code>,
            path: <code className={CHIP}>choices[0].message.content</code>,
          }}
        />
      </SetupHint>
      <SnippetBlock code={ZAPIER_REQUEST_BODY} copyText={ZAPIER_REQUEST_BODY} language="json" />

      <SetupHint>
        <RichText
          text={t('harnesses.guides.zapierSession')}
          parts={{ header: <code className={CHIP}>x-session-key</code> }}
        />
      </SetupHint>
    </SetupCard>
  );
}
