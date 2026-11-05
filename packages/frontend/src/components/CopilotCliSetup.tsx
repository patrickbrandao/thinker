import { getCopilotCliProvidersSnippet, SNIPPET_CONTEXT_WINDOW } from 'thinker-shared';
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

/** Copilot CLI BYOK through `~/.copilot/providers.json`. */
export default function CopilotCliSetup({ apiKey, keyPrefix, baseUrl, virtualModels = [] }: Props) {
  const key = useSetupKey(apiKey, keyPrefix);

  return (
    <SetupCard>
      <SetupHint>
        <RichText
          text={t('harnesses.guides.copilotCli')}
          parts={{
            file: <code className={CHIP}>~/.copilot/providers.json</code>,
            cmd: <code className={CHIP}>copilot --model thinker/auto</code>,
          }}
        />
      </SetupHint>

      <SnippetBlock
        code={getCopilotCliProvidersSnippet(baseUrl, key.shown, virtualModels)}
        copyText={getCopilotCliProvidersSnippet(baseUrl, key.copy, virtualModels)}
        language="json"
        reveal={key.reveal}
      />

      <SetupHint>
        <RichText
          text={t('harnesses.guides.contextHint')}
          parts={{
            name: 'Copilot CLI',
            field: <code className={CHIP}>maxPromptTokens</code>,
            value: <code className={CHIP}>{SNIPPET_CONTEXT_WINDOW}</code>,
          }}
        />
      </SetupHint>
    </SetupCard>
  );
}
