import { OPEN_WEBUI_SESSION_HEADERS } from 'thinker-shared';
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

/** Open WebUI OpenAI API connection, with the chat id as the Thinker session. */
export default function OpenWebUISetup({ apiKey, keyPrefix, baseUrl }: Props) {
  const key = useSetupKey(apiKey, keyPrefix);

  return (
    <SetupCard>
      <SetupHint>
        <RichText
          text={t('harnesses.guides.openWebUI')}
          parts={{
            auto: <code className={CHIP}>auto</code>,
            models: <code className={CHIP}>/v1/models</code>,
          }}
        />
      </SetupHint>

      <OnboardFields label={t('harnesses.guides.values')}>
        {/* i18n-ignore: labels mirror the Open WebUI connection fields */}
        <OnboardField label="URL" value={baseUrl} copyable />
        {/* i18n-ignore: labels mirror the Open WebUI connection fields */}
        <OnboardField label="API Key">
          <KeyValue {...key.cell} />
        </OnboardField>
        {/* i18n-ignore: labels mirror the Open WebUI connection fields */}
        <OnboardField label="Headers" value={OPEN_WEBUI_SESSION_HEADERS} copyable />
      </OnboardFields>

      <SetupHint>
        <RichText
          text={t('harnesses.guides.openWebUIDocker')}
          parts={{
            localhost: <code className={CHIP}>localhost</code>,
            docker: <code className={CHIP}>host.docker.internal</code>,
          }}
        />
      </SetupHint>
      <SetupHint>
        <RichText
          text={t('harnesses.guides.openWebUISession')}
          parts={{
            header: <code className={CHIP}>x-session-key</code>,
            chatId: <code className={CHIP}>X-OpenWebUI-Chat-Id</code>,
            env: <code className={CHIP}>ENABLE_FORWARD_USER_INFO_HEADERS=true</code>,
          }}
        />{' '}
        <RichText
          text={t('harnesses.guides.openWebUITask')}
          parts={{ task: <code className={CHIP}>TASK_MODEL</code> }}
        />
      </SetupHint>
    </SetupCard>
  );
}
