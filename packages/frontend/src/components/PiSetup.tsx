import { getPiModelsSnippet, SNIPPET_CONTEXT_WINDOW } from 'thinker-shared';
import RichText from './RichText.jsx';
import { CHIP, SetupCard, SetupHint, SnippetBlock, useSetupKey } from './setup-ui.jsx';
import { t } from '../i18n/index.js';

interface Props {
  apiKey: string | null;
  keyPrefix: string | null;
  baseUrl: string;
  /** Active virtual models of the harness, declared after `auto`. */
  virtualModels?: readonly string[];
}

/** Agent Pi through `~/.pi/agent/models.json`. */
export default function PiSetup({ apiKey, keyPrefix, baseUrl, virtualModels = [] }: Props) {
  const key = useSetupKey(apiKey, keyPrefix);

  return (
    <SetupCard>
      <SetupHint>
        <RichText
          text={t('harnesses.guides.pi')}
          parts={{
            file: <code className={CHIP}>~/.pi/agent/models.json</code>,
            cmd: <code className={CHIP}>/model</code>,
            compat: <code className={CHIP}>sendSessionAffinityHeaders</code>,
          }}
        />
      </SetupHint>

      <SnippetBlock
        code={getPiModelsSnippet(baseUrl, key.shown, virtualModels)}
        copyText={getPiModelsSnippet(baseUrl, key.copy, virtualModels)}
        language="json"
        reveal={key.reveal}
      />

      <SetupHint>
        <RichText
          text={t('harnesses.guides.contextHint')}
          parts={{
            name: 'Pi',
            field: <code className={CHIP}>contextWindow</code>,
            value: <code className={CHIP}>{SNIPPET_CONTEXT_WINDOW}</code>,
          }}
        />{' '}
        <RichText
          text={t('harnesses.guides.piReasoning')}
          parts={{
            reasoning: <code className={CHIP}>reasoning</code>,
            yes: <code className={CHIP}>true</code>,
            effort: <code className={CHIP}>reasoning_effort</code>,
            image: <code className={CHIP}>"image"</code>,
          }}
        />
      </SetupHint>
    </SetupCard>
  );
}
