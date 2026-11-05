import { useState } from 'react';
import {
  getCodexKeyExportSnippet,
  getDeepSeekHarnessNativeSnippet,
  getDeepSeekHarnessPiAiSnippet,
} from 'thinker-shared';
import RichText from './RichText.jsx';
import {
  CHIP,
  SetupCard,
  SetupHint,
  SetupSegment,
  SnippetBlock,
  useSetupKey,
} from './setup-ui.jsx';
import { t } from '../i18n/index.js';

type Route = 'native' | 'pi-ai';

interface Props {
  apiKey: string | null;
  keyPrefix: string | null;
  baseUrl: string;
  /** Active virtual models of the harness, declared after `auto`. */
  virtualModels?: readonly string[];
}

const PROFILE_FILE = '$DSH_HOME/profiles/<profile>/cordis.patch.yml';

/**
 * DeepSeek Harness (dsh): the native route (Anthropic Messages, which sends
 * the dsh session id) or the pi-ai "Custom model API" route (Chat
 * Completions). Both read the key from `THINKER_API_KEY`.
 */
export default function DeepSeekHarnessSetup({
  apiKey,
  keyPrefix,
  baseUrl,
  virtualModels = [],
}: Props) {
  const [route, setRoute] = useState<Route>('native');
  const key = useSetupKey(apiKey, keyPrefix);
  const config =
    route === 'native'
      ? getDeepSeekHarnessNativeSnippet(baseUrl, virtualModels)
      : getDeepSeekHarnessPiAiSnippet(baseUrl, virtualModels);
  const file = <code className={CHIP}>{PROFILE_FILE}</code>;

  return (
    <SetupCard>
      <SetupHint>{t('harnesses.guides.deepSeekIntro')}</SetupHint>

      <SetupSegment
        full
        label={t('harnesses.guides.configMethod')}
        value={route}
        onChange={setRoute}
        items={[
          { key: 'native', label: t('harnesses.guides.deepSeekNativeTab') },
          { key: 'pi-ai', label: t('harnesses.guides.deepSeekPiTab') },
        ]}
      />

      <SetupHint>
        {route === 'native' ? (
          <RichText
            text={t('harnesses.guides.deepSeekNative')}
            parts={{
              file,
              profile: <code className={CHIP}>web</code>,
              path: <code className={CHIP}>/v1/messages</code>,
              auto: <code className={CHIP}>auto</code>,
            }}
          />
        ) : (
          <RichText
            text={t('harnesses.guides.deepSeekPi')}
            parts={{ file, v1: <code className={CHIP}>/v1</code> }}
          />
        )}
      </SetupHint>
      <SnippetBlock code={config} copyText={config} language="yaml" />

      <SetupHint>{t('harnesses.guides.deepSeekKey')}</SetupHint>
      <SnippetBlock
        code={getCodexKeyExportSnippet(key.shown)}
        copyText={getCodexKeyExportSnippet(key.copy)}
        language="bash"
        reveal={key.reveal}
      />
    </SetupCard>
  );
}
